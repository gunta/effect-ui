// @vitest-environment happy-dom
import { UiSchema, View } from "@effect/ui"
import { BrowserHost, Html, HtmlServer } from "@effect/ui/html"
import * as HtmlHydrate from "@effect/ui/html/HtmlHydrate"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { collectGarbage } from "../utils/gc.ts"

// `Html.template` rows, shown with `h.list`: the browser host copies a row's
// nodes and writes its slots; every other reader sees the element the same
// view would build with the helper.

const tick = Effect.promise(() =>
  new Promise<void>((resolve) => setTimeout(resolve, 10))
)

const container = Effect.acquireRelease(
  Effect.sync(() => document.body.appendChild(document.createElement("div"))),
  (element) => Effect.sync(() => element.remove())
)

const Item = Schema.Struct({ id: Schema.Number, label: Schema.String })
type Item = typeof Item.Type

const Message = UiSchema.TaggedEnum({
  Set: { items: Schema.Array(Item) },
  Label: { id: Schema.Number, label: Schema.String },
  Select: { id: Schema.Number },
  Remove: { id: Schema.Number },
  Swap: { from: Schema.Number, to: Schema.Number },
  Hover: { id: Schema.Number }
})
type Message = typeof Message.Type

const Model = Schema.Struct({
  items: Schema.Array(Item),
  selected: Schema.Number,
  seen: Schema.Array(Schema.String)
})
type Model = typeof Model.Type

const update = (
  { model }: { readonly model: Model },
  message: Message
): Model => {
  switch (message._tag) {
    case "Set":
      return { ...model, items: message.items }
    case "Label":
      return {
        ...model,
        items: model.items.map((item) =>
          item.id === message.id ? { ...item, label: message.label } : item
        )
      }
    case "Select":
      return {
        ...model,
        selected: message.id,
        seen: [...model.seen, `select ${message.id}`]
      }
    case "Remove":
      return {
        ...model,
        items: model.items.filter((item) => item.id !== message.id),
        seen: [...model.seen, `remove ${message.id}`]
      }
    case "Swap": {
      const items = [...model.items]
      const from = items[message.from]!
      items[message.from] = items[message.to]!
      items[message.to] = from
      return { ...model, items }
    }
    case "Hover":
      return { ...model, seen: [...model.seen, `hover ${message.id}`] }
  }
}

const Row = Html.template<Message, {
  readonly key: string
  readonly label: string
  readonly state: string | undefined
  readonly select: Message
  readonly remove: Message
}>((h, $) =>
  h.li.key($.key).attr("data-static", "yes").class($.state).children(
    h.span.class("id").children($.key),
    h.a.on("click", $.select).on("focus", (_) => undefined).children(
      $.label
    ),
    h.button.on("click", $.remove).children(h.i.children("x"))
  )
)

const row = (_h: unknown, item: Item, selected: boolean) =>
  Row({
    key: String(item.id),
    label: item.label,
    state: selected ? "selected" : undefined,
    select: Message.Select({ id: item.id }),
    remove: Message.Remove({ id: item.id })
  })

const idOf = (item: Item) => item.id

const List = Html.component({ name: "List", model: Model, message: Message })
  .make({
    init: () => ({ items: [], selected: 0, seen: [] }),
    update,
    view: (h, model) =>
      h.ul.children(
        h.list(model.items, { key: idOf, selected: model.selected }, row)
      )
  })

const itemsOf = (from: number, count: number): Array<Item> =>
  Array.from({ length: count }, (_, index) => ({
    id: from + index,
    label: "item " + (from + index)
  }))

const expected = (model: Model): string =>
  model.items.map((item) =>
    `<li data-static="yes"${
      item.id === model.selected ? ` class="selected"` : ""
    }><span class="id">${item.id}</span><a>${item.label}</a><button><i>x</i></button></li>`
  ).join("")

describe("Html.template", { concurrent: false }, () => {
  it.effect("rows render, patch, move and dispatch like rows built with the helper", () =>
    Effect.gen(function*() {
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(List, {}, app)
      const list = () => app.querySelector("ul")!
      const check = () =>
        assert.strictEqual(list().innerHTML, expected(root.model()!))
      const send = (message: Message) =>
        Effect.andThen(Effect.sync(() => root.send(message)), tick)
      const link = (index: number) =>
        list().children[index]!.querySelector<HTMLElement>("a")!
      const button = (index: number) =>
        list().children[index]!.querySelector<HTMLElement>("button")!

      yield* send(Message.Set({ items: itemsOf(1, 10) }))
      check()
      link(2).click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, ["select 3"])

      // A changed label is written, and the row keeps its handlers' values.
      const third = list().children[2]
      yield* send(Message.Label({ id: 3, label: "changed" }))
      check()
      assert.strictEqual(list().children[2], third)
      link(4).click()
      button(0).click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, [
        "select 3",
        "select 5",
        "remove 1"
      ])

      // Rows move with their nodes, and their handlers follow them.
      const before = [...list().children]
      yield* send(Message.Swap({ from: 1, to: 7 }))
      check()
      assert.strictEqual(list().children[1], before[7])
      assert.strictEqual(list().children[7], before[1])
      link(1).click()
      yield* tick
      assert.strictEqual(root.model()!.selected, root.model()!.items[1]!.id)

      // Neighbours trade places, and the first row trades with the last.
      const next = [...list().children]
      yield* send(Message.Swap({ from: 3, to: 4 }))
      check()
      assert.deepStrictEqual([...list().children], [
        ...next.slice(0, 3),
        next[4],
        next[3],
        ...next.slice(5)
      ])
      const last = list().children.length - 1
      const ends = [...list().children]
      yield* send(Message.Swap({ from: 0, to: last }))
      check()
      assert.strictEqual(list().children[0], ends[last])
      assert.strictEqual(list().children[last], ends[0])
      button(last).click()
      yield* tick
      check()
      assert.strictEqual(
        root.model()!.seen[root.model()!.seen.length - 1],
        `remove ${ends[0]!.querySelector("span")!.textContent}`
      )

      // Appending, replacing and clearing.
      yield* send(
        Message.Set({ items: [...root.model()!.items, ...itemsOf(50, 3)] })
      )
      check()
      yield* send(Message.Set({ items: itemsOf(100, 4) }))
      check()
      button(3).click()
      yield* tick
      check()
      yield* send(Message.Set({ items: [] }))
      check()
    }).pipe(Effect.scoped))

  it.effect("a node something else puts in a row doesn't move its handlers", () =>
    Effect.gen(function*() {
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(List, {}, app)
      root.send(Message.Set({ items: itemsOf(1, 2) }))
      yield* tick
      const [first, second] = app.querySelectorAll("li")
      // A comment before the link, and an element before the button, as a
      // translator or an extension adds: what follows them moves.
      first!.prepend(document.createComment("annotation"))
      second!.insertBefore(
        document.createElement("font"),
        second!.querySelector("button")
      )
      first!.querySelector("a")!.click()
      yield* tick
      second!.querySelector("a")!.click()
      yield* tick
      second!.querySelector("button")!.click()
      yield* tick
      assert.deepStrictEqual(root.model()!.seen, [
        "select 1",
        "select 2",
        "remove 2"
      ])
    }).pipe(Effect.scoped))

  it.effect("rows inserted or removed in one place leave the others' nodes alone", () =>
    Effect.gen(function*() {
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(List, {}, app)
      const list = () => app.querySelector("ul")!
      const rows = () => [...list().children]
      const check = () =>
        assert.strictEqual(list().innerHTML, expected(root.model()!))
      const send = (message: Message) =>
        Effect.andThen(Effect.sync(() => root.send(message)), tick)
      // `h.list` matches items by identity, so the kept ones are passed on.
      const items = () => root.model()!.items

      yield* send(Message.Set({ items: itemsOf(1, 6) }))
      const first = rows()
      yield* send(
        Message.Set({
          items: [
            ...items().slice(0, 2),
            ...itemsOf(20, 3),
            ...items().slice(2)
          ]
        })
      )
      check()
      assert.deepStrictEqual(
        [...rows().slice(0, 2), ...rows().slice(5)],
        first
      )

      yield* send(Message.Set({ items: [...itemsOf(30, 2), ...items()] }))
      check()
      const before = rows()
      yield* send(
        Message.Set({ items: [...items().slice(0, 3), ...items().slice(7)] })
      )
      check()
      assert.deepStrictEqual(rows(), [
        ...before.slice(0, 3),
        ...before.slice(7)
      ])
      yield* send(Message.Set({ items: [...items(), ...itemsOf(40, 2)] }))
      check()

      // Inserted rows dispatch with their own values.
      rows()[0]!.querySelector<HTMLElement>("a")!.click()
      // A click on what a handled element holds reaches its handler.
      rows()[rows().length - 1]!.querySelector<HTMLElement>("button > i")!
        .click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, ["select 30", "remove 41"])
    }).pipe(Effect.scoped))

  it.effect("rows the server rendered are adopted, patched and dispatch beside new ones", () =>
    Effect.gen(function*() {
      const first: Model = { items: itemsOf(1, 3), selected: 2, seen: [] }
      const Served = Html.component({
        name: "Served",
        model: Model,
        message: Message
      }).make({
        init: () => first,
        update,
        view: (h, model) =>
          h.ul.children(
            h.list(model.items, { key: idOf, selected: model.selected }, row)
          )
      })
      const rendered = yield* HtmlServer.renderToHtml(Served, {})
      assert.include(rendered.html, expected(first))
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const app = document.createElement("div")
          app.innerHTML = rendered.html
          document.body.appendChild(app)
          return app
        }),
        (app) => Effect.sync(() => app.remove())
      )
      const server = [...app.querySelectorAll("li")]
      const root = yield* HtmlHydrate.hydrateEffect(
        Served,
        {},
        app,
        rendered.state
      )
      yield* root.adopted
      assert.deepStrictEqual([...app.querySelectorAll("li")], server)
      const list = () => app.querySelector("ul")!
      const check = () =>
        assert.strictEqual(list().innerHTML, expected(root.model()!))

      // An adopted row is patched in place; the rows added after it are copies.
      root.send(Message.Label({ id: 2, label: "patched" }))
      yield* tick
      check()
      assert.strictEqual(list().children[1], server[1])
      root.send(
        Message.Set({ items: [...root.model()!.items, ...itemsOf(10, 2)] })
      )
      yield* tick
      check()
      list().children[0]!.querySelector<HTMLElement>("a")!.click()
      list().children[4]!.querySelector<HTMLElement>("button > i")!.click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, ["select 1", "remove 11"])
    }).pipe(Effect.scoped))

  // A template around a list: the slot that is the `ul`'s only child holds
  // the rows `h.list` gives.
  const Shell = Html.template<Message, {
    readonly title: string
    readonly rows: ReadonlyArray<View.Node<Message>>
  }>((h, $) =>
    h.div.class("shell").children(
      h.h1.children($.title),
      h.button.on("click", Message.Set({ items: itemsOf(70, 2) })).children(
        "Reset"
      ),
      h.ul.children($.rows)
    )
  )
  const shellOf = (h: View.Helper<Message, {}>, model: Model) =>
    Shell({
      title: `${model.items.length} items`,
      rows: h.list(model.items, { key: idOf, selected: model.selected }, row)
    })
  const InShell = Html.component({
    name: "InShell",
    model: Model,
    message: Message
  }).make({
    init: () => ({ items: [], selected: 0, seen: [] }),
    update,
    view: shellOf
  })
  const shellHtml = (model: Model): string =>
    `<div class="shell"><h1>${model.items.length} items</h1><button>Reset</button><ul>${
      expected(model)
    }</ul></div>`

  it.effect("a slot that is an element's only child holds a list's rows", () =>
    Effect.gen(function*() {
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(InShell, {}, app)
      const check = () =>
        assert.strictEqual(app.innerHTML, shellHtml(root.model()!))
      const send = (message: Message) =>
        Effect.andThen(Effect.sync(() => root.send(message)), tick)
      const list = () => app.querySelector("ul")!
      const rows = () => [...list().children]
      const items = () => root.model()!.items
      check()

      yield* send(Message.Set({ items: itemsOf(1, 6) }))
      check()
      const first = rows()
      // Changed, removed, inserted and traded rows keep the others' nodes.
      yield* send(Message.Label({ id: 2, label: "two" }))
      check()
      assert.deepStrictEqual(rows(), first)
      yield* send(Message.Remove({ id: 3 }))
      check()
      assert.deepStrictEqual(rows(), [first[0], first[1], ...first.slice(3)])
      yield* send(
        Message.Set({ items: [...items(), ...itemsOf(20, 2)] })
      )
      check()
      yield* send(Message.Swap({ from: 0, to: 4 }))
      check()
      // A row's handler, and the template's own around it.
      rows()[1]!.querySelector<HTMLElement>("a")!.click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, ["remove 3", "select 2"])
      app.querySelector<HTMLElement>("button")!.click()
      yield* tick
      check()
      assert.deepStrictEqual(items().map((item) => item.id), [70, 71])
      yield* send(Message.Set({ items: [] }))
      check()
      yield* send(Message.Set({ items: itemsOf(30, 3) }))
      check()
      rows()[2]!.querySelector<HTMLElement>("button > i")!.click()
      yield* tick
      check()
      assert.deepStrictEqual(items().map((item) => item.id), [30, 31])
    }).pipe(Effect.scoped))

  it.effect("a content slot holds text or nodes, and changes from one to the other", () =>
    Effect.gen(function*() {
      const Next = UiSchema.TaggedEnum({ Next: {} })
      type Next = typeof Next.Type
      const Box = Html.template<Next, {
        readonly body: string | ReadonlyArray<View.Node<Next>>
      }>((h, $) => h.p.class("box").children($.body))
      const Show = Html.component({
        name: "Show",
        model: Schema.Struct({ step: Schema.Number }),
        message: Next
      }).make({
        init: () => ({ step: 0 }),
        update: ({ model }) => ({ step: model.step + 1 }),
        view: (h, model) =>
          Box({
            body: model.step % 3 === 0
              ? `step ${model.step}`
              : model.step % 3 === 1
              ? [View.toNode(h.b.children("bold")), View.text("and text")]
              : []
          })
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Show, {}, app)
      const html = [
        `<p class="box">step 0</p>`,
        `<p class="box"><b>bold</b>and text</p>`,
        `<p class="box"></p>`,
        `<p class="box">step 3</p>`,
        `<p class="box"><b>bold</b>and text</p>`
      ]
      assert.strictEqual(app.innerHTML, html[0])
      for (let step = 1; step < html.length; step++) {
        root.send({ _tag: "Next" })
        yield* tick
        assert.strictEqual(app.innerHTML, html[step])
      }
    }).pipe(Effect.scoped))

  it.effect("a content slot's first nodes with one key twice fail the render", () =>
    Effect.gen(function*() {
      const Box = Html.template<never, {
        readonly body: ReadonlyArray<View.Node<never>>
      }>((h, $) => h.ul.children($.body))
      const Twice = Html.component({
        name: "TwiceKeyed",
        model: Schema.Null,
        message: Schema.Never
      }).make({
        init: () => null,
        update: ($) => $.model,
        view: (h) =>
          Box({
            body: [
              View.toNode(h.li.key("a").children("1")),
              View.toNode(h.li.key("a").children("2"))
            ]
          })
      })
      const app = yield* container
      yield* BrowserHost.mountEffect(Twice, {}, app, {
        fallback: (_, h) => h.text("failed")
      })
      yield* tick
      assert.strictEqual(app.textContent, "failed")
    }).pipe(Effect.scoped))

  it.effect("a controlled field in a content slot given the same nodes again is restored", () =>
    Effect.gen(function*() {
      const Step = UiSchema.TaggedEnum({ Stepped: {} })
      type Step = typeof Step.Type
      const Box = Html.template<Step, {
        readonly step: string
        readonly body: ReadonlyArray<View.Node<Step>>
      }>((h, $) => h.div.attr("data-step", $.step).children($.body))
      // The same array on every render, as a list given again unchanged is.
      let body: ReadonlyArray<View.Node<Step>> | undefined
      const Form = Html.component({
        name: "SameBody",
        model: Schema.Struct({ step: Schema.Number }),
        message: Step
      }).make({
        init: () => ({ step: 0 }),
        update: ({ model }) => ({ step: model.step + 1 }),
        view: (h, model) => {
          body ??= [View.toNode(h.input.prop("value", "kept"))]
          return Box({ step: String(model.step), body })
        }
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Form, {}, app)
      const field = app.querySelector<HTMLInputElement>("input")!
      assert.strictEqual(field.value, "kept")
      field.value = "typed"
      // A new element of the template, its other slot changed: the field
      // goes back to the value the view gives.
      root.send(Step.Stepped())
      yield* tick
      assert.strictEqual(app.querySelector("div")!.dataset.step, "1")
      assert.strictEqual(app.querySelector("input"), field)
      assert.strictEqual(field.value, "kept")
    }).pipe(Effect.scoped))

  it.effect("a controlled field that a kept template's content slot gains is restored", () =>
    Effect.gen(function*() {
      const Step = UiSchema.TaggedEnum({ Stepped: {} })
      type Step = typeof Step.Type
      const Box = Html.template<Step, {
        readonly body: string | ReadonlyArray<View.Node<Step>>
      }>((h, $) => h.div.class("box").children($.body))
      // Kept while `field` and `value` hold, so its record is restored, not
      // patched, on the renders between.
      const boxed = (h: Html.H<Step>, field: boolean, value: string) =>
        Box({
          body: field
            ? [View.toNode(h.input.prop("value", value))]
            : "no field"
        })
      const Form = Html.component({
        name: "Form",
        model: Schema.Struct({ step: Schema.Number }),
        message: Step
      }).make({
        init: () => ({ step: 0 }),
        update: ({ model }) => ({ step: model.step + 1 }),
        view: (h, model) =>
          h.div.children(
            // A controlled property elsewhere, so kept elements are restored.
            h.input.class("other").prop("value", "other"),
            h.lazy(boxed, model.step >= 2, "kept")
          )
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Form, {}, app)
      const step = Effect.andThen(
        Effect.sync(() => root.send(Step.Stepped())),
        tick
      )
      // Kept with no controlled property in it, then given the field.
      yield* step
      yield* step
      const field = app.querySelector<HTMLInputElement>(".box input")!
      assert.strictEqual(field.value, "kept")
      field.value = "typed"
      // Kept again: its field goes back to the value the view gives.
      yield* step
      assert.strictEqual(
        app.querySelector<HTMLInputElement>(".box input")!.value,
        "kept"
      )
    }).pipe(Effect.scoped))

  it.effect("a template holding a list is rendered on the server, adopted and patched", () =>
    Effect.gen(function*() {
      const first: Model = { items: itemsOf(1, 3), selected: 2, seen: [] }
      const Served = Html.component({
        name: "ServedShell",
        model: Model,
        message: Message
      }).make({ init: () => first, update, view: shellOf })
      const rendered = yield* HtmlServer.renderToHtml(Served, {})
      assert.include(rendered.html, shellHtml(first))
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const app = document.createElement("div")
          app.innerHTML = rendered.html
          document.body.appendChild(app)
          return app
        }),
        (app) => Effect.sync(() => app.remove())
      )
      const server = [...app.querySelectorAll("li")]
      const root = yield* HtmlHydrate.hydrateEffect(
        Served,
        {},
        app,
        rendered.state
      )
      yield* root.adopted
      assert.deepStrictEqual([...app.querySelectorAll("li")], server)
      const check = () =>
        assert.include(app.innerHTML, shellHtml(root.model()!))
      root.send(Message.Label({ id: 2, label: "patched" }))
      yield* tick
      check()
      assert.strictEqual(app.querySelectorAll("li")[1], server[1])
      root.send(Message.Remove({ id: 1 }))
      yield* tick
      check()
      app.querySelectorAll("li")[0]!.querySelector<HTMLElement>("a")!.click()
      yield* tick
      check()
      assert.deepStrictEqual(root.model()!.seen, ["remove 1", "select 2"])
    }).pipe(Effect.scoped))

  it.effect("a template built inside another renders and dispatches everywhere", () =>
    Effect.gen(function*() {
      const Inner = Html.template<Message, {
        readonly label: string
        readonly pick: Message
      }>((h, $) => h.span.class("inner").on("click", $.pick).children($.label))
      const Outer = Html.template<Message, {
        readonly title: string
        readonly label: string
        readonly pick: Message
      }>((h, $) =>
        h.div.attr("title", $.title).children(
          Inner({ label: $.label, pick: $.pick })
        )
      )
      const first: Model = { items: itemsOf(1, 1), selected: 0, seen: [] }
      const Nested = Html.component({
        name: "Nested",
        model: Model,
        message: Message
      }).make({
        init: () => first,
        update,
        view: (_h, model) =>
          Outer({
            title: "outer",
            label: model.items[0]!.label,
            pick: Message.Select({ id: model.items[0]!.id })
          })
      })
      const html = (label: string) =>
        `<div title="outer"><span class="inner">${label}</span></div>`
      const rendered = yield* HtmlServer.renderToHtml(Nested, {})
      assert.include(rendered.html, html("item 1"))
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Nested, {}, app)
      assert.strictEqual(app.innerHTML, html("item 1"))
      root.send(Message.Label({ id: 1, label: "patched" }))
      yield* tick
      assert.strictEqual(app.innerHTML, html("patched"))
      app.querySelector<HTMLElement>("span")!.click()
      yield* tick
      assert.deepStrictEqual(root.model()!.seen, ["select 1"])
    }).pipe(Effect.scoped))

  it.effect("a template in elements copied for their siblings keeps its handlers", () =>
    Effect.gen(function*() {
      const Pick = Html.template<Message, { readonly pick: Message }>((
        h,
        $
      ) => h.button.on("click", $.pick).children("pick"))
      const Sections = Html.component({
        name: "Sections",
        model: Model,
        message: Message
      }).make({
        init: () => ({ items: [], selected: 0, seen: [] }),
        update,
        view: (h) => {
          const pick = Pick({ pick: Message.Select({ id: 1 }) })
          return h.div.children(
            h.section.key("a").children(h.p.children("a"), pick),
            h.section.key("b").children(h.p.children("b"), pick)
          )
        }
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Sections, {}, app)
      const buttons = app.querySelectorAll<HTMLElement>("button")
      assert.strictEqual(buttons.length, 2)
      buttons[1]!.click()
      yield* tick
      buttons[0]!.click()
      yield* tick
      assert.deepStrictEqual(root.model()!.seen, ["select 1", "select 1"])
    }).pipe(Effect.scoped))

  it.effect("a handler slot sends false and null as on does", () =>
    Effect.gen(function*() {
      const Answer = Schema.NullOr(Schema.Boolean)
      const Buttons = Html.template<boolean | null, {
        readonly no: boolean | null
        readonly none: boolean | null
      }>((h, $) =>
        h.div.children(
          h.button.class("no").on("click", $.no).children("no"),
          h.button.class("none").on("click", $.none).children("none")
        )
      )
      const Answers = Html.component({
        name: "Answers",
        model: Schema.Struct({ got: Schema.Array(Answer) }),
        message: Answer
      }).make({
        init: () => ({ got: [] }),
        update: ({ model }, answer) => ({ got: [...model.got, answer] }),
        view: () => Buttons({ no: false, none: null })
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Answers, {}, app)
      app.querySelector<HTMLElement>(".no")!.click()
      yield* tick
      app.querySelector<HTMLElement>(".none")!.click()
      yield* tick
      assert.deepStrictEqual(root.model()!.got, [false, null])
    }).pipe(Effect.scoped))

  // collectGarbage uses Node's V8 flags, unavailable on Bun and Deno.
  const withGc = it.effect.skipIf(
    process.versions.bun !== undefined || process.versions.deno !== undefined
  )

  withGc(
    "a template defined for the whole program keeps no unmounted app",
    () =>
      Effect.gen(function*() {
        let app: WeakRef<HTMLElement> | undefined
        yield* Effect.gen(function*() {
          const element = document.body.appendChild(
            document.createElement("div")
          )
          app = new WeakRef(element)
          const root = yield* BrowserHost.mountEffect(List, {}, element)
          root.send(Message.Set({ items: itemsOf(1, 2) }))
          yield* tick
          element.remove()
        }).pipe(Effect.scoped)
        // `Row` is still in use here: its definition lives on.
        assert.strictEqual(
          (row(undefined, itemsOf(1, 1)[0]!, false) as View.TemplateNode)["~t"]
            .kernel !== undefined,
          true
        )
        yield* collectGarbage
        assert.isUndefined(app!.deref())
      })
  )

  withGc(
    "a template made by a view is dropped once no view uses it",
    () =>
      Effect.gen(function*() {
        const Next = UiSchema.TaggedEnum({ Next: {} })
        let first: WeakRef<object> | undefined
        const Fresh = Html.component({
          name: "Fresh",
          model: Schema.Number,
          message: Next
        }).make({
          init: () => 0,
          update: ({ model }) => model + 1,
          view: (_h, model) => {
            // A new template on every render, which a module-level one would avoid.
            const Label = Html.template<never, { readonly label: string }>((
              h,
              $
            ) => h.p.children($.label))
            const node = Label({ label: String(model) })
            if (model === 0) {
              first = new WeakRef((node as View.TemplateNode)["~t"])
            }
            return node
          }
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Fresh, {}, app)
        for (let step = 0; step < 3; step++) {
          root.send(Next.Next())
          yield* tick
        }
        assert.strictEqual(app.innerHTML, "<p>3</p>")
        yield* collectGarbage
        assert.isUndefined(first!.deref())
      }).pipe(Effect.scoped)
  )

  it.effect("a template made with View.template renders in the browser as any element", () =>
    Effect.gen(function*() {
      // Without Html.template's operations, the browser host builds and
      // patches the element the template reads as.
      const Plain = View.template(
        View.makeHelper<Message, {}>({}, undefined),
        (h, $: { readonly label: string; readonly pick: Message }) =>
          h.el("p").children(h.el("a").on("click", $.pick).children($.label))
      )
      const first: Model = { items: itemsOf(1, 1), selected: 0, seen: [] }
      const Shown = Html.component({
        name: "Shown",
        model: Model,
        message: Message
      }).make({
        init: () => first,
        update,
        view: (_h, model) =>
          Plain({
            label: model.items[0]!.label,
            pick: Message.Select({ id: model.items[0]!.id })
          })
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Shown, {}, app)
      assert.strictEqual(app.innerHTML, "<p><a>item 1</a></p>")
      const def = (Plain({
        label: "",
        pick: Message.Select({ id: 0 })
      }) as View.TemplateNode)[
        "~t"
      ]
      assert.isUndefined(def.kernel)
      root.send(Message.Label({ id: 1, label: "patched" }))
      yield* tick
      assert.strictEqual(app.innerHTML, "<p><a>patched</a></p>")
      app.querySelector<HTMLElement>("a")!.click()
      yield* tick
      assert.deepStrictEqual(root.model()!.seen, ["select 1"])
    }).pipe(Effect.scoped))

  it("a content slot's nodes keep their requirements in the template's type", () => {
    const Box = Html.template<Message, {
      readonly body: ReadonlyArray<View.Node<Message, "Needed">>
    }>((h, $) => h.div.children($.body))
    type Needs = View.Requirements<ReturnType<typeof Box>>
    const needs: [Needs] extends ["Needed"] ? ["Needed"] extends [Needs] ? true
      : false
      : false = true
    assert.isTrue(needs)
  })

  it("a row reads as the element the helper would build", () => {
    const select = Message.Select({ id: 7 })
    const node = Row({
      key: "7",
      label: "seven",
      state: "selected",
      select,
      remove: Message.Remove({ id: 7 })
    })
    assert.strictEqual(node.tag, "li")
    assert.strictEqual(node.elementKey, "7")
    assert.deepStrictEqual(node.attrs, {
      "data-static": "yes",
      class: "selected"
    })
    assert.strictEqual(View.textOf(node), "7sevenx")
    const link = node.children[1] as View.Element<Message>
    assert.strictEqual(link.handlers.click, select)
    assert.isFunction(link.handlers.focus)
    assert.deepStrictEqual(
      Row({
        key: "8",
        label: "",
        state: undefined,
        select,
        remove: select
      }).attrs,
      { "data-static": "yes" }
    )
  })

  it("rejects a slot inside a larger value", () => {
    assert.throws(() =>
      Html.template<Message, { readonly name: string }>((h, $) =>
        h.p.children("Hi " + $.name)
      )
    )
    assert.throws(() =>
      Html.template<Message, { readonly state: string }>((h, $) =>
        h.p.class("row", $.state)
      )
    )
    // Text after the slot, and two slots in one value.
    assert.throws(() =>
      Html.template<Message, { readonly name: string }>((h, $) =>
        h.p.children($.name + "!")
      )
    )
    assert.throws(() =>
      Html.template<Message, { readonly state: string }>((h, $) =>
        h.p.class($.state, "fixed")
      )
    )
    assert.throws(() =>
      Html.template<Message, { readonly state: string }>((h, $) =>
        h.p.class($.state).class("fixed")
      )
    )
    assert.throws(() =>
      Html.template<Message, {
        readonly first: string
        readonly last: string
      }>((h, $) => h.p.attr("title", $.first + $.last))
    )
  })
})

const listRow = (
  h: View.Helper<never, {}>,
  item: Item,
  isSelected: boolean
) => h.el("li").key(String(item.id)).attr("data-selected", String(isSelected))

describe("h.list", () => {
  const render = (
    store: View.LazyStore,
    items: ReadonlyArray<Item>,
    selected: number
  ) => {
    const h = View.makeHelper<never, {}>({}, undefined, undefined, "/L", store)
    const lazies = store.lazy as View.Lazies | undefined
    lazies?.begin()
    const nodes = h.list(items, { key: idOf, selected }, listRow)
    ;(store.lazy as View.Lazies).end()
    ;(store.lazy as View.Lazies).endLists()
    return nodes
  }

  it("builds again only the rows whose item or selection changed", () => {
    // `render` is declared once: it tells the lists of a view apart.
    const store: View.LazyStore = { lazy: undefined }
    const items = itemsOf(1, 5)
    const first = render(store, items, 2)
    assert.strictEqual(render(store, items, 2), first)
    const moved = render(store, items, 4)
    assert.notStrictEqual(moved, first)
    for (const index of [0, 2, 4]) {
      assert.strictEqual(moved[index], first[index])
    }
    assert.notStrictEqual(moved[1], first[1])
    assert.notStrictEqual(moved[3], first[3])
    const changed = items.map((item) => item.id === 3 ? { ...item } : item)
    const next = render(store, changed, 4)
    assert.notStrictEqual(next[2], moved[2])
    for (const index of [0, 1, 3, 4]) {
      assert.strictEqual(next[index], moved[index])
    }
    const removed = render(store, changed.filter((item) => item.id !== 2), 4)
    assert.deepStrictEqual(
      removed.map((node) => (node as View.Element<never>).elementKey),
      ["1", "3", "4", "5"]
    )
    assert.strictEqual(removed[0], next[0])
    assert.strictEqual(removed[1], next[2])
  })

  it("moves the selection off every row whose key is the selected one", () => {
    const store: View.LazyStore = { lazy: undefined }
    // Two items share a label, which is the key here.
    const items = [
      { id: 1, label: "same" },
      { id: 2, label: "same" },
      { id: 3, label: "other" }
    ]
    const byLabel = (
      store: View.LazyStore,
      selected: string | undefined
    ) => {
      const h = View.makeHelper<never, {}>(
        {},
        undefined,
        undefined,
        "/L",
        store
      )
      ;(store.lazy as View.Lazies | undefined)?.begin()
      const nodes = h.list(
        items,
        { key: (item: Item) => item.label, selected },
        listRow
      )
      ;(store.lazy as View.Lazies).end()
      ;(store.lazy as View.Lazies).endLists()
      return nodes.map((node) =>
        (node as View.Element<never>).attrs["data-selected"]
      )
    }
    assert.deepStrictEqual(byLabel(store, "same"), ["true", "true", "false"])
    assert.deepStrictEqual(byLabel(store, undefined), [
      "false",
      "false",
      "false"
    ])
    assert.deepStrictEqual(byLabel(store, "same"), ["true", "true", "false"])
  })

  // collectGarbage uses Node's V8 flags, unavailable on Bun and Deno.
  it.effect.skipIf(
    process.versions.bun !== undefined || process.versions.deno !== undefined
  )(
    "keeps no earlier render's nodes alive through what it tells the runtime",
    () =>
      Effect.gen(function*() {
        const store: View.LazyStore = { lazy: undefined }
        let items = itemsOf(1, 5)
        const first = new WeakRef(render(store, items, 0))
        // Each render changes a row, so each tells the runtime how; none is taken.
        for (let round = 0; round < 3; round++) {
          items = items.map((item, index) =>
            index === round ? { ...item } : item
          )
          render(store, items, 0)
        }
        yield* collectGarbage
        assert.isUndefined(first.deref())
      })
  )
})
