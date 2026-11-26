// @vitest-environment happy-dom
import { UiSchema } from "@effect/ui"
import { BrowserHost, Html } from "@effect/ui/html"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

// Lists of rows of one shape are built by copying the first row's nodes, and
// a row's records below its root are made on its first patch. These tests
// check that such rows render, patch, move and dispatch as any others do.

const tick = Effect.promise(() =>
  new Promise<void>((resolve) => setTimeout(resolve, 10))
)

const container = Effect.acquireRelease(
  Effect.sync(() => document.body.appendChild(document.createElement("div"))),
  (element) => Effect.sync(() => element.remove())
)

const Row = Schema.Struct({ id: Schema.Number, label: Schema.String })
type Row = typeof Row.Type

const Message = UiSchema.TaggedEnum({
  Set: { rows: Schema.Array(Row) },
  Label: { id: Schema.Number, label: Schema.String },
  Select: { id: Schema.Number },
  Remove: { id: Schema.Number },
  Swap: { from: Schema.Number, to: Schema.Number }
})
type Message = typeof Message.Type

const Model = Schema.Struct({
  rows: Schema.Array(Row),
  selected: Schema.Number,
  clicks: Schema.Array(Schema.Number)
})
type Model = typeof Model.Type

const update = (
  { model }: { readonly model: Model },
  message: Message
): Model => {
  switch (message._tag) {
    case "Set":
      return { ...model, rows: message.rows }
    case "Label":
      return {
        ...model,
        rows: model.rows.map((row) =>
          row.id === message.id ? { ...row, label: message.label } : row
        )
      }
    case "Select":
      return {
        ...model,
        selected: message.id,
        clicks: [...model.clicks, message.id]
      }
    case "Remove":
      return {
        ...model,
        rows: model.rows.filter((row) => row.id !== message.id)
      }
    case "Swap": {
      const rows = [...model.rows]
      const from = rows[message.from]!
      rows[message.from] = rows[message.to]!
      rows[message.to] = from
      return { ...model, rows }
    }
  }
}

const Def = Html.component({ name: "Table", model: Model, message: Message })

const rowView = (
  h: Html.H<Message>,
  row: Row,
  selected: boolean
) =>
  h.tr.key(String(row.id)).class(selected && "danger").children(
    h.td.class("id").children(String(row.id)),
    h.td.class("label").children(
      h.a.on("click", Message.Select({ id: row.id })).children(row.label)
    ),
    h.td.children(
      h.a.on("click", Message.Remove({ id: row.id })).children(
        h.span.class("icon").attr("aria-hidden", "true")
      )
    )
  )

const tables = {
  plain: Def.make({
    init: () => ({ rows: [], selected: 0, clicks: [] }),
    update,
    view: (h, model) =>
      h.table.children(
        h.tbody.children(
          model.rows.map((row) => rowView(h, row, row.id === model.selected))
        )
      )
  }),
  lazy: Def.make({
    init: () => ({ rows: [], selected: 0, clicks: [] }),
    update,
    view: (h, model) =>
      h.table.children(
        h.tbody.children(
          model.rows.map((row) =>
            h.lazy(rowView, row, row.id === model.selected)
          )
        )
      )
  })
}

const rowsOf = (from: number, count: number): Array<Row> =>
  Array.from({ length: count }, (_, index) => ({
    id: from + index,
    label: "row " + (from + index)
  }))

const expected = (model: Model): string =>
  model.rows.map((row) =>
    `<tr${row.id === model.selected ? ` class="danger"` : ""}>` +
    `<td class="id">${row.id}</td>` +
    `<td class="label"><a>${row.label}</a></td>` +
    `<td><a><span class="icon" aria-hidden="true"></span></a></td></tr>`
  ).join("")

const labelOf = (app: HTMLElement, index: number) =>
  app.querySelectorAll<HTMLElement>("tbody tr")[index]!
    .querySelector<HTMLElement>(".label a")!

describe("rows built from a copy", { concurrent: false }, () => {
  for (const [variant, Table] of Object.entries(tables)) {
    it.effect(`${variant}: render, patch, move and dispatch like rows built one node at a time`, () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Table, {}, app)
        const tbody = () => app.querySelector("tbody")!
        const check = () =>
          assert.strictEqual(tbody().innerHTML, expected(root.model()!))
        const send = (message: Message) =>
          Effect.andThen(Effect.sync(() => root.send(message)), tick)

        yield* send(Message.Set({ rows: rowsOf(1, 20) }))
        check()
        // A click on a copied row reaches its handler.
        labelOf(app, 3).click()
        yield* tick
        assert.deepStrictEqual(root.model()!.clicks, [4])
        check()

        // A patch of a copied row makes its records and keeps its handlers current.
        yield* send(Message.Label({ id: 4, label: "changed" }))
        check()
        labelOf(app, 3).click()
        yield* tick
        assert.deepStrictEqual(root.model()!.clicks, [4, 4])
        yield* send(Message.Label({ id: 4, label: "again" }))
        check()

        // Distant and neighbouring swaps.
        const before = [...tbody().children]
        yield* send(Message.Swap({ from: 1, to: 18 }))
        check()
        const after = [...tbody().children]
        assert.strictEqual(after[1], before[18])
        assert.strictEqual(after[18], before[1])
        for (let index = 0; index < 20; index++) {
          if (index !== 1 && index !== 18) {
            assert.strictEqual(after[index], before[index])
          }
        }
        yield* send(Message.Swap({ from: 5, to: 6 }))
        check()
        labelOf(app, 5).click()
        labelOf(app, 18).click()
        yield* tick
        assert.deepStrictEqual(root.model()!.clicks, [4, 4, 7, 2])
        check()

        // Removing, appending and replacing.
        app.querySelectorAll<HTMLElement>("tbody tr")[2]!
          .querySelector<HTMLElement>("span")!.click()
        yield* tick
        check()
        assert.strictEqual(tbody().children.length, 19)
        yield* send(
          Message.Set({ rows: [...root.model()!.rows, ...rowsOf(100, 10)] })
        )
        check()
        labelOf(app, 25).click()
        yield* tick
        check()
        assert.strictEqual(root.model()!.selected, 106)
        yield* send(Message.Set({ rows: rowsOf(200, 15) }))
        check()
        yield* send(Message.Set({ rows: [] }))
        check()
        yield* send(Message.Set({ rows: rowsOf(300, 3) }))
        check()
      }).pipe(Effect.scoped))

    it.effect(`${variant}: a row whose nodes something else changed is built again when it's patched`, () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Table, {}, app)
        root.send(Message.Set({ rows: rowsOf(1, 5) }))
        yield* tick
        // As a page translator does: the label's text goes into an element of its own.
        const label = labelOf(app, 2)
        const font = document.createElement("font")
        font.textContent = label.textContent
        label.replaceChildren(font)
        root.send(Message.Label({ id: 3, label: "patched" }))
        yield* tick
        assert.strictEqual(
          app.querySelector("tbody")!.innerHTML,
          expected(root.model()!)
        )
        labelOf(app, 2).click()
        yield* tick
        assert.deepStrictEqual(root.model()!.clicks, [3])
      }).pipe(Effect.scoped))
  }

  const field = <M>(h: Html.H<M>, value: string) =>
    h.li.key(value).children(h.input.value(value))

  it.effect("a controlled value in a row given again unchanged is still set again", () =>
    Effect.gen(function*() {
      const Fields = Html.component({
        name: "Fields",
        model: Schema.Array(Schema.String),
        message: UiSchema.TaggedEnum({ Touch: {} })
      }).make({
        init: () => ["a", "b", "c"],
        update: ({ model }) => [...model],
        view: (h, model) =>
          h.ul.children(model.map((value) => h.lazy(field, value)))
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Fields, {}, app)
      yield* tick
      const input = app.querySelectorAll("input")[1]!
      input.value = "typed"
      root.send({ _tag: "Touch" })
      yield* tick
      assert.strictEqual(input.value, "b")
    }).pipe(Effect.scoped))
})
