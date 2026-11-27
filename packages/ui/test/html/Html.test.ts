import { UiSchema, View } from "@effect/ui"
import { Html, HtmlServer } from "@effect/ui/html"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

const button = () => new Html.Element("button")

const TodoMessage = UiSchema.TaggedEnum({
  Add: {},
  Draft: { value: Schema.String }
})
type TodoMessage = typeof TodoMessage.Type
const NewTodo = Html.ref("NewTodo", "input")
const Item = Html.component({
  name: "Item",
  props: Schema.Struct({ title: Schema.String }),
  model: Schema.String,
  message: Schema.Never
}).make({
  init: ($) => $.props.title,
  update: ($) => $.model,
  view: (h, title) => h.li(title)
})
const helper = () => View.makeHelper<TodoMessage, {}, Html.Elements>({}, Html)
const element = (
  tag: string,
  fields: Partial<
    Omit<View.Element<TodoMessage, any>, "_tag" | "tag" | "children">
  >,
  children: ReadonlyArray<View.Node<TodoMessage, any>>
): View.Element<TodoMessage, any> => ({
  _tag: "Element",
  tag,
  elementKey: undefined,
  attrs: {},
  props: {},
  handlers: {},
  eventOptions: {},
  refKey: undefined,
  mount: undefined,
  owned: [],
  children,
  ...fields
})

describe("Html", () => {
  describe("builder", () => {
    const add = TodoMessage.Add()
    const onInput = ({ value }: Html.InputPayload) =>
      TodoMessage.Draft({ value })
    const todos = ["Milk", "Eggs"]

    it("builds the tree a chain describes", () => {
      const h = helper()
      const tree = View.build(h.form.on("submit", add), [
        h.input.ref(NewTodo).value("draft").on("input", onInput),
        h.button.attr("type", "submit").children("Add"),
        h.span("Todos"),
        todos.map((title) => Item(h, { key: title, props: { title } }))
      ])
      assert.deepStrictEqual(
        tree,
        element("form", { handlers: { submit: add } }, [
          element("input", {
            refKey: NewTodo.key,
            props: { value: "draft" },
            handlers: { input: onInput }
          }, []),
          element("button", { attrs: { type: "submit" } }, [View.text("Add")]),
          element("span", {}, [View.text("Todos")]),
          Item(h, { key: "Milk", props: { title: "Milk" } }),
          Item(h, { key: "Eggs", props: { title: "Eggs" } })
        ])
      )
    })

    it.effect("renders the example the same as the children-first form did", () =>
      Effect.gen(function*() {
        const Todos = Html.component({
          name: "Todos",
          model: Schema.String,
          message: TodoMessage
        }).make({
          init: () => "draft",
          update: ($) => $.model,
          view: (h, draft) =>
            h.form.on("submit", add).children(
              h.input.ref(NewTodo).value(draft).on("input", onInput),
              h.button.attr("type", "submit").children("Add"),
              h.span("Todos"),
              todos.map((title) => Item(h, { key: title, props: { title } }))
            )
        })
        const rendered = yield* HtmlServer.renderToHtml(Todos, {})
        // The markup the children-first form, h.form(...children).on("submit", add), rendered.
        assert.strictEqual(
          rendered.html,
          "<!--[/Todos--><form><input value=\"draft\"><button type=\"submit\">Add</button><span>Todos</span>" +
            "<li>Milk</li><li>Eggs</li></form><!--]/Todos-->"
        )
      }))

    it("the shorthand call is children, and a builder alone is an element with no children", () => {
      const h = helper()
      assert.deepStrictEqual(
        h.li("a", ["b", false], null, h.br),
        h.li.children("a", ["b", false], null, h.br)
      )
      assert.deepStrictEqual(
        h.ul(h.li, h.li.key("k")),
        h.ul(h.li(), h.li.key("k").children())
      )
      assert.deepStrictEqual(h.el("x-foo", "a"), h.el("x-foo").children("a"))
      assert.deepStrictEqual<unknown>(
        View.toNode(h.input.value("a")),
        element("input", { props: { value: "a" } }, [])
      )
    })

    it("a tag on h is one builder per vocabulary, shared by every render", () => {
      const first = helper()
      const second = helper()
      assert.strictEqual(first.form, second.form)
      assert.strictEqual(first.br, second.br)
      assert.strictEqual<unknown>(first.form, Html.tags.form)
      // A chain call copies the fields into a plain builder: no function is made.
      const chained = first.form.attr("method", "post")
      assert.strictEqual(typeof chained, "object")
      assert.instanceOf(chained, Html.Element)
      assert.strictEqual(typeof first.input.value("a"), "object")
    })

    it("the root's own name and length never reach a builder or a node", () => {
      const h = helper()
      const node = [
        "attrs",
        "elementKey",
        "eventOptions",
        "handlers",
        "mount",
        "owned",
        "props",
        "refKey",
        "tag"
      ]
      // The fields most builders leave unset share one record, `~rare`.
      const builder = [
        "content",
        "elementAttrs",
        "elementKey",
        "handlers",
        "props",
        "tag",
        "~rare"
      ].sort()
      assert.deepStrictEqual(
        Object.keys(h.form.attr("method", "post")).sort(),
        builder
      )
      assert.deepStrictEqual(Object.keys(h.form("a")).sort(), builder)
      assert.deepStrictEqual(
        Object.keys(View.toNode(h.form)).sort(),
        ["_tag", "children", ...node].sort()
      )
    })

    it("builders are values: a chain call leaves its receiver alone", () => {
      const h = helper()
      const base = h.button.attr("type", "button")
      const primary = base.class("primary")
      assert.deepStrictEqual(base.elementAttrs, { type: "button" })
      assert.deepStrictEqual(primary.elementAttrs, {
        type: "button",
        class: "primary"
      })
      assert.deepStrictEqual(h.button.elementAttrs, {})
    })

    it("setting an attribute again moves it last, and removing one keeps the others in order", () => {
      const h = helper()
      const base = h.button.attrs({ type: "button", title: "Go", name: "go" })
      assert.deepStrictEqual(
        Object.entries(base.attr("type", "submit").elementAttrs),
        [
          ["title", "Go"],
          ["name", "go"],
          ["type", "submit"]
        ]
      )
      assert.deepStrictEqual(
        Object.entries(base.attr("title", undefined).elementAttrs),
        [
          ["type", "button"],
          ["name", "go"]
        ]
      )
      assert.strictEqual(
        base.attr("hidden", undefined).elementAttrs,
        base.elementAttrs
      )
      assert.deepStrictEqual(Object.keys(base.elementAttrs), [
        "type",
        "title",
        "name"
      ])
    })

    it("attrs sets and removes multiple own attributes through attr", () => {
      const h = helper()
      const base = h.div.attrs({
        id: "menu",
        role: "navigation",
        title: "Main"
      })
      assert.deepStrictEqual(h.div.elementAttrs, {})
      const updated = base.attrs(
        Object.assign(Object.create({ inherited: "skip" }), {
          id: "nav",
          role: undefined,
          lang: "en"
        })
      )
      assert.deepStrictEqual(Object.entries(updated.elementAttrs), [
        ["title", "Main"],
        ["id", "nav"],
        ["lang", "en"]
      ])
      assert.deepStrictEqual(View.build(updated, []).attrs, {
        title: "Main",
        id: "nav",
        lang: "en"
      })
      const empty = base.attrs({})
      assert.notStrictEqual(empty, base)
      assert.strictEqual(empty.elementAttrs, base.elementAttrs)
      assert.strictEqual(
        base.attrs({ hidden: undefined }).elementAttrs,
        base.elementAttrs
      )
      const tracked = Object.assign(h.div.attrs({}), {
        removals: [] as ReadonlyArray<string>
      })
      const afterTracked = tracked.attrs({
        "aria-readonly": undefined,
        title: "part",
        "data-removed": undefined
      })
      assert.deepStrictEqual(tracked.removals, [])
      assert.deepStrictEqual(afterTracked.removals, [
        "aria-readonly",
        "data-removed"
      ])
      assert.deepStrictEqual(afterTracked.elementAttrs, { title: "part" })
      class TrimmedId extends View.ElementBuilder<TodoMessage> {
        override attr(name: string, value: string | undefined): this {
          return super.attr(
            name,
            name === "id" && value !== undefined ? value.trim() : value
          )
        }
      }
      assert.deepStrictEqual(
        new TrimmedId("nav").attrs({ id: " menu ", role: "navigation" })
          .elementAttrs,
        {
          id: "menu",
          role: "navigation"
        }
      )
    })

    it("a handler set again without options drops the ones it had", () => {
      const h = helper()
      const once = h.button.on("click", add, { preventDefault: true }).on(
        "focus",
        add,
        { preventDefault: "always" }
      )
      assert.deepStrictEqual(once.eventOptions, {
        click: { preventDefault: true },
        focus: { preventDefault: "always" }
      })
      const again = once.on("click", add)
      assert.deepStrictEqual(again.handlers, { click: add, focus: add })
      assert.deepStrictEqual(again.eventOptions, {
        focus: { preventDefault: "always" }
      })
      assert.deepStrictEqual(once.eventOptions, {
        click: { preventDefault: true },
        focus: { preventDefault: "always" }
      })
      assert.strictEqual(
        h.button.on("click", add).eventOptions,
        h.button.eventOptions
      )
      assert.isUndefined(
        h.img.on("dragstart", add, { preventDefault: "always" })
          .on("dragstart", add).eventOptions.dragstart
      )
    })

    it("a builder class of the user's keeps the fields each of its builders holds", () => {
      // Only a toned builder holds `tone`.
      class Tagged extends View.ElementBuilder<TodoMessage> {
        declare tone: string | undefined
        toned(tone: string): this {
          const out = this.attr("data-tone", tone)
          out.tone = tone
          return out
        }
      }
      const plain = new Tagged("p").attr("id", "a")
      const toned = new Tagged("p").toned("warm").attr("id", "b").key("k")
      assert.isFalse("tone" in plain.attr("id", "c"))
      assert.instanceOf(toned, Tagged)
      assert.strictEqual(toned.tone, "warm")
      assert.deepStrictEqual(toned.elementAttrs, {
        "data-tone": "warm",
        id: "b"
      })
      assert.strictEqual(toned.elementKey, "k")
    })

    it.effect("style sets, replaces and removes inline CSS without changing the original builder", () =>
      Effect.gen(function*() {
        const h = helper()
        const styled = h.div.id("styled").style({
          color: "red",
          marginTop: "1rem",
          "--spacing": "2px",
          opacity: false,
          width: null,
          height: undefined,
          display: ""
        })
        assert.deepStrictEqual(h.div.elementAttrs, {})
        assert.deepStrictEqual(styled.elementAttrs, {
          id: "styled",
          style: "color:red;margin-top:1rem;--spacing:2px"
        })
        assert.deepStrictEqual(styled.style({ color: "blue" }).elementAttrs, {
          id: "styled",
          style: "color:blue"
        })
        assert.deepStrictEqual(styled.style({}).elementAttrs, { id: "styled" })
        assert.deepStrictEqual(
          styled.style({
            color: false,
            width: null,
            height: undefined,
            display: ""
          }).elementAttrs,
          {
            id: "styled"
          }
        )
        assert.strictEqual(
          h.div.style({
            webkitLineClamp: "2",
            float: "left",
            "--Accent": "red"
          }).elementAttrs.style,
          "-webkit-line-clamp:2;float:left;--Accent:red"
        )
        const Page = Html.component({
          name: "Styled",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.div.style({ color: "red" }).children(
              h.input.style({ width: "2px" })
            )
        })
        const rendered = yield* HtmlServer.renderToHtml(Page, {})
        assert.strictEqual(
          rendered.html,
          "<!--[/Styled--><div style=\"color:red\"><input style=\"width:2px\"></div><!--]/Styled-->"
        )
      }))

    it("a field added to a library builder under a string key is kept by its chain calls", () => {
      const decorated = Object.assign(
        new View.ElementBuilder<TodoMessage>("button"),
        { tone: "warm" }
      )
      assert.strictEqual(decorated.attr("id", "save").key("k").tone, "warm")
    })

    it("children are the same nodes however they are passed", () => {
      const h = helper()
      const cases: ReadonlyArray<ReadonlyArray<View.Input<TodoMessage, any>>> =
        [
          [],
          ["a"],
          ["a", "b"],
          ["a", h.text("b"), h.span],
          [h.span, "a", h.text("b")],
          [h.text("a"), h.span, "b"],
          ["", "a"],
          ["a", ""],
          [h.span, h.text("")],
          [h.span, false, "a"],
          ["a", null, "b"],
          [h.span, undefined, h.p("x")],
          [h.span, ["a", "b"], "c"],
          ["a", [h.span, false], Item(h, { key: "i", props: { title: "t" } })],
          [
            h.span.attr("id", "x"),
            h.p("x"),
            Item(h, { key: "i", props: { title: "t" } }),
            "end"
          ]
        ]
      for (const inputs of cases) {
        const expected: ReadonlyArray<View.Node<TodoMessage, any>> = View
          .children(inputs)
        const built = (
          builder: View.ElementBuilder<TodoMessage, any, any, any>
        ) => View.build(builder, []).children
        assert.deepStrictEqual(built(h.div.children(...inputs)), expected)
        assert.deepStrictEqual(
          built(h.div(...inputs as [View.Input<TodoMessage, any>])),
          expected
        )
        assert.deepStrictEqual(
          built(
            new View.ContainerBuilder<TodoMessage>("div").children(...inputs)
          ),
          expected
        )
      }
    })

    it("View.build leaves the inputs it is given as they were", () => {
      const h = helper()
      const inputs: ReadonlyArray<View.Input<TodoMessage>> = [
        "a",
        h.span,
        false,
        ["b"]
      ]
      const copy = [...inputs]
      const built = View.build(h.div, inputs)
      assert.deepStrictEqual(inputs, copy)
      assert.strictEqual(inputs[1], copy[1])
      assert.deepStrictEqual(built.children.map((child) => child._tag), [
        "Text",
        "Element",
        "Text"
      ])
    })

    it("builders that set nothing share their empty records, and a chain call never writes to them", () => {
      const h = helper()
      const empty = h.div.elementAttrs
      assert.strictEqual(h.span.elementAttrs, empty)
      assert.isTrue(Object.isFrozen(empty))
      const set = h.div.attr("id", "a").prop("hidden", true).on("click", add)
      assert.deepStrictEqual(set.elementAttrs, { id: "a" })
      assert.deepStrictEqual(Object.keys(set.handlers), ["click"])
      assert.deepStrictEqual(Object.keys(empty), [])
      assert.deepStrictEqual(h.div.elementAttrs, {})
      assert.deepStrictEqual(h.div.props, {})
      assert.deepStrictEqual(h.div.handlers, {})
      // Removing the only attribute leaves a record with none.
      assert.deepStrictEqual(set.attr("id", undefined).elementAttrs, {})
    })

    it("__proto__ is an attribute or property like any other name", () => {
      const h = helper()
      const set = h.div.attr("__proto__", "a").attr("id", "x").prop(
        "__proto__",
        { hidden: true }
      )
      assert.deepStrictEqual(Object.entries(set.elementAttrs), [[
        "__proto__",
        "a"
      ], ["id", "x"]])
      assert.deepStrictEqual(Object.entries(set.props), [["__proto__", {
        hidden: true
      }]])
      assert.strictEqual(Object.getPrototypeOf(set.props), Object.prototype)
      // Setting another attribute again copies `__proto__` across.
      assert.deepStrictEqual(Object.entries(set.attr("id", "y").elementAttrs), [
        ["__proto__", "a"],
        ["id", "y"]
      ])
    })
  })

  describe("classNames", () => {
    it("joins tokens with one space", () => {
      assert.strictEqual(
        Html.classNames("rounded px-3", "py-1"),
        "rounded px-3 py-1"
      )
    })

    it("skips false, null, undefined and empty tokens", () => {
      assert.strictEqual(
        Html.classNames(false, "a", null, "", undefined, "b"),
        "a b"
      )
    })

    it("returns an empty string when no token is left", () => {
      assert.strictEqual(Html.classNames(), "")
      assert.strictEqual(Html.classNames(false, null, undefined, ""), "")
    })
  })

  describe("Element.class", () => {
    it("still takes a single string", () => {
      assert.deepStrictEqual(button().class("primary").elementAttrs, {
        class: "primary"
      })
    })

    it("joins several tokens and drops the falsy ones", () => {
      const saving = true
      const error: string | undefined = undefined
      const element = button().class(
        "rounded px-3 py-1",
        saving && "opacity-50",
        error !== undefined && "ring-2"
      )
      assert.deepStrictEqual(element.elementAttrs, {
        class: "rounded px-3 py-1 opacity-50"
      })
    })

    it("removes the attribute when every token is falsy", () => {
      assert.deepStrictEqual(
        button().class(false, null, undefined, "").elementAttrs,
        {}
      )
    })

    it("appends to the classes already on the builder", () => {
      assert.deepStrictEqual(
        button().class("btn btn-primary").class("w-full").elementAttrs,
        { class: "btn btn-primary w-full" }
      )
    })

    it("keeps classes on falsy tokens and returns a plain builder from a shorthand root", () => {
      const out = View.shorthand(button().class("btn")).class(false)
      assert.strictEqual(typeof out, "object")
      assert.deepStrictEqual(out.elementAttrs, { class: "btn" })
    })

    it.effect("renders the same classes on the server", () =>
      Effect.gen(function*() {
        const Classes = Html.component({
          name: "Classes",
          model: Schema.Struct({ saving: Schema.Boolean }),
          message: Schema.Never
        }).make({
          init: () => ({ saving: false }),
          update: ($) => $.model,
          view: (h, model) =>
            h.div(
              h.button.class("rounded", model.saving && "opacity-50", "px-3")
                .children("Save"),
              h.p.class(model.saving && "busy").children("Idle")
            )
        })
        const rendered = yield* HtmlServer.renderToHtml(Classes, {})
        assert.include(
          rendered.html,
          `<button class="rounded px-3">Save</button>`
        )
        assert.include(rendered.html, "<p>Idle</p>")
      }))
  })
})
