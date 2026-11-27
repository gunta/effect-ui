// @vitest-environment happy-dom
import {
  Command,
  Component,
  Feature,
  Head,
  MessageLog,
  Mount,
  Query,
  Renderer,
  Route,
  Router,
  Subscription,
  UiSchema,
  View
} from "@effect/ui"
import {
  BrowserHost,
  Html,
  HtmlCommand,
  HtmlHydrate,
  HtmlKeyboard,
  HtmlScheduler,
  HtmlServer,
  HtmlSubscription
} from "@effect/ui/html"
import {
  BrowserCase,
  HtmlLocator,
  TestAnimationFrames
} from "@effect/ui/html/testing"
import { Case, TestHost } from "@effect/ui/testing"
import { assert, expect, it } from "@effect/vitest"
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Scheduler,
  Schema,
  Scope,
  Stream
} from "effect"
import { describe, vi } from "vitest"
import { collectGarbage } from "../utils/gc.ts"
import { Confirm, ConfirmMessage, Nested } from "./fixtures/confirm.ts"
import {
  Menu,
  MenuMessage,
  ModalMenu,
  popoverStub,
  Rows
} from "./fixtures/popover.ts"
import { maxTitle, TodoApp } from "./fixtures/todos.ts"

/** Lets the render flush, Commands and the controlled-property restore run. */
const tick = Effect.promise(() =>
  new Promise<void>((resolve) => setTimeout(resolve, 30))
)

/** Defines a custom element that clicks its buttons once it is in the document, after `before` runs. */
const clicksWhenConnected = (name: string, before?: () => void) =>
  customElements.define(
    name,
    class extends HTMLElement {
      connectedCallback() {
        before?.()
        for (const button of this.querySelectorAll("button")) button.click()
      }
    }
  )

const container = Effect.acquireRelease(
  Effect.sync(() => document.body.appendChild(document.createElement("div"))),
  (element) => Effect.sync(() => element.remove())
)

// The tests share one document, and some of them move focus.
interface NativeTags<Msg> {
  readonly view: View.ElementBuilder<Msg>
}
interface NativeHost {
  readonly NativeHost: unique symbol
}
interface Native extends View.Elements {
  readonly Tags: NativeTags<this["Msg"]>
  readonly Host: NativeHost
}

describe("BrowserHost", { concurrent: false }, () => {
  it.effect("the layer provides the document's visibility and connectivity, and stops listening when closed", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(BrowserHost.layer(), scope)
      const visibility = Context.get(context, Query.Visibility)
      const connectivity = Context.get(context, Query.Connectivity)
      const seen: Array<string> = []
      visibility.subscribe(() => seen.push(`visible ${visibility.get()}`))
      connectivity.subscribe(() => seen.push(`online ${connectivity.get()}`))
      assert.deepStrictEqual([visibility.get(), connectivity.get()], [
        true,
        true
      ])
      const setVisibility = (state: DocumentVisibilityState) => {
        Object.defineProperty(document, "visibilityState", {
          value: state,
          configurable: true
        })
        document.dispatchEvent(new Event("visibilitychange"))
      }
      setVisibility("hidden")
      setVisibility("visible")
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
      // The window's focus is not visibility.
      window.dispatchEvent(new Event("blur"))
      assert.deepStrictEqual(seen, [
        "visible false",
        "visible true",
        "online false",
        "online true"
      ])
      yield* Scope.close(scope, Exit.void)
      setVisibility("hidden")
      window.dispatchEvent(new Event("offline"))
      assert.deepStrictEqual([visibility.get(), connectivity.get()], [
        true,
        true
      ])
      delete (document as { visibilityState?: unknown }).visibilityState
    }))

  it.effect("runs a props Effect once, so props that are an Effect stay data", () =>
    Effect.gen(function*() {
      const Lazy = Component.define({
        name: "Lazy",
        props: Schema.declare((u): u is Effect.Effect<never, string> =>
          Effect.isEffect(u)
        ),
        model: Schema.Null,
        message: Schema.Never
      }).make({
        init: () => null,
        update: ($) => $.model,
        view: (h) => h.text("mounted")
      })
      const app = yield* container
      yield* BrowserHost.mountEffect(
        Lazy,
        Effect.succeed(Effect.fail("ran inner")),
        app
      )
      expect(app.textContent).toBe("mounted")
    }).pipe(Effect.scoped))

  it.live("runs Commands on HtmlScheduler unless the caller provides a Scheduler", () =>
    Effect.gen(function*() {
      const posted: Array<string> = []
      vi.stubGlobal("scheduler", {
        postTask: (run: () => void, options: { readonly priority: string }) => {
          posted.push(options.priority)
          return new Promise((resolve) => setTimeout(() => resolve(run()), 0))
        }
      })
      const Ping = Command.make(
        "Ping",
        { args: {} },
        () => Effect.as(Effect.yieldNowWith(1), "pong")
      )
      const App = Component.define({
        name: "App",
        model: Schema.String,
        message: Schema.String
      })
        .make({
          init: () => "",
          update: ($, message) =>
            message === "ping" ? $.run(Ping.make()) : message,
          view: (h, model) => h.text(model)
        })
      const mounted = Effect.fnUntraced(function*(app: Element) {
        const root = yield* BrowserHost.mountEffect(App, {}, app)
        root.send("ping")
        yield* tick
        return app.textContent
      })
      expect(yield* mounted(yield* container)).toBe("pong")
      expect(posted).toContain("background")
      posted.length = 0
      expect(
        yield* mounted(yield* container).pipe(
          Effect.provideService(
            Scheduler.Scheduler,
            new Scheduler.MixedScheduler()
          )
        )
      ).toBe("pong")
      expect(posted).toEqual([])
    }).pipe(
      Effect.scoped,
      Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
    ))

  describe("a todo app", () => {
    it.effect("adds, toggles, deletes and clears todos", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(TodoApp, {}, app)
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "New todo"
        }) as HTMLInputElement
        const add = HtmlLocator.getByRole(app, "button", { name: "Add" })

        for (const title of ["Buy milk", "Walk the dog", "Write docs"]) {
          HtmlLocator.type(field, title)
          yield* tick
          HtmlLocator.click(add)
          yield* tick
        }
        expect(field.value).toBe("")
        const list = HtmlLocator.getByRole(app, "list", { name: "Todos" })
        expect(
          HtmlLocator.queryAllByRole(list, "listitem").map((item) =>
            item.textContent
          )
        ).toEqual([
          "Buy milk×",
          "Walk the dog×",
          "Write docs×"
        ])
        expect(
          HtmlLocator.getByRole(app, "button", { name: "Clear done" })
            .hasAttribute("disabled")
        ).toBe(true)

        // Toggling a row keeps every row's nodes.
        const before = HtmlLocator.queryAllByRole(list, "listitem")
        const walk = HtmlLocator.getByRole(app, "checkbox", {
          name: "Walk the dog"
        }) as HTMLInputElement
        HtmlLocator.click(walk)
        yield* tick
        expect(walk.checked).toBe(true)
        expect(root.model()!.todos.map((todo) => todo.done)).toEqual([
          false,
          true,
          false
        ])
        expect(HtmlLocator.queryAllByRole(list, "listitem")).toEqual(before)
        expect(before[1]!.className).toBe("done")
        expect(HtmlLocator.queryAllByRole(app, "checkbox", { checked: true }))
          .toEqual([walk])
        expect(app.textContent).toContain("2 items left")

        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Delete Buy milk" })
        )
        yield* tick
        expect(HtmlLocator.queryAllByRole(list, "listitem")).toEqual([
          before[1],
          before[2]
        ])

        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Clear done" })
        )
        yield* tick
        expect(HtmlLocator.queryAllByRole(list, "listitem")).toEqual([
          before[2]
        ])
        expect(app.textContent).toContain("1 item left")
      }).pipe(Effect.scoped))

    it.effect("submits with Enter in the field", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(TodoApp, {}, app)
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "New todo"
        })
        HtmlLocator.type(field, "Ship it")
        yield* tick
        HtmlLocator.submit(field)
        yield* tick
        expect(root.model()!.todos.map((todo) => todo.title)).toEqual([
          "Ship it"
        ])
        expect(HtmlLocator.getByRole(app, "checkbox", { name: "Ship it" }))
          .toBeDefined()
      }).pipe(Effect.scoped))
  })

  describe("controlled properties", () => {
    it.effect("a field keeps the Model's value when update rejects what the user typed", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(TodoApp, {}, app)
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "New todo"
        }) as HTMLInputElement
        HtmlLocator.type(field, "Short title")
        yield* tick
        expect(field.value).toBe("Short title")

        const tooLong = "x".repeat(maxTitle + 1)
        HtmlLocator.type(field, tooLong)
        expect(field.value).toBe(tooLong)
        yield* tick
        expect(root.model()!.draft).toBe("Short title")
        expect(field.value).toBe("Short title")
      }).pipe(Effect.scoped))

    const Message = UiSchema.TaggedEnum({
      Typed: { value: Schema.String },
      Checked: { checked: Schema.Boolean }
    })
    const Form = Html.component({
      name: "Form",
      model: Schema.Struct({
        text: Schema.String,
        checked: Schema.Boolean,
        open: Schema.Boolean
      }),
      message: Message
    }).make({
      init: () => ({ text: "fixed", checked: false, open: true }),
      // Every change is rejected.
      update: ($) => $.model,
      view: (h, model) =>
        h.div(
          // A handler that ignores the event: nothing reaches update.
          h.input.attr("aria-label", "Ignored").value(model.text).on(
            "input",
            () => undefined
          ),
          // No handler at all: the field is read-only, as the Model never changes.
          h.textarea.attr("aria-label", "Unhandled").value(model.text),
          h.input.attrs({ type: "checkbox", "aria-label": "Agree" }).checked(
            model.checked
          )
            .on("input", ({ checked }) => Message.Checked({ checked })),
          h.select
            .attr("aria-label", "Pick")
            .value("b").children(
              h.option.attr("value", "a").children("A"),
              h.option.attr("value", "b").children("B")
            ),
          h.details.open(model.open).children(h.summary("More"), "Details")
        )
    })

    it.effect("an ignored or unhandled change is put back", () =>
      Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(Form, {}, app)
        const ignored = HtmlLocator.getByRole(app, "textbox", {
          name: "Ignored"
        }) as HTMLInputElement
        const unhandled = HtmlLocator.getByRole(app, "textbox", {
          name: "Unhandled"
        }) as HTMLTextAreaElement
        const select = HtmlLocator.getByRole(app, "combobox", {
          name: "Pick"
        }) as HTMLSelectElement
        expect(select.value).toBe("b")

        HtmlLocator.type(ignored, "typed")
        HtmlLocator.type(unhandled, "typed")
        select.value = "a"
        select.dispatchEvent(new Event("change", { bubbles: true }))
        yield* tick
        expect(ignored.value).toBe("fixed")
        expect(unhandled.value).toBe("fixed")
        expect(select.value).toBe("b")
      }).pipe(Effect.scoped))

    it.effect("a checkbox keeps the Model's state when update rejects the click", () =>
      Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(Form, {}, app)
        const box = HtmlLocator.getByRole(app, "checkbox", {
          name: "Agree"
        }) as HTMLInputElement
        HtmlLocator.click(box)
        yield* tick
        expect(box.checked).toBe(false)
      }).pipe(Effect.scoped))

    it.effect("a form reset is put back to what the Model says", () =>
      Effect.gen(function*() {
        const Resettable = Html.component({
          name: "Resettable",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.form(
              h.input.attr("aria-label", "Name").value("fixed"),
              h.input.attrs({ type: "checkbox", "aria-label": "Agree" })
                .checked(true),
              h.select
                .attr("aria-label", "Pick").children(
                  h.option.attr("value", "a").children("A"),
                  h.option.attr("value", "b").selected(true).children("B")
                )
            )
        })
        const app = yield* container
        yield* BrowserHost.mountEffect(Resettable, {}, app)
        const name = HtmlLocator.getByRole(app, "textbox", {
          name: "Name"
        }) as HTMLInputElement
        const agree = HtmlLocator.getByRole(app, "checkbox", {
          name: "Agree"
        }) as HTMLInputElement
        const pick = HtmlLocator.getByRole(app, "combobox", {
          name: "Pick"
        }) as HTMLSelectElement
        app.querySelector("form")!.reset()
        expect([name.value, agree.checked, pick.value]).toEqual([
          "",
          false,
          "a"
        ])
        yield* tick
        expect([name.value, agree.checked, pick.value]).toEqual([
          "fixed",
          true,
          "b"
        ])
      }).pipe(Effect.scoped))

    it.effect("accepting what the user typed leaves the caret where it is", () =>
      Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(TodoApp, {}, app)
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "New todo"
        }) as HTMLInputElement
        HtmlLocator.type(field, "abcdef")
        yield* tick
        field.setSelectionRange(2, 2)
        HtmlLocator.type(field, "abXcdef")
        field.setSelectionRange(3, 3)
        yield* tick
        expect(field.value).toBe("abXcdef")
        expect(field.selectionStart).toBe(3)
      }).pipe(Effect.scoped))

    describe("the selection of a focused field the host writes", () => {
      const Edited = UiSchema.TaggedEnum({
        Upper: { value: Schema.String },
        Card: { value: Schema.String },
        Push: {},
        Accept: {},
        ResetUpper: {}
      })
      const Fields = Html.component({
        name: "Fields",
        model: Schema.Struct({
          upper: Schema.String,
          card: Schema.String,
          pushed: Schema.String
        }),
        message: Edited
      }).make({
        init: () => ({ upper: "ABCDEF", card: "1234", pushed: "hello world" }),
        update: ($, message) =>
          Edited.match(message, {
            Upper: ({ value }) => ({ ...$.model, upper: value.toUpperCase() }),
            Card: ({ value }) => ({
              ...$.model,
              card: value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ")
            }),
            Push: () => ({
              ...$.model,
              pushed: $.model.pushed === "hello world"
                ? "hello"
                : "hello world"
            }),
            Accept: () => ({ ...$.model, pushed: "hello Xworld" }),
            ResetUpper: () => ({ ...$.model, upper: "ABCDEF" })
          }),
        view: (h, model) =>
          h.div(
            h.input.attr("aria-label", "Fixed").value("123456").on(
              "input",
              () => undefined
            ),
            h.textarea.attr("aria-label", "Upper").value(model.upper).on(
              "input",
              (
                { value }
              ) => Edited.Upper({ value })
            ),
            h.input.attr("aria-label", "Card").value(model.card).on("input", (
              { value }
            ) => Edited.Card({ value })),
            h.input.attr("aria-label", "Pushed").value(model.pushed),
            h.input.attr("aria-label", "Other").value(model.pushed),
            h.input.attrs({ type: "email", "aria-label": "Email" }).value(
              model.pushed
            ),
            h.button.on("click", Edited.Push()).children("Push"),
            h.button.on("click", Edited.Accept()).children("Accept"),
            h.button.on("click", Edited.ResetUpper()).children("Reset")
          )
      })
      const mountFields = Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(Fields, {}, app)
        return {
          field: (name: string) =>
            HtmlLocator.getByRole(app, "textbox", { name }) as HTMLInputElement,
          press: (name: string) =>
            HtmlLocator.click(HtmlLocator.getByRole(app, "button", { name }))
        }
      })
      const beforeInput = (field: HTMLInputElement, cancel = false) => {
        if (cancel) {
          field.addEventListener(
            "beforeinput",
            (event) => event.preventDefault(),
            { once: true }
          )
        }
        field.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText"
          })
        )
      }
      const edit = (field: HTMLInputElement, value: string, caret: number) => {
        beforeInput(field)
        field.value = value
        field.setSelectionRange(caret, caret)
        field.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" })
        )
      }
      const selection = (
        field: HTMLInputElement
      ) => [field.value, field.selectionStart, field.selectionEnd]

      it.effect("a rejected edit puts back the selection it started from", () =>
        Effect.gen(function*() {
          const field = (yield* mountFields).field("Fixed")
          field.focus()
          field.setSelectionRange(3, 3)
          edit(field, "123a456", 4)
          yield* tick
          expect(selection(field)).toEqual(["123456", 3, 3])
          field.setSelectionRange(3, 6)
          edit(field, "123a", 4)
          yield* tick
          expect(selection(field)).toEqual(["123456", 3, 6])
          field.setSelectionRange(1, 1)
          beforeInput(field, true)
          field.value = "123x456"
          field.setSelectionRange(4, 4)
          field.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "insertText" })
          )
          yield* tick
          expect(selection(field)).toEqual(["123456", 3, 3])
        }).pipe(Effect.scoped))

      it.effect("a normalized value keeps the caret with the text around it, and at the end", () =>
        Effect.gen(function*() {
          const { field, press } = yield* mountFields
          const upper = field("Upper")
          upper.focus()
          upper.setSelectionRange(1, 1)
          edit(upper, "AXBCDEF", 2)
          yield* Effect.promise(() => Promise.resolve())
          upper.setSelectionRange(5, 5)
          press("Reset")
          yield* tick
          expect(selection(upper)).toEqual(["ABCDEF", 4, 4])
          upper.setSelectionRange(3, 3)
          edit(upper, "ABCxDEF", 4)
          yield* tick
          expect(selection(upper)).toEqual(["ABCXDEF", 4, 4])

          const card = field("Card")
          card.focus()
          edit(card, "12345", 5)
          yield* tick
          expect(selection(card)).toEqual(["1234 5", 6, 6])
          card.setSelectionRange(2, 2)
          edit(card, "12934 5", 3)
          yield* tick
          expect(selection(card)).toEqual(["1293 45", 3, 3])
        }).pipe(Effect.scoped))

      it.effect("a value the Model pushes keeps a focused field's selection, clamped", () =>
        Effect.gen(function*() {
          const { field, press } = yield* mountFields
          const [pushed, other] = [field("Pushed"), field("Other")]
          pushed.setSelectionRange(2, 8)
          other.setSelectionRange(2, 8)
          pushed.focus()
          press("Push")
          yield* tick
          expect(selection(pushed)).toEqual(["hello", 2, 5])
          expect(selection(other)).toEqual(["hello", 5, 5])
          field("Email").focus()
          press("Push")
          yield* tick
          expect(field("Email").value).toBe("hello world")
        }).pipe(Effect.scoped))

      it.effect("an edit the Model takes after it was put back gets its caret back", () =>
        Effect.gen(function*() {
          const { field, press } = yield* mountFields
          const pushed = field("Pushed")
          pushed.focus()
          pushed.setSelectionRange(6, 6)
          edit(pushed, "hello Xworld", 7)
          yield* tick
          expect(selection(pushed)).toEqual(["hello world", 6, 6])
          press("Accept")
          yield* tick
          expect(selection(pushed)).toEqual(["hello Xworld", 7, 7])
        }).pipe(Effect.scoped))

      it.effect("a rejected composition puts back the selection it started from after compositionend", () =>
        Effect.gen(function*() {
          const field = (yield* mountFields).field("Fixed")
          field.focus()
          field.setSelectionRange(1, 4)
          field.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true })
          )
          field.dispatchEvent(
            new InputEvent("beforeinput", { bubbles: true, isComposing: true })
          )
          field.value = "1か56"
          field.setSelectionRange(2, 2)
          field.dispatchEvent(
            new InputEvent("input", { bubbles: true, isComposing: true })
          )
          yield* tick
          expect(selection(field)).toEqual(["1か56", 2, 2])
          field.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true })
          )
          yield* tick
          expect(selection(field)).toEqual(["123456", 1, 4])
        }).pipe(Effect.scoped))
    })
  })

  describe("a field bound to the URL", () => {
    const SearchRoute = Route.union({
      Search: Route.make("/search", {
        search: { q: Schema.optional(Schema.String) }
      }),
      NotFound: Route.make("/*")
    })
    const SearchMessage = UiSchema.TaggedEnum({
      Typed: { value: Schema.String },
      Patched: { outcome: Schema.Literals(["navigated", "blocked", "stale"]) }
    })
    // The search is the only copy of the text: the page's Model holds none. Digits are rejected.
    const SearchPage = Html.component({
      name: "SearchPage",
      props: Schema.Struct({ route: SearchRoute.subset(["Search"]) }),
      model: Schema.Struct({}),
      message: SearchMessage
    }).make({
      init: () => ({}),
      update: ($, message) =>
        SearchMessage.match(message, {
          Typed: ({ value }) =>
            /\d/.test(value)
              ? $.model
              : $.run(
                Router.patchSearch(SearchRoute, $.props.route, {
                  q: value || undefined
                }).pipe(
                  Command.map((outcome) => SearchMessage.Patched({ outcome }))
                )
              ),
          Patched: () => $.model
        }),
      view: (h) =>
        h.input.attr("aria-label", "Search").value(h.props.route.search.q ?? "")
          .on("input", ({ value }) => SearchMessage.Typed({ value }))
    })
    const AppMessage = UiSchema.TaggedEnum({
      ChangedRoute: { route: SearchRoute }
    })
    const SearchApp = Html.component({
      name: "SearchApp",
      props: Schema.Struct({ route: SearchRoute }),
      model: Schema.Struct({ route: SearchRoute }),
      message: AppMessage
    }).make({
      init: ($) => ({ route: $.props.route }),
      update: (_, { route }) => ({ route }),
      subscriptions: ({ model }) => [
        Router.subscription(
          SearchRoute,
          model.route,
          (route) => AppMessage.ChangedRoute({ route })
        )
      ],
      view: (h, model) =>
        SearchRoute.match(model.route, {
          Search: (route) =>
            SearchPage(h, {
              key: SearchRoute.printPath(route),
              props: { route }
            }),
          NotFound: () => h.p("Not found")
        })
    })

    /**
     * Runs a test with the app mounted at `url`. Every value the host writes to the field is
     * recorded, and `type` changes it as the user would, without recording.
     */
    const withSearch = <A, E>(
      body: (search: {
        readonly field: HTMLInputElement
        readonly history: ReturnType<typeof Router.memoryHistory>
        readonly type: (value: string) => void
        readonly writes: ReadonlyArray<string>
      }) => Effect.Effect<A, E, Scope.Scope>,
      url = "/search"
    ) => {
      const history = Router.memoryHistory(url)
      return Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(
          SearchApp,
          Router.props(SearchRoute),
          app
        )
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "Search"
        }) as HTMLInputElement
        const native = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!
        const writes: Array<string> = []
        Object.defineProperty(field, "value", {
          configurable: true,
          get: () => native.get!.call(field),
          set: (value: string) => {
            writes.push(value)
            native.set!.call(field, value)
          }
        })
        const type = (value: string) => {
          native.set!.call(field, value)
          field.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: value,
              inputType: "insertText"
            })
          )
        }
        return yield* body({ field, history, type, writes })
      }).pipe(
        Effect.scoped,
        Effect.provide(Router.memory({ routes: SearchRoute, history }))
      )
    }

    it.effect("an accepted keystroke writes nothing back, and the caret stays", () =>
      withSearch(({ field, history, type, writes }) =>
        Effect.gen(function*() {
          type("abcdef")
          yield* tick
          field.setSelectionRange(2, 2)
          type("abXcdef")
          field.setSelectionRange(3, 3)
          yield* tick
          expect(field.value).toBe("abXcdef")
          expect(field.selectionStart).toBe(3)
          expect(history.entries()).toEqual(["/search?q=abXcdef"])
          expect(writes).toEqual([])
        })
      ))

    it.effect("two keystrokes inside one round trip write nothing back", () =>
      withSearch(({ field, history, type, writes }) =>
        Effect.gen(function*() {
          type("a")
          type("ab")
          yield* tick
          expect(field.value).toBe("ab")
          expect(history.entries()).toEqual(["/search?q=ab"])
          expect(writes).toEqual([])
        })
      ))

    it.effect("fast typing loses no characters, keeps the caret and keeps the params the route doesn't declare", () =>
      withSearch(({ field, history, type, writes }) =>
        Effect.gen(function*() {
          let text = ""
          for (const char of "effect") {
            text += char
            type(text)
            field.setSelectionRange(text.length, text.length)
          }
          yield* tick
          field.setSelectionRange(1, 1)
          type("eXffect")
          field.setSelectionRange(2, 2)
          type("eXYffect")
          field.setSelectionRange(3, 3)
          yield* tick
          expect(field.value).toBe("eXYffect")
          expect(field.selectionStart).toBe(3)
          expect(history.entries()).toEqual([
            "/search?q=eXYffect&utm_source=news"
          ])
          expect(writes).toEqual([])
        }), "/search?utm_source=news"))

    it.effect("keeps typed text when HtmlScheduler has no budget left", () =>
      withSearch(({ field, history, type, writes }) =>
        Effect.gen(function*() {
          yield* Effect.promise(async () => {
            let text = ""
            for (const char of "effect") {
              text += char
              type(text)
              field.setSelectionRange(text.length, text.length)
              await Promise.resolve()
              expect(field.value).toBe(text)
              expect(history.entries()).toEqual([`/search?q=${text}`])
            }
          })
          yield* tick
          expect(field.value).toBe("effect")
          expect(field.selectionStart).toBe(6)
          expect(history.entries()).toEqual(["/search?q=effect"])
          expect(writes).toEqual([])
        })
      ).pipe(
        Effect.provideService(Scheduler.MaxOpsBeforeYield, 8),
        Effect.provide(HtmlScheduler.layer({ budget: 0 }))
      ))

    it.effect("a rejected keystroke is put back", () =>
      withSearch(({ field, history, type }) =>
        Effect.gen(function*() {
          type("ab")
          yield* tick
          type("ab1")
          yield* tick
          expect(field.value).toBe("ab")
          expect(history.entries()).toEqual(["/search?q=ab"])
        })
      ))
  })

  describe("lists", () => {
    const ListMessage = UiSchema.TaggedEnum({
      Set: { rows: Schema.Array(Schema.String) }
    })
    // A child's nodes are a list of their own, among the parent's other nodes.
    const Shown = Html.component({
      name: "Shown",
      props: Schema.Struct({ rows: Schema.Array(Schema.String) }),
      model: Schema.Null,
      message: Schema.Never
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        h.props.rows.length === 0 ? h.span("none") : h.em(h.props.rows.join(""))
    })
    const Lists = Html.component({
      name: "Lists",
      model: Schema.Array(Schema.String),
      message: ListMessage
    }).make({
      init: (): ReadonlyArray<string> => ["a", "b", "c"],
      update: (_, message) => message.rows,
      view: (h, rows) =>
        h.div(
          h.ul(rows.map((row) => h.li.key(row).children(row))),
          h.ol(
            h.li("first"),
            rows.map((row) => h.li.key(row).children(row)),
            "last"
          ),
          h.p("before", Shown(h, { key: "shown", props: { rows } }), "after")
        )
    })

    it.effect("a list that loses every row keeps the nodes beside it, whether it's emptied or replaced", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Lists, {}, app)
        const html = (rows: ReadonlyArray<string>) => {
          const items = rows.map((row) => `<li>${row}</li>`).join("")
          const shown = rows.length === 0
            ? "<span>none</span>"
            : `<em>${rows.join("")}</em>`
          return `<div><ul>${items}</ul><ol><li>first</li>${items}last</ol><p>before${shown}after</p></div>`
        }
        expect(app.innerHTML).toBe(html(["a", "b", "c"]))
        root.send(ListMessage.Set({ rows: [] }))
        yield* tick
        expect(app.innerHTML).toBe(html([]))
        root.send(ListMessage.Set({ rows: ["d", "e"] }))
        yield* tick
        expect(app.innerHTML).toBe(html(["d", "e"]))
        const kept = app.querySelector("ul li")
        // Every row is new: the old ones go before the new ones are placed.
        root.send(ListMessage.Set({ rows: ["f", "g", "h"] }))
        yield* tick
        expect(app.innerHTML).toBe(html(["f", "g", "h"]))
        expect(kept?.isConnected).toBe(false)
      }).pipe(Effect.scoped))

    it.effect("an element's only child keeps its node until its key or its tag changes", () =>
      Effect.gen(function*() {
        // The rows are the child's tag, its key and its text.
        const Only = Html.component({
          name: "Only",
          model: Schema.Array(Schema.String),
          message: ListMessage
        }).make({
          init: (): ReadonlyArray<string> => ["p", "a", "one"],
          update: (_, message) => message.rows,
          view: (h, [tag, key, text]) =>
            h.div(
              tag === "p"
                ? h.p.key(key!).children(text!)
                : h.span.key(key!).children(text!)
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Only, {}, app)
        const first = app.querySelector("p")
        root.send(ListMessage.Set({ rows: ["p", "a", "two"] }))
        yield* tick
        expect(app.innerHTML).toBe("<div><p>two</p></div>")
        expect(app.querySelector("p")).toBe(first)
        root.send(ListMessage.Set({ rows: ["p", "b", "two"] }))
        yield* tick
        expect(app.innerHTML).toBe("<div><p>two</p></div>")
        expect(app.querySelector("p")).not.toBe(first)
        root.send(ListMessage.Set({ rows: ["span", "b", "two"] }))
        yield* tick
        expect(app.innerHTML).toBe("<div><span>two</span></div>")
      }).pipe(Effect.scoped))

    it.effect("a focused row keeps focus when a keyed reorder moves it", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Lists, {}, app)
        const ul = app.querySelector("ul")!
        const a = ul.firstElementChild as HTMLElement
        a.tabIndex = 0
        a.focus()
        root.send(ListMessage.Set({ rows: ["b", "c", "a"] }))
        yield* tick
        expect(Array.from(ul.children, (li) => li.textContent))
          .toEqual(["b", "c", "a"])
        expect(ul.lastElementChild).toBe(a)
        expect(document.activeElement).toBe(a)
        // Code that runs during the move, like a blur handler, keeps the focus it gives.
        const other = yield* container
        other.tabIndex = 0
        customElements.define(
          "focus-other",
          class extends HTMLElement {
            disconnectedCallback() {
              other.focus()
            }
          }
        )
        a.append(document.createElement("focus-other"))
        root.send(ListMessage.Set({ rows: ["a", "b", "c"] }))
        yield* tick
        expect(document.activeElement).toBe(other)
      }).pipe(Effect.scoped))

    it.effect("a keyed reorder uses moveBefore when the parent supports it", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Lists, {}, app)
        const ul = app.querySelector("ul")!
        const a = ul.firstElementChild!
        const moved: Array<[globalThis.Node, globalThis.Node | null]> = []
        ul.moveBefore = (node, before) => {
          moved.push([node, before])
          ul.insertBefore(node, before)
        }
        root.send(ListMessage.Set({ rows: ["b", "c", "a"] }))
        yield* tick
        expect(moved).toEqual([[a, null]])
        moved.length = 0
        root.send(ListMessage.Set({ rows: ["b", "c", "a", "d"] }))
        yield* tick
        expect(moved).toEqual([])
        // A form control named `moveBefore` shadows the method.
        Object.assign(ul, { moveBefore: document.createElement("input") })
        root.send(ListMessage.Set({ rows: ["a", "b", "c", "d"] }))
        yield* tick
        expect(ul.firstElementChild).toBe(a)
      }).pipe(Effect.scoped))

    it.effect("a custom element's class is set as an attribute, whatever its className does", () =>
      Effect.gen(function*() {
        const seen: Array<string | null> = []
        // Its className doesn't reflect, so only setting the attribute gives it a class.
        class Classed extends HTMLElement {
          static observedAttributes = ["class"]
          override set className(_: string) {}
          attributeChangedCallback(
            _: string,
            __: string | null,
            value: string | null
          ) {
            seen.push(value)
          }
        }
        if (customElements.get("x-classed") === undefined) {
          customElements.define("x-classed", Classed)
        }
        const Page = Html.component({
          name: "Classed",
          model: Schema.Array(Schema.String),
          message: ListMessage
        }).make({
          init: (): ReadonlyArray<string> => ["a"],
          update: (_, message) => message.rows,
          view: (h, [name]) => h.div(h.el("x-classed").attr("class", name))
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Page, {}, app)
        expect(app.innerHTML).toBe(
          "<div><x-classed class=\"a\"></x-classed></div>"
        )
        root.send(ListMessage.Set({ rows: ["b"] }))
        yield* tick
        expect(app.innerHTML).toBe(
          "<div><x-classed class=\"b\"></x-classed></div>"
        )
        expect(seen).toEqual(["a", "b"])
      }).pipe(Effect.scoped))
  })

  describe("lazy", () => {
    const Item = Schema.Struct({ id: Schema.Number, label: Schema.String })
    const LazyMessage = UiSchema.TaggedEnum({
      Select: { id: Schema.Number },
      Rename: { id: Schema.Number, label: Schema.String },
      Remove: { id: Schema.Number },
      Tick: {}
    })
    const ItemsDef = Html.component({
      name: "Items",
      model: Schema.Struct({
        items: Schema.Array(Item),
        selected: Schema.Number,
        ticks: Schema.Number
      }),
      message: LazyMessage
    })
    const built: Array<string> = []
    const row = (
      h: Component.Helper<typeof ItemsDef>,
      item: typeof Item.Type,
      selected: boolean
    ) => {
      built.push(item.label)
      return h.li.key(String(item.id)).class(selected && "on").children(
        item.label
      )
    }
    const Items = ItemsDef.make({
      init: () => ({
        items: [{ id: 1, label: "a" }, { id: 2, label: "b" }, {
          id: 3,
          label: "c"
        }],
        selected: 0,
        ticks: 0
      }),
      update: ($, message) =>
        LazyMessage.match(message, {
          Select: ({ id }) => ({ ...$.model, selected: id }),
          Rename: ({ id, label }) => ({
            ...$.model,
            items: $.model.items.map((item) =>
              item.id === id ? { id, label } : item
            )
          }),
          Remove: ({ id }) => ({
            ...$.model,
            items: $.model.items.filter((item) => item.id !== id)
          }),
          Tick: () => ({ ...$.model, ticks: $.model.ticks + 1 })
        }),
      view: (h, model) =>
        h.div(
          h.p(String(model.ticks)),
          h.ul(model.items.map((item) =>
            h.lazy(row, item, item.id === model.selected)
          ))
        )
    })

    it.effect("builds a row again only when one of its arguments changes, and keeps every row's nodes", () =>
      Effect.gen(function*() {
        built.length = 0
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Items, {}, app)
        const step = Effect.fnUntraced(
          function*(message: typeof LazyMessage.Type) {
            built.length = 0
            root.send(message)
            yield* tick
            return [...built]
          }
        )
        assert.deepStrictEqual(built, ["a", "b", "c"])
        const items = () => [...app.querySelectorAll("li")]
        const [a, b, c] = items()
        assert.deepStrictEqual(yield* step(LazyMessage.Tick()), [])
        assert.strictEqual(
          app.innerHTML,
          "<div><p>1</p><ul><li>a</li><li>b</li><li>c</li></ul></div>"
        )
        assert.deepStrictEqual(yield* step(LazyMessage.Select({ id: 2 })), [
          "b"
        ])
        assert.deepStrictEqual(yield* step(LazyMessage.Select({ id: 3 })), [
          "b",
          "c"
        ])
        assert.deepStrictEqual(
          yield* step(LazyMessage.Rename({ id: 1, label: "A" })),
          ["A"]
        )
        assert.strictEqual(
          app.innerHTML,
          "<div><p>1</p><ul><li>A</li><li>b</li><li class=\"on\">c</li></ul></div>"
        )
        assert.deepStrictEqual(yield* step(LazyMessage.Remove({ id: 2 })), [])
        assert.deepStrictEqual(items(), [a, c])
        assert.strictEqual(b!.isConnected, false)
        assert.deepStrictEqual(yield* step(LazyMessage.Tick()), [])
        assert.strictEqual(
          app.innerHTML,
          "<div><p>2</p><ul><li>A</li><li class=\"on\">c</li></ul></div>"
        )
      }).pipe(Effect.scoped))

    it.effect.each([false, true])(
      "patches a node it gives again when the node holds a child, alone: %s",
      (alone) =>
        Effect.gen(function*() {
          // The frame's argument never changes, but its feature child shows a fallback until the Layer is ready.
          class Leaf extends Feature.Service<Leaf>()("Leaf", {
            props: Schema.Struct({})
          }) {}
          const LeafImpl = Html.component({
            name: "LeafImpl",
            model: Schema.Null,
            message: Schema.Never
          })
            .make({
              init: () => null,
              update: ($) => $.model,
              view: (h) => h.p("ready")
            })
          const ready = yield* Deferred.make<void>()
          const FrameDef = Html.component({
            name: "Frame",
            model: Schema.Null,
            message: Schema.Never
          })
          const frame = (h: Component.Helper<typeof FrameDef>, title: string) =>
            h.section(
              alone ? undefined : h.h2(title),
              Leaf.render(h, {
                key: "leaf",
                props: {},
                fallback: () => h.p("loading")
              })
            )
          const Frame = Component.provide(
            FrameDef.make({
              init: () => null,
              update: ($) => $.model,
              view: (h) => h.lazy(frame, "Title")
            }),
            Layer.merge(
              Leaf.toLayer(LeafImpl),
              Layer.effectDiscard(Deferred.await(ready))
            )
          )
          const app = yield* container
          yield* BrowserHost.mountEffect(Frame, {}, app)
          yield* tick
          const heading = alone ? "" : "<h2>Title</h2>"
          assert.strictEqual(
            app.innerHTML,
            `<section>${heading}<p>loading</p></section>`
          )
          yield* Deferred.succeed(ready, undefined)
          yield* tick
          assert.strictEqual(
            app.innerHTML,
            `<section>${heading}<p>ready</p></section>`
          )
        }).pipe(Effect.scoped)
    )

    it.effect("puts controlled properties back under a node it gives again, as under one the view keeps or builds", () =>
      Effect.gen(function*() {
        const FieldsDef = Html.component({
          name: "Fields",
          model: Schema.Number,
          message: LazyMessage
        })
        // The option asks for `a` and the select for `b`: the select is set after its options, so `b` wins.
        const field = (h: Component.Helper<typeof FieldsDef>, label: string) =>
          h.div(
            h.input.attr("aria-label", label).value("fixed"),
            h.select.value("b").children(
              h.option.attr("value", "a").selected(true).children("A"),
              h.option.attr("value", "b").children("B")
            )
          )
        let kept: View.Node<typeof LazyMessage.Type> | undefined
        const Fields = FieldsDef.make({
          init: () => 0,
          update: ($) => $.model + 1,
          view: (h, ticks) =>
            h.div(
              h.p(String(ticks)),
              field(h, "built"),
              h.lazy(field, "lazy"),
              kept ??= View.toNode(field(h, "kept"))
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Fields, {}, app)
        const inputs = [...app.querySelectorAll("input")]
        const selects = [...app.querySelectorAll("select")]
        assert.deepStrictEqual(selects.map((select) => select.value), [
          "b",
          "b",
          "b"
        ])
        // Changed by a script, with no event for the host to restore after.
        for (const input of inputs) input.value = "edited"
        root.send(LazyMessage.Tick())
        yield* tick
        assert.strictEqual(app.querySelector("p")!.textContent, "1")
        assert.deepStrictEqual(inputs.map((input) => input.value), [
          "fixed",
          "fixed",
          "fixed"
        ])
        assert.deepStrictEqual(selects.map((select) => select.value), [
          "b",
          "b",
          "b"
        ])
      }).pipe(Effect.scoped))

    it.effect(
      "skips a subtree it gives again with no controlled properties, restores one that gains them, and lets the old one go",
      () =>
        Effect.gen(function*() {
          const RowDef = Html.component({
            name: "Row",
            model: Schema.Number,
            message: LazyMessage
          })
          let reads = 0
          let plain: WeakRef<object> | undefined
          // Counts every read of the row's props, the field restoring looks at.
          const row = (h: Component.Helper<typeof RowDef>, input: boolean) => {
            const li = View.build(h.li, [
              input ? h.input.value("fixed") : "row"
            ])
            plain ??= new WeakRef(li)
            const props = li.props
            return Object.defineProperty(li, "props", {
              get: () => (reads++, props)
            })
          }
          const Row = RowDef.make({
            init: () => 0,
            update: ($) => $.model + 1,
            // The row gains its input on the third tick.
            view: (h, ticks) =>
              h.div(h.p(String(ticks)), h.lazy(row, ticks > 2))
          })
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Row, {}, app)
          const next = Effect.suspend(() => {
            root.send(LazyMessage.Tick())
            return tick
          })
          yield* next
          reads = 0
          yield* next
          assert.strictEqual(app.querySelector("p")!.textContent, "2")
          assert.strictEqual(reads, 0)
          yield* next
          const input = app.querySelector("input")!
          for (let index = 0; index < 2; index++) {
            // Changed by a script, with no event for the host to restore after.
            input.value = "edited"
            yield* next
            assert.strictEqual(input.value, "fixed")
          }
          // collectGarbage uses Node's V8 flags, unavailable on Bun and Deno.
          if (
            process.versions.bun === undefined &&
            process.versions.deno === undefined
          ) {
            yield* collectGarbage
            assert.strictEqual(plain!.deref(), undefined)
          }
        }).pipe(Effect.scoped)
    )

    it("builds again what a render that threw built", () => {
      let fails = true
      const Failing = ItemsDef.make({
        init: () => ({ items: [], selected: 0, ticks: 0 }),
        update: ($) => $.model,
        view: (h, model) => {
          const node = h.lazy(row, model.items[0]!, false)
          if (fails) throw new Error("boom")
          return node
        }
      })
      const store: View.LazyStore = { lazy: undefined }
      const model = { items: [{ id: 1, label: "a" }], selected: 0, ticks: 0 }
      built.length = 0
      assert.throws(
        () =>
          Failing.view(
            model,
            {},
            undefined,
            undefined,
            undefined,
            undefined,
            store
          ),
        /boom/
      )
      fails = false
      Failing.view(model, {}, undefined, undefined, undefined, undefined, store)
      assert.deepStrictEqual(built, ["a", "a"])
    })
  })

  describe("events", () => {
    const Message = UiSchema.TaggedEnum({
      Clicked: { where: Schema.String },
      PointerClicked: { pointerType: Schema.String },
      Key: { key: Schema.String, shift: Schema.Boolean },
      Hovered: { x: Schema.Number, y: Schema.Number },
      Submitted: { title: Schema.String, tags: Schema.Array(Schema.String) },
      Focused: { where: Schema.String },
      FocusMoved: { event: Schema.String, within: Schema.Boolean }
    })
    const Events = Html.component({
      name: "Events",
      model: Schema.Array(Schema.String),
      message: Message
    }).make({
      init: (): ReadonlyArray<string> => [],
      update: ($, message) =>
        Message.match(message, {
          Clicked: ({ where }) => [...$.model, `click ${where}`],
          PointerClicked: ({ pointerType }) => [...$.model, pointerType],
          Key: (
            { key, shift }
          ) => [...$.model, `key ${key}${shift ? " shift" : ""}`],
          Hovered: ({ x, y }) => [...$.model, `hover ${x},${y}`],
          Submitted: (
            { tags, title }
          ) => [...$.model, `submit ${title} [${tags.join(",")}]`],
          Focused: ({ where }) => [...$.model, `focus ${where}`],
          FocusMoved: (
            { event, within }
          ) => [...$.model, `${event}${within ? " within" : ""}`]
        }),
      view: (h) =>
        h.div(
          h.section.attr("aria-label", "Outer").on(
            "click",
            Message.Clicked({ where: "outer" })
          ).children(
            h.button.on("click", Message.Clicked({ where: "inner" })).children(
              "Inner"
            ),
            h.button("Plain")
          ),
          h.div
            .on("focus", Message.Focused({ where: "div" })).children(
              h.input.attr("aria-label", "Focus me")
            ),
          h.div
            .on("focusin", ({ within }) =>
              Message.FocusMoved({ event: "focusin", within }))
            .on("focusout", ({ within }) =>
              Message.FocusMoved({ event: "focusout", within }))
            .children(
              h.input.attr("aria-label", "First"),
              h.input.attr("aria-label", "Second")
            ),
          h.button.on("click", ({ pointerId, pointerType }) =>
            Message.PointerClicked({
              pointerType: `${pointerType} ${pointerId}`
            }))
            .on("pointerdown", ({ button, pointerId, pointerType }) =>
              Message.PointerClicked({
                pointerType: `down ${button} ${pointerType} ${pointerId}`
              }))
            .children("Pointer"),
          h.input.attr("aria-label", "Keys")
            .on("keydown", ({ key, shift }) =>
              Message.Key({ key, shift }))
            .on("mouseenter", ({ x, y }) =>
              Message.Hovered({ x, y }))
            .on("focus", Message.Focused({ where: "keys" })),
          h.form.on("submit", ({ entries, fields }) =>
            Message.Submitted({
              title: fields.title ?? "",
              tags: entries.filter(([name]) =>
                name === "tag"
              ).map(([, value]) =>
                value
              )
            })).children(
              h.input.attrs({
                name: "title",
                "aria-label": "Title",
                value: "Hello"
              }),
              h.input.attrs({
                type: "checkbox",
                name: "tag",
                value: "a",
                checked: ""
              }),
              h.input.attrs({
                type: "checkbox",
                name: "tag",
                value: "b",
                checked: ""
              }),
              h.button.attr("type", "submit").children("Send")
            )
        )
    })

    it.effect("only the innermost element with a handler gets an event", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Inner" })
        )
        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Plain" })
        )
        yield* tick
        expect(root.model()).toEqual(["click inner", "click outer"])
      }).pipe(Effect.scoped))

    it.effect("two mounts on one host each get their own events, and one that ends leaves the other's", () =>
      Effect.gen(function*() {
        const context = yield* Layer.build(BrowserHost.layer())
        const [first, second] = [yield* container, yield* container]
        const scope = yield* Scope.make()
        const a = yield* Renderer.mount(Events, {}, first).pipe(
          Scope.provide(scope),
          Effect.provideContext(context)
        )
        const b = yield* Renderer.mount(Events, {}, second, { head: false })
          .pipe(Effect.provideContext(context))
        HtmlLocator.click(
          HtmlLocator.getByRole(first, "button", { name: "Inner" })
        )
        HtmlLocator.click(
          HtmlLocator.getByRole(second, "button", { name: "Plain" })
        )
        yield* Scope.close(scope, Exit.void)
        HtmlLocator.click(
          HtmlLocator.getByRole(second, "button", { name: "Inner" })
        )
        yield* tick
        expect([a.model(), b.model()]).toEqual([["click inner"], [
          "click outer",
          "click inner"
        ]])
      }).pipe(Effect.scoped))

    it.effect("two mounts of the same component with different keys produce distinct element ids", () =>
      Effect.gen(function*() {
        const Slot = Html.component({
          name: "Slot",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) => h.button.id(h.id("trigger")).children("Open")
        })
        const [first, second] = [yield* container, yield* container]
        yield* BrowserHost.mountEffect(Slot, {}, first, {
          head: false,
          key: "a"
        })
        yield* BrowserHost.mountEffect(Slot, {}, second, {
          head: false,
          key: "b"
        })
        const firstButton = first.querySelector("button")!
        const secondButton = second.querySelector("button")!
        expect(document.getElementById(firstButton.id)).toBe(firstButton)
        expect(document.getElementById(secondButton.id)).toBe(secondButton)
      }).pipe(Effect.scoped))

    clicksWhenConnected("x-clicks-on-connect")
    const LogPage = Component.define({
      name: "Page",
      model: Schema.Array(Schema.String),
      message: Schema.String
    })
    const logPage = (view: Parameters<typeof LogPage.make>[0]["view"]) =>
      LogPage.make({
        init: (): ReadonlyArray<string> => [],
        update: ($, message) => [...$.model, message],
        view
      })

    it.effect("an event an insertion fires reaches the inserted element and its ancestors' post-patch handlers", () =>
      Effect.gen(function*() {
        const Page = logPage((h, log) => {
          // The patch changes the outer handler and takes the inner one away, as it inserts the element.
          const inner = log.length === 0
            ? h.el("section").on("click", "inner")
            : h.el("section")
          return h.el("div").on("click", log.length === 0 ? "old" : "new")
            .children(
              inner.children(
                log.length === 0
                  ? h.el("span")
                  : h.el(
                    "x-clicks-on-connect",
                    h.el("button").on("click", "inserted").children("Inserted"),
                    h.el("button").children("Go")
                  )
              )
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Page, {}, app)
        root.send("start")
        yield* tick
        expect(root.model()).toEqual(["start", "inserted", "new"])
      }).pipe(Effect.scoped))

    it.effect("a kept keep-alive child gets the events it fires as it is drawn again", () =>
      Effect.gen(function*() {
        const Counter = Component.define({
          name: "Counter",
          model: Schema.Number,
          message: Schema.String
        }).make({
          init: () => 0,
          update: ($) => $.model + 1,
          view: (h, count) =>
            h.el(
              "x-clicks-on-connect",
              h.el("button").on("click", "hit").children(`Hit ${count}`)
            )
        })
        const Outer = Component.define({
          name: "Outer",
          model: Schema.Null,
          message: Schema.Never
        })
          .make({
            init: () => null,
            update: ($) => $.model,
            view: (h) =>
              h.keepAlive((s) => h.el("section", Counter(s, { key: "c" })))
          })
        const Shell = Component.define({
          name: "Shell",
          model: Schema.Boolean,
          message: Schema.Boolean
        })
          .make({
            init: () => true,
            update: (_, shown) => shown,
            view: (h, shown) =>
              h.el(
                "div",
                h.keepAlive((s) => shown ? Outer(s, { key: "o" }) : null)
              )
          })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Shell, {}, app)
        yield* tick
        assert.strictEqual(
          HtmlLocator.getByRole(app, "button").textContent,
          "Hit 1"
        )
        root.send(false)
        yield* tick
        assert.strictEqual(app.querySelector("button"), null)
        root.send(true)
        yield* tick
        assert.strictEqual(
          HtmlLocator.getByRole(app, "button").textContent,
          "Hit 2"
        )
      }).pipe(Effect.scoped))

    it.effect("a hydrated instance starts from the server's state, not the history entry's snapshot", () =>
      Effect.gen(function*() {
        const LoginRoute = Route.union({ Login: Route.make("/") })
        const Login = Html.component({
          name: "Login",
          model: Schema.Struct({ email: Schema.String }),
          message: Schema.Never
        }).make({
          init: () => ({ email: "server" }),
          update: ($) => $.model,
          view: (h, model) => h.p(model.email)
        })
        const history = Router.memoryHistory("/")
        history.replace("/", {
          "@effect/ui": { index: 0, snapshot: { "/Login": { email: "saved" } } }
        })
        const rendered = yield* HtmlServer.renderToHtml(Login, {})
        const app = yield* container
        app.innerHTML = rendered.html
        const root = yield* HtmlHydrate.hydrateEffect(
          Login,
          {},
          app,
          rendered.state
        ).pipe(
          Effect.provide(Router.memory({ routes: LoginRoute, history }))
        )
        yield* tick
        assert.deepStrictEqual(root.model(), { email: "server" })
        assert.strictEqual(app.textContent, "server")
      }).pipe(Effect.scoped))

    it.effect("an element hydration rebuilds gets the events it fires as it goes in", () =>
      Effect.gen(function*() {
        const Page = logPage((h) =>
          h.el(
            "main",
            h.el(
              "x-clicks-on-connect",
              h.el("button").on("click", "hit").children("Hit")
            )
          )
        )
        const rendered = yield* HtmlServer.renderToHtml(Page, {})
        const app = yield* container
        app.innerHTML = rendered.html
        // The client finds a span where the server wrote the custom element, and builds that one anew.
        app.querySelector("x-clicks-on-connect")!.replaceWith(
          document.createElement("span")
        )
        const root = yield* HtmlHydrate.hydrateEffect(
          Page,
          {},
          app,
          rendered.state
        )
        yield* tick
        expect(root.model()).toEqual(["hit"])
      }).pipe(Effect.scoped))

    it.effect("a constant message is sent without reading the event", () =>
      Effect.gen(function*() {
        const read = vi.spyOn(globalThis, "FormData")
        yield* Effect.addFinalizer(() => Effect.sync(() => read.mockRestore()))
        const Page = logPage((h) => h.el("form").on("submit", "sent"))
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Page, {}, app)
        app.querySelector("form")!.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        )
        yield* tick
        expect(root.model()).toEqual(["sent"])
        expect(read).not.toHaveBeenCalled()
      }).pipe(Effect.scoped))

    // A custom element that submits its form once it is in the document, and keeps whether the app took it.
    const prevented: Array<boolean> = []
    customElements.define(
      "x-submits-on-insert",
      class extends HTMLElement {
        connectedCallback() {
          const event = new Event("submit", { bubbles: true, cancelable: true })
          this.closest("form")!.dispatchEvent(event)
          prevented.push(event.defaultPrevented)
        }
      }
    )
    for (
      const [name, form] of [
        [
          "a form the patch inserts",
          (h: any, after: boolean) =>
            after ? h.el("form").attr("method", "dialog") : h.el("div")
        ],
        [
          "a form whose submit handler the patch takes away",
          (h: any, after: boolean) =>
            after
              ? h.el("form").attr("method", "dialog")
              : h.el("form").on("submit", "sent")
        ]
      ] as const
    ) {
      it.effect(`a submission during a patch is the app's: ${name}`, () =>
        Effect.gen(function*() {
          prevented.length = 0
          const Page = logPage((h, log) =>
            form(h, log.length > 0).children(
              log.length > 0 ? h.el("x-submits-on-insert") : h.el("span")
            )
          )
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Page, {}, app)
          root.send("insert")
          yield* tick
          expect(prevented).toEqual([true])
        }).pipe(Effect.scoped))
    }

    it.effect("an element a patch inserts gets its events after a patch inside its insertion", () =>
      Effect.gen(function*() {
        const testHost = yield* TestHost.TestHost
        // Renders what the scheduler holds, here a child's patch, before it clicks.
        clicksWhenConnected(
          "x-flushes-then-clicks",
          () => testHost.drain(testHost.budget)
        )
        const Rows = Component.define({
          name: "Rows",
          model: Schema.Number,
          message: Schema.String
        })
          .make({
            init: () => 0,
            update: ($) => $.model + 1,
            view: (h, count) =>
              h.el(
                "div",
                h.el("button").on("click", "more").children("More"),
                ...Array.from({ length: count }, (_, index) =>
                  h.el("p", `${index}`))
              )
          })
        const Page = logPage((h, log) =>
          h.el(
            "div",
            Rows(h, { key: "r" }),
            ...(log.length === 0
              ? []
              : [
                h.el(
                  "x-flushes-then-clicks",
                  h.el("button").on("click", "appended").children("Appended")
                )
              ])
          )
        )
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Page, {}, app)
        testHost.drain(testHost.budget)
        const more = HtmlLocator.getByRole(app, "button", { name: "More" })
        // Rows waits for the flush, and then Page does too.
        HtmlLocator.click(more)
        root.send("append")
        // Page renders now, ahead of the message to Rows, and inserts the custom element.
        HtmlLocator.click(more)
        testHost.drain(testHost.budget)
        expect(root.model()).toEqual(["append", "appended"])
        assert.strictEqual(app.querySelectorAll("p").length, 2)
      }).pipe(Effect.scoped, Effect.provide(TestHost.layer())))

    it.effect("a pointerdown reports its button, pointer and id, and a click the pointer of the pointerdown before it, or none from the keyboard, and no id", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        const button = HtmlLocator.getByRole(app, "button", { name: "Pointer" })
        const click = (detail: number) =>
          button.dispatchEvent(
            new MouseEvent("click", { bubbles: true, detail })
          )
        // No pointerdown yet: a mouse.
        click(1)
        // A tap, whose click WebKit reports as a mouse's.
        button.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 2,
            pointerType: "touch"
          })
        )
        click(1)
        // Enter on the button: a click with no pointer, whatever pressed last.
        click(0)
        button.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 2,
            pointerId: 3,
            pointerType: "pen"
          })
        )
        click(1)
        yield* tick
        expect(root.model()).toEqual([
          "mouse -1",
          "down 0 touch 2",
          "touch -1",
          " -1",
          "down 2 pen 3",
          "pen -1"
        ])
      }).pipe(Effect.scoped))

    it.effect("a handler a render takes away no longer gets the event: the next element out does", () =>
      Effect.gen(function*() {
        const Toggle = Html.component({
          name: "Toggle",
          model: Schema.Array(Schema.String),
          message: Message
        }).make({
          init: (): ReadonlyArray<string> => [],
          update: ($, message) =>
            message._tag === "Clicked" ? [...$.model, message.where] : $.model,
          view: (h, log) =>
            h.section.on("click", Message.Clicked({ where: "outer" })).children(
              // The inner handler goes after the first click lands on it.
              log.length === 0
                ? h.button.on("click", Message.Clicked({ where: "inner" }))
                  .children("Go")
                : h.button("Go")
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Toggle, {}, app)
        const button = HtmlLocator.getByRole(app, "button", { name: "Go" })
        HtmlLocator.click(button)
        yield* tick
        HtmlLocator.click(HtmlLocator.getByRole(app, "button", { name: "Go" }))
        yield* tick
        assert.strictEqual(
          HtmlLocator.getByRole(app, "button", { name: "Go" }),
          button
        )
        expect(root.model()).toEqual(["inner", "outer"])
      }).pipe(Effect.scoped))

    it.effect("focus doesn't bubble", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        ;(HtmlLocator.getByRole(app, "textbox", {
          name: "Focus me"
        }) as HTMLInputElement).focus()
        ;(HtmlLocator.getByRole(app, "textbox", {
          name: "Keys"
        }) as HTMLInputElement).focus()
        yield* tick
        expect(root.model()).toEqual(["focus keys"])
      }).pipe(Effect.scoped))

    it.effect("focusin and focusout say whether focus moved within the element", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        const input = (name: string) =>
          HtmlLocator.getByRole(app, "textbox", { name }) as HTMLInputElement
        input("First").focus()
        input("Second").focus()
        input("Keys").focus()
        // A script may name any event target as the other end, such as the window, which no element contains.
        input("First").dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: window })
        )
        yield* tick
        expect(root.model()).toEqual([
          "focusin",
          "focusout within",
          "focusin within",
          "focusout",
          "focus keys",
          "focusout"
        ])
      }).pipe(Effect.scoped))

    it.effect("blur and focusout say whether the element that lost focus is disabled", () =>
      Effect.gen(function*() {
        const Left = UiSchema.TaggedEnum({
          Left: { event: Schema.String, disabled: Schema.Boolean }
        })
        const Leaving = Html.component({
          name: "Leaving",
          model: Schema.Array(Schema.String),
          message: Left
        }).make({
          init: (): ReadonlyArray<string> => [],
          update: (
            $,
            { disabled, event }
          ) => [...$.model, `${event}${disabled ? " disabled" : ""}`],
          view: (h) =>
            h.div.on(
              "focusout",
              ({ disabled }) => Left.Left({ event: "focusout", disabled })
            ).children(
              h.input.on("blur", ({ disabled }) =>
                Left.Left({ event: "blur", disabled })),
              h.form.attr("tabindex", "0").on("blur", ({ disabled }) =>
                Left.Left({ event: "blur", disabled })).children(
                  h.input.attr("name", "matches")
                )
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Leaving, {}, app)
        const input = app.querySelector("input")!
        const form = app.querySelector("form")!
        const leave = (element: Element) => {
          element.dispatchEvent(new FocusEvent("blur"))
          element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
        }
        leave(input)
        input.disabled = true
        leave(input)
        // A browser puts a form's named control over the form's own method of that name. happy-dom doesn't.
        Object.defineProperty(form, "matches", {
          value: form.querySelector("input")
        })
        leave(form)
        yield* tick
        expect(root.model()).toEqual([
          "blur",
          "focusout",
          "blur disabled",
          "focusout disabled",
          "blur",
          "focusout"
        ])
      }).pipe(Effect.scoped))

    it.effect("focus says whether the element shows a focus ring", () =>
      Effect.gen(function*() {
        const Seen = UiSchema.TaggedEnum({
          Focused: { focusVisible: Schema.Boolean }
        })
        const Focusing = Html.component({
          name: "Focusing",
          model: Schema.Array(Schema.Boolean),
          message: Seen
        }).make({
          init: (): ReadonlyArray<boolean> => [],
          update: ($, { focusVisible }) => [...$.model, focusVisible],
          view: (h) =>
            h.a.attr("href", "/a").on(
              "focus",
              ({ focusVisible }) => Seen.Focused({ focusVisible })
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Focusing, {}, app)
        const link = app.querySelector("a")!
        const focusWith = (matches: (selector: string) => boolean) => {
          Object.defineProperty(link, "matches", {
            configurable: true,
            value: matches
          })
          link.dispatchEvent(new FocusEvent("focus"))
        }
        focusWith((selector) => selector === ":focus-visible")
        focusWith(() => false)
        focusWith(() => {
          throw new SyntaxError(":focus-visible")
        })
        yield* tick
        expect(root.model()).toEqual([true, false, true])
      }).pipe(Effect.scoped))

    it.effect("payloads are plain data", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        const keys = HtmlLocator.getByRole(app, "textbox", { name: "Keys" })
        HtmlLocator.keydown(keys, "Enter", { shift: true })
        keys.dispatchEvent(
          new MouseEvent("mouseenter", { clientX: 3, clientY: 4 })
        )
        yield* tick
        expect(root.model()).toEqual(["key Enter shift", "hover 3,4"])
      }).pipe(Effect.scoped))

    describe("input methods and selections", () => {
      const Seen = UiSchema.TaggedEnum({ Saw: { entry: Schema.String } })
      const Typing = Html.component({
        name: "Typing",
        model: Schema.Array(Schema.String),
        message: Seen
      }).make({
        init: (): ReadonlyArray<string> => [],
        update: ($, { entry }) => [...$.model, entry],
        view: (h) => {
          const saw = (label: string) => (payload: object) =>
            Seen.Saw({ entry: `${label} ${JSON.stringify(payload)}` })
          return h.div(
            h.input.attr("aria-label", "Text").on("input", saw("input")).on(
              "change",
              saw("change")
            )
              .on("compositionend", saw("compositionend")).on(
                "keydown",
                saw("key")
              ),
            h.textarea.attr("aria-label", "Area").on("input", saw("input"))
              .on("compositionend", saw("compositionend"))
              .on("selectionchange", saw("selectionchange")),
            h.input.attrs({ type: "checkbox", "aria-label": "Box" }).on(
              "keydown",
              saw("key")
            ),
            h.button.on("keydown", saw("key")).children("Button")
          )
        }
      })

      it.effect("input and change say how the edit was made, and compositionend sends the composed value", () =>
        Effect.gen(function*() {
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Typing, {}, app)
          const text = HtmlLocator.getByRole(app, "textbox", {
            name: "Text"
          }) as HTMLInputElement
          const area = HtmlLocator.getByRole(app, "textbox", {
            name: "Area"
          }) as HTMLTextAreaElement
          text.value = "ka"
          text.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              isComposing: true,
              inputType: "insertCompositionText"
            })
          )
          text.dispatchEvent(
            new CompositionEvent("compositionend", {
              bubbles: true,
              data: "ka"
            })
          )
          text.dispatchEvent(new Event("change", { bubbles: true }))
          area.value = "auto"
          area.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertReplacementText"
            })
          )
          area.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true })
          )
          yield* tick
          expect(root.model()).toEqual([
            `input {"value":"ka","checked":false,"files":[],"composing":true,"inputType":"insertCompositionText","selectionStart":2,"selectionEnd":2}`,
            `compositionend {"value":"ka"}`,
            `change {"value":"ka","checked":false,"files":[],"composing":false,"inputType":"","selectionStart":2,"selectionEnd":2}`,
            `input {"value":"auto","composing":false,"inputType":"insertReplacementText","selectionStart":4,"selectionEnd":4}`,
            `compositionend {"value":"auto"}`
          ])
        }).pipe(Effect.scoped))

      it.effect("keys and selectionchange report the selection of a text field, and none for a button or a checkbox", () =>
        Effect.gen(function*() {
          const app = yield* container
          const shadowHost = yield* container
          const shadow = shadowHost.attachShadow({ mode: "open" })
          const root = yield* BrowserHost.mountEffect(Typing, {}, app)
          const shadowRoot = yield* BrowserHost.mountEffect(
            Typing,
            {},
            shadow as unknown as Element
          )
          const text = HtmlLocator.getByRole(app, "textbox", {
            name: "Text"
          }) as HTMLInputElement
          const shadowText = shadow.querySelector<HTMLInputElement>(
            "[aria-label=Text]"
          )!
          text.value = "hello"
          text.setSelectionRange(1, 4)
          shadowText.value = "hello"
          shadowText.setSelectionRange(0, 0)
          HtmlLocator.keydown(text, "ArrowLeft")
          HtmlLocator.keydown(
            HtmlLocator.getByRole(app, "checkbox", { name: "Box" }),
            " "
          )
          HtmlLocator.keydown(
            HtmlLocator.getByRole(app, "button", { name: "Button" }),
            "Enter"
          )
          const area = HtmlLocator.getByRole(app, "textbox", {
            name: "Area"
          }) as HTMLTextAreaElement
          area.value = "hello"
          area.setSelectionRange(3, 5)
          area.dispatchEvent(new Event("selectionchange", { bubbles: true }))
          const keyEvent = new KeyboardEvent("keydown", {
            key: "ArrowLeft",
            bubbles: true,
            composed: true
          })
          Object.defineProperty(keyEvent, "composedPath", {
            value: () => [
              shadowText,
              shadowText.parentNode!,
              shadow,
              shadowHost,
              document.body,
              document,
              window
            ]
          })
          shadowHost.dispatchEvent(keyEvent)
          yield* tick
          const selectionOf = (entries: ReadonlyArray<string>) =>
            entries.map((entry) => {
              const { selectionEnd, selectionStart } = JSON.parse(
                entry.slice(entry.indexOf(" ") + 1)
              )
              return [selectionStart, selectionEnd]
            })
          const selections = selectionOf(root.model()!)
          expect(selections).toEqual([
            [1, 4],
            [null, null],
            [null, null],
            [3, 5]
          ])
          expect(selectionOf(shadowRoot.model()!)).toEqual([[0, 0]])
        }).pipe(Effect.scoped))

      it.effect("keydown and keyup report editable targets and auto-repeat on elements and the document", () =>
        Effect.gen(function*() {
          const app = yield* container
          const shadowHost = yield* container
          const shadow = shadowHost.attachShadow({ mode: "open" })
          const shadowInput = document.createElement("input")
          shadow.appendChild(shadowInput)
          const editableIds = [
            "kt-readonly",
            "kt-unknown",
            "kt-area",
            "kt-select",
            "kt-ce",
            "kt-ce-child"
          ]
          const nonEditableTypes = [
            "button",
            "checkbox",
            "color",
            "file",
            "image",
            "radio",
            "range",
            "reset",
            "submit"
          ] as const
          const KeyTargets = Html.component({
            name: "KeyTargets",
            model: Schema.Array(Schema.String),
            message: Schema.String
          }).make({
            init: (): ReadonlyArray<string> => [],
            update: ($, entry) => [...$.model, entry],
            view: (h) =>
              h.div
                .on("keydown", ({ editable, key, repeat }) =>
                  `el:down:${key}:${editable}:${repeat}`)
                .on("keyup", ({ editable, key, repeat }) =>
                  `el:up:${key}:${editable}:${repeat}`)
                .children(
                  h.input.attr("id", "kt-text"),
                  h.input.attr("id", "kt-readonly").attr("readonly", ""),
                  h.input.attr("id", "kt-unknown").attr("type", "futuretype"),
                  h.textarea.attr("id", "kt-area"),
                  h.select.attr("id", "kt-select").children(
                    h.option.attr("value", "a").children("A")
                  ),
                  ...nonEditableTypes.map((type) =>
                    h.input.attr("id", `kt-${type}`).attr("type", type)
                  ),
                  h.div.attr("id", "kt-ce").attr("contenteditable", "true")
                    .children(
                      h.span.attr("id", "kt-ce-child").children("hi"),
                      h.div.attr("id", "kt-ce-island").attr(
                        "contenteditable",
                        "false"
                      ).children(
                        h.button.attr("id", "kt-ce-btn").children("x")
                      )
                    )
                ),
            subscriptions: () => [
              HtmlSubscription.onDocument(
                "keydown",
                ({ editable, key, repeat }) =>
                  `doc:down:${key}:${editable}:${repeat}`
              ),
              HtmlSubscription.onDocument(
                "keyup",
                ({ editable, key, repeat }) =>
                  `doc:up:${key}:${editable}:${repeat}`
              )
            ]
          })
          const root = yield* BrowserHost.mountEffect(KeyTargets, {}, app)
          yield* tick
          const fire = (
            target: EventTarget,
            type: "keydown" | "keyup",
            key: string,
            repeat = false
          ) =>
            target.dispatchEvent(
              new KeyboardEvent(type, {
                key,
                repeat,
                bubbles: true,
                composed: true
              })
            )
          const byId = (id: string) => app.querySelector(`#${id}`)!
          fire(byId("kt-text"), "keydown", "g", true)
          fire(byId("kt-text"), "keyup", "g")
          for (const id of editableIds) fire(byId(id), "keydown", id)
          fire(byId("kt-ce-btn"), "keydown", "island")
          for (const type of nonEditableTypes) {
            fire(byId(`kt-${type}`), "keydown", type)
          }
          const shadowEvent = new KeyboardEvent("keydown", {
            key: "s",
            bubbles: true,
            composed: true
          })
          Object.defineProperty(shadowEvent, "composedPath", {
            value: () => [
              shadowInput,
              shadow,
              shadowHost,
              document.body,
              document,
              window
            ]
          })
          shadowHost.dispatchEvent(shadowEvent)
          const svgInput = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "input"
          )
          app.appendChild(svgInput)
          fire(svgInput, "keydown", "svg")
          yield* tick
          expect(root.model()).toEqual([
            "el:down:g:true:true",
            "doc:down:g:true:true",
            "el:up:g:true:false",
            "doc:up:g:true:false",
            ...editableIds.flatMap((
              id
            ) => [`el:down:${id}:true:false`, `doc:down:${id}:true:false`]),
            "el:down:island:false:false",
            "doc:down:island:false:false",
            ...nonEditableTypes.flatMap((
              type
            ) => [
              `el:down:${type}:false:false`,
              `doc:down:${type}:false:false`
            ]),
            "doc:down:s:true:false",
            "doc:down:svg:false:false"
          ])
        }).pipe(Effect.scoped))

      it.effect("document listeners receive the DOM event timeStamp", () =>
        Effect.gen(function*() {
          const app = yield* container
          const Stamps = Html.component({
            name: "Stamps",
            model: Schema.Array(Schema.Number),
            message: Schema.Number
          }).make({
            init: (): ReadonlyArray<number> => [],
            update: ($, stamp) => [...$.model, stamp],
            view: (h) => h.div(),
            subscriptions: () => [
              HtmlSubscription.onDocument(
                "keydown",
                ({ timeStamp }) => timeStamp
              )
            ]
          })
          const root = yield* BrowserHost.mountEffect(Stamps, {}, app)
          yield* tick
          const event = new KeyboardEvent("keydown", {
            key: "g",
            bubbles: true
          })
          document.body.dispatchEvent(event)
          yield* tick
          expect(root.model()).toEqual([event.timeStamp])
        }).pipe(Effect.scoped))

      it.effect("a keyup reports composing when the keydown of the same key composed, until that keyup or the window losing focus, with only keyup handled", () =>
        Effect.gen(function*() {
          const Released = Html.component({
            name: "Released",
            props: Schema.Struct({ watch: Schema.Boolean }),
            model: Schema.Array(Schema.String),
            message: Schema.String
          }).make({
            init: (): ReadonlyArray<string> => [],
            update: ($, entry) => [...$.model, entry],
            view: (h) =>
              h.div(
                h.input.attr("aria-label", "Text").on(
                  "keyup",
                  ({ composing, key }) => `el:${key}:${composing}`
                ),
                h.button.children("Sibling")
              ),
            subscriptions: ({ props }) =>
              props.watch
                ? [
                  HtmlSubscription.onDocument(
                    "keyup",
                    ({ composing, key }) => `doc:${key}:${composing}`
                  )
                ]
                : []
          })
          const fire = (
            target: Element,
            type: string,
            init: KeyboardEventInit
          ) =>
            target.dispatchEvent(
              new KeyboardEvent(type, { bubbles: true, code: "Enter", ...init })
            )
          // Chrome on Windows reports the keydown that commits as "Process", and
          // its keyup, after compositionend, as a plain Enter.
          const commit = (text: Element) => {
            fire(text, "keydown", {
              key: "Process",
              isComposing: true,
              keyCode: 229
            })
            text.dispatchEvent(
              new CompositionEvent("compositionend", { bubbles: true })
            )
          }
          const released = Effect.fnUntraced(
            function*(watch: boolean, keys: (text: HTMLElement) => void) {
              const app = yield* container
              const root = yield* BrowserHost.mountEffect(
                Released,
                { watch },
                app
              )
              yield* tick
              const text = HtmlLocator.getByRole(app, "textbox", {
                name: "Text"
              })
              text.focus()
              keys(text)
              yield* tick
              return root.model()
            },
            Effect.scoped
          )
          expect(
            yield* released(true, (text) => {
              // The commit key held while focus moves and another key is pressed.
              commit(text)
              const sibling = text.nextElementSibling as HTMLElement
              sibling.focus()
              fire(sibling, "keydown", { key: "Shift", code: "ShiftLeft" })
              fire(sibling, "keyup", { key: "Shift", code: "ShiftLeft" })
              fire(sibling, "keydown", { key: "Enter", repeat: true })
              text.focus()
              fire(text, "keyup", { key: "Enter" })
            })
          ).toEqual(["doc:Shift:false", "el:Enter:true", "doc:Enter:true"])
          const outside = (yield* container).appendChild(
            document.createElement("button")
          )
          expect(
            yield* released(false, (text) => {
              // The commit key released outside the host, then pressed again
              // there before focus comes back.
              commit(text)
              outside.focus()
              fire(outside, "keyup", { key: "Enter" })
              fire(outside, "keydown", { key: "Enter" })
              text.focus()
              fire(text, "keyup", { key: "Enter" })
              // The window losing focus while the commit key is held.
              commit(text)
              window.dispatchEvent(new FocusEvent("blur"))
              fire(text, "keyup", { key: "Enter" })
            })
          ).toEqual(["el:Enter:false", "el:Enter:false"])
        }).pipe(Effect.scoped))

      it.effect("a composing field's value isn't written until compositionend, including inside shadow DOM", () =>
        Effect.gen(function*() {
          const Typed = UiSchema.TaggedEnum({ Typed: { value: Schema.String } })
          const Upper = Html.component({
            name: "Upper",
            model: Schema.String,
            message: Typed
          }).make({
            init: () => "",
            update: (_, { value }) => value.toUpperCase(),
            view: (h, text) =>
              h.div(
                h.input.attr("aria-label", "Upper").value(text).on("input", (
                  { value }
                ) => Typed.Typed({ value })),
                h.input.attr("aria-label", "Fixed").value("fixed").on(
                  "input",
                  () => undefined
                )
              )
          })
          const app = yield* container
          const shadowHost = yield* container
          const shadow = shadowHost.attachShadow({ mode: "open" })
          yield* BrowserHost.mountEffect(Upper, {}, app)
          yield* BrowserHost.mountEffect(
            Upper,
            {},
            shadow as unknown as Element
          )
          const retarget = (inner: HTMLElement, event: Event) => {
            Object.defineProperty(event, "composedPath", {
              value: () => [
                inner,
                inner.parentNode!,
                shadow,
                shadowHost,
                document.body,
                document,
                window
              ]
            })
            shadowHost.dispatchEvent(event)
          }
          const compose = (field: HTMLInputElement, value: string) => {
            field.value = value
            field.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                composed: true,
                isComposing: true
              })
            )
          }
          const upper = HtmlLocator.getByRole(app, "textbox", {
            name: "Upper"
          }) as HTMLInputElement
          const fixed = HtmlLocator.getByRole(app, "textbox", {
            name: "Fixed"
          }) as HTMLInputElement
          const shadowUpper = shadow.querySelector<HTMLInputElement>(
            "[aria-label=Upper]"
          )!
          HtmlLocator.type(fixed, "x")
          fixed.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true })
          )
          compose(upper, "ka")
          shadowUpper.value = "ka"
          retarget(
            shadowUpper,
            new InputEvent("input", {
              bubbles: true,
              composed: true,
              isComposing: true
            })
          )
          yield* tick
          expect([upper.value, fixed.value, shadowUpper.value]).toEqual([
            "ka",
            "x",
            "ka"
          ])
          upper.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true })
          )
          fixed.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true })
          )
          retarget(
            shadowUpper,
            new CompositionEvent("compositionend", {
              bubbles: true,
              composed: true
            })
          )
          yield* tick
          expect([upper.value, fixed.value, shadowUpper.value]).toEqual([
            "KA",
            "fixed",
            "KA"
          ])
        }).pipe(Effect.scoped))
    })

    it.effect("submit sends the form's fields and prevents the browser's submission", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Events, {}, app)
        const form = app.querySelector("form")!
        const event = new Event("submit", { bubbles: true, cancelable: true })
        form.dispatchEvent(event)
        yield* tick
        expect(event.defaultPrevented).toBe(true)
        expect(root.model()).toEqual(["submit Hello [a,b]"])
      }).pipe(Effect.scoped))

    it.effect("an unhandled form is prevented only for dialog; handled forms always are; forms outside the app aren't", () =>
      Effect.gen(function*() {
        const app = yield* container
        const outside = yield* container
        outside.innerHTML = `<form method="dialog"></form>`
        // `Events` handles submit on its own form, so the document listener is already there.
        yield* BrowserHost.mountEffect(Events, {}, app)
        const Forms = Html.component({
          name: "Forms",
          model: Schema.Null,
          message: Schema.Literal("Submitted")
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.div(
              h.form.attrs({
                "aria-label": "Get",
                method: "get",
                action: "/settings"
              }).children(
                h.input.attrs({ type: "hidden", name: "tools", value: "1" }),
                h.button.attrs({ type: "submit", formmethod: "dialog" })
                  .children("Close")
              ),
              // An upper-case tag is still a form.
              h.el("FORM").attrs({ "aria-label": "Dialog", method: "dialog" }),
              h.form.attrs({ "aria-label": "Handled post", method: "post" })
                .on("submit", "Submitted")
            )
        })
        const mounted = yield* container
        yield* BrowserHost.mountEffect(Forms, {}, mounted)
        const submitted = (
          form: HTMLFormElement,
          submitter?: HTMLElement | null
        ) => {
          const event = new SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
            submitter: submitter ?? null
          })
          form.dispatchEvent(event)
          return event.defaultPrevented
        }
        const form = (name: string) =>
          HtmlLocator.getByRole(mounted, "form", { name }) as HTMLFormElement
        const get = form("Get")
        expect(submitted(get)).toBe(false)
        expect(
          submitted(
            get,
            HtmlLocator.getByRole(get, "button", { name: "Close" })
          )
        ).toBe(true)
        expect(submitted(form("Dialog"))).toBe(true)
        expect(submitted(form("Handled post"))).toBe(true)
        expect(submitted(outside.querySelector("form")!)).toBe(false)
      }).pipe(Effect.scoped))

    it.effect("preventDefault cancels the default only when the handler sends, before the message is sent", () =>
      Effect.gen(function*() {
        let event: Event | undefined
        const seen: Array<string> = []
        const Composer = Html.component({
          name: "Composer",
          model: Schema.Number,
          message: Schema.Literals(["Send", "Menu"])
        }).make({
          init: () => 0,
          update: ($, message) => {
            seen.push(`${message} prevented=${event?.defaultPrevented}`)
            return $.model + 1
          },
          view: (h) =>
            h.div.on("contextmenu", "Menu", { preventDefault: true }).children(
              h.textarea.attr("aria-label", "Message").on(
                "keydown",
                ({ composing, key, shift }) =>
                  key === "Enter" && !shift && !composing ? "Send" : undefined,
                { preventDefault: true }
              )
            )
        })
        const app = yield* container
        yield* BrowserHost.mountEffect(Composer, {}, app)
        const field = HtmlLocator.getByRole(app, "textbox", { name: "Message" })
        const fire = (next: Event) => {
          event = next
          field.dispatchEvent(next)
          return next.defaultPrevented
        }
        const key = (init: KeyboardEventInit) =>
          fire(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init
            })
          )
        expect(key({ key: "Enter" })).toBe(true)
        expect(key({ key: "Enter", shiftKey: true })).toBe(false)
        // The Enter that ends an IME composition is the input method's.
        expect(key({ key: "Enter", isComposing: true })).toBe(false)
        expect(
          fire(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
          )
        ).toBe(true)
        // `update` ran after the default was cancelled.
        expect(seen).toEqual(["Send prevented=true", "Menu prevented=true"])
      }).pipe(Effect.scoped))

    it.effect("fields named like Object.prototype members are kept", () =>
      Effect.gen(function*() {
        const seen: Array<Html.SubmitPayload> = []
        const Prototype = Html.component({
          name: "Prototype",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.form.on("submit", (payload) => {
              seen.push(payload)
              return undefined
            }).children(
              h.input.attrs({ name: "constructor", value: "a" }),
              h.input.attrs({ name: "__proto__", value: "b" }),
              h.input.attrs({ name: "toString", value: "c" }),
              h.input.attrs({ name: "toString", value: "d" })
            )
        })
        const app = yield* container
        yield* BrowserHost.mountEffect(Prototype, {}, app)
        HtmlLocator.submit(app.querySelector("form")!)
        const { entries, fields } = seen[0]!
        expect(Object.keys(fields)).toEqual([
          "constructor",
          "__proto__",
          "toString"
        ])
        expect([fields.constructor, fields["__proto__"], fields.toString])
          .toEqual(["a", "b", "c"])
        expect(entries).toEqual([["constructor", "a"], ["__proto__", "b"], [
          "toString",
          "c"
        ], ["toString", "d"]])
      }).pipe(Effect.scoped))
  })

  describe("drag and drop", () => {
    /** A `DataTransfer` as a browser shows it: string types as set, and `"Files"` when it carries files. */
    class Transfer {
      dropEffect = "none"
      effectAllowed = "uninitialized"
      readonly strings = new Map<string, string>()
      constructor(readonly files: ReadonlyArray<File> = []) {}
      get types() {
        return [
          ...this.strings.keys(),
          ...(this.files.length > 0 ? ["Files"] : [])
        ]
      }
      setData(type: string, value: string) {
        this.strings.set(type.toLowerCase(), value)
      }
      getData(type: string) {
        return this.strings.get(type.toLowerCase()) ?? ""
      }
    }
    /** Fires a drag event at `element`, reporting whether its default was cancelled. */
    const drag = (
      element: Element,
      name: string,
      transfer: Transfer,
      at = { x: 0, y: 0 }
    ) => {
      const event = new MouseEvent(name, {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y
      })
      Object.defineProperty(event, "dataTransfer", { value: transfer })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }
    const box = (
      element: Element,
      left: number,
      top: number,
      width: number,
      height: number
    ) => {
      element.getBoundingClientRect = () => (({
        left,
        top,
        width,
        height
      }) as DOMRect)
    }
    const byLabel = (app: Element, label: string) =>
      app.querySelector(`[aria-label="${label}"]`)!

    it.effect("puts a drag source's data on the drag, though it has no handler, once a patch makes it one", () =>
      Effect.gen(function*() {
        const Cards = Html.component({
          name: "Cards",
          model: Schema.Boolean,
          message: Schema.Boolean
        }).make({
          init: () => false,
          update: (_, draggable) => draggable,
          view: (h, draggable) =>
            h.div(
              h.p.draggable({ "text/plain": "first" }).children("first"),
              draggable
                ? h.p.draggable({ "text/plain": "second" }).children("second")
                : h.p("second")
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Cards, {}, app)
        root.send(true)
        yield* tick
        const dragged = Array.from(app.querySelectorAll("p"), (card) => {
          const transfer = new Transfer()
          drag(card, "dragstart", transfer)
          return transfer.getData("text/plain")
        })
        assert.deepStrictEqual(dragged, ["first", "second"])
      }).pipe(Effect.scoped))

    const Board = Html.component({
      name: "Board",
      model: Schema.Array(Schema.String),
      message: Schema.String
    }).make({
      init: (): ReadonlyArray<string> => [],
      update: ($, message) => [...$.model, message],
      view: (h) =>
        h.div(
          // Either order keeps the data or the target and the handler.
          h.p.attr("aria-label", "Milk").draggable({
            "application/x-todo": "milk"
          }, { effectAllowed: "move" })
            .on("dragstart", "start milk").on("dragend", ({ dropped }) =>
              `end milk dropped=${dropped}`).children("Milk"),
          h.p.attr("aria-label", "Eggs").on("dragstart", "start eggs")
            .draggable({
              "application/x-todo": "eggs"
            }).children(
              "Eggs"
            ),
          h.section.attr("aria-label", "Done")
            .dropTarget({
              accepts: ["application/x-todo", "Files"],
              dropEffect: "move"
            })
            .on("drop", ({ data, files, height, width, x, y }) =>
              `drop ${
                data["application/x-todo"] ??
                  files.map((file) =>
                    file.name
                  ).join(",")
              } at ${x},${y} of ${width}x${height}`)
            .on("dragenter", "enter").on("dragleave", "leave")
            .on("dragover", ({ x, y }) =>
              `over ${x},${y}`).children(
              h.p.attr("aria-label", "Header").children("Header"),
              h.p.attr("aria-label", "Body").children("Body"),
              h.div.attr("aria-label", "Inner")
                .on("drop", ({ data }) =>
                  `inner drop ${data["application/x-todo"]}`)
                .dropTarget({ accepts: ["text/uri-list"] })
                .on("dragenter", "inner enter").on("dragleave", "inner leave")
                .children(
                  h.p.attr("aria-label", "Inner child").children("Inner child")
                )
            )
        )
    })

    it.effect("a drag between two elements carries the source's data, and the source hears it was dropped", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Board, {}, app)
        const done = byLabel(app, "Done")
        box(done, 10, 20, 200, 100)
        for (const name of ["Milk", "Eggs"]) {
          const transfer = new Transfer()
          drag(byLabel(app, name), "dragstart", transfer)
          expect(transfer.getData("application/x-todo")).toBe(
            name.toLowerCase()
          )
          if (name === "Milk") expect(transfer.effectAllowed).toBe("move")
        }
        const transfer = new Transfer()
        drag(byLabel(app, "Milk"), "dragstart", transfer)
        expect(drag(done, "dragenter", transfer)).toBe(true)
        expect(transfer.dropEffect).toBe("move")
        expect(drag(done, "drop", transfer, { x: 60, y: 45 })).toBe(true)
        // The browser reports no effect on `dragend` here; the host saw the drop.
        drag(byLabel(app, "Milk"), "dragend", transfer)
        yield* tick
        expect(root.model()).toEqual([
          "start milk",
          "start eggs",
          "start milk",
          "enter",
          "drop milk at 50,25 of 200x100",
          "leave",
          "end milk dropped=true"
        ])
      }).pipe(Effect.scoped))

    it.effect("a template's drop target given no drop handler leaves the drop to the one around it", () =>
      Effect.gen(function*() {
        const Zone = Html.template<string, {
          readonly drop: string | undefined
        }>((h, $) =>
          h.div.attr("aria-label", "Zone")
            .dropTarget({ accepts: ["application/x-todo"] })
            // `undefined` leaves the handler out, as it leaves an attribute out.
            .on("drop", $.drop as string)
            .children(h.p.attr("aria-label", "Zone child").children("Zone"))
        )
        const Outer = Html.component({
          name: "Outer",
          model: Schema.Array(Schema.String),
          message: Schema.String
        }).make({
          init: (): ReadonlyArray<string> => [],
          update: ($, message) => [...$.model, message],
          view: (h) =>
            h.section.attr("aria-label", "Outer")
              .dropTarget({ accepts: ["application/x-todo"] })
              .on("drop", ({ data }) =>
                `outer drop ${data["application/x-todo"]}`)
              .children(Zone({ drop: undefined }))
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Outer, {}, app)
        const transfer = new Transfer()
        transfer.setData("application/x-todo", "milk")
        const child = byLabel(app, "Zone child")
        expect(drag(child, "dragenter", transfer)).toBe(true)
        expect(drag(child, "drop", transfer)).toBe(true)
        yield* tick
        expect(root.model()).toEqual(["outer drop milk"])
      }).pipe(Effect.scoped))

    it.effect("a drag of a type no target accepts is left alone, so the browser refuses the drop", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Board, {}, app)
        const transfer = new Transfer()
        transfer.setData("text/plain", "hello")
        const done = byLabel(app, "Done")
        expect([
          drag(done, "dragenter", transfer),
          drag(done, "dragover", transfer),
          drag(done, "drop", transfer)
        ])
          .toEqual([false, false, false])
        drag(byLabel(app, "Milk"), "dragend", transfer)
        yield* tick
        expect(root.model()).toEqual(["end milk dropped=false"])
      }).pipe(Effect.scoped))

    it.effect("a file drop sends the files, and the log's wire encoding replaces a message it can't encode", () =>
      Effect.gen(function*() {
        const Message = UiSchema.TaggedEnum({
          Dropped: { files: Schema.Array(Schema.instanceOf(File)) }
        })
        const Uploader = Html.component({
          name: "Uploader",
          model: Schema.Array(Schema.String),
          message: Message
        }).make({
          init: (): ReadonlyArray<string> => [],
          // Plain facts about the files go in the Model; the files themselves would go on to a Command.
          update: (
            $,
            { files }
          ) => [
            ...$.model,
            ...files.map((file) => `${file.name} ${file.size}`)
          ],
          view: (h) =>
            h.div.attr("aria-label", "Upload")
              .dropTarget({ accepts: ["Files"], dropEffect: "copy" })
              .on("drop", ({ files }) => Message.Dropped({ files }))
        })
        const log = MessageLog.makeMemory()
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Uploader, {}, app).pipe(
          Effect.provideService(MessageLog.MessageLog, log)
        )
        const transfer = new Transfer([new File(["hello"], "notes.txt")])
        const upload = byLabel(app, "Upload")
        expect(drag(upload, "dragover", transfer)).toBe(true)
        expect(drag(upload, "drop", transfer)).toBe(true)
        yield* tick
        expect(root.model()).toEqual(["notes.txt 5"])
        const update = log.entries().find((entry) => entry._tag === "Update")!
        const warnings: Array<string> = []
        const wire = MessageLog.makeEncoder({
          onWarning: (warning) => warnings.push(warning)
        }).encode(update)
        expect(
          (wire as MessageLog.WireEntry & { readonly message: unknown }).message
        ).toEqual({
          "~unserialisable": "encode"
        })
        expect(warnings).toHaveLength(1)
      }).pipe(Effect.scoped))

    it.effect("enter and leave follow the active target, not its children, and a window exit leaves", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Board, {}, app)
        const todo = new Transfer()
        todo.setData("application/x-todo", "milk")
        const [header, body] = [byLabel(app, "Header"), byLabel(app, "Body")]
        drag(header, "dragenter", todo)
        // The spec's order: the enter of the element reached, then the leave of the one left.
        drag(body, "dragenter", todo)
        drag(header, "dragleave", todo)
        yield* tick
        // The other order, with the check for a window exit in between.
        drag(body, "dragleave", todo)
        drag(header, "dragenter", todo)
        yield* tick
        expect(root.model()).toEqual(["enter"])
        // Leaving the document: a leave with no enter after it.
        drag(header, "dragleave", todo)
        expect(root.model()).toEqual(["enter"])
        yield* tick
        expect(root.model()).toEqual(["enter", "leave"])

        // A nested target that accepts the drag takes over from the outer one, and hands back.
        const link = new Transfer()
        link.setData("text/uri-list", "https://example.com")
        link.setData("application/x-todo", "milk")
        drag(body, "dragenter", link)
        drag(byLabel(app, "Inner child"), "dragenter", link)
        drag(body, "dragleave", link)
        drag(body, "dragenter", link)
        drag(byLabel(app, "Inner child"), "dragleave", link)
        yield* tick
        expect(root.model()?.slice(2)).toEqual([
          "enter",
          "leave",
          "inner enter",
          "inner leave",
          "enter"
        ])
      }).pipe(Effect.scoped))

    /** Binds handlers on a bare host, as the renderer does, and records what they send. */
    const bare = (seen: Array<unknown>) => {
      const host = BrowserHost.makeHost(document)
      const dispatch: Renderer.Dispatch = (_, handler, payload, onMessage) => {
        const message = typeof handler === "function"
          ? (handler as (payload: unknown) => unknown)(payload)
          : handler
        if (message === undefined) return false
        onMessage?.({})
        seen.push(message)
        return true
      }
      return Effect.acquireRelease(
        Effect.succeed({ host, dispatch }),
        () => Effect.sync(() => host.dispose())
      )
    }
    /** The options `dropTarget` stores, for a target bound by hand. */
    const accepting = (
      ...accepts: ReadonlyArray<string>
    ): Readonly<Record<string, View.EventOptions>> => {
      const drop: Html.DropTargetOptions = { accepts, preventDefault: "always" }
      return { drop }
    }

    it.effect("a queued dragover is dropped when a render takes the target's drop handler away or changes what it accepts", () =>
      Effect.gen(function*() {
        for (const rebound of [{}, { drop: () => undefined }]) {
          const seen: Array<unknown> = []
          const { dispatch, host } = yield* bare(seen)
          const element = (yield* container).appendChild(
            document.createElement("div")
          )
          const over = (payload: Html.DragOverPayload) => `over ${payload.y}`
          host.setEvents(
            element,
            { drop: () => undefined, dragover: over },
            dispatch,
            accepting("application/x-todo")
          )
          const todo = new Transfer()
          todo.setData("application/x-todo", "milk")
          drag(element, "dragenter", todo)
          drag(element, "dragover", todo, { x: 0, y: 5 })
          // Before the frame, the element keeps its position handler, but no longer takes this drag.
          host.setEvents(
            element,
            { ...rebound, dragover: over },
            dispatch,
            accepting("text/uri-list")
          )
          yield* tick
          expect(seen).toEqual([])
        }
      }).pipe(Effect.scoped))

    it.effect("dropped starts over with every drag, even from a source with only a dragend handler", () =>
      Effect.gen(function*() {
        const seen: Array<unknown> = []
        const { dispatch, host } = yield* bare(seen)
        const app = yield* container
        const link = app.appendChild(document.createElement("a"))
        const target = app.appendChild(document.createElement("div"))
        host.setEvents(
          link,
          {
            dragend: ({ dropped }: Html.DragEndPayload) => `dropped=${dropped}`
          },
          dispatch,
          {}
        )
        host.setEvents(
          target,
          { drop: () => undefined },
          dispatch,
          accepting("text/uri-list")
        )
        const first = new Transfer()
        first.setData("text/uri-list", "https://example.com")
        drag(link, "dragstart", first)
        drag(target, "dragover", first)
        drag(target, "drop", first)
        drag(link, "dragend", first)
        // A second drag, cancelled: the browser reports no effect.
        const second = new Transfer()
        second.setData("text/uri-list", "https://example.com")
        drag(link, "dragstart", second)
        drag(link, "dragend", second)
        expect(seen).toEqual(["dropped=true", "dropped=false"])
      }).pipe(Effect.scoped))

    it.effect("dragover is sent once per frame when the position changed, and a queued one is dropped", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Board, {}, app)
        const done = byLabel(app, "Done")
        box(done, 0, 0, 100, 100)
        const todo = new Transfer()
        todo.setData("application/x-todo", "milk")
        drag(done, "dragenter", todo)
        for (const y of [1, 2, 3]) drag(done, "dragover", todo, { x: 5, y })
        yield* tick
        drag(done, "dragover", todo, { x: 5, y: 3 })
        yield* tick
        // Queued, then the target stops being active before the frame.
        drag(done, "dragover", todo, { x: 5, y: 9 })
        drag(byLabel(app, "Milk"), "dragenter", todo)
        yield* tick
        // Queued, then the drag ends with a drop.
        drag(done, "dragover", todo, { x: 5, y: 7 })
        drag(done, "drop", todo, { x: 5, y: 7 })
        yield* tick
        expect(root.model()).toEqual([
          "enter",
          "over 5,3",
          "leave",
          "enter",
          "drop milk at 5,7 of 100x100",
          "leave"
        ])
      }).pipe(Effect.scoped))
  })

  describe("pointer gestures", () => {
    /** Each `setPointerCapture`, with the element it was called on, and each `Handle` update, in order. */
    const calls: Array<readonly [Element, number] | string> = []
    const Handle = Html.component({
      name: "Handle",
      model: Schema.Null,
      message: Schema.String
    }).make({
      init: () => null,
      update: ($, message) => {
        calls.push(message)
        return $.model
      },
      parts: (p) => ({
        root: p.part(
          "div",
          (b) => b.on("pointerdown", "grab", { capturePointer: true })
        )
      })
    })
    // Shared with an event capture doesn't apply to, which it type-checks for.
    const grab = { preventDefault: true, capturePointer: true } as const
    const Divider = Html.component({
      name: "Divider",
      model: Schema.Array(Schema.String),
      message: Schema.String
    }).make({
      init: (): ReadonlyArray<string> => [],
      update: ($, message) => [...$.model, message],
      view: (h) =>
        h.div(
          Handle(h, {
            key: "handle",
            view: (handle) => handle.root(h.div).attr("aria-label", "Handle")
          }),
          h.div.attr("aria-label", "Divider")
            .on("pointerdown", ({ button, pointerId }) =>
              button === 0 ? `down ${pointerId}` : undefined, grab)
            .on("contextmenu", "menu", grab)
            .on("pointermove", ({ pointerId, x }) =>
              `move ${pointerId} ${x}`)
            .on("pointerup", ({ pointerId }) =>
              `up ${pointerId}`)
            .on("pointercancel", ({ pointerId }) =>
              `cancel ${pointerId}`)
            .children(h.span("Grip"))
        )
    })
    const pointer = (
      element: Element,
      name: string,
      init: {
        readonly pointerId: number
        readonly x?: number
        readonly button?: number
      }
    ) =>
      element.dispatchEvent(
        new PointerEvent(name, {
          bubbles: true,
          pointerId: init.pointerId,
          button: init.button ?? 0,
          clientX: init.x ?? 0,
          pointerType: "mouse"
        })
      )
    const captures = Effect.acquireRelease(
      Effect.sync(() => {
        calls.length = 0
        const spy = vi.spyOn(Element.prototype, "setPointerCapture")
          .mockImplementation(function(this: Element, pointerId: number) {
            calls.push([this, pointerId])
          })
        return spy
      }),
      (spy) => Effect.sync(() => spy.mockRestore())
    )

    // Html's own host, and `makeHost` driven through `Renderer.Host` alone, each with an author's handler and a part's.
    it.effect.each(["mountEffect", "Renderer.Host"])(
      "a press captures its pointer on the element with the handler before the update, unless the handler sends nothing: %s",
      (via) =>
        Effect.gen(function*() {
          yield* captures
          const app = yield* container
          if (via === "mountEffect") {
            yield* BrowserHost.mountEffect(Divider, {}, app)
          } else {
            const host = BrowserHost.makeHost(document)
            yield* Effect.addFinalizer(() => Effect.sync(() => host.dispose()))
            // A copy, which the renderer doesn't know for an Html host.
            yield* Renderer.mount(Divider, {}, app).pipe(
              Effect.provide(Renderer.layer({ ...host })),
              Effect.provideService(Html.Host, BrowserHost.htmlHost)
            )
          }
          const divider = app.querySelector("[aria-label=Divider]")!
          const handle = app.querySelector("[aria-label=Handle]")!
          pointer(app.querySelector("span")!, "pointerdown", { pointerId: 7 })
          pointer(divider, "pointerdown", { pointerId: 8, button: 2 })
          pointer(handle, "pointerdown", { pointerId: 9 })
          pointer(divider, "contextmenu", { pointerId: 10, button: 2 })
          assert.deepStrictEqual(calls, [[divider, 7], [handle, 9], "grab"])
        }).pipe(Effect.scoped)
    )

    it.effect("moves are sent once per frame per pointer, with the latest position, and a queued one before its release but not after a cancel", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Divider, {}, app)
        const divider = app.querySelector("[aria-label=Divider]")!
        pointer(divider, "pointerdown", { pointerId: 1 })
        for (const x of [1, 2, 3]) {
          pointer(divider, "pointermove", { pointerId: 1, x })
        }
        pointer(divider, "pointermove", { pointerId: 2, x: 9 })
        yield* tick
        // Queued, then released in the same task.
        pointer(divider, "pointermove", { pointerId: 1, x: 4 })
        pointer(divider, "pointermove", { pointerId: 1, x: 5 })
        pointer(divider, "pointerup", { pointerId: 1, x: 5 })
        yield* tick
        // Queued, then cancelled: the Model reverts without it.
        pointer(divider, "pointerdown", { pointerId: 1 })
        pointer(divider, "pointermove", { pointerId: 1, x: 6 })
        pointer(divider, "pointercancel", { pointerId: 1 })
        yield* tick
        expect(root.model()).toEqual([
          "down 1",
          "move 1 3",
          "move 2 9",
          "move 1 5",
          "up 1",
          "down 1",
          "cancel 1"
        ])
      }).pipe(Effect.scoped))

    it.effect("a cancel or release a move's handler fires ends the other pointer's move still in the frame", () =>
      Effect.gen(function*() {
        const app = yield* container
        const Pane = Html.component({
          name: "Pane",
          model: Schema.Array(Schema.String),
          message: Schema.String
        }).make({
          init: (): ReadonlyArray<string> => [],
          update: ($, message) => [...$.model, message],
          view: (h) =>
            h.div.attr("aria-label", "Pane")
              .on("pointermove", ({ pointerId, x }) => {
                if (pointerId === 1) {
                  const pane = app.querySelector("[aria-label=Pane]")!
                  pointer(pane, "pointercancel", { pointerId: 2 })
                  // A newer move, then the release: the release sends only the newer one.
                  pointer(pane, "pointermove", { pointerId: 3, x: 9 })
                  pointer(pane, "pointerup", { pointerId: 3 })
                }
                return `move ${pointerId} ${x}`
              })
              .on("pointercancel", ({ pointerId }) => `cancel ${pointerId}`)
              .on("pointerup", ({ pointerId }) => `up ${pointerId}`)
        })
        const root = yield* BrowserHost.mountEffect(Pane, {}, app)
        const pane = app.querySelector("[aria-label=Pane]")!
        pointer(pane, "pointermove", { pointerId: 1 })
        pointer(pane, "pointermove", { pointerId: 2 })
        pointer(pane, "pointermove", { pointerId: 3 })
        yield* tick
        yield* tick
        expect(root.model()).toEqual([
          "cancel 2",
          "move 3 9",
          "up 3",
          "move 1 0"
        ])
      }).pipe(Effect.scoped))
  })

  describe("modal dialogs", () => {
    /**
     * Records `showModal` and `close`, and makes `showModal` throw on a dialog that isn't in the document,
     * as browsers do. A `close` on a detached dialog is marked: it can't restore focus. happy-dom has no
     * top layer, so the dialogs' own state is all a test can see here.
     */
    const dialogCalls = Effect.acquireRelease(
      Effect.sync(() => {
        const calls: Array<string> = []
        const proto = window.HTMLDialogElement.prototype
        const { close, showModal } = proto
        const label = (dialog: HTMLDialogElement) =>
          dialog.getAttribute("aria-label")
        const spies = [
          vi.spyOn(proto, "showModal").mockImplementation(
            function(this: HTMLDialogElement) {
              if (!this.isConnected) {
                throw new DOMException(
                  "The dialog isn't connected",
                  "InvalidStateError"
                )
              }
              calls.push(`showModal ${label(this)}`)
              showModal.call(this)
            }
          ),
          vi.spyOn(proto, "close").mockImplementation(
            function(this: HTMLDialogElement, value?: string) {
              calls.push(
                `close ${label(this)}${this.isConnected ? "" : " (detached)"}`
              )
              close.call(this, value)
            }
          )
        ]
        return { calls, close, spies }
      }),
      ({ spies }) =>
        Effect.sync(() => spies.forEach((spy) => spy.mockRestore()))
    )
    const mountConfirm = Effect.fnUntraced(
      function*(
        props: {
          readonly state: "closed" | "open" | "modal"
          readonly acceptEscape: boolean
        }
      ) {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Confirm, props, app)
        yield* tick
        const dialog = () => app.querySelector("dialog")
        return { app, dialog, root }
      }
    )
    const cancel = (dialog: Element, cancelable = true) => {
      const event = new Event("cancel", { cancelable })
      dialog.dispatchEvent(event)
      return event.defaultPrevented
    }

    it.effect("a modal opens once it's in the document and closes from the Model, and its form is the app's", () =>
      Effect.gen(function*() {
        const { calls } = yield* dialogCalls
        const { app, dialog, root } = yield* mountConfirm({
          state: "modal",
          acceptEscape: false
        })
        expect(calls).toEqual(["showModal Delete note?"])
        expect(dialog()!.open).toBe(true)
        // `method="dialog"` doesn't close it: the submission is the app's, and the Model closes it.
        const form = app.querySelector("form")!
        form.requestSubmit(
          HtmlLocator.getByRole(app, "button", {
            name: "Delete"
          }) as HTMLButtonElement
        )
        yield* tick
        expect(calls).toEqual(["showModal Delete note?", "close Delete note?"])
        expect(dialog()!.open).toBe(false)
        expect(dialog()!.returnValue).toBe("")
        expect(root.model()!.log).toEqual(["delete", "closed"])
        expect(HtmlLocator.dialogState(dialog())).toBe("closed")
      }).pipe(Effect.scoped))

    it.effect("Escape is the Model's: rejected stays open, a forced close reopens, accepted closes", () =>
      Effect.gen(function*() {
        const { calls, close } = yield* dialogCalls
        const rejecting = yield* mountConfirm({
          state: "modal",
          acceptEscape: false
        })
        expect(cancel(rejecting.dialog()!)).toBe(true)
        yield* tick
        expect(rejecting.dialog()!.open).toBe(true)
        // A browser that won't let the close request be cancelled closes the dialog itself.
        expect(cancel(rejecting.dialog()!, false)).toBe(false)
        close.call(rejecting.dialog()!)
        yield* tick
        expect(rejecting.dialog()!.open).toBe(true)
        // The cancel says so, so the app can tell the close that follows is the same request.
        expect(rejecting.root.model()!.log).toEqual([
          "escape rejected",
          "escape rejected, forced",
          "closed"
        ])
        expect(calls).toEqual([
          "showModal Delete note?",
          "showModal Delete note?"
        ])

        calls.length = 0
        const accepting = yield* mountConfirm({
          state: "modal",
          acceptEscape: true
        })
        expect(cancel(accepting.dialog()!)).toBe(true)
        yield* tick
        yield* tick
        expect(accepting.dialog()!.open).toBe(false)
        expect(accepting.root.model()!.log).toEqual(["escape", "closed"])
        expect(calls).toEqual(["showModal Delete note?", "close Delete note?"])
      }).pipe(Effect.scoped))

    it.effect("a file input in a modal keeps its cancel to itself, and is never given a non-empty value", () =>
      Effect.gen(function*() {
        const Message = UiSchema.TaggedEnum({ Cancelled: {} })
        const Upload = Html.component({
          name: "Upload",
          model: Schema.Number,
          message: Message
        }).make({
          init: () => 0,
          update: ($) => $.model + 1,
          view: (h) =>
            h.dialog.attr("aria-label", "Upload").modal(true).on(
              "cancel",
              Message.Cancelled()
            ).children(
              h.input.attrs({ type: "file", "aria-label": "File" }).value(
                "notes.txt"
              )
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Upload, {}, app)
        yield* tick
        const input = app.querySelector("input")!
        const dismissed = new Event("cancel", {
          bubbles: true,
          cancelable: true
        })
        input.dispatchEvent(dismissed)
        yield* tick
        expect([
          dismissed.defaultPrevented,
          root.model(),
          app.querySelector("dialog")!.open,
          input.value
        ])
          .toEqual([false, 0, true, ""])
      }).pipe(Effect.scoped))

    it.effect("closing a mounted root closes its modal dialog", () =>
      Effect.gen(function*() {
        const Modal = Html.component({
          name: "Modal",
          model: Schema.Struct({}),
          message: Schema.Never
        }).make({
          init: () => ({}),
          update: ($) => $.model,
          view: (h) => h.dialog.modal(true).children("Hi")
        })
        const app = yield* container
        const dialog = yield* Effect.gen(function*() {
          yield* BrowserHost.mountEffect(Modal, {}, app)
          yield* tick
          return app.querySelector("dialog")!
        }).pipe(Effect.scoped)
        expect(dialog.open).toBe(false)
      }))

    it.effect("document shortcuts don't fire while a modal dialog is open", () =>
      Effect.gen(function*() {
        const Message = UiSchema.TaggedEnum({ Help: {}, Closed: {} })
        const Shell = Html.component({
          name: "Shell",
          model: Schema.Struct({
            open: Schema.Boolean,
            log: Schema.Array(Schema.String)
          }),
          message: Message
        }).make({
          init: () => ({ open: true, log: [] }),
          update: {
            Help: ($) => ({ ...$.model, log: [...$.model.log, "help"] }),
            Closed: ($) => ({ ...$.model, open: false })
          },
          view: (h, model) =>
            h.dialog.attr("aria-label", "Confirm").modal(model.open).children(
              h.button.children("Inside")
            ),
          subscriptions: () => [
            HtmlSubscription.onDocument(
              "keydown",
              HtmlKeyboard.shortcuts([{ key: "?", message: Message.Help() }])
            )
          ]
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Shell, {}, app)
        yield* tick
        const help = (target: EventTarget) =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "?",
              bubbles: true,
              cancelable: true
            })
          )
        help(app.querySelector("button")!)
        yield* tick
        expect(root.model()!.log).toEqual([])
        root.send(Message.Closed())
        yield* tick
        help(document.body)
        yield* tick
        expect(root.model()!.log).toEqual(["help"])
      }).pipe(Effect.scoped))

    it.effect("a modal removed while open is forgotten, and switching mode closes without telling the app", () =>
      Effect.gen(function*() {
        const { calls } = yield* dialogCalls
        const { app, dialog, root } = yield* mountConfirm({
          state: "open",
          acceptEscape: false
        })
        expect(dialog()!.open).toBe(true)
        root.send(ConfirmMessage.Mode({ state: "modal" }))
        yield* tick
        expect(calls).toEqual(["close Delete note?", "showModal Delete note?"])
        root.send(ConfirmMessage.Mode({ state: "open" }))
        yield* tick
        expect(calls.slice(2)).toEqual(["close Delete note?"])
        expect(dialog()!.open).toBe(true)
        expect(root.model()!.log).toEqual([])

        root.send(ConfirmMessage.Mode({ state: "modal" }))
        yield* tick
        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Remove" })
        )
        yield* tick
        expect(dialog()).toBeNull()
        // Later commits have nothing to show; showModal on the detached dialog would throw.
        root.send(ConfirmMessage.Ask())
        yield* tick
        expect(calls.filter((call) => call.startsWith("showModal")))
          .toHaveLength(2)
      }).pipe(Effect.scoped))

    it.each(
      [
        {
          name: "two mode switches, then a close",
          states: [true, "modal", false],
          closes: ["closed"]
        },
        {
          name: "a close, a reopen, then a close",
          states: [false, "modal", false],
          closes: ["closed"]
        },
        { name: "a close, then a reopen", states: [false, "modal"], closes: [] }
      ] as const
    )(
      "close events reported a task later end the right showing: $name",
      ({ closes, states }) => {
        // Browsers close at once and report it in a later task; happy-dom reports it at once.
        const host = BrowserHost.makeHost(document)
        const dialog = document.body.appendChild(
          document.createElement("dialog")
        )
        const tasks: Array<() => void> = []
        const close = vi.spyOn(dialog, "close").mockImplementation(() => {
          dialog.open = false
          tasks.push(() => dialog.dispatchEvent(new Event("close")))
        })
        const seen: Array<unknown> = []
        try {
          host.setEvents(
            dialog,
            { close: "closed" },
            (_, handler) => seen.push(handler) > 0,
            {}
          )
          host.setProp(dialog, "open", "modal")
          host.commit?.()
          for (const state of states) {
            host.setProp(dialog, "open", state)
            host.commit?.()
          }
          for (const task of tasks) {
            task()
          }
          expect(seen).toEqual(closes)
        } finally {
          close.mockRestore()
          host.dispose()
          dialog.remove()
        }
      }
    )

    it.effect("a close the browser makes is the app's, unless the host has shown the dialog again first", () =>
      Effect.gen(function*() {
        const events = Context.get(
          yield* Layer.build(BrowserHost.layer()),
          HtmlSubscription.GlobalEvents
        )
        const help = HtmlKeyboard.shortcuts([{ key: "?", message: "help" }])
        const heard: Array<unknown> = []
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            events.listen(
              "document",
              "keydown",
              { capture: false },
              (payload) => heard.push(help(payload as never))
            )
          ),
          (off) => Effect.sync(off)
        )
        const host = BrowserHost.makeHost(document)
        const dialog = document.body.appendChild(
          document.createElement("dialog")
        )
        const seen: Array<unknown> = []
        try {
          host.setEvents(
            dialog,
            { close: "closed" },
            (_, handler) => seen.push(handler) > 0,
            {}
          )
          host.setProp(dialog, "open", "modal")
          host.commit?.()
          // A forced close reported before the reconciliation shows it again.
          dialog.open = false
          dialog.dispatchEvent(new Event("close"))
          expect(seen).toEqual(["closed"])
          host.commit?.()
          expect(dialog.open).toBe(true)
          // A forced close the reconciliation got to first: its report is stale.
          dialog.open = false
          host.commit?.()
          dialog.dispatchEvent(new Event("close"))
          expect(seen).toEqual(["closed"])
          // Disposed with it reopened, the host holds the page's shortcuts
          // past the stale `close`, until the dialog really closes.
          dialog.open = false
          host.commit?.()
          host.dispose()
          dialog.dispatchEvent(new Event("close"))
          const press = () =>
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))
          press()
          dialog.close()
          yield* tick
          press()
          expect(heard).toEqual([undefined, "help"])
        } finally {
          host.dispose()
          dialog.remove()
        }
      }).pipe(Effect.scoped))

    it("reconciling a dialog that's already open records its showing once", () => {
      const host = BrowserHost.makeHost(document)
      const dialog = document.body.appendChild(document.createElement("dialog"))
      dialog.setAttribute("open", "")
      const seen: Array<unknown> = []
      try {
        host.setEvents(
          dialog,
          { close: "closed" },
          (_, handler) => seen.push(handler) > 0,
          {}
        )
        for (let i = 0; i < 3; i++) {
          host.setProp(dialog, "open", true)
          host.commit?.()
        }
        // One record: the browser's close of that showing is the app's. A second would make it stale.
        dialog.open = false
        dialog.dispatchEvent(new Event("close"))
        expect(seen).toEqual(["closed"])
      } finally {
        host.dispose()
        dialog.remove()
      }
    })

    it.effect("nested modals open outer first, so the inner one is on top", () =>
      Effect.gen(function*() {
        const { calls } = yield* dialogCalls
        yield* BrowserHost.mountEffect(Nested, {}, yield* container)
        expect(calls).toEqual(["showModal Outer", "showModal Inner"])
      }).pipe(Effect.scoped))

    it.effect("a shown dialog is closed before it's removed, latest shown first, without telling the app", () =>
      Effect.gen(function*() {
        const { calls } = yield* dialogCalls
        const { app, root } = yield* mountConfirm({
          state: "modal",
          acceptEscape: false
        })
        HtmlLocator.click(
          HtmlLocator.getByRole(app, "button", { name: "Remove" })
        )
        yield* tick
        expect(calls).toEqual(["showModal Delete note?", "close Delete note?"])
        expect(root.model()!.log).toEqual([])

        // A drawer: a child component mounted only while it's open.
        calls.length = 0
        const DrawerMessage = UiSchema.TaggedEnum({ Close: {} })
        const Drawer = Html.component({
          name: "Drawer",
          model: Schema.Boolean,
          message: DrawerMessage
        }).make({
          init: () => true,
          update: () => false,
          view: (h, open) =>
            h.div(
              h.button.on("click", DrawerMessage.Close()).children("Close"),
              open && Nested(h, { key: "nested" })
            )
        })
        const drawer = yield* container
        yield* BrowserHost.mountEffect(Drawer, {}, drawer)
        HtmlLocator.click(
          HtmlLocator.getByRole(drawer, "button", { name: "Close" })
        )
        yield* tick
        expect(calls).toEqual([
          "showModal Outer",
          "showModal Inner",
          "close Inner",
          "close Outer"
        ])

        // Siblings shown later one before the other: the stack, not the document, sets the order.
        calls.length = 0
        const Stack = Html.component({
          name: "Stack",
          model: Schema.Number,
          message: Schema.Number
        }).make({
          init: () => 0,
          update: (_, step) => step,
          view: (h, step) =>
            h.div(
              step < 2 && h.div(
                h.dialog.attr("aria-label", "First").key("first").modal(
                  step === 1
                ).children(h.p("First")),
                h.dialog.attr("aria-label", "Second").key("second").modal(true)
                  .children(h.p("Second"))
              )
            )
        })
        const stack = yield* BrowserHost.mountEffect(
          Stack,
          {},
          yield* container
        )
        stack.send(1)
        yield* tick
        stack.send(2)
        yield* tick
        expect(calls).toEqual([
          "showModal Second",
          "showModal First",
          "close First",
          "close Second"
        ])
      }).pipe(Effect.scoped))
  })

  describe("popovers", () => {
    const mountMenu = Effect.fnUntraced(
      function*(
        props: {
          readonly mode: "manual" | "auto"
          readonly open: boolean
          readonly follow: boolean
        }
      ) {
        const stub = yield* popoverStub
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Menu, props, app)
        yield* tick
        const menu = () => app.querySelector("[aria-label=Menu]")
        const send = (message: typeof MenuMessage.Type) =>
          Effect.andThen(Effect.sync(() => root.send(message)), tick)
        // Runs the queued toggle tasks, then lets the reconciliation frame run.
        const settle = Effect.andThen(Effect.sync(stub.run), tick)
        return { menu, root, send, settle, stub }
      }
    )
    const shows = (calls: ReadonlyArray<string>) =>
      calls.filter((call) => call.startsWith("showPopover")).length

    it.effect("a manual popover is controlled: shown and hidden by the Model, and put back after other changes", () =>
      Effect.gen(function*() {
        const { menu, root, send, settle, stub } = yield* mountMenu({
          mode: "manual",
          open: true,
          follow: false
        })
        expect(stub.calls).toEqual(["showPopover Menu"])
        yield* settle
        // Something else hides it, such as a `popovertarget` button: it's shown again.
        stub.dismiss(menu()!)
        yield* settle
        expect(stub.showing.has(menu()!)).toBe(true)
        expect(shows(stub.calls)).toBe(2)
        // Its own show's toggle changes nothing more: no loop.
        yield* settle
        expect(shows(stub.calls)).toBe(2)
        expect(root.model()!.log).toEqual([
          "closed->open",
          "open->closed",
          "closed->open"
        ])

        // Hidden then shown again by the Model before the toggle task: one coalesced, stale notification.
        yield* send(MenuMessage.Set({ open: false }))
        yield* send(MenuMessage.Set({ open: true }))
        yield* settle
        expect(root.model()!.log.at(-1)).toBe("open->open")
        expect(stub.showing.has(menu()!)).toBe(true)
        expect(shows(stub.calls)).toBe(3)
        yield* send(MenuMessage.Set({ open: false }))
        yield* settle
        expect(stub.showing.has(menu()!)).toBe(false)
        expect(stub.calls.at(-1)).toBe("hidePopover Menu")
      }).pipe(Effect.scoped))

    it.effect("a manual popover with no toggle handler is put back by the host alone", () =>
      Effect.gen(function*() {
        const stub = yield* popoverStub
        const host = BrowserHost.makeHost(document)
        yield* Effect.addFinalizer(() => Effect.sync(() => host.dispose()))
        const element = (yield* container).appendChild(
          document.createElement("div")
        )
        host.setAttr(element, "popover", "manual")
        host.setProp(element, "popoverOpen", true)
        host.commit?.()
        stub.run()
        // Nothing re-renders: the toggle's reconciliation alone shows it again.
        stub.dismiss(element)
        stub.run()
        yield* tick
        expect(stub.showing.has(element)).toBe(true)
        stub.run()
        yield* tick
        expect(shows(stub.calls)).toBe(2)
      }).pipe(Effect.scoped))

    it.effect("an auto popover is followed: a light dismiss is reported and never reverted", () =>
      Effect.gen(function*() {
        const following = yield* mountMenu({
          mode: "auto",
          open: true,
          follow: true
        })
        yield* following.settle
        following.stub.dismiss(following.menu()!)
        yield* following.settle
        expect(following.root.model()!.open).toBe(false)
        expect(shows(following.stub.calls)).toBe(1)

        // A Model that ignores the toggle still says open, and the popover stays closed across renders.
        const ignoring = yield* mountMenu({
          mode: "auto",
          open: true,
          follow: false
        })
        yield* ignoring.settle
        ignoring.stub.dismiss(ignoring.menu()!)
        yield* ignoring.settle
        expect(ignoring.root.model()!.open).toBe(true)
        expect(ignoring.stub.showing.has(ignoring.menu()!)).toBe(false)
        // It shows again only once the Model's value goes to false and back.
        yield* ignoring.send(MenuMessage.Set({ open: false }))
        yield* ignoring.send(MenuMessage.Set({ open: true }))
        expect(ignoring.stub.showing.has(ignoring.menu()!)).toBe(true)
      }).pipe(Effect.scoped))

    it.effect("a coalesced toggle with equal states still reaches the Model, which converges on the latest", () =>
      Effect.gen(function*() {
        const { menu, root, send, settle, stub } = yield* mountMenu({
          mode: "auto",
          open: false,
          follow: true
        })
        // The Model opens it, and the browser dismisses it before the toggle task: one `closed->closed`.
        yield* send(MenuMessage.Set({ open: true }))
        stub.dismiss(menu()!)
        yield* settle
        expect(root.model()!.log).toEqual(["closed->closed"])
        expect(root.model()!.open).toBe(false)
        yield* settle
        expect(stub.showing.has(menu()!)).toBe(false)
        expect(shows(stub.calls)).toBe(1)
      }).pipe(Effect.scoped))

    it.effect("a keyed move closes the popover in it: a manual one is shown again, an auto one isn't", () =>
      Effect.gen(function*() {
        const stub = yield* popoverStub
        // Reversing the rows moves one of them; the browser closes the popover in it without a toggle.
        for (const [mode, expected] of [["manual", 2], ["auto", 1]] as const) {
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Rows, { mode }, app)
          yield* tick
          // The opening toggles, and the reconciliation frame they schedule, are over before the move.
          stub.run()
          yield* tick
          const showing = () =>
            Array.from(
              app.querySelectorAll("[popover]"),
              (node) => stub.showing.has(node)
            )
          expect(showing()).toEqual([true, true])
          root.send(true)
          yield* tick
          // A manual popover is reconciled at every commit; an auto one only when its Model's value changes.
          expect(showing().filter(Boolean)).toHaveLength(expected)
        }
      }).pipe(Effect.scoped))

    it.effect("a mode change applies the Model's state under the new mode", () =>
      Effect.gen(function*() {
        const { menu, send, settle, stub } = yield* mountMenu({
          mode: "manual",
          open: true,
          follow: false
        })
        // Changing the attribute hides it; the new mode shows it again from the Model.
        yield* send(MenuMessage.Mode({ mode: "auto" }))
        expect(stub.showing.has(menu()!)).toBe(true)
        yield* settle
        stub.dismiss(menu()!)
        yield* settle
        expect(stub.showing.has(menu()!)).toBe(false)
        yield* send(MenuMessage.Mode({ mode: "manual" }))
        expect(stub.showing.has(menu()!)).toBe(true)
        expect(shows(stub.calls)).toBe(3)
      }).pipe(Effect.scoped))

    it.effect("a detached or removed popover is never shown, and a popover in a modal opens after it", () =>
      Effect.gen(function*() {
        const { menu, root, send, stub } = yield* mountMenu({
          mode: "manual",
          open: true,
          follow: false
        })
        const host = BrowserHost.makeHost(document)
        yield* Effect.addFinalizer(() => Effect.sync(() => host.dispose()))
        const detached = document.createElement("div")
        host.setAttr(detached, "popover", "manual")
        host.setProp(detached, "popoverOpen", true)
        // showPopover would throw on it.
        host.commit?.()
        expect(stub.calls).toEqual(["showPopover Menu"])

        const shown = menu()!
        yield* send(MenuMessage.Remove())
        expect(menu()).toBeNull()
        yield* send(MenuMessage.Set({ open: false }))
        yield* send(MenuMessage.Set({ open: true }))
        expect(stub.calls.filter((call) => call.startsWith("showPopover")))
          .toHaveLength(1)
        expect(root.model()!.log).toEqual([])
        expect(shown.isConnected).toBe(false)

        stub.calls.length = 0
        yield* BrowserHost.mountEffect(ModalMenu, {}, yield* container)
        // A modal opening closes the auto popovers showing, so the popover in it opens after it.
        expect(stub.calls).toEqual(["showModal Settings", "showPopover Menu"])
      }).pipe(Effect.scoped))

    it.effect("showing a modal dialog or a popover that takes focus leaves the page's scroll where it was", () =>
      Effect.gen(function*() {
        yield* popoverStub
        const jumps: Array<string> = []
        const jumping = (proto: any, name: "showModal" | "showPopover") => {
          const show = proto[name]
          return vi.spyOn(proto, name).mockImplementation(
            function(this: HTMLElement) {
              show.call(this)
              jumps.push(name)
              this.tabIndex = -1
              this.focus()
              window.scrollTo(0, 0)
            }
          )
        }
        const spies = [
          jumping(window.HTMLDialogElement.prototype, "showModal"),
          jumping(window.HTMLElement.prototype, "showPopover")
        ]
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => spies.forEach((spy) => spy.mockRestore()))
        )
        window.scrollTo(0, 600)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => window.scrollTo(0, 0))
        )
        yield* BrowserHost.mountEffect(ModalMenu, {}, yield* container)
        expect(jumps).toEqual(["showModal", "showPopover"])
        expect(window.scrollY).toBe(600)
      }).pipe(Effect.scoped))
  })

  describe("refs and mounts", () => {
    it.effect("a mount given new args finds the elements the same patch made below it", () =>
      Effect.gen(function*() {
        const Count = Mount.makeStream(
          "Count",
          { args: { rows: Schema.Number } },
          (list: HTMLElement, _args, changes) =>
            Stream.map(changes, () => list.querySelectorAll("li").length)
        )
        const Rows = Html.component({
          name: "Rows",
          model: Schema.Struct({
            rows: Schema.Number,
            seen: Schema.Array(Schema.Number)
          }),
          message: UiSchema.TaggedEnum({
            Add: {},
            Saw: { count: Schema.Number }
          })
        }).make({
          init: () => ({ rows: 1, seen: [] }),
          update: {
            Add: ($) => ({ ...$.model, rows: $.model.rows + 1 }),
            Saw: ($, { count }) => ({
              ...$.model,
              seen: [...$.model.seen, count]
            })
          },
          view: (h, { rows }) =>
            h.ul.onMount(
              Count({ rows }).pipe(
                Mount.map((count) => ({ _tag: "Saw" as const, count }))
              )
            ).children(
              Array.from({ length: rows }, (_, index) => h.li(String(index)))
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Rows, {}, app)
        yield* tick
        root.send({ _tag: "Add" })
        yield* tick
        assert.deepStrictEqual(root.model()?.seen, [1, 2])
      }).pipe(Effect.scoped))

    const Field = Html.ref("Field", "input")
    const Missing = Html.ref("Missing", "input")
    const Message = UiSchema.TaggedEnum({
      Focus: {},
      FocusMissing: {},
      Measure: {},
      Found: { found: Schema.Boolean },
      Measured: { some: Schema.Boolean },
      Mounted: { tag: Schema.String }
    })
    const ReadTag = Mount.make(
      "ReadTag",
      { args: {} },
      (element: HTMLElement) => Effect.succeed(element.localName)
    )
    const refs = (elements: View.Vocabulary<Html.Elements>) =>
      Component.define({
        name: "Refs",
        model: Schema.Array(Schema.String),
        message: Message,
        elements
      }).make({
        init: (): ReadonlyArray<string> => [],
        update: ($, message) =>
          Message.match(message, {
            Focus: () =>
              $.run(
                HtmlCommand.focus(
                  Field,
                  ({ found }) => Message.Found({ found })
                )
              ),
            FocusMissing: () =>
              $.run(
                HtmlCommand.focus(Missing, ({ found }) =>
                  Message.Found({ found }))
              ),
            Measure: () =>
              $.run(
                HtmlCommand.measure(Field, (rect) =>
                  Message.Measured({ some: Option.isSome(rect) }))
              ),
            Found: ({ found }) => [...$.model, `found ${found}`],
            Measured: ({ some }) => [...$.model, `measured ${some}`],
            Mounted: ({ tag }) => [...$.model, `mounted ${tag}`]
          }),
        view: (h) =>
          h.div(
            h.input.attr("aria-label", "Field").ref(Field)
              .onMount(
                ReadTag().pipe(Mount.map((tag) => Message.Mounted({ tag })))
              )
          )
      })

    const vocabularies: ReadonlyArray<
      readonly [string, View.Vocabulary<Html.Elements>]
    > = [
      ["the Html module", Html],
      ["Html.vocabulary", Html.vocabulary]
    ]

    it.effect.each(vocabularies)(
      "ref Commands reach the element; onMount gets it, with %s as elements",
      ([, elements]) =>
        Effect.gen(function*() {
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(refs(elements), {}, app)
          yield* tick
          root.send(Message.Focus())
          root.send(Message.FocusMissing())
          root.send(Message.Measure())
          yield* tick
          expect(document.activeElement).toBe(
            HtmlLocator.getByRole(app, "textbox", { name: "Field" })
          )
          expect(root.model()).toEqual([
            "mounted input",
            "found true",
            "found false",
            "measured true"
          ])
        }).pipe(Effect.scoped)
    )

    it.effect("ref Commands run in the committing task under HtmlScheduler", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(refs(Html), {}, app)
        yield* tick
        yield* Effect.promise(async () => {
          root.send(Message.Focus())
          await Promise.resolve()
        })
        expect(document.activeElement).toBe(
          HtmlLocator.getByRole(app, "textbox", { name: "Field" })
        )
        expect(root.model()).toEqual(["mounted input", "found true"])
      }).pipe(
        Effect.scoped,
        Effect.provide(HtmlScheduler.layer({ budget: 0 }))
      ))

    const Code = Html.ref("Code", "input")
    const Loose = Html.ref("Loose", "input")
    const EntryMessage = UiSchema.TaggedEnum({
      Pasted: { text: Schema.String },
      Select: {},
      Selected: { found: Schema.Boolean },
      Submit: { loose: Schema.Boolean },
      Submitted: { submitted: Schema.Boolean },
      Sent: { code: Schema.String }
    })
    const Entry = Html.component({
      name: "Entry",
      model: Schema.Array(Schema.String),
      message: EntryMessage
    }).make({
      init: (): ReadonlyArray<string> => [],
      update: ($, message) =>
        EntryMessage.match(message, {
          Pasted: ({ text }) => [...$.model, `pasted ${text}`],
          Select: () =>
            $.run(HtmlCommand.select(Code, ({ found }) =>
              EntryMessage.Selected({ found }))),
          Selected: ({ found }) => [...$.model, `selected ${found}`],
          Submit: ({ loose }) =>
            $.run(
              HtmlCommand.requestSubmit(loose ? Loose : Code, ({ submitted }) =>
                EntryMessage.Submitted({ submitted }))
            ),
          Submitted: ({ submitted }) => [...$.model, `submitted ${submitted}`],
          Sent: ({ code }) => [...$.model, `sent ${code}`]
        }),
      view: (h) =>
        h.div(
          h.form.on("submit", ({ fields }) =>
            EntryMessage.Sent({ code: fields.code ?? "" })).children(
              h.input.attrs({ "aria-label": "Code", name: "code" }).ref(Code)
                .value("7")
                .on("paste", ({ text }) =>
                  EntryMessage.Pasted({ text }), {
                  preventDefault: true
                })
            ),
          h.input.attr("aria-label", "Loose").ref(Loose)
        )
    })

    it.effect("a field reports pasted text, is selected, and submits its form", () =>
      Effect.gen(function*() {
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Entry, {}, app)
        yield* tick
        const code = HtmlLocator.getByRole(app, "textbox", {
          name: "Code"
        }) as HTMLInputElement
        const pasted = Object.assign(
          new Event("paste", { bubbles: true, cancelable: true }),
          {
            clipboardData: {
              getData: (type: string) => (type === "text/plain" ? "12 34" : "")
            }
          }
        )
        code.dispatchEvent(pasted)
        expect(pasted.defaultPrevented).toBe(true)
        yield* tick

        code.value = "rejected"
        root.send(EntryMessage.Select())
        yield* tick
        expect([code.value, code.selectionStart, code.selectionEnd]).toEqual([
          "7",
          0,
          1
        ])

        root.send(EntryMessage.Submit({ loose: false }))
        root.send(EntryMessage.Submit({ loose: true }))
        yield* tick
        expect(root.model()).toEqual([
          "pasted 12 34",
          "selected true",
          "sent 7",
          "submitted true",
          "submitted false"
        ])
      }).pipe(Effect.scoped))

    it.effect("HtmlCommand.select places a range in the value the same update wrote, and finds a field without a selection", () =>
      Effect.gen(function*() {
        const Area = Html.ref("Area", "textarea")
        const Attachment = Html.ref("Attachment", "input")
        const CaretMessage = UiSchema.TaggedEnum({
          Completed: {},
          Selected: { found: Schema.Boolean }
        })
        const Editor = Html.component({
          name: "Editor",
          model: Schema.Struct({
            text: Schema.String,
            found: Schema.Array(Schema.Boolean)
          }),
          message: CaretMessage
        }).make({
          init: () => ({ text: "a ser b", found: [] }),
          update: ($, message) =>
            CaretMessage.match(message, {
              Completed: () =>
                $.evolve({ text: "a service.name b" }).run(
                  HtmlCommand.select(
                    Area,
                    ({ found }) => CaretMessage.Selected({ found }),
                    { start: 14 }
                  ),
                  HtmlCommand.select(
                    Attachment,
                    ({ found }) => CaretMessage.Selected({ found }),
                    { start: 0 }
                  )
                ),
              Selected: ({ found }) =>
                $.evolve({ found: (all) => [...all, found] })
            }),
          view: (h, model) =>
            h.div(
              h.textarea.attr("aria-label", "Area").ref(Area).value(model.text),
              h.input.attrs({ type: "file", "aria-label": "Attachment" }).ref(
                Attachment
              ).value("notes.txt")
            )
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Editor, {}, app)
        yield* tick
        const area = HtmlLocator.getByRole(app, "textbox", {
          name: "Area"
        }) as HTMLTextAreaElement
        area.focus()
        area.setSelectionRange(5, 5)
        root.send(CaretMessage.Completed())
        yield* tick
        expect([area.value, area.selectionStart, area.selectionEnd]).toEqual([
          "a service.name b",
          14,
          14
        ])
        expect(root.model()!.found).toEqual([true, true])
      }).pipe(Effect.scoped))

    it.effect("HtmlCommand.waitForPaint waits two animation frames", () =>
      Effect.gen(function*() {
        const PaintMessage = UiSchema.TaggedEnum({
          Start: {},
          Painted: {}
        })
        const Enter = Html.component({
          name: "Enter",
          model: Schema.Literals(["idle", "starting", "shown"]),
          message: PaintMessage
        }).make({
          init: () => "idle" as const,
          update: {
            Start: ($) =>
              $.set("starting" as const).run(
                HtmlCommand.waitForPaint(() => PaintMessage.Painted())
              ),
            Painted: () => "shown" as const
          },
          view: (h, phase) => h.p(phase)
        })

        const root = yield* TestHost.mount(Enter, {})
        yield* TestHost.settle
        root.send(PaintMessage.Start())
        yield* TestHost.settle
        assert.strictEqual(root.model(), "starting")

        yield* TestAnimationFrames.fire(16)
        yield* TestHost.settle
        assert.strictEqual(root.model(), "starting")

        yield* TestAnimationFrames.fire(16)
        yield* TestHost.settle
        assert.strictEqual(root.model(), "shown")

        // A frame source may call back while `listen` registers.
        const eager = yield* TestHost.mount(Enter, {}).pipe(
          Effect.provideService(HtmlSubscription.AnimationFrames, {
            now: () => 0,
            listen: (listener) => {
              listener(0)
              return () => {}
            }
          })
        )
        yield* TestHost.settle
        eager.send(PaintMessage.Start())
        yield* TestHost.settle
        assert.strictEqual(eager.model(), "shown")
      }).pipe(
        Effect.provide(
          Layer.merge(TestHost.layer(), TestAnimationFrames.layer)
        ),
        Effect.scoped
      ))

    it.effect("HtmlCommand.waitForAnimations skips infinite animations, waits for a replacement after cancellation, and reports missing refs", () =>
      Effect.gen(function*() {
        const Panel = Html.ref("Panel", "div")
        const MissingPanel = Html.ref("MissingPanel", "div")
        const AnimMessage = UiSchema.TaggedEnum({
          Wait: { missing: Schema.Boolean },
          Settled: { found: Schema.Boolean }
        })
        const Drawer = Html.component({
          name: "Drawer",
          model: Schema.Array(Schema.String),
          message: AnimMessage
        }).make({
          init: (): ReadonlyArray<string> => [],
          update: {
            Wait: ($, { missing }) =>
              $.run(
                HtmlCommand.waitForAnimations(
                  missing ? MissingPanel : Panel,
                  ({ found }) => AnimMessage.Settled({ found })
                )
              ),
            Settled: ($, { found }) => [...$.model, `settled ${found}`]
          },
          view: (h) => h.div.attr("id", "anim-panel").ref(Panel)
        })

        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Drawer, {}, app)
        yield* tick

        root.send(AnimMessage.Wait({ missing: true }))
        yield* tick
        assert.deepStrictEqual(root.model(), ["settled false"])

        const panel = app.querySelector("#anim-panel")!
        const original = panel.getAnimations
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            panel.getAnimations = original
          })
        )

        // Infinite animations are ignored; a cancelled finite animation triggers a retry.
        const looping = {
          effect: { getComputedTiming: () => ({ endTime: Infinity }) },
          finished: new Promise(() => {})
        } as unknown as Animation
        let rejectFirst!: () => void
        let resolveSecond!: () => void
        const first = {
          effect: { getComputedTiming: () => ({ endTime: 150 }) },
          finished: new Promise<void>((_, reject) => {
            rejectFirst = () =>
              reject(new DOMException("cancelled", "AbortError"))
          })
        } as unknown as Animation
        const second = {
          effect: { getComputedTiming: () => ({ endTime: 150 }) },
          finished: new Promise<void>((resolve) => {
            resolveSecond = resolve
          })
        } as unknown as Animation

        let active: ReadonlyArray<Animation> = [looping, first]
        panel.getAnimations = () => [...active]

        root.send(AnimMessage.Wait({ missing: false }))
        yield* tick
        // Cancel the first animation and replace it with the second.
        active = [looping, second]
        rejectFirst()
        yield* tick
        assert.deepStrictEqual(root.model(), ["settled false"])

        resolveSecond()
        yield* tick
        assert.deepStrictEqual(root.model(), ["settled false", "settled true"])

        // Detaching the element cancels its animation: it settles without a frame.
        const raf = window.requestAnimationFrame
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            window.requestAnimationFrame = raf
          })
        )
        window.requestAnimationFrame = () => 0
        let rejectRemoved!: () => void
        active = [{
          effect: { getComputedTiming: () => ({ endTime: 150 }) },
          finished: new Promise<void>((_, reject) => {
            rejectRemoved = () =>
              reject(new DOMException("cancelled", "AbortError"))
          })
        } as unknown as Animation]
        root.send(AnimMessage.Wait({ missing: false }))
        yield* tick
        app.remove()
        rejectRemoved()
        yield* tick
        assert.strictEqual(root.model()?.length, 3)
      }).pipe(Effect.scoped))
  })

  describe("hosts", () => {
    it.effect("writes attributes under their HTML names, keeps SVG's case, and owns a form's submission", () =>
      Effect.gen(function*() {
        const Shapes = Html.component({
          name: "Shapes",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.form.attr("method", "dialog").children(
              h.el("div").attrs({ "Data-Kind": "box", "a b": "dropped" }),
              h.el("svg", h.el("rect").attr("viewBox", "0 0 1 1"))
            )
        })
        const app = yield* container
        yield* BrowserHost.mountEffect(Shapes, {}, app)
        assert.deepStrictEqual(
          Array.from(app.querySelector("div")!.attributes, (attr) => attr.name),
          ["data-kind"]
        )
        const rect = app.querySelector("rect")!
        assert.strictEqual(rect.namespaceURI, "http://www.w3.org/2000/svg")
        assert.strictEqual(rect.getAttribute("viewBox"), "0 0 1 1")
        const submit = new Event("submit", { bubbles: true, cancelable: true })
        app.querySelector("form")!.dispatchEvent(submit)
        assert.isTrue(submit.defaultPrevented)
      }).pipe(Effect.scoped))

    const Native: View.Vocabulary<Native> = {
      name: "native",
      tags: { view: new View.ElementBuilder("view") }
    }
    const NativeBox = Component.define({
      name: "NativeBox",
      model: Schema.Null,
      message: Schema.Never,
      elements: Native
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) => h.view
    })
    const Page = Html.component({
      name: "Page",
      model: Schema.Null,
      message: Schema.Never
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        h.div(
          h.p("before"),
          NativeBox(h, {
            key: "box",
            fallback: () => h.p("wrong host")
          }),
          h.p("after")
        )
    })

    it.effect("a nested component of another vocabulary fails as a child", () =>
      Effect.gen(function*() {
        const app = yield* container
        yield* BrowserHost.mountEffect(Page, {}, app)
        yield* tick
        expect(app.textContent).toBe("beforewrong hostafter")
      }).pipe(Effect.scoped))

    it.effect("closing the Scope removes the nodes and stops their events", () =>
      Effect.gen(function*() {
        const app = yield* container
        const scope = yield* Scope.make()
        const root = yield* BrowserHost.mountEffect(TodoApp, {}, app).pipe(
          Scope.provide(scope)
        )
        const field = HtmlLocator.getByRole(app, "textbox", {
          name: "New todo"
        })
        yield* Scope.close(scope, Exit.void)
        expect(app.childNodes.length).toBe(0)
        // A detached node from the old tree no longer reaches it.
        app.appendChild(field)
        HtmlLocator.type(field, "late")
        yield* tick
        expect(root.model()?.draft ?? "").toBe("")
      }).pipe(Effect.scoped))

    // collectGarbage uses Node's V8 flags, unavailable on Bun and Deno.
    it.effect.skipIf(
      process.versions.bun !== undefined || process.versions.deno !== undefined
    )(
      "a node the page keeps after the Scope closes doesn't keep the app alive",
      () =>
        Effect.gen(function*() {
          const app = yield* container
          const scope = yield* Scope.make()
          const model = yield* BrowserHost.mountEffect(TodoApp, {}, app).pipe(
            Effect.map((root) => new WeakRef(root.model()!)),
            Scope.provide(scope)
          )
          const field = HtmlLocator.getByRole(app, "textbox", {
            name: "New todo"
          })
          yield* Scope.close(scope, Exit.void)
          yield* collectGarbage
          expect(model.deref()).toBeUndefined()
          expect(field.isConnected).toBe(false)
        }).pipe(Effect.scoped)
    )

    it.effect.skipIf(
      process.versions.bun !== undefined || process.versions.deno !== undefined
    )(
      "a child the last event reached doesn't stay alive once it is removed",
      () =>
        Effect.gen(function*() {
          let model: WeakRef<object> | undefined
          const Item = Component.define({
            name: "Item",
            model: Schema.Struct({}),
            message: Schema.Null
          })
            .make({
              init: () => {
                const value = {}
                model = new WeakRef(value)
                return value
              },
              update: ($) => $.model,
              view: (h) => h.el("button").on("click", null).children("Item")
            })
          const Page = Component.define({
            name: "Page",
            model: Schema.Boolean,
            message: Schema.Null
          })
            .make({
              init: () => true,
              update: () => false,
              view: (h, shown) =>
                h.el(
                  "div",
                  h.text("Remove"),
                  shown ? Item(h, { key: "i" }) : null
                )
            })
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Page, {}, app)
          HtmlLocator.click(
            HtmlLocator.getByRole(app, "button", { name: "Item" })
          )
          yield* tick
          // Removed by a message, with no event after the one inside it.
          root.send(null)
          yield* tick
          expect(app.textContent).toBe("Remove")
          yield* collectGarbage
          expect(model!.deref()).toBeUndefined()
        }).pipe(Effect.scoped)
    )

    it.effect.skipIf(
      process.versions.bun !== undefined || process.versions.deno !== undefined
    )(
      "a root whose view fails keeps nothing of that view while it shows its fallback",
      () =>
        Effect.gen(function*() {
          let props: WeakRef<object> | undefined
          const Item = Component.define({
            name: "Item",
            props: Schema.Struct({}),
            model: Schema.Null,
            message: Schema.Never
          })
            .make({
              init: () => null,
              update: ($) => $.model,
              view: (h) => h.text("item")
            })
          const Broken = Component.define({
            name: "Broken",
            model: Schema.Null,
            message: Schema.Never
          })
            .make({
              init: () => null,
              update: ($) => $.model,
              view: (h) => {
                const value = {}
                props = new WeakRef(value)
                // Two elements with one key: the render fails once its child paths are checked.
                return h.el(
                  "div",
                  Item(h, { key: "i", props: value }),
                  h.el("p").key("k"),
                  h.el("p").key("k")
                )
              }
            })
          const app = yield* container
          yield* BrowserHost.mountEffect(Broken, {}, app, {
            fallback: (_, h) => h.text("failed")
          })
          yield* tick
          expect(app.textContent).toBe("failed")
          yield* collectGarbage
          expect(props!.deref()).toBeUndefined()
        }).pipe(Effect.scoped)
    )

    it.effect.skipIf(
      process.versions.bun !== undefined || process.versions.deno !== undefined
    )(
      "a mounted root doesn't retain events it emitted",
      () =>
        Effect.gen(function*() {
          const mounted: Array<WeakRef<object>> = []
          const updated: Array<WeakRef<object>> = []
          const sink: MessageLog.MessageLog = {
            enabled: true,
            record: (entry) => {
              if (entry._tag === "Mounted") {
                for (const event of entry.events) {
                  mounted.push(new WeakRef(event as object))
                }
              } else if (entry._tag === "Update") {
                for (const event of entry.events) {
                  updated.push(new WeakRef(event as object))
                }
              }
            }
          }
          const Events = UiSchema.TaggedEnum({
            Emitted: { payload: Schema.Array(Schema.Number) }
          })
          const Message = UiSchema.TaggedEnum({ Pressed: {} })
          const Emitter = Html.component({
            name: "Emitter",
            model: Schema.Number,
            message: Message,
            events: Events
          }).make({
            init: ($) => $.set(0).emit(Events.Emitted({ payload: [0] })),
            update: ($) =>
              $.set($.model + 1).emit(
                Events.Emitted({ payload: [$.model + 1] })
              ),
            view: (h, n) =>
              h.button.on("click", Message.Pressed()).children(String(n))
          })
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Emitter, {}, app).pipe(
            Effect.provideService(MessageLog.MessageLog, sink)
          )
          const button = HtmlLocator.getByRole(app, "button")
          for (let i = 0; i < 3; i++) {
            HtmlLocator.click(button)
            yield* tick
          }
          expect(root.model()).toBe(3)
          expect(mounted.length).toBe(1)
          expect(updated.length).toBe(3)
          yield* collectGarbage
          expect(
            [...mounted, ...updated].filter((ref) => ref.deref() !== undefined)
          ).toEqual([])
        }).pipe(Effect.scoped)
    )

    it.effect("mount is a Layer: the tree is live while it is built, and closing it removes the nodes", () =>
      Effect.gen(function*() {
        const app = yield* container
        const scope = yield* Scope.make()
        yield* Layer.buildWithScope(BrowserHost.mount(TodoApp, {}, app), scope)
        HtmlLocator.type(
          HtmlLocator.getByRole(app, "textbox", { name: "New todo" }),
          "Buy milk"
        )
        yield* tick
        HtmlLocator.click(HtmlLocator.getByRole(app, "button", { name: "Add" }))
        yield* tick
        const list = HtmlLocator.getByRole(app, "list", { name: "Todos" })
        expect(
          HtmlLocator.queryAllByRole(list, "listitem").map((item) =>
            item.textContent
          )
        ).toEqual(["Buy milk×"])
        yield* Scope.close(scope, Exit.void)
        expect(app.childNodes.length).toBe(0)
      }).pipe(Effect.scoped))
  })

  it.effect("a mount and a Subscription stopped by a close are interrupted by the fiber that closes", () =>
    Effect.gen(function*() {
      const interruptors: Array<ReadonlyArray<number>> = []
      const record = <A, E>(exit: Exit.Exit<A, E>) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) {
            interruptors.push([...Cause.interruptors(exit.cause)])
          }
        })
      const Held = Mount.make(
        "Held",
        { args: {} },
        () => Effect.onExit(Effect.never, record)
      )
      const Page = Html.component({
        name: "Page",
        model: Schema.Null,
        message: Schema.Never
      }).make({
        init: () => null,
        update: ($) => $.model,
        subscriptions: () => [
          Subscription.make("held", Stream.onExit(Stream.never, record))
        ],
        view: (h) => h.p.onMount(Held()).children("held")
      })
      const app = yield* container
      const scope = yield* Scope.make()
      yield* BrowserHost.mountEffect(Page, {}, app).pipe(Scope.provide(scope))
      yield* tick
      yield* Scope.close(scope, Exit.void)
      const closer = yield* Effect.fiberId
      expect(interruptors).toEqual([[closer], [closer]])
    }).pipe(Effect.scoped))

  it.effect("runs a mount's start, new args and release in the task that commits them", () =>
    Effect.gen(function*() {
      const log: Array<string> = []
      const Logged = Mount.make(
        "Logged",
        { args: { n: Schema.Number } },
        (_node, _args, changes) =>
          Effect.addFinalizer(() => Effect.sync(() => log.push("release")))
            .pipe(
              Effect.andThen(
                Stream.runForEach(
                  changes,
                  ({ n }) => Effect.sync(() => log.push(`args ${n}`))
                )
              ),
              Effect.as(Component.noop)
            )
      )
      const Page = Html.component({
        name: "Page",
        model: Schema.NullOr(Schema.Number),
        message: Schema.NullOr(Schema.Number)
      }).make({
        init: () => null,
        update: (_, message) => message,
        view: (h, n) =>
          n === null
            ? h.span("none")
            : h.p.onMount(Logged({ n })).children("held")
      })
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(Page, {}, app)
      yield* tick
      yield* Effect.promise(async () => {
        for (const message of [1, 2, null]) {
          root.send(message)
          await Promise.resolve()
        }
      })
      expect(log).toEqual(["args 1", "args 2", "release"])
    }).pipe(Effect.scoped, Effect.provide(HtmlScheduler.layer({ budget: 0 }))))

  it.effect(
    "renders once for the Commands of one flush that end together",
    () =>
      Effect.gen(function*() {
        const Message = UiSchema.TaggedEnum({ Loaded: {} })
        class Load extends Command.Service<Load>()(
          "Load",
          { args: { id: Schema.Number }, success: Message }
        ) {
          static readonly layer = this.toLayer(() =>
            Effect.succeed(Message.Loaded())
          )
        }
        let renders = 0
        const Page = Html.component({
          name: "Page",
          model: Schema.Number,
          message: Message
        }).make({
          init: ($) =>
            $.set(0).run(
              Load.make({ id: 1 }),
              Load.make({ id: 2 }),
              Load.make({ id: 3 })
            ),
          update: ($) => $.model + 1,
          view: (h, loaded) => {
            renders++
            return h.p(`${loaded} loaded`)
          }
        }).pipe(Component.provide(Load.layer))
        const app = yield* container
        yield* BrowserHost.mountEffect(Page, {}, app)
        yield* tick
        expect(app.textContent).toBe("3 loaded")
        expect(renders).toBe(2)
      }).pipe(Effect.scoped)
  )

  describe("inline style", () => {
    it.effect(
      "declarations written by onMount survive when a patch adds, changes, or removes the view's style, winning on shared properties",
      () =>
        Effect.gen(function*() {
          const Position = Mount.make(
            "Position",
            { args: {} },
            (element: HTMLElement) =>
              Effect.sync(() => {
                element.style.setProperty("left", "10px")
                element.style.setProperty("--available-width", "500px")
                element.style.setProperty("z-index", "9", "important")
                return Component.noop
              })
          )
          const Page = Html.component({
            name: "StyledPositioner",
            model: Schema.Number,
            message: Schema.Number
          }).make({
            init: () => 0,
            update: (_, next) => next,
            view: (h, step) => {
              const div = h.div.onMount(Position())
              return step === 0
                ? div
                : step === 1
                ? div.style({
                  inset: "auto",
                  "--available-width": "100vw",
                  color: "red",
                  zIndex: "1"
                })
                : step === 2
                ? div.style({
                  inset: "auto",
                  "--available-width": "100vw",
                  color: "blue",
                  zIndex: "2"
                })
                : div.style({})
            }
          })
          const app = yield* container
          const root = yield* BrowserHost.mountEffect(Page, {}, app)
          yield* tick
          const box = app.firstElementChild as HTMLElement
          const read = () => ({
            color: box.style.getPropertyValue("color"),
            left: box.style.getPropertyValue("left"),
            availableWidth: box.style.getPropertyValue("--available-width"),
            zIndex: box.style.getPropertyValue("z-index"),
            zPriority: box.style.getPropertyPriority("z-index")
          })

          root.send(1)
          yield* tick
          expect(read()).toEqual({
            color: "red",
            left: "10px",
            availableWidth: "500px",
            zIndex: "9",
            zPriority: "important"
          })

          root.send(2)
          yield* tick
          expect(read()).toEqual({
            color: "blue",
            left: "10px",
            availableWidth: "500px",
            zIndex: "9",
            zPriority: "important"
          })

          root.send(3)
          yield* tick
          expect(read()).toEqual({
            color: "",
            left: "10px",
            availableWidth: "500px",
            zIndex: "9",
            zPriority: "important"
          })
        }).pipe(Effect.scoped)
    )

    it.effect("an untouched element lets the later style alias win on mount and keeps the view's exact style text after a patch", () =>
      Effect.gen(function*() {
        const Page = Html.component({
          name: "UntouchedStyle",
          model: Schema.Boolean,
          message: Schema.Boolean
        }).make({
          init: () => false,
          update: (_, next) => next,
          view: (h, changed) =>
            changed
              ? h.div.attr("style", "color: blue; margin-top: 8px")
              : h.div.attrs({
                STYLE: "color: green",
                style: "color: red; margin-top: 4px"
              })
        })
        const app = yield* container
        const root = yield* BrowserHost.mountEffect(Page, {}, app)
        yield* tick
        const box = app.firstElementChild as HTMLElement
        expect(box.getAttribute("style")).toBe("color: red; margin-top: 4px")
        root.send(true)
        yield* tick
        expect(box.getAttribute("style")).toBe("color: blue; margin-top: 8px")
      }).pipe(Effect.scoped))

    it.effect("a hydration style mismatch replaces the server's style text", () =>
      Effect.gen(function*() {
        const Page = Html.component({
          name: "HydrateStyle",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) => h.div.attr("style", "color: blue")
        })
        const rendered = yield* HtmlServer.renderToHtml(Page, {})
        const app = yield* container
        app.innerHTML = rendered.html
        const box = app.firstElementChild as HTMLElement
        box.setAttribute("style", "color: red; font-weight: bold")
        yield* HtmlHydrate.hydrateEffect(Page, {}, app, rendered.state)
        yield* tick
        expect(box.getAttribute("style")).toBe("color: blue")
        expect(box.style.getPropertyValue("font-weight")).toBe("")
      }).pipe(Effect.scoped))
  })

  it.effect("mountEffect provides its browser Renderer and direct GlobalEvents/AnimationFrames to app effects", () =>
    Effect.gen(function*() {
      const Page = Html.component({
        name: "DirectContext",
        props: Schema.Struct({
          hasBrowserRenderer: Schema.Boolean,
          heard: Schema.Boolean
        }),
        model: Schema.Struct({
          hasBrowserRenderer: Schema.Boolean,
          heard: Schema.Boolean
        }),
        message: Schema.Never
      }).make({
        init: ($) => $.props,
        update: ($) => $.model,
        view: (h) => h.div()
      })
      const outer = TestHost.makeHost()
      const app = yield* container
      const root = yield* BrowserHost.mountEffect(
        Page,
        Effect.gen(function*() {
          const renderer = yield* Effect.serviceOption(Renderer.Renderer)
          const events = yield* HtmlSubscription.GlobalEvents
          let heard = false
          const off = events.listen(
            "document",
            "click",
            { capture: false },
            () => {
              heard = true
            }
          )
          app.ownerDocument.dispatchEvent(new MouseEvent("click"))
          off()
          return {
            hasBrowserRenderer: Option.isSome(renderer) &&
              renderer.value.host !== outer &&
              renderer.value.host.elements.includes(Html.name),
            heard
          }
        }),
        app
      ).pipe(Effect.provideService(Renderer.Renderer, { host: outer }))
      expect(root.model()).toEqual({ hasBrowserRenderer: true, heard: true })
    }).pipe(Effect.scoped))

  it.effect("renders a native slot in a shadow root and delivers slotchange", () =>
    Effect.gen(function*() {
      const Card = Html.component({
        name: "Card",
        model: Schema.Number,
        message: Schema.Literal("SlotChanged")
      }).make({
        init: () => 0,
        update: ($) => $.model + 1,
        view: (h) =>
          h.slot.attr("name", "title").on("slotchange", "SlotChanged")
      })
      const host = yield* container
      host.innerHTML = "<span slot=\"title\">Plan</span>"
      const shadow = host.attachShadow({ mode: "open" })
      const root = yield* BrowserHost.mountEffect(
        Card,
        {},
        shadow as unknown as Element
      )
      const slot = shadow.querySelector<HTMLSlotElement>("slot")!
      expect(slot.assignedElements()).toEqual([host.querySelector("span")])
      slot.dispatchEvent(new Event("slotchange", { bubbles: true }))
      yield* tick
      expect(root.model()).toBe(1)
    }).pipe(Effect.scoped))

  describe("defineElement", () => {
    it.effect("updates props from attributes and properties without resetting the Model", () =>
      Effect.gen(function*() {
        const TourForm = Html.component({
          name: "TourForm",
          props: Schema.Struct({
            unitId: Schema.String,
            compact: Schema.Boolean
          }),
          model: Schema.Number,
          message: Schema.Literal("Bump")
        }).make({
          init: () => 0,
          update: ($) => $.model + 1,
          head: () => [Head.title("Widget title")],
          view: (h, count) =>
            h.div(
              h.span(`${h.props.unitId}:${h.props.compact}:${count}`),
              h.button.on("click", "Bump").children("Bump")
            )
        })
        const titleBefore = document.title
        const app = yield* container
        app.innerHTML = `<ce-tour-form unit-id="u1">Loading</ce-tour-form>`
        const element = app.querySelector("ce-tour-form") as HTMLElement & {
          unitId: string
          compact: boolean
        }
        element.compact = true

        yield* Layer.build(
          BrowserHost.defineElement("ce-tour-form", TourForm, {
            props: { unitId: "", compact: false },
            attributes: { unitId: Schema.String }
          })
        )

        expect(element.querySelector("span")!.textContent).toBe("u1:true:0")
        expect(element.textContent).not.toContain("Loading")

        element.querySelector("button")!.click()
        yield* tick
        expect(element.querySelector("span")!.textContent).toBe("u1:true:1")

        element.setAttribute("unit-id", "u2")
        yield* tick
        expect(element.querySelector("span")!.textContent).toBe("u2:true:1")

        element.compact = false
        yield* tick
        expect(element.querySelector("span")!.textContent).toBe("u2:false:1")

        element.removeAttribute("unit-id")
        yield* tick
        expect(element.querySelector("span")!.textContent).toBe(":false:1")
        expect(document.title).toBe(titleBefore)
      }).pipe(Effect.scoped))

    it.effect("dispatches tagged emissions as bubbling composed CustomEvents from a shadow root with styles", () =>
      Effect.gen(function*() {
        const Events = UiSchema.TaggedEnum({
          TourBooked: { unitId: Schema.String }
        })
        const ShadowTour = Html.component({
          name: "ShadowTour",
          props: Schema.Struct({ unitId: Schema.String }),
          model: Schema.Null,
          message: Schema.Literal("Book"),
          events: Events
        }).make({
          init: () => null,
          update: ($) => $.emit(Events.TourBooked({ unitId: $.props.unitId })),
          view: (h) => h.button.on("click", "Book").children("Book")
        })

        yield* Layer.build(
          BrowserHost.defineElement("ce-shadow-tour", ShadowTour, {
            props: { unitId: "" },
            attributes: { unitId: Schema.String },
            shadow: { mode: "open", styles: [".tour { color: red; }"] }
          })
        )

        const app = yield* container
        const received: Array<CustomEvent> = []
        app.addEventListener("tourbooked", (event) => {
          received.push(event as CustomEvent)
        })
        const element = document.createElement("ce-shadow-tour")
        element.setAttribute("unit-id", "u9")
        app.appendChild(element)

        expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(1)

        element.shadowRoot!.querySelector("button")!.click()
        expect(received).toHaveLength(1)
        expect(received[0]!.composed).toBe(true)
        expect(received[0]!.detail).toEqual(Events.TourBooked({ unitId: "u9" }))
      }).pipe(Effect.scoped))

    it.effect("keeps Model across a synchronous move and closes its scope on removal or layer release", () =>
      Effect.gen(function*() {
        class Prefix extends Context.Service<Prefix, string>()("CePrefix") {}
        let prefix: string | undefined
        let closed = 0
        const Track = Mount.make(
          "CeTrack",
          { args: {} },
          () =>
            Effect.gen(function*() {
              prefix = yield* Prefix
              return yield* Effect.onExit(Effect.never, () =>
                Effect.sync(() => {
                  closed++
                }))
            })
        )
        const Counter = Html.component({
          name: "CeCounter",
          model: Schema.Number,
          message: Schema.Literal("Bump")
        }).make({
          init: () => 0,
          update: ($) => $.model + 1,
          view: (h, count) =>
            h.div.onMount(Track()).children(
              h.span(String(count)),
              h.button.on("click", "Bump").children("Bump")
            )
        })

        const layerScope = yield* Scope.make()
        yield* Layer.buildWithScope(
          BrowserHost.defineElement("ce-counter", Counter, {
            props: {}
          }).pipe(Layer.provide(Layer.succeed(Prefix, "ok"))),
          layerScope
        )

        const firstParent = yield* container
        const secondParent = yield* container
        const first = document.createElement("ce-counter")
        firstParent.appendChild(first)
        yield* tick

        expect(prefix).toBe("ok")
        first.querySelector("button")!.click()
        yield* tick

        secondParent.appendChild(first)
        yield* tick
        expect(first.querySelector("span")!.textContent).toBe("1")
        expect(closed).toBe(0)

        first.remove()
        yield* tick
        expect(closed).toBe(1)

        const second = document.createElement("ce-counter")
        secondParent.appendChild(second)
        yield* tick
        yield* Scope.close(layerScope, Exit.void)
        expect(closed).toBe(2)
      }).pipe(Effect.scoped))

    it.effect.skipIf(
      process.versions.bun !== undefined || process.versions.deno !== undefined
    )(
      "a released element keeps neither its Model nor the Layer's services, and decodes nothing",
      () =>
        Effect.gen(function*() {
          class Api extends Context.Service<Api, object>()("CeApi") {}
          let model: WeakRef<object> | undefined
          let api: WeakRef<object> | undefined
          let decoded = 0
          const Label = Html.component({
            name: "CeLabel",
            props: Schema.Struct({ text: Schema.String }),
            model: Schema.Struct({}),
            message: Schema.Never
          }).make({
            init: () => {
              const value = {}
              model = new WeakRef(value)
              return value
            },
            update: ($) => $.model,
            view: (h) => h.label.id(h.id("label")).children(h.props.text)
          })
          const text = Schema.String.check(
            Schema.makeFilter(() => (decoded++, true))
          )
          const define = (tag: string) =>
            BrowserHost.defineElement(tag, Label, {
              props: { text: "" },
              attributes: { text }
            })
          const layerScope = yield* Scope.make()
          yield* Layer.buildWithScope(
            Layer.mergeAll(define("ce-label-a"), define("ce-label-b")).pipe(
              Layer.provide(
                Layer.sync(Api)(() => {
                  const value = {}
                  api = new WeakRef(value)
                  return value
                })
              )
            ),
            layerScope
          )
          const app = yield* container
          app.innerHTML = "<ce-label-a></ce-label-a><ce-label-b></ce-label-b>"
          const [a, b] = app.querySelectorAll("label")
          expect(a!.id).not.toBe(b!.id)

          yield* Scope.close(layerScope, Exit.void)
          app.firstElementChild!.setAttribute("text", "x")
          expect(decoded).toBe(0)
          yield* collectGarbage
          expect(model!.deref()).toBeUndefined()
          expect(api!.deref()).toBeUndefined()
        }).pipe(Effect.scoped)
    )
  })
})

describe("BrowserCase", { concurrent: false }, () => {
  it.effect("mounts from the case's model, or sends its messages with its layer", () =>
    Effect.gen(function*() {
      const Msg = UiSchema.TaggedEnum({ ClickedSave: {}, CompletedSave: {} })
      class SaveTodo extends Command.Service<SaveTodo>()(
        "BrowserCase/SaveTodo",
        { args: {}, success: Msg }
      ) {}
      const TodoItem = Html.component({
        name: "TodoItem",
        model: Schema.Struct({ saved: Schema.Boolean }),
        message: Msg
      }).make({
        init: () => ({ saved: false }),
        update: ($, message) =>
          Msg.match(message, {
            ClickedSave: () => $.run(SaveTodo.make({})),
            CompletedSave: () => ({ saved: true })
          }),
        view: (h, model) => h.p(model.saved ? "saved" : "save")
      })
      const layer = SaveTodo.toLayer(() => Effect.succeed(Msg.CompletedSave()))
      const cases = Case.make(TodoItem, {
        saved: { model: { saved: true }, layer },
        replayed: { messages: [Msg.ClickedSave()], layer }
      })

      const app = yield* container
      yield* BrowserCase.mount(cases.saved, app)
      expect(app.textContent).toBe("saved")

      const app2 = yield* container
      yield* BrowserCase.mount(cases.replayed, app2)
      yield* tick
      expect(app2.textContent).toBe("saved")
    }).pipe(Effect.scoped))
})
