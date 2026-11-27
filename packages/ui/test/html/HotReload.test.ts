// @vitest-environment happy-dom
import {
  Command,
  Component,
  Route,
  Router,
  UiSchema,
  type View
} from "@effect/ui"
import {
  BrowserHost,
  BrowserRouter,
  Html,
  HtmlHydrate,
  HtmlServer
} from "@effect/ui/html"
import { assert, describe, it, vi } from "@effect/vitest"
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
  SchemaGetter,
  Scope
} from "effect"

const hotKey = Symbol.for("@effect/ui/hot")
const swapKey = Symbol.for("@effect/ui/hot/swap")

type Exports = Record<string, unknown>

const hotSwap = (first: Exports, next: Exports): boolean =>
  (window as unknown as Record<
    symbol,
    (first: Exports, next: Exports, names: ReadonlyArray<string>) => boolean
  >)[swapKey](first, next, Object.keys(next))

const triggerHotSave = () =>
  (window as unknown as Record<symbol, (() => void) | undefined>)[hotKey]?.()

const tick = Effect.promise(() =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
)

const inContainer = <A, E, R>(
  id: string | undefined,
  body: (container: HTMLDivElement) => Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const div = document.createElement("div")
      if (id !== undefined) div.id = id
      document.body.appendChild(div)
      return div
    }),
    body,
    (div) => Effect.sync(() => div.remove())
  ).pipe(Effect.scoped)

const captureWarnings = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const warnings: Array<string> = []
    const original = console.warn
    console.warn = (...args: ReadonlyArray<unknown>) => {
      warnings.push(args.map(String).join(" "))
    }
    return effect.pipe(
      Effect.map((value) => ({ value, warnings })),
      Effect.ensuring(Effect.sync(() => {
        console.warn = original
      }))
    )
  })

describe("hot reload", { concurrent: false }, () => {
  it.live(
    "preserves compatible state (restore, keepAlive, preloaded lazy), isolates container IDs, survives broken reload, and resets on manual refresh",
    () =>
      Effect.gen(function*() {
        sessionStorage.clear()
        const Msg = UiSchema.TaggedEnum({ Inc: {}, Fill: {}, Hide: {} })
        const Login = Html.component({
          name: "Login",
          model: Schema.Struct({
            email: Schema.String,
            password: Schema.String
          }),
          message: Msg,
          restore: (model) => ({ ...model, password: "" })
        }).make({
          init: () => ({ email: "", password: "" }),
          update: () => ({ email: "ada@example.com", password: "secret" }),
          view: (h, model) =>
            h.button.on("click", Msg.Fill()).children(
              `${model.email}|${model.password}`
            )
        })
        const counter = (name: string, restore?: false) =>
          Html.component({
            name,
            model: Schema.Number,
            message: Msg,
            restore
          }).make({
            init: () => 0,
            update: ($) => $.model + 1,
            view: (h, count) =>
              h.button.on("click", Msg.Inc()).children(`${name}=${count}`)
          })
        const Ephemeral = counter("ephemeral", false)
        const Kept = counter("kept")
        const LazyTarget = counter("lazy")
        const LazyChild = Component.lazy(
          "lazy",
          () => Promise.resolve(LazyTarget)
        )
        yield* Effect.promise(() => LazyChild.preload())
        const App = Html.component({
          name: "App",
          model: Schema.Struct({ count: Schema.Number, shown: Schema.Boolean }),
          message: Msg
        }).make({
          init: () => ({ count: 0, shown: true }),
          update: ($, msg) =>
            Msg.match(msg, {
              Inc: () => ({ ...$.model, count: $.model.count + 1 }),
              Fill: () => $.model,
              Hide: () => ({ ...$.model, shown: !$.model.shown })
            }),
          view: (h, model) =>
            h.div(
              h.span(`count=${model.count}`),
              Login(h, { key: "login" }),
              Ephemeral(h, { key: "ephemeral" }),
              LazyChild(h, { key: "l", fallback: () => h.span("loading") }),
              model.shown ? h.keepAlive((s) => Kept(s, { key: "kept" })) : null
            )
        })

        yield* inContainer("app", (el) =>
          Effect.gen(function*() {
            const root = yield* BrowserHost.mountEffect(App, {}, el)
            root.send(Msg.Inc())
            root.send(Msg.Inc())
            for (const button of el.querySelectorAll("button")) button.click()
            root.send(Msg.Hide())
            yield* tick
            assert.include(el.textContent ?? "", "count=2")
            assert.include(el.textContent ?? "", "ada@example.com|secret")
            assert.include(el.textContent ?? "", "ephemeral=1")
            assert.include(el.textContent ?? "", "lazy=1")
            triggerHotSave()
          }))

        triggerHotSave()

        yield* inContainer("other", (other) =>
          inContainer(undefined, (anon) =>
            inContainer("app", (el) =>
              Effect.gen(function*() {
                yield* BrowserHost.mountEffect(App, {}, other)
                yield* BrowserHost.mountEffect(App, {}, anon)
                const root = yield* BrowserHost.mountEffect(App, {}, el)
                yield* tick
                assert.include(other.textContent ?? "", "count=0")
                assert.include(anon.textContent ?? "", "count=0")
                assert.include(el.textContent ?? "", "count=2")
                assert.include(el.textContent ?? "", "ada@example.com|")
                assert.notInclude(el.textContent ?? "", "secret")
                assert.include(el.textContent ?? "", "ephemeral=0")
                assert.include(el.textContent ?? "", "lazy=1")
                root.send(Msg.Hide())
                yield* tick
                assert.include(el.textContent ?? "", "kept=1")
              }))))

        yield* inContainer("app", (el) =>
          Effect.gen(function*() {
            yield* BrowserHost.mountEffect(App, {}, el)
            yield* tick
            assert.include(el.textContent ?? "", "count=0")
            assert.include(el.textContent ?? "", "lazy=0")
            assert.include(el.textContent ?? "", "kept=0")
          }))
      })
  )

  it.live(
    "warns on incompatible edits, Schema.Redacted, and interrupted Commands while keeping compatible siblings",
    () =>
      Effect.gen(function*() {
        sessionStorage.clear()
        const gate = yield* Deferred.make<void>()
        class SlowWork extends Command.Service<SlowWork>()(
          "test/SlowWork",
          { args: {}, success: Schema.Void }
        ) {
          static readonly layer = this.toLayer(() => Deferred.await(gate))
        }
        const Msg = UiSchema.TaggedEnum({ Bump: {}, Start: {}, Done: {} })
        const makeParent = <M, E>(
          childModel: Schema.Codec<M, E>,
          childInit: M
        ) => {
          const Child = Html.component({
            name: "Child",
            model: childModel,
            message: Msg
          }).make({
            init: () => childInit,
            update: ($) => $.model,
            view: (h, value) => h.span(`child=${String(value)}`)
          })
          const Secret = Html.component({
            name: "Secret",
            model: Schema.Struct({ token: Schema.Redacted(Schema.String) }),
            message: Msg
          }).make({
            init: () => ({ token: Redacted.make("tok_123") }),
            update: ($) => $.model,
            view: (h) => h.span("secret")
          })
          return Html.component({
            name: "Parent",
            model: Schema.Number,
            message: Msg
          }).make({
            init: () => 0,
            update: ($, msg) =>
              Msg.match(msg, {
                Bump: () => $.model + 1,
                Start: () =>
                  $.run(SlowWork.make({}).pipe(Command.map(() => Msg.Done()))),
                Done: () => $.model
              }),
            view: (h, count) =>
              h.div(
                h.span(`parent=${count}`),
                Child(h, { key: "c" }),
                Secret(h, { key: "s" })
              )
          })
        }

        const ParentV1 = makeParent(Schema.Number, 7)
        const ParentV2 = makeParent(Schema.String, "fresh")

        yield* inContainer("warn-app", (el) =>
          Effect.gen(function*() {
            const root = yield* BrowserHost.mountEffect(ParentV1, {}, el).pipe(
              Effect.provide(SlowWork.layer)
            )
            root.send(Msg.Bump())
            root.send(Msg.Bump())
            root.send(Msg.Start())
            yield* tick
            triggerHotSave()
          }))

        assert.notInclude(
          sessionStorage.getItem("@effect/ui/hot") ?? "",
          "tok_123"
        )

        const { warnings } = yield* captureWarnings(
          inContainer("warn-app", (el) =>
            Effect.gen(function*() {
              yield* BrowserHost.mountEffect(ParentV2, {}, el).pipe(
                Effect.provide(SlowWork.layer)
              )
              yield* tick
              assert.include(el.textContent ?? "", "parent=2")
              assert.include(el.textContent ?? "", "child=fresh")
            }))
        )

        const joined = warnings.join("\n")
        assert.include(joined, "/Parent/Child[c] restarted from init")
        assert.include(joined, "Schema.Redacted")
        assert.include(joined, "interrupted in-flight Commands")
        assert.include(joined, "test/SlowWork")
      })
  )

  it.live(
    "overrides HtmlHydrate server HTML on hot reload without duplicating nodes",
    () =>
      Effect.gen(function*() {
        sessionStorage.clear()
        const Msg = UiSchema.TaggedEnum({ Inc: {} })
        const Counter = Html.component({
          name: "HydratedCounter",
          model: Schema.Number,
          message: Msg
        }).make({
          init: () => 0,
          update: ($) => $.model + 1,
          view: (h, count) => h.p(`count=${count}`)
        })

        const rendered = yield* HtmlServer.renderToHtml(Counter, {})

        yield* inContainer("ssr", (el) =>
          Effect.gen(function*() {
            const root = yield* BrowserHost.mountEffect(Counter, {}, el)
            root.send(Msg.Inc())
            root.send(Msg.Inc())
            yield* tick
            assert.strictEqual(el.textContent, "count=2")
            triggerHotSave()
          }))

        yield* inContainer("ssr", (el) =>
          Effect.gen(function*() {
            el.innerHTML = rendered.html
            const root = yield* HtmlHydrate.hydrateEffect(
              Counter,
              {},
              el,
              rendered.state
            )
            yield* root.adopted
            yield* tick
            assert.strictEqual(el.textContent, "count=2")
            assert.strictEqual(el.querySelectorAll("p").length, 1)
          }))
      })
  )

  it.live("keeps the server HTML when props don't decode with a hot snapshot pending", () =>
    Effect.gen(function*() {
      sessionStorage.clear()
      const Shown = Html.component({
        name: "HotProps",
        props: Schema.Struct({ text: Schema.String }),
        model: Schema.Null,
        message: Schema.Never
      }).make({
        init: () => null,
        update: ($) => $.model,
        view: (h) => h.p(h.props.text)
      })
      const rendered = yield* HtmlServer.renderToHtml(Shown, { text: "server" })
      yield* inContainer("props", (el) =>
        Effect.andThen(
          BrowserHost.mountEffect(Shown, { text: "client" }, el),
          Effect.sync(triggerHotSave)
        ))
      yield* inContainer("props", (el) =>
        Effect.gen(function*() {
          el.innerHTML = rendered.html
          // Rendered without includeProps, so decodeProps fails.
          const error = yield* Effect.flip(
            HtmlHydrate.hydrateEffect(
              Shown,
              HtmlHydrate.decodeProps(Shown, rendered.state),
              el,
              rendered.state
            )
          )
          assert.isTrue(Schema.isSchemaError(error))
          assert.strictEqual(el.innerHTML, rendered.html)
        }))
    }))

  it.live(
    "preserves compatible descendants under an async-decoding parent whether its decode succeeds or fails",
    () =>
      Effect.gen(function*() {
        sessionStorage.clear()
        const Msg = UiSchema.TaggedEnum({ Set: { text: Schema.String } })
        const Field = Html.component({
          name: "Field",
          model: Schema.String,
          message: Msg
        }).make({
          init: () => "init-field",
          update: (_, msg) => msg.text,
          view: (h, text) =>
            h.button.on("click", Msg.Set({ text: "typed" })).children(
              `field=${text}`
            )
        })
        const makeAsyncHost = <M, E>(
          parentSchema: Schema.Codec<M, E>,
          parentInit: M
        ) => {
          const AsyncParent = Html.component({
            name: "AsyncParent",
            model: parentSchema,
            message: Schema.Never
          }).make({
            init: () => parentInit,
            update: ($) => $.model,
            view: (h, value) =>
              h.div(
                h.span(`parent=${String(value)}`),
                Field(h, { key: "f" })
              )
          })
          return Html.component({
            name: "AsyncRoot",
            model: Schema.Null,
            message: Schema.Never
          }).make({
            init: () => null,
            update: ($) => $.model,
            view: (h) => h.div(AsyncParent(h, { key: "p" }))
          })
        }

        const delayed = <M, E>(schema: Schema.Codec<M, E>) =>
          schema.pipe(Schema.decode({
            decode: SchemaGetter.transformEffect((value: M) =>
              Effect.as(Effect.sleep("15 millis"), value)
            ),
            encode: SchemaGetter.passthrough()
          }))

        const V1 = makeAsyncHost(delayed(Schema.String), "saved-parent")
        const V2Incompatible = makeAsyncHost(delayed(Schema.Number), 99)

        yield* inContainer("async-app", (el) =>
          Effect.gen(function*() {
            yield* BrowserHost.mountEffect(V1, {}, el)
            yield* tick
            el.querySelector("button")!.click()
            yield* tick
            assert.include(el.textContent ?? "", "field=typed")
            triggerHotSave()
          }))

        yield* inContainer("async-app", (el) =>
          Effect.gen(function*() {
            yield* BrowserHost.mountEffect(V1, {}, el)
            yield* Effect.sleep("40 millis")
            assert.include(el.textContent ?? "", "parent=saved-parent")
            assert.include(el.textContent ?? "", "field=typed")
            triggerHotSave()
          }))

        const { warnings } = yield* captureWarnings(
          inContainer("async-app", (el) =>
            Effect.gen(function*() {
              yield* BrowserHost.mountEffect(V2Incompatible, {}, el)
              yield* Effect.sleep("40 millis")
              assert.include(el.textContent ?? "", "parent=99")
              assert.include(el.textContent ?? "", "field=typed")
            }))
        )
        assert.include(
          warnings.join("\n"),
          "/AsyncRoot/AsyncParent[p] restarted from init"
        )
      })
  )

  it.live(
    "prefers hot snapshot over BrowserRouter history.state and does not leak stale history state onto a later route",
    () =>
      Effect.gen(function*() {
        sessionStorage.clear()
        window.history.replaceState(null, "", "/")
        const AppRoute = Route.union({
          Home: Route.make("/"),
          Next: Route.make("/next")
        })
        const ChildMsg = UiSchema.TaggedEnum({ Set: { text: Schema.String } })
        const Draft = Html.component({
          name: "Draft",
          model: Schema.String,
          message: ChildMsg
        }).make({
          init: () => "init",
          update: (_, msg) => msg.text,
          view: (h, text) =>
            h.div(
              h.span(`draft=${text}`),
              h.button.on("click", ChildMsg.Set({ text: "history" })).children(
                "set-history"
              ),
              h.button.on("click", ChildMsg.Set({ text: "hot" })).children(
                "set-hot"
              )
            )
        })
        const AppMsg = UiSchema.TaggedEnum({
          ChangedRoute: { route: AppRoute },
          Toggle: {},
          Go: { route: AppRoute }
        })
        const App = Html.component({
          name: "HistoryLeakApp",
          props: Schema.Struct({ route: AppRoute }),
          model: Schema.Struct({ route: AppRoute, shown: Schema.Boolean }),
          message: AppMsg
        }).make({
          init: ($) => ({ route: $.props.route, shown: true }),
          update: ($, msg) =>
            AppMsg.match(msg, {
              ChangedRoute: ({ route }) => ({ route, shown: true }),
              Toggle: () => ({ ...$.model, shown: !$.model.shown }),
              Go: ({ route }) =>
                $.run(Router.push(AppRoute, route).pipe(Command.asNoop))
            }),
          subscriptions: ({ model }) => [
            Router.subscription(
              AppRoute,
              model.route,
              (route) => AppMsg.ChangedRoute({ route })
            )
          ],
          view: (h, model) =>
            h.div(model.shown ? Draft(h, { key: "shared" }) : null)
        })

        yield* inContainer("leak-app", (el) =>
          Effect.gen(function*() {
            const root = yield* BrowserHost.mountEffect(
              App,
              Router.props(AppRoute),
              el
            )
            yield* tick
            el.querySelectorAll("button")[0]!.click()
            yield* tick
            assert.include(el.textContent ?? "", "draft=history")
            root.send(AppMsg.Go({ route: AppRoute.Next() }))
            yield* tick
            window.history.back()
            yield* Effect.sleep("20 millis")
            el.querySelectorAll("button")[1]!.click()
            yield* tick
            assert.include(el.textContent ?? "", "draft=hot")
            triggerHotSave()
          }).pipe(Effect.provide(BrowserRouter.layer({ routes: AppRoute }))))

        yield* inContainer("leak-app", (el) =>
          Effect.gen(function*() {
            const root = yield* BrowserHost.mountEffect(
              App,
              Router.props(AppRoute),
              el
            )
            yield* tick
            assert.include(el.textContent ?? "", "draft=hot")
            root.send(AppMsg.Toggle())
            yield* tick
            root.send(AppMsg.Go({ route: AppRoute.Next() }))
            yield* tick
            assert.include(el.textContent ?? "", "draft=init")
          }).pipe(Effect.provide(BrowserRouter.layer({ routes: AppRoute }))))
      })
  )

  it.live("does not replay init Commands on hot reload adoption", () =>
    Effect.gen(function*() {
      sessionStorage.clear()
      let runs = 0
      const PickApple = Command.make(
        "test/PickApple",
        { args: {} },
        () => Effect.sync(() => ++runs * 10)
      )
      const Msg = UiSchema.TaggedEnum({ Picked: { apple: Schema.Number } })
      const Game = Html.component({
        name: "InitCommandGame",
        model: Schema.Number,
        message: Msg
      }).make({
        init: ($) =>
          $.set(0).run(
            PickApple.make({}).pipe(
              Command.map((apple) => Msg.Picked({ apple }))
            )
          ),
        update: (_, { apple }) => apple,
        view: (h, apple) => h.span(`apple=${apple}`)
      })

      yield* inContainer("init-cmd", (el) =>
        Effect.gen(function*() {
          yield* BrowserHost.mountEffect(Game, {}, el)
          yield* tick
          assert.strictEqual(el.textContent, "apple=10")
          triggerHotSave()
        }))

      yield* inContainer("init-cmd", (el) =>
        Effect.gen(function*() {
          yield* BrowserHost.mountEffect(Game, {}, el)
          yield* tick
          assert.strictEqual(runs, 1)
          assert.strictEqual(el.textContent, "apple=10")
        }))
    }))

  it.live("updates a component in a template's content slot in place", () =>
    Effect.gen(function*() {
      sessionStorage.clear()
      const Msg = UiSchema.TaggedEnum({ Inc: {} })
      type Msg = typeof Msg.Type
      const counter = (label: string) =>
        Html.component({ name: "Counter", model: Schema.Number, message: Msg })
          .make({
            init: () => 0,
            update: ($) => $.model + 1,
            view: (h, count) =>
              h.button.on("click", Msg.Inc()).children(`${label}=${count}`)
          })
      // One template for both versions of App, as a module the edit didn't
      // touch keeps it.
      const Frame = Html.template<Msg, {
        readonly title: string
        readonly body: ReadonlyArray<View.Node<Msg>>
      }>((h, $) =>
        h.div.children(h.span.children($.title), h.section.children($.body))
      )
      const app = (child: typeof Counter) =>
        Html.component({ name: "App", model: Schema.Number, message: Msg })
          .make({
            init: () => 0,
            update: ($) => $.model,
            view: (h) => Frame({ title: "app", body: [child(h, { key: "c" })] })
          })
      const Counter = counter("a")
      const first = { App: app(Counter), Counter }

      yield* inContainer("template-swap", (el) =>
        Effect.gen(function*() {
          yield* BrowserHost.mountEffect(first.App, {}, el)
          const button = el.querySelector("button")!
          button.click()
          yield* tick
          assert.strictEqual(el.textContent, "appa=1")

          const Edited = counter("b")
          assert.isTrue(
            hotSwap(first, { App: app(Edited), Counter: Edited })
          )
          yield* tick
          assert.strictEqual(el.textContent, "appb=1")
          assert.strictEqual(el.querySelector("button"), button)
        }))
    }))

  it.live("updates mounted components in place, or refuses", () =>
    Effect.gen(function*() {
      sessionStorage.clear()
      const Msg = UiSchema.TaggedEnum({ Inc: {} })
      const counter = (label: string) =>
        Html.component({ name: "Counter", model: Schema.Number, message: Msg })
          .make({
            init: () => 0,
            update: ($) => $.model + 1,
            view: (h, count) =>
              h.button.on("click", Msg.Inc()).children(`${label}=${count}`)
          })
      const fixed = (name: string, text: () => string) =>
        Html.component({ name, model: Schema.Number, message: Msg }).make({
          init: () => 0,
          update: ($) => $.model,
          view: (h) => h.i(text())
        })
      const Row = fixed("Row", () => "row")
      const Broken = fixed("Broken", () => {
        throw new Error("broken")
      })
      const Pending = Component.lazy(
        "Pending",
        () => new Promise<typeof Row>(() => {})
      )
      const Counter = counter("a")
      const app = (
        label: string,
        child: typeof Counter,
        row = Row,
        wrap = false
      ) =>
        Html.component({ name: "App", model: Schema.Number, message: Msg })
          .make({
            init: () => 0,
            update: ($) => $.model + 1,
            view: (h, count) =>
              h.div(
                h.span(`${label}=${count}`),
                wrap
                  ? h.section(child(h, { key: "c" }))
                  : child(h, { key: "c" }),
                row(h, { key: "r" }),
                Broken(h, { key: "b", fallback: () => h.i("failed") }),
                h.keepAlive((s) =>
                  Pending(s, { key: "p", fallback: () => s.i("loading") })
                )
              )
          })
      const first = { App: app("app", Counter), Counter }

      yield* inContainer("swap", (el) =>
        Effect.gen(function*() {
          const root = yield* BrowserHost.mountEffect(first.App, {}, el)
          root.send(Msg.Inc())
          const button = el.querySelector("button")!
          button.click()
          yield* tick
          assert.strictEqual(el.textContent, "app=1a=1rowfailedloading")

          const Edited = counter("b")
          assert.isTrue(
            hotSwap(first, { App: app("edited", Edited), Counter: Edited })
          )
          assert.isTrue(hotSwap(first, { App: app("edited2", Edited) }))
          yield* tick
          assert.strictEqual(el.textContent, "edited2=1b=1rowfailedloading")
          assert.strictEqual(el.querySelector("button"), button)
          button.click()
          yield* tick
          assert.strictEqual(el.textContent, "edited2=1b=2rowfailedloading")

          const Text = Html.component({
            name: "Counter",
            model: Schema.String,
            message: Msg
          }).make({
            init: () => "",
            update: ($) => $.model,
            view: (h) => h.b()
          })
          assert.isFalse(hotSwap(first, { Counter: Text }))
          assert.isFalse(
            hotSwap(first, {
              Counter: counter("c").pipe(Component.provide(Layer.empty))
            })
          )
          // A re-run module makes its unexported Row again.
          assert.isFalse(
            hotSwap(first, { App: app("c", Counter, fixed("Row", () => "")) })
          )
          // A child wrapped in a new element would be made again.
          assert.isFalse(hotSwap(first, { App: app("c", Counter, Row, true) }))
          // A failed child takes its fix by reload.
          assert.isFalse(
            hotSwap({ Broken }, { Broken: fixed("Broken", () => "fixed") })
          )
          yield* tick
          assert.strictEqual(el.textContent, "edited2=1b=2rowfailedloading")

          // The save skips the kept lazy child that is still loading.
          triggerHotSave()
        }))

      yield* inContainer("swap", (el) =>
        Effect.gen(function*() {
          yield* BrowserHost.mountEffect(first.App, {}, el)
          yield* tick
          assert.strictEqual(el.textContent, "edited2=1b=2rowfailedloading")
        }))

      // A fallback on show that holds a child is drawn again, child included.
      const shell = (label: string) =>
        Html.component({ name: "Shell", model: Schema.Number, message: Msg })
          .make({
            init: () => 0,
            update: ($) => $.model,
            view: (h) =>
              h.div(
                h.span(label),
                Broken(h, { key: "b", fallback: () => Row(h, { key: "r" }) })
              )
          })
      const Shell = shell("a")
      yield* inContainer("swap-fallback", (el) =>
        Effect.gen(function*() {
          yield* BrowserHost.mountEffect(Shell, {}, el)
          yield* tick
          assert.strictEqual(el.textContent, "arow")
          assert.isFalse(hotSwap({ Shell }, { Shell: shell("b") }))
        }))
    }))

  it.live("gives the hot hooks to the copy that still has mounted roots", () =>
    Effect.gen(function*() {
      const app = (html: typeof Html, name: string) =>
        html.component({ name, model: Schema.Number, message: Schema.Never })
          .make({
            init: () => 1,
            update: ($) => $.model,
            view: (h) => h.p("x")
          })
      const saved = () => {
        sessionStorage.clear()
        triggerHotSave()
        return sessionStorage.getItem("@effect/ui/hot") ?? ""
      }
      vi.resetModules()
      const [Host, Html2] = yield* Effect.promise(() =>
        Promise.all([
          import("@effect/ui/html/BrowserHost"),
          import("@effect/ui/html/Html")
        ])
      )
      yield* inContainer(
        "copy-a",
        (a) =>
          inContainer("copy-b", (b) =>
            Effect.gen(function*() {
              // Closes A if an assertion fails before the explicit close.
              const scopeA = yield* Scope.fork(yield* Effect.scope)
              yield* BrowserHost.mountEffect(app(Html, "CopyA"), {}, a).pipe(
                Scope.provide(scopeA)
              )
              yield* Host.mountEffect(app(Html2, "CopyB"), {}, b)
              assert.include(saved(), "/CopyA")
              yield* Scope.close(scopeA, Exit.void)
              assert.include(saved(), "/CopyB")
            }))
      )
    }))
})
