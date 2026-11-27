/**
 * Views are values: a tree of element, text and child nodes that a component's
 * `view` returns and a host renders.
 *
 * The core `h` has only `el` and `text`. A child component is declared by
 * calling it with `h`, and a feature by its `render`. An element vocabulary
 * such as the HTML one adds element names and its own element class, supplied
 * through a vocabulary constructor such as `Html.component` or by passing
 * `elements` to `Component.define`.
 *
 * An element is written as a chain: `h.el("form").on("submit", msg).children(...)`.
 * `children` returns the builder, so the chain goes on, and a second call
 * adds after the first. `h.el(tag, ...children)` is shorthand for it. A
 * builder is itself a valid child or view, with the children it holds.
 * Arrays of children are flattened, and `false`, `null` and
 * `undefined` render nothing. Adjacent text merges into one text node when
 * the view is built, and empty text is dropped. Key an element when a
 * conditional sibling before it has the same tag; otherwise it can take
 * that sibling's node.
 *
 * **Example** (A host-neutral view)
 *
 * ```ts import.meta.vitest
 * import type { View } from "@effect/ui"
 * import { UiSchema } from "@effect/ui"
 * import { Schema } from "effect"
 *
 * const Message = UiSchema.TaggedEnum({ ClickedIncrement: {} })
 *
 * const view = (count: number, h: View.Helper<typeof Message.Type, {}>) =>
 *   h.el("div", h.el("button").on("click", Message.ClickedIncrement()).children("+"), String(count))
 * ```
 *
 * @stability experimental
 * @since 0.1.0
 */
import { dev } from "#dev"
import type * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Command from "./Command.ts"
import type * as Component from "./Component.ts"
import type * as Feature from "./Feature.ts"
import type * as Head from "./Head.ts"
import type * as MountModule from "./Mount.ts"
import type * as Renderer from "./Renderer.ts"

/**
 * A node of a view: an element, text, or a child component.
 *
 * **Details**
 *
 * `Msg` is the message type the view's handlers send. `R` collects the
 * requirements of the children declared by value, which surface in the
 * parent's requirements.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Node<Msg, R = never> =
  | Element<Msg, R>
  | Text
  | Child<Msg, R>
  | Outlet

/**
 * Where a component places what its parent passed for one of its slots:
 * `h.slots.body`.
 *
 * **Details**
 *
 * An outlet is opaque: the view that places it can't read the content. The
 * content keeps its own nodes, so an element key in it can't clash with the
 * outlet's siblings, and the outlet is keyed by its slot's name among them.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Outlet {
  readonly _tag: "Outlet"
  /** The slot's name. */
  readonly name: string
  /**
   * Set when the outlet sits in an element that can't hold text: the error a
   * content with text fails its author with.
   *
   * @internal
   */
  readonly noText?: string | undefined
}

/**
 * A text node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Text {
  readonly _tag: "Text"
  readonly text: string
}

/**
 * What an event sends: a message value, or a function of the event's payload
 * that returns `undefined` to ignore the event.
 *
 * **Details**
 *
 * Payloads are plain data declared by the vocabulary and built by the host.
 * No host event object reaches component code, so a test fires one with a
 * literal.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Handler<Msg, Payload> =
  | Msg
  | ((payload: Payload) => Msg | undefined)

/**
 * How a host treats one event of an element, set with the handler by `on`.
 *
 * **Details**
 *
 * With `preventDefault: true`, the host cancels the event's default action
 * when the handler produces a message, after the handler runs and before the
 * message is sent. A handler that returns `undefined` leaves the event alone,
 * so one handler decides per event, such as Enter but not Shift+Enter. A
 * message value always prevents. With `preventDefault: "always"`, the host
 * cancels the default whatever the handler returns. A host whose events have
 * no default ignores it.
 *
 * Nothing stops an event's propagation. A host gives each event to the
 * innermost element with a handler for it, and only that one, even when the
 * handler returns `undefined`.
 *
 * A vocabulary may extend these options for its own events, such as what a
 * drop target accepts. They stay plain data on the element: hosts and tests
 * read what they know and ignore the rest.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EventOptions {
  readonly preventDefault?: boolean | "always" | undefined
}

/**
 * Who a layer of an element belongs to: one headless instance. The runtime
 * makes one per instance, and a story one per expanded child.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Owner {
  readonly path: string
  readonly depth: number
}

/**
 * What a part of a headless component added to an element: its handlers,
 * their options, its ref and its mount, kept apart from the author's.
 *
 * **Details**
 *
 * `tokens` holds the part's token-list attributes, such as `class` and
 * `aria-describedby`. They're added to the element's own value, whether the
 * consumer set it before or after applying the part, and a token already
 * there isn't repeated. The part's other attributes are written over what
 * the consumer set before applying it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Owned {
  readonly owner: Owner
  readonly handlers: Readonly<Record<string, Handler<any, any>>>
  readonly eventOptions: Readonly<Record<string, EventOptions>>
  readonly refKey: string | undefined
  readonly mount: Mount<any> | undefined
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * The attributes whose value is a space-separated list, which a part adds
 * its tokens to rather than replacing: `class`, `rel` and the ARIA
 * attributes that list ids.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export const tokenListAttributes: ReadonlySet<string> = new Set([
  "class",
  "rel",
  "aria-controls",
  "aria-describedby",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns"
])

const noOwned: ReadonlyArray<Owned> = []

// What an element built without children holds: one frozen array for all of them.
const noChildren: ReadonlyArray<never> = Object.freeze([])

/**
 * The attributes, properties, handlers and event options of a builder that
 * has set none. One frozen record that every such builder shares, so the
 * runtime and a host know an empty one by looking at it, without reading it.
 *
 * @internal
 */
export const noFields: Readonly<Record<string, never>> = Object.freeze({})

/**
 * The fields of a builder that most never set, in one record that a builder
 * and its copies share until one is set. A copy, made for every chain call,
 * then stores six fields fewer.
 *
 * @internal
 */
export interface Rare {
  readonly eventOptions: Readonly<Record<string, EventOptions>>
  readonly refKey: string | undefined
  readonly mount: Mount<any> | undefined
  readonly owned: ReadonlyArray<Owned>
  readonly hooks: ReadonlyArray<Forward> | undefined
  readonly removals: ReadonlyArray<string> | undefined
  /**
   * While a part's forward hook runs, the index of that part's owned layer:
   * the handlers, ref and mount the hook sets go there.
   */
  readonly layer: number | undefined
}

const noRare: Rare = Object.freeze({
  eventOptions: noFields,
  refKey: undefined,
  mount: undefined,
  owned: noOwned,
  hooks: undefined,
  removals: undefined,
  layer: undefined
})

/** Sets one of the `Rare` fields of `builder`, a copy no one else holds yet. */
const setRare = <K extends keyof Rare>(
  builder: { readonly "~rare": Rare },
  name: K,
  value: Rare[K]
): void => {
  const rare: { -readonly [F in keyof Rare]: Rare[F] } = { ...builder["~rare"] }
  rare[name] = value
  ;(builder as { "~rare": Rare })["~rare"] = rare
}

/**
 * An element node, as data.
 *
 * **Details**
 *
 * `attrs` are strings set as attributes. `props` are typed values the host
 * decides the meaning of. `handlers` map an event name to its handler, so
 * re-rendering never touches listeners, and `eventOptions` holds the
 * `EventOptions` set with a handler. `key` keeps the element's node when
 * its siblings move. Unkeyed elements match by position, checking matching
 * siblings from the start and then the end. Use a key to distinguish
 * same-tag siblings when inserting, removing or reordering them.
 * `refKey` names the element for ref Commands, and `mount` is the work
 * started by `onMount`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Element<out Msg, out R = never> {
  readonly _tag: "Element"
  readonly tag: string
  readonly elementKey: string | undefined
  readonly attrs: Readonly<Record<string, string>>
  readonly props: Readonly<Record<string, unknown>>
  readonly handlers: Readonly<Record<string, Handler<Msg, any>>>
  readonly eventOptions: Readonly<Record<string, EventOptions>>
  readonly refKey: string | undefined
  readonly mount: Mount<Msg> | undefined
  /**
   * The layers the parts of headless components added, in the order they
   * were applied. An element written by hand may leave it out.
   */
  readonly owned?: ReadonlyArray<Owned> | undefined
  readonly children: ReadonlyArray<Node<Msg, R>>
}

/**
 * Whether a host makes all of `element` from its tag, attributes, handlers
 * and children: it sets no property, mount, ref or part layer. With
 * `isPlainTag`, a copy of another such element's node can stand for its own.
 *
 * @internal
 */
export const isPlain = (element: Element<any, any>): boolean =>
  element.props === noFields && element.mount === undefined &&
  element.refKey === undefined &&
  (element.owned === undefined || element.owned.length === 0)

/**
 * Whether an element of `tag` is no more than its markup: not a form, a
 * script or a custom element, whose node does more than a copy of it shows.
 *
 * @internal
 */
export const isPlainTag = (tag: string): boolean =>
  tag !== "form" && tag !== "script" && !tag.includes("-")

/**
 * What `onMount` stores: the issued mount, with its name, its args and the
 * map from its result to a message.
 *
 * **Details**
 *
 * It's data: a story reads `name` and `args` off it without running the
 * body. See `Mount.make`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Mount<Msg> = MountModule.Issued<
  Msg | Component.Noop,
  any,
  any,
  never
>

/**
 * The text of the type error `onMount` gives for a mount that doesn't end
 * with a message or `Component.noop`, such as one whose body is an
 * `Effect<void>` or whose result hasn't been mapped.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type MountHint =
  "onMount's mount ends with a message or Component.noop. Map its result with Mount.map, or end its body with Effect.as(Component.noop)"

/**
 * A child component, declared by calling a component with the
 * parent's `h`, `Editor(h, { key })`, or with a feature's `render`,
 * `Todos.render(h, { key, fallback })`.
 *
 * **Details**
 *
 * The runtime gives each child its own instance, Model and Scope, at the path
 * `Name[key]` under its parent. Several instances of one component are
 * several children with different keys. The child reports up through
 * `onEmit`, checked against the parent's message type, and every child is a
 * failure boundary: a failed child shows `fallback`, or nothing, until its
 * key changes, and the parent's optional `onFailure` is also messaged.
 *
 * A child dropped from the view unmounts, and its Model goes with it. A
 * child written inside `h.keepAlive` with the `s` it passes is kept instead,
 * so the user finds it as they left it: a hidden tab with a half-filled form,
 * a wizard step, a row a filter hides. Keeping is decided where the child is
 * written, `h.keepAlive((s) => Profile(s, { key: "profile" }))`, so the same
 * component can be kept in one view and unmount in another. A kept child
 * belongs to the component whose view called `h.keepAlive`, its author. Its
 * path is `Name[key]` under the author wherever the view puts it, so moving
 * it to another element or into another child's slot keeps the instance.
 *
 * While no view writes it, the runtime keeps its nodes out of the document,
 * and the child keeps its Model, its Commands in flight, its Subscriptions
 * and what the user typed into its inputs. It still gets `$.send` and query
 * results, and its events reach the author's `update` through the `onEmit`
 * of the last render that placed it. It contributes no head entries and no
 * reports to `collects`, a ref lookup inside it finds nothing, and its
 * element mounts stop until it's written again. The log records `Kept` and
 * `Drawn`. Saved state, from the server or a history entry, holds a kept
 * child's Model, and the child takes it once it's written again.
 *
 * Without a predicate it lives as long as its author. With one,
 * `h.keepAlive(({ key, model }) => key in model.rows, (s) => ...)`, the runtime
 * asks the predicate about each live child on every render of the author and
 * ends the child once it says no.
 *
 * **Gotchas**
 *
 * A child without a key has the empty key, at `Name[]`, so it must be the only
 * child of its component where it is rendered: a second one fails the parent
 * with an error that asks for a `key`. Rows in a list always need a key. A
 * list of one unkeyed row renders, and a row that replaces it keeps its
 * instance and Model.
 *
 * Two children at one path are one instance, whatever branch of the view
 * declared them: `cond ? Listbox(h, { props: a }) : Listbox(h, { props: b })`
 * keeps the Model when `cond` changes, and `init` doesn't run again. Key each
 * branch when the component's Model holds state that shouldn't carry over.
 *
 * A kept child costs what a shown one does. Its Subscriptions keep running,
 * so gate one on the Model when it should pause. A dialog or popover open
 * inside it closes when it's kept, and focus inside it is lost. A host
 * without `createContainer` fails the author of a kept child. The props and
 * `onEmit` it has are those of the last render that placed it: write it
 * inside a `hidden` element instead when it needs fresh ones.
 *
 * Every component called with `s` is kept, so a child of an `h.keepAlive`
 * block that should unmount is called with `h`. A child whose call changes
 * from `h` to `s` from one render to the next keeps its instance, and is
 * kept from then on. Changed back, it's an ordinary child again. One
 * component written with `h` and with `s` at one key in one render is one
 * path claimed twice, which fails the author.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Child<out Msg, out R = never> {
  readonly _tag: "Child"
  /**
   * A component value, a lazy component whose module loads when it mounts, or a feature service
   * resolved from the instance's context when it mounts.
   */
  readonly component: Component.Any | Component.Lazy.Any | Feature.Any
  /** The child's key. */
  readonly key: string
  readonly props: unknown
  readonly onEmit: (events: any) => Msg | undefined
  /** What shows in the child's place while it can't be shown. Required for a feature child. */
  readonly fallback:
    | ((
      result:
        | AsyncResult.Initial<never, unknown>
        | AsyncResult.Failure<never, unknown>
    ) => Content<Msg, any>)
    | undefined
  /** Also tells the parent that the child failed. */
  readonly onFailure:
    | ((failure: AsyncResult.Failure<never, unknown>) => Msg | undefined)
    | undefined
  /** A headless child's whole view, written by whoever declared the child. */
  readonly view: ((parts: any) => Content<Msg, any>) | undefined
  /** What the parent passed for each of the child's slots. */
  readonly slots: Readonly<Record<string, Input<any, any>>> | undefined
  /**
   * Set when the child is written with the `s` of `h.keepAlive`: the block's
   * predicate, or `true` for a block without one.
   */
  readonly alive?: ((input: any) => boolean) | true | undefined
  /** The headless instance that declared the child with `p.child`, which takes its events and failures. */
  readonly owner?: Owner | undefined
  /** Phantom: the child's requirements surface in its parent's. */
  readonly "~R"?: (_: never) => R
}

/**
 * Helper types for `Child`.
 *
 * @stability experimental
 * @since 0.1.0
 */
export declare namespace Child {
  /**
   * The options of a child: what a component call and a feature's `render`
   * take. `props` may be left out when the component takes none.
   *
   * **Details**
   *
   * Without a `key`, the child's key is the empty string, so `key: ""` and
   * no key name the same child.
   *
   * A component call adds one rule: a component whose props are erased,
   * such as a `Component.Any`, takes `props` even when it needs none.
   *
   * @category models
   * @since 0.1.0
   */
  export type Options<Props, Events, Msg> =
    & {
      /** The child's identity among its parent's children of one component. The empty string by default. */
      readonly key?: string | undefined
      /**
       * Handle the child's events with a callback, or supply one handler per tag for tagged events.
       * Return a parent message to dispatch it, or `undefined` to ignore the event.
       */
      readonly onEmit?:
        | ((events: Events) => Msg | undefined)
        | EmitHandlers<Events, Msg>
        | undefined
      /** Also tells the parent that the child failed. The failure stays in the child either way. */
      readonly onFailure?:
        | ((failure: AsyncResult.Failure<never, unknown>) => Msg | undefined)
        | undefined
    }
    & ({} extends Props ? { readonly props?: Props | undefined }
      : { readonly props: Props })

  /**
   * One handler for each tag in a child's event union.
   *
   * @category models
   * @since 0.1.0
   */
  export type EmitHandlers<Events, Msg> = [Events] extends [never] ? never
    : [Events] extends [{ readonly _tag: string }]
    // Reject a wide tag with a conditional on a fixed type: one on a type that depends on Events wouldn't relate
    // for two Events, and would fail a variance check.
      ? [(tag: EventTag<Events>) => void] extends [(tag: string) => void] ?
        never
      : {
        readonly [T in EventTag<Events>]: (
          event: Extract<Events, { readonly _tag: T }>
        ) => Msg | undefined
      }
    : never

  /**
   * The options a component call takes: `Options`, with the key checked
   * against the `h.keepAlive` block when the call is given its `s`. `K` is
   * the key as written, and `Ends` is `true` in a block with a predicate,
   * and `never` for a call given `h`. In a block without a predicate, the
   * key's type must be a literal, so the source fixes how many children the
   * block can keep.
   *
   * @category models
   * @since 0.1.0
   */
  export type KeepAliveOptions<Props, Events, Msg, K, Ends extends boolean> =
    & {
      /** The child's identity among its parent's children of one component, or a kept child's among its author's. The empty string by default. */
      readonly key?: KeepAliveKey<K, Ends> | undefined
      /**
       * Handle the child's events with a callback, or supply one handler per tag for tagged events.
       * Return a parent message to dispatch it, or `undefined` to ignore the event.
       */
      readonly onEmit?:
        | ((events: Events) => Msg | undefined)
        | EmitHandlers<Events, Msg>
        | undefined
      /** Also tells the parent that the child failed. The failure stays in the child either way. */
      readonly onFailure?:
        | ((failure: AsyncResult.Failure<never, unknown>) => Msg | undefined)
        | undefined
    }
    & ({} extends Props ? { readonly props?: Props | undefined }
      : { readonly props: Props })
}

type KeepAliveKey<K, Ends extends boolean> = [Ends] extends [true] ? K
  : true extends WideKey<K> ? KeepAliveKeyHint
  : K

type WideKey<K> = K extends string ? {} extends Record<K, 1> ? true : false
  : false

/**
 * The type a key takes when it needs a predicate, so the error names the fix.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type KeepAliveKeyHint =
  "A keep-alive child whose key isn't a literal needs a predicate that says when it ends: h.keepAlive(($) => ..., (s) => ...)"

/**
 * `s`, what `h.keepAlive` gives its content: `h`, marked as written in an
 * `h.keepAlive` block. A component called with it is kept alive. `Ends` is
 * `true` in a block with a predicate. A function that takes `s` types it
 * `KeepAlive<Msg, true>` to write children whose keys aren't literals,
 * `KeepAlive<Msg, false>` for a block without a predicate, or
 * `KeepAlive<Msg>` for either, where keys must be literals.
 *
 * **Gotchas**
 *
 * Every component called with `s` is kept, so pass `h` to any child in the
 * block that shouldn't be. A headless component, or a feature's `render`,
 * takes `s` as it takes `h`, and its child isn't kept. A function whose
 * parameter is typed `View.Helper` drops the brand: a component it calls with
 * the `s` it's handed is kept, with no check on its key.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface KeepAlive<Msg, out Ends extends boolean = boolean>
  extends HelperBase<Msg, unknown>
{
  /** Phantom: the brand only `h.keepAlive` gives. */
  readonly "~keepAlive": Ends
}

type EventTag<Events> = Events extends { readonly _tag: infer T extends string }
  ? T
  : never

/**
 * One child argument of an element: a node, an element builder, text, an
 * array of them, or a hole (`false`, `null`, `undefined`) that renders
 * nothing. `R` is what the child requires, as for `Content`.
 *
 * **When to use**
 *
 * Use to type the children a shared view helper passes on. Leaving `R` out
 * accepts only children that need no service, so a child that needs one
 * fails at the call site. To pass on whatever the children need, take them
 * with a generic `Children` constraint, as in the example: the element adds their
 * requirements to its own.
 *
 * **Gotchas**
 *
 * `Input<Msg, any>` as a parameter's type, outside a generic, erases what
 * the children require.
 *
 * **Example** (A view helper that keeps its children's requirements)
 *
 * ```ts
 * import type { View } from "@effect/ui"
 * import type { Html } from "@effect/ui/html"
 *
 * const Field = <M, C extends View.Children<M>>(h: Html.H<M>, options: {
 *   readonly label: string
 *   readonly children: C
 * }) => h.label.children(options.label, h.div.class("control").children(options.children))
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Input<Msg, R = never> =
  | Content<Msg, R>
  | string
  | false
  | null
  | undefined
  | Children<Msg, R>

/**
 * A readonly array of children. Use `C extends View.Children<Msg>` for a
 * wrapper's children option to preserve each child's requirements, and pass
 * that option directly to `.children(options.children)` without spreading it.
 * The default requirement is `any` for generic constraints, not annotations:
 * annotating a value as `Children<Msg>` erases its requirements.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type Children<Msg, R = any> = ReadonlyArray<
  Content<Msg, R> | string | false | null | undefined
>

/**
 * What a view, a child and a fallback may return: a node, or an element
 * builder with no children yet, such as `h.br` or `h.input.value(draft)`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Content<Msg, R = never> =
  | Node<Msg, R>
  | ElementBuilder<Msg, R, any, any>

/**
 * The requirements of a tuple of children, collected one at a time, so two
 * siblings with different needs give the union. `Requirements<any>` is
 * `any`.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type Requirements<T> = 0 extends 1 & T ? any :
  T extends string | false | null | undefined ? never
  : T extends Text | Outlet ? never
  : T extends ReadonlyArray<infer E> ? Requirements<E>
  : T extends Child<infer _Msg, infer R> ? R
  : T extends Element<infer _Msg, infer R> ? R
  : T extends ElementBuilder<infer _Msg, infer R, any, any> ? R
  : never

/**
 * Builds a text node.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const text = (text: string): Text => ({ _tag: "Text", text })

/**
 * Normalises element children: holes are dropped, arrays are flattened,
 * element builders become elements with no children, and adjacent text
 * merges into one node with empty text dropped.
 *
 * **Details**
 *
 * The view value never holds two text nodes side by side, so server HTML
 * hydrates without separator comments.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const children = <Msg>(
  inputs: ReadonlyArray<Input<Msg, any>>
): Array<Node<Msg, any>> => {
  const out: Array<Node<Msg, any>> = []
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    if (Array.isArray(input)) {
      for (let j = 0; j < input.length; j++) {
        // An element or a child, as in a list of rows, goes in as it is.
        const item = input[j]
        const tag = item?._tag
        if (tag === "Element" || tag === "Child") out.push(item)
        else pushChild(out, item)
      }
    } else {
      pushChild(
        out,
        input as Content<Msg, any> | string | false | null | undefined
      )
    }
  }
  return out
}

const pushChild = <Msg>(
  out: Array<Node<Msg, any>>,
  input: Content<Msg, any> | string | false | null | undefined
): void => {
  if (input === false || input === null || input === undefined) return
  if (typeof input === "string") {
    if (input === "") return
    const last = out.length === 0 ? undefined : out[out.length - 1]
    if (last !== undefined && last._tag === "Text") {
      out[out.length - 1] = text(last.text + input)
    } else out.push(text(input))
    return
  }
  // A node, the common input, is taken as it is; anything else is a builder.
  const node: Node<Msg, any> = (input as Node<Msg, any>)._tag === undefined
    ? toNode(input)
    : input as Node<Msg, any>
  if (node._tag === "Text") {
    if (node.text === "") return
    const last = out.length === 0 ? undefined : out[out.length - 1]
    if (last !== undefined && last._tag === "Text") {
      out[out.length - 1] = text(last.text + node.text)
      return
    }
  }
  out.push(node)
}

/**
 * Whether a value is an element builder.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isElementBuilder = (
  u: unknown
): u is ElementBuilder<unknown, unknown, unknown, unknown> =>
  u instanceof ElementBuilder

/**
 * Turns view content into a node: an element builder becomes its element,
 * with the children it holds, and a node is returned as it is.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const toNode = <Msg, R>(content: Content<Msg, R>): Node<Msg, R> =>
  content instanceof ElementBuilder ? elementFrom(content) : content

/**
 * The element a builder describes, with the children it holds: what each
 * builder a view passes as a child becomes, in one call where there is no
 * `forward`.
 */
const elementFrom = <Msg, R>(
  builder: ElementBuilder<Msg, any, any, any>
): Element<Msg, R> => {
  const hooks = builder["~rare"].hooks
  const children = builder.content ?? noChildren
  return hooks === undefined
    ? elementOf(builder, children)
    : forwardTo(builder, hooks, children)
}

/**
 * Builds the element node a builder describes: the children it holds, then
 * the given ones, normalised as `children` does.
 *
 * **When to use**
 *
 * Use when a finished node is needed, such as in a function declared to
 * return a `View.Element`. A view, a child and a fallback take the builder
 * as it is.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const build = <Msg, R, const C extends ReadonlyArray<Input<Msg, any>>>(
  builder: ElementBuilder<Msg, R, any, any>,
  inputs: C
): Element<Msg, R | Requirements<C[number]>> =>
  buildWith(builder, inputs.length === 0 ? noChildren : children(inputs))

const buildWith = <Msg, R>(
  builder: ElementBuilder<Msg, any, any, any>,
  given: ReadonlyArray<Node<Msg, any>>
): Element<Msg, R> => {
  // What the builder holds from `children` comes first, and what it is
  // given now comes after.
  const content = builder.content
  const all = content === undefined
    ? given
    : given.length === 0
    ? content
    : children([...content, ...given])
  const hooks = builder["~rare"].hooks
  return hooks === undefined
    ? elementOf(builder, all)
    : forwardTo(builder, hooks, all)
}

const elementOf = <Msg, R>(
  builder: ElementBuilder<Msg, any, any, any>,
  children: ReadonlyArray<Node<Msg, any>>
): Element<Msg, R> => {
  const rare = builder["~rare"]
  if (
    children.length === 0 && rare === noRare && builder.handlers === noFields &&
    builder.props === noFields && builder.elementKey === undefined &&
    Object.isFrozen(builder.elementAttrs)
  ) return leafOf(builder.tag, builder.elementAttrs)
  return {
    _tag: "Element",
    tag: builder.tag,
    elementKey: builder.elementKey,
    attrs: rare.owned.length === 0
      ? builder.elementAttrs
      : withTokens(builder.elementAttrs, rare.owned),
    props: builder.props,
    handlers: builder.handlers,
    eventOptions: rare.eventOptions,
    refKey: rare.refKey,
    mount: rare.mount,
    owned: rare.owned,
    children
  }
}

const leaves = new WeakMap<object, Map<string, Element<never>>>()

/**
 * An element with no children and nothing on it but shared attributes, such
 * as a list's icon or empty cell: one node per tag and attributes, which
 * every row shares. A patch then finds it the same without reading it.
 */
const leafOf = (
  tag: string,
  attrs: Readonly<Record<string, string>>
): Element<any, any> => {
  let byTag = leaves.get(attrs)
  if (byTag === undefined) leaves.set(attrs, byTag = new Map())
  let leaf = byTag.get(tag)
  if (leaf === undefined) {
    byTag.set(
      tag,
      leaf = {
        _tag: "Element",
        tag,
        elementKey: undefined,
        attrs,
        props: noFields,
        handlers: noFields,
        eventOptions: noFields,
        refKey: undefined,
        mount: undefined,
        owned: noOwned,
        children: noChildren
      }
    )
  }
  return leaf
}

/**
 * What a builder's `forward` stores: a function from the finished builder
 * to the element to render.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Forward = (
  node: any
) => Element<any, any> | ElementBuilder<any, any, any, any>

const partForwardLayer = Symbol("partForwardLayer")
type PartForward = Forward & { readonly [partForwardLayer]?: number }

const forwardInPart = (place: Forward, layer: number): PartForward =>
  Object.assign((node: any) => place(node), { [partForwardLayer]: layer })

type OwnFields = Pick<Owned, "handlers" | "eventOptions" | "refKey" | "mount">

/**
 * Selects the fields for handlers, event options, refs and mounts. Inside a
 * part's forward hook, these belong to the part, not the consumer.
 *
 * @internal
 */
export const ownFields = (
  builder: ElementBuilder<any, any, any, any>
): OwnFields => {
  const rare = builder["~rare"]
  const index = rare.layer
  return index === undefined ? builder : rare.owned[index]!
}

/**
 * Copies the builder and updates the fields selected by `ownFields`.
 *
 * @internal
 */
export const withOwnFields = <B extends ElementBuilder<any, any, any, any>>(
  builder: B,
  fields: Partial<OwnFields>
): B => {
  const rare = builder["~rare"]
  const index = rare.layer
  if (index === undefined) return withFields(builder, fields)
  const owned = rare.owned.slice()
  owned[index] = { ...owned[index]!, ...fields }
  return withFields(builder, { owned })
}

// Builds a builder that holds hooks. The last hook set runs first. It gets
// the finished builder: this one without that hook and without its key,
// holding every child. Building that runs the hooks set before it. The key
// goes on what the hook returns, as siblings are matched by the outermost
// node.
const forwardTo = <Msg, R>(
  builder: ElementBuilder<Msg, any, any, any>,
  hooks: ReadonlyArray<Forward>,
  content: ReadonlyArray<Node<Msg, any>>
): Element<Msg, R> => {
  const finished = copyBuilder(builder) as Mutable<
    ElementBuilder<Msg, any, any, any>
  >
  setRare(
    finished,
    "hooks",
    hooks.length === 1 ? undefined : hooks.slice(0, -1)
  )
  finished.content = content
  finished.elementKey = undefined
  const hook: PartForward = hooks[hooks.length - 1]!
  const layer = hook[partForwardLayer]
  if (layer !== finished["~rare"].layer) setRare(finished, "layer", layer)
  const out: Node<Msg, R> = toNode(hook(finished))
  if (out._tag !== "Element") {
    throw new Error(
      `forward: the <${builder.tag}> was built into a ${out._tag}, and its hook has to return an element`
    )
  }
  return builder.elementKey === undefined
    ? out
    : { ...asElement(out), elementKey: builder.elementKey }
}

/**
 * A copy of `builder` with `place` added after the hooks it already holds.
 * What a builder's `forward` calls.
 *
 * @internal
 */
export const withForward = <B extends ElementBuilder<any, any, any, any>>(
  builder: B,
  place: Forward
): B => {
  const out = copyBuilder(builder) as Mutable<B>
  const rare = builder["~rare"]
  const hook = rare.layer === undefined
    ? place
    : forwardInPart(place, rare.layer)
  setRare(
    out,
    "hooks",
    rare.hooks === undefined ? [hook] : [...rare.hooks, hook]
  )
  return out
}

/**
 * A copy of `builder` with `inputs` after the children it already holds,
 * normalised as `children` does. What a builder's `children` calls, with
 * its rest arguments: the array is reused for the first children.
 *
 * @stability experimental
 * @category vocabularies
 * @since 0.1.0
 */
export const withContent = <B extends ElementBuilder<any, any, any, any>>(
  builder: B,
  inputs: ReadonlyArray<Input<any, any>>
): B => {
  const out = copyBuilder(builder) as Mutable<B>
  const content = builder.content
  out.content = content === undefined
    ? (inputs.length === 0
      ? noChildren
      : inputs.length === 1 && isList(inputs[0])
      ? inputs[0]
      : childrenOf(inputs as Array<Input<any, any>>))
    : inputs.length === 0
    ? content
    : children([...content, ...inputs])
  return out
}

/**
 * Like {@link withContent}, for a container element that cannot hold text
 * directly. Throws if any child is text and marks slot `Outlet` nodes so
 * the runtime rejects text passed through them. `vocabulary` is the
 * vocabulary of `builder`: the error names it, and its `textParents` as
 * where text goes.
 *
 * @stability experimental
 * @category vocabularies
 * @since 0.1.0
 */
export const withNoTextContent = <B extends ElementBuilder<any, any, any, any>>(
  builder: B,
  inputs: ReadonlyArray<Input<any, any>>,
  vocabulary: Pick<Vocabulary, "name" | "textParents">
): B => {
  const out = withContent(builder, inputs) as Mutable<B>
  let message: string | undefined
  let updated: Array<Node<any, any>> | undefined
  const content = out.content ?? noChildren
  for (let index = 0; index < content.length; index++) {
    const child = content[index]!
    if (child._tag === "Text") {
      throw new Error(noTextMessage(builder.tag, vocabulary))
    }
    if (child._tag === "Outlet") {
      updated ??= [...content]
      updated[index] = {
        _tag: "Outlet",
        name: child.name,
        noText: message ??= noTextMessage(builder.tag, vocabulary)
      }
    }
  }
  if (updated !== undefined) out.content = updated
  return out
}

const noTextMessage = (
  tag: string,
  vocabulary: Pick<Vocabulary, "name" | "textParents">
): string =>
  `<${tag}> can't hold text in the ${vocabulary.name} vocabulary; text goes inside ${
    (vocabulary.textParents ?? []).join(", ")
  }`

/**
 * `children`, for an array the caller owns, such as a method's rest
 * arguments. While the inputs are nodes, builders and text that stands
 * alone, each is turned into its node where it is, and the array itself is
 * the result: no second array, and none with room to spare. The first input
 * that needs more, a hole, a nested array or text to join, hands what's left
 * to `children`.
 */
const childrenOf = <Msg>(
  inputs: Array<Input<Msg, any>>
): Array<Node<Msg, any>> => {
  let afterText = false
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    if (typeof input === "string") {
      if (input === "" || afterText) return children(inputs)
      inputs[i] = text(input)
      afterText = true
    } else if (
      input === false || input === null || input === undefined ||
      Array.isArray(input)
    ) {
      return children(inputs)
    } else {
      const node: Node<Msg, any> = input instanceof ElementBuilder
        ? elementFrom(input)
        : input as Node<Msg, any>
      if (node._tag === "Text") {
        if (node.text === "" || afterText) return children(inputs)
        afterText = true
      } else {
        afterText = false
      }
      inputs[i] = node
    }
  }
  return inputs as Array<Node<Msg, any>>
}

const withTokens = (
  attrs: Readonly<Record<string, string>>,
  owned: ReadonlyArray<Owned>
): Readonly<Record<string, string>> => {
  let out: Record<string, string> | undefined
  for (let index = 0; index < owned.length; index++) {
    const tokens = owned[index]!.tokens
    if (tokens === noFields) continue
    for (const name in tokens) {
      out ??= { ...attrs }
      out[name] = joinTokens(out[name], tokens[name]!)
    }
  }
  return out ?? attrs
}

const joinTokens = (current: string | undefined, added: string): string => {
  const tokens = current === undefined
    ? []
    : current.split(/\s+/).filter((token) => token !== "")
  for (const token of added.split(/\s+/)) {
    if (token !== "" && !tokens.includes(token)) tokens.push(token)
  }
  return tokens.join(" ")
}

/**
 * Copies a builder with some of its fields replaced, keeping its class. Every
 * chain method is written with it, so a builder stays a value.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const withFields = <B extends ElementBuilder<any, any, any, any>>(
  builder: B,
  fields: Partial<
    Pick<
      ElementBuilder<unknown>,
      | "elementKey"
      | "elementAttrs"
      | "props"
      | "handlers"
      | "eventOptions"
      | "refKey"
      | "mount"
      | "owned"
    >
  >
): B => {
  const out = copyBuilder(builder)
  for (const name in fields) {
    const value = (fields as Record<string, any>)[name]
    if (name in noRare) setRare(out, name as keyof Rare, value)
    else (out as any)[name] = value
  }
  return out
}

/**
 * Marks a builder class, by a static field of its own, whose builders hold the
 * base class's fields and no other: its methods add none. Its builders are
 * copied without counting their fields. A subclass, which may add fields,
 * isn't marked by its parent's mark.
 *
 * @internal
 */
export const baseFieldsOnly: unique symbol = Symbol.for(
  "@effect/ui/View/baseFieldsOnly"
)

/**
 * A copy of a builder, with its class and every field it holds.
 *
 * A view copies a builder for each chain call, so the copy is what building a
 * view costs most. A builder that holds only the base class's fields is
 * copied by a constructor made for its class, which stores them one by one:
 * several times faster than a generic copy. A copy that constructor made, of
 * a class marked with `baseFieldsOnly` as the library's own are, is taken to
 * hold only those: the class's methods add none. Any other builder has its
 * fields counted, in case its class or its caller added one: a builder that
 * holds another field under a string key is copied generically. A field
 * under a symbol isn't looked for, as asking for a builder's symbols on
 * every copy cost about as much as the rest of building a view, so a copy
 * leaves it behind: a part's forward layer is in `~rare` for that reason.
 */
const copyBuilder = <B extends ElementBuilder<any, any, any, any>>(
  builder: B
): B => {
  const proto = Object.getPrototypeOf(builder)
  const made = (builder as any)[copied] === true
  if (made && proto === lastMarked) return new lastMarkedCopier!(builder) as B
  if (made && Object.hasOwn(proto.constructor, baseFieldsOnly)) {
    let copier = copiers.get(proto)
    if (copier === undefined) {
      copiers.set(proto, copier = makeCopier(proto, builder))
    }
    if (copier !== null) {
      lastMarked = proto
      lastMarkedCopier = copier
      return new copier(builder) as B
    }
  }
  // Counted in place: `Object.keys` would make an array for every copy.
  let fields = 0
  for (const _ in builder) fields++
  if (fields === builderFields.length) {
    let copier = proto === lastProto ? lastCopier : copiers.get(proto)
    if (copier === undefined) {
      copiers.set(proto, copier = makeCopier(proto, builder))
    }
    lastProto = proto
    lastCopier = copier
    if (copier !== null) return new copier(builder) as B
  }
  const out = Object.assign(Object.create(proto), builder)
  // Not one the copier made, whatever its source was.
  if (made) out[copied] = false
  return out
}

/** Set on the builders a copier makes. Not enumerable by `for...in`, so not counted. */
const copied: unique symbol = Symbol("@effect/ui/View/copied")

const builderFields = [
  "elementKey",
  "elementAttrs",
  "props",
  "handlers",
  "content",
  "~rare",
  "tag"
] as const

type Copier = new(
  builder: ElementBuilder<any, any, any, any>
) => ElementBuilder<any, any, any, any>

/** A class's copier by its prototype, or `null` for a class whose builders are copied generically. */
const copiers = new WeakMap<object, Copier | null>()
let lastProto: object | undefined
let lastCopier: Copier | null = null
let lastMarked: object | undefined
let lastMarkedCopier: Copier | undefined

/**
 * A constructor that copies the base fields of a builder of the class with
 * `proto`. `null` when `first`, the first builder of the class to be copied,
 * lacks a base field, which a count of its keys doesn't show.
 */
const makeCopier = (
  proto: object,
  first: ElementBuilder<any, any, any, any>
): Copier | null => {
  for (const field of builderFields) {
    if (!Object.hasOwn(first, field)) return null
  }
  const copier = function(
    this: Mutable<ElementBuilder<any, any, any, any>>,
    from: ElementBuilder<any, any, any, any>
  ) {
    this.elementKey = from.elementKey
    this.elementAttrs = from.elementAttrs
    this.props = from.props
    this.handlers = from.handlers
    this.content = from.content
    this["~rare"] = from["~rare"]
    this.tag = from.tag
    ;(this as any)[copied] = true
  }
  copier.prototype = proto
  return copier as unknown as Copier
}

/**
 * A part of a headless component: it takes the builder of an element the
 * consumer wrote and returns it with the part's attributes, properties and
 * owned layer added.
 *
 * **Details**
 *
 * `Tag` is the tag, or the union of tags, the part is declared for, and
 * `string` for a part that takes any element. `Args` is what the part takes
 * after the builder, and `R` what its mount requires, which joins the
 * headless component's requirements.
 *
 * A part is tied to tag names, the same check the runtime makes: a part
 * declared for `"h2"` takes `h.h2` and rejects `h.h3`, although both
 * render an `HTMLHeadingElement`. A part that takes several tags lists them,
 * as `p.part(["h2", "h3"], ...)`.
 *
 * The result is the builder's chain type, never the callable root, so
 * `menu.trigger(h.button)("Open")` doesn't compile.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Part<
  in out Tag extends string,
  in Args extends ReadonlyArray<any>,
  out R = never
> {
  <B extends PartTarget<Tag>>(builder: B, ...args: Args): ReturnType<B["attr"]>
  readonly "~R"?: (_: never) => R
}

/**
 * What a part accepts: a builder whose declared tag is one of `Tag`, either
 * a tag's callable root or its chain type.
 *
 * **Details**
 *
 * It's structural on purpose. With `ElementBuilder` as the constraint, a
 * callable root such as `h.dialog` infers as the constraint and loses its
 * chain type. A builder whose tag isn't known, such as `h.el("x-foo")`'s,
 * only fits a part declared without a tag.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PartTarget<out Tag extends string> {
  readonly "~Tag"?: Tag | undefined
  readonly attr: (...args: any) => any
}

/**
 * The requirements of the parts in a headless component's `parts` record.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type PartRequirements<P> = P extends
  { readonly "~R"?: (_: never) => infer R } ? R : never

/**
 * Keeps a part's requirements on a wrapper function returned from a headless
 * component's `parts`.
 *
 * **Details**
 *
 * Returns `wrapper` unchanged, preserving its parameters, generics and return
 * type. Use it when adapting a part to an options object or adding markup.
 * The wrapper must apply `part`; this only carries that part's requirements,
 * not requirements of any other parts or effects the wrapper uses.
 *
 * **Example** (A part with an options object)
 *
 * ```ts import.meta.vitest
 * import { View } from "@effect/ui"
 *
 * const withOptions = <R>(part: View.Part<"button", [], R>) =>
 *   View.wrapPart(part, <B extends View.PartTarget<"button">>(
 *     { element }: { element: B }
 *   ): ReturnType<B["attr"]> => part(element))
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const wrapPart = <
  P extends { readonly "~R"?: (_: never) => unknown },
  F extends (...args: Array<any>) => any
>(_part: P, wrapper: F): F & Pick<P, "~R"> => wrapper

/**
 * Makes a part for one owner. `decorate` gets an empty builder of the
 * consumer's class and tag, so it never sees what the consumer set. Its
 * attributes and properties are written over the consumer's, except token
 * lists, and its handlers, event options, ref, mount and token lists become
 * one owned layer. The children it adds go after the ones the consumer's
 * builder holds, and what it sets with `forward` after the builder's. The
 * handlers, ref and mount its `forward` sets join its layer too.
 *
 * @internal
 */
export const makePart = (
  owner: Owner,
  tags: ReadonlyArray<string> | undefined,
  decorate: (
    builder: any,
    ...args: ReadonlyArray<any>
  ) => ElementBuilder<any, any, any, any>
): Part<any, any, any> =>
(target: PartTarget<any>, ...args: ReadonlyArray<any>): any => {
  const builder: unknown = target
  if (!(builder instanceof ElementBuilder)) {
    throw new Error(
      owner.path + ": a part takes an element builder, such as h.button"
    )
  }
  if (tags !== undefined && !tags.includes(builder.tag)) {
    throw new Error(
      owner.path + ": a part for <" + tags.join("> or <") + "> was given <" +
        builder.tag + ">"
    )
  }
  const blank: ElementBuilder<any, any, any, any> = Object.assign(
    Object.create(Object.getPrototypeOf(builder)),
    blankFields,
    { "~rare": { ...noRare, removals: [] }, tag: builder.tag }
  )
  const patch = decorate(blank, ...args)
  if (!(patch instanceof ElementBuilder)) {
    throw new Error(owner.path + ": a part returns the builder it was given")
  }
  if (patch.elementKey !== undefined) {
    throw new Error(owner.path + ": a part can't set an element's key")
  }
  if (patch.owned.length > 0) {
    throw new Error(owner.path + ": a part can't apply another part")
  }
  const attrs: Record<string, string> = { ...builder.elementAttrs }
  let tokens: Record<string, string> | undefined
  for (const name of patch.removals ?? []) {
    // Token lists are additive: a part can omit its own tokens, not the consumer's.
    if (!tokenListAttributes.has(name)) delete attrs[name]
  }
  for (const name in patch.elementAttrs) {
    if (tokenListAttributes.has(name)) {
      ;(tokens ??= {})[name] = patch.elementAttrs[name]!
    } else attrs[name] = patch.elementAttrs[name]!
  }
  const layer: Owned = {
    owner,
    handlers: patch.handlers,
    eventOptions: patch.eventOptions,
    refKey: patch.refKey,
    mount: patch.mount,
    tokens: tokens ?? noFields
  }
  const out = withFields(builder, {
    elementAttrs: attrs,
    props: patch.props === noFields
      ? builder.props
      : builder.props === noFields
      ? patch.props
      : { ...builder.props, ...patch.props },
    owned: [...builder.owned, layer]
  })
  // The part's children come after the ones the builder came with, and its
  // hooks are set after the builder's.
  if (patch.content !== undefined) {
    ;(out as Mutable<typeof out>).content = builder.content === undefined
      ? patch.content
      : children([...builder.content, ...patch.content])
  }
  if (patch.hooks !== undefined) {
    const hooks = patch.hooks.map((hook) =>
      forwardInPart(hook, builder.owned.length)
    )
    setRare(
      out,
      "hooks",
      builder.hooks === undefined ? hooks : [...builder.hooks, ...hooks]
    )
  }
  return out
}

/**
 * `record` with `name` set to `value` as its last entry, or without `name`
 * when `value` is `undefined`.
 */
const withEntry = <A>(
  record: Readonly<Record<string, A>>,
  name: string,
  value: A | undefined
): Readonly<Record<string, A>> => {
  if (!Object.hasOwn(record, name)) {
    return value === undefined
      ? record
      : assoc(record, name, value)
  }
  const out: Record<string, A> = {}
  for (const key in record) {
    if (key !== name) put(out, key, record[key]!)
  }
  if (value !== undefined) put(out, name, value)
  return out
}

/**
 * `{ ...record, [name]: value }`, written as a copy and a store: an object
 * literal with a computed key is several times slower.
 */
const assoc = <A>(
  record: Readonly<Record<string, A>>,
  name: string,
  value: A
): Readonly<Record<string, A>> => {
  // The first entry of most records: nothing to copy.
  if (record === noFields) return firstEntry(name, value)
  const out: Record<string, A> = { ...record }
  put(out, name, value)
  return out
}

/**
 * A record holding one entry. The names set most often are written as literals, which hold their
 * one entry in place, where `{}` keeps room for four. A literal is also faster to build than a
 * store under a name a view chose.
 */
const firstEntry = <A>(name: string, value: A): Record<string, A> => {
  switch (name) {
    case "class":
      return { class: value }
    case "id":
      return { id: value }
    case "click":
      return { click: value }
    case "input":
      return { input: value }
  }
  const out: Record<string, A> = {}
  put(out, name, value)
  return out
}

const classRecords = new Map<string, Readonly<Record<string, string>>>()

/**
 * The attributes of an element that has only a class: one frozen record per
 * value, which the rows of a list share. A patch then finds them the same
 * without reading them, and a render keeps fewer objects. The cache is
 * emptied when it grows large, as a view may build classes from data.
 */
const classOnly = (value: string): Readonly<Record<string, string>> => {
  let record = classRecords.get(value)
  if (record === undefined) {
    if (classRecords.size >= 1024) classRecords.clear()
    classRecords.set(value, record = Object.freeze({ class: value }))
  }
  return record
}

const extensions = new WeakMap<
  object,
  Map<string, Map<string, Readonly<Record<string, string>>>>
>()

/**
 * A shared record, as `classOnly` makes, with one more attribute: shared in
 * turn, so `h.span.class("icon").attr("aria-hidden", "true")` builds one
 * record for every row. A name given many values, as from data, gets a
 * record of its own each time past the first few, and so does each name past
 * the first few, as `data-${id}` would be.
 */
const extended = (
  record: Readonly<Record<string, string>>,
  name: string,
  value: string
): Readonly<Record<string, string>> => {
  let byName = extensions.get(record)
  if (byName === undefined) extensions.set(record, byName = new Map())
  let byValue = byName.get(name)
  if (byValue === undefined) {
    if (byName.size >= 32) return assoc(record, name, value)
    byName.set(name, byValue = new Map())
  }
  let out = byValue.get(value)
  if (out === undefined) {
    const made = assoc(record, name, value)
    if (byValue.size >= 32) return made
    byValue.set(value, out = Object.freeze(made))
  }
  return out
}

/** Sets an own entry, `__proto__` included, which a plain store would take as the prototype. */
const put = <A>(record: Record<string, A>, name: string, value: A): void => {
  if (name === "__proto__") {
    Object.defineProperty(record, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    })
  } else {
    record[name] = value
  }
}

type Mutable<A> = { -readonly [K in keyof A]: A[K] }

const blankFields = {
  elementKey: undefined,
  elementAttrs: noFields,
  props: noFields,
  handlers: noFields,
  content: undefined
}

let lastPath = ""
let lastEscaped = ""

/**
 * An id for an element of the instance at `path`, the same on the server and
 * the client. The path, the name and the key are each escaped down to
 * `[A-Za-z0-9]` and joined with a hyphen, which no escaped field contains:
 * two ids are equal only when all three are. The result is safe in a
 * space-separated list such as `aria-labelledby`, and in a selector.
 *
 * @internal
 */
export const idOf = (
  path: string,
  name: string,
  key?: string | number | undefined
): string => {
  if (path !== lastPath) {
    lastPath = path
    lastEscaped = escapeId(path)
  }
  return lastEscaped + "-" + escapeId(name) +
    (key === undefined ? "" : "-" + escapeId(String(key)))
}

// The underscore that opens and closes an escape is escaped too, so the escaping can be undone.
const escapeId = (value: string): string =>
  value.replace(
    /[^A-Za-z0-9]/g,
    (char) => "_" + char.codePointAt(0)!.toString(36) + "_"
  )

/**
 * The element builder: `h.el(tag)` and a vocabulary's element names. It
 * holds attributes, properties, handlers, a key, a ref, a mount and the
 * children given so far.
 *
 * **Details**
 *
 * Every method returns a copy, so a view stays a value. `Handlers` maps an
 * event name to its payload; a vocabulary's element class fixes it and adds
 * its own helpers. The core builder leaves payloads untyped.
 *
 * This base class has no `children`, so it's the shape of a void element.
 * `ContainerBuilder` adds it, and a vocabulary does the same for the tags
 * that take children. A builder is itself valid content: as a child or a
 * view it renders as its element with no children.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class ElementBuilder<
  out Msg,
  out R = never,
  in out Handlers = Record<string, unknown>,
  in out HostNode = unknown,
  out Tag extends string = string
> {
  /** @internal */
  static readonly [baseFieldsOnly] = true
  /**
   * The key set with `key`, if any.
   *
   * @since 0.1.0
   */
  readonly elementKey: string | undefined = undefined
  /**
   * The attributes set with `attr` or `attrs`.
   *
   * @since 0.1.0
   */
  readonly elementAttrs: Readonly<Record<string, string>> = noFields
  /**
   * The properties set with `prop`.
   *
   * @since 0.1.0
   */
  readonly props: Readonly<Record<string, unknown>> = noFields
  /**
   * The handlers set with `on`, by event name.
   *
   * @since 0.1.0
   */
  readonly handlers: Readonly<Record<string, Handler<Msg, any>>> = noFields
  /**
   * The options set with `on`, by event name.
   *
   * @since 0.1.0
   */
  get eventOptions(): Readonly<Record<string, EventOptions>> {
    return this["~rare"].eventOptions
  }
  /** @internal */
  protected set eventOptions(value: Readonly<Record<string, EventOptions>>) {
    setRare(this, "eventOptions", value)
  }
  /**
   * The ref set with `ref`, if any.
   *
   * @since 0.1.0
   */
  get refKey(): string | undefined {
    return this["~rare"].refKey
  }
  /** @internal */
  protected set refKey(value: string | undefined) {
    setRare(this, "refKey", value)
  }
  /**
   * The work set with `onMount`, if any.
   *
   * @since 0.1.0
   */
  get mount(): Mount<Msg> | undefined {
    return this["~rare"].mount as Mount<Msg> | undefined
  }
  /** @internal */
  protected set mount(value: Mount<Msg> | undefined) {
    setRare(this, "mount", value)
  }
  /**
   * The layers added by the parts of headless components.
   *
   * @since 0.1.0
   */
  get owned(): ReadonlyArray<Owned> {
    return this["~rare"].owned
  }
  /** @internal */
  protected set owned(value: ReadonlyArray<Owned>) {
    setRare(this, "owned", value)
  }
  /**
   * The children given with `children` so far, as nodes, or `undefined`
   * before the first call. Read the element's children off the node,
   * `View.build(builder, []).children`, which also runs `forward`.
   *
   * @since 0.1.0
   */
  readonly content: ReadonlyArray<Node<Msg, any>> | undefined = undefined
  /**
   * The functions set with `forward`, in the order they were set.
   *
   * @since 0.1.0
   */
  get hooks(): ReadonlyArray<Forward> | undefined {
    return this["~rare"].hooks
  }
  /** @internal */
  protected set hooks(value: ReadonlyArray<Forward> | undefined) {
    setRare(this, "hooks", value)
  }
  /**
   * On the blank builder a part decorates, the attributes the part
   * removed. `undefined` on every other builder.
   *
   * @since 0.1.0
   */
  get removals(): ReadonlyArray<string> | undefined {
    return this["~rare"].removals
  }
  /** @internal */
  protected set removals(value: ReadonlyArray<string> | undefined) {
    setRare(this, "removals", value)
  }
  /**
   * The options, ref, mount, layers, `forward` functions and removals, which
   * most builders leave unset, in one record their copies share.
   *
   * @internal
   */
  readonly "~rare": Rare = noRare
  /**
   * Phantom: the requirements of the element's mount, which surface in the
   * component's.
   *
   * @since 0.1.0
   */
  declare readonly "~R"?: (_: never) => R
  /**
   * Phantom: the host node this element renders to, which types `ref` and
   * `onMount`.
   *
   * @since 0.1.0
   */
  declare readonly "~HostNode"?: (_: HostNode) => HostNode
  /**
   * Phantom: the element's events and their payloads.
   *
   * @since 0.1.0
   */
  declare readonly "~Handlers"?: Handlers
  /**
   * Phantom: the element's tag as the vocabulary declares it, which a part
   * of a headless component checks. `string` when it isn't known, as for
   * `h.el`.
   *
   * @since 0.1.0
   */
  declare readonly "~Tag"?: Tag
  /**
   * Phantom: the requirements `WithRequirements` adds.
   *
   * @since 0.1.0
   */
  declare readonly "~Add"?: unknown
  /**
   * Phantom: this builder's class with `~Add` in its requirements. A
   * subclass redeclares it with its own class, so `children`, `onMount` and
   * `forward` return that class.
   *
   * @since 0.1.0
   */
  declare readonly "~With"?: ElementBuilder<
    Msg,
    R | this["~Add"],
    Handlers,
    HostNode,
    Tag
  >
  /**
   * The element's tag.
   *
   * @since 0.1.0
   */
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  /**
   * Sends a message when `event` fires: a value, or a function of the payload.
   * `options` sets how the host treats the event, such as `preventDefault`.
   * Setting `event` again replaces its handler and its options.
   *
   * @since 0.1.0
   */
  on<K extends keyof Handlers & string>(
    event: K,
    handler: Handler<Msg, Handlers[K]>,
    options?: EventOptions | undefined
  ): this {
    // Inside a part's forward hook, the handler joins the part's layer.
    const rare = this["~rare"]
    const own = rare.layer === undefined ? undefined : rare.owned[rare.layer]!
    const was = own === undefined ? rare.eventOptions : own.eventOptions
    let eventOptions = was
    if (eventOptions === noFields) {
      if (options !== undefined) {
        eventOptions = assoc(eventOptions, event, options)
      }
    } else if (options !== undefined || Object.hasOwn(eventOptions, event)) {
      eventOptions = withEntry(eventOptions, event, options)
    }
    if (own !== undefined) {
      return withOwnFields(this, {
        handlers: assoc(own.handlers, event, handler),
        eventOptions
      })
    }
    // The usual case: `~rare` is copied only when the event options change.
    const out = copyBuilder(this) as Mutable<this>
    out.handlers = assoc(this.handlers, event, handler)
    if (eventOptions !== was) setRare(out, "eventOptions", eventOptions)
    return out
  }
  /**
   * Keeps this element's node when its siblings move. Unique among siblings.
   *
   * @since 0.1.0
   */
  key(key: string): this {
    const out = copyBuilder(this) as Mutable<this>
    out.elementKey = key
    return out
  }
  /**
   * Sets an attribute, or removes it with `undefined`. The HTML renderers omit
   * a URL attribute holding a `javascript:` or `vbscript:` URL; see `Html`.
   *
   * @since 0.1.0
   */
  attr(name: string, value: string | undefined): this {
    const attrs = this.elementAttrs
    const removals = this["~rare"].removals
    // A `shorthand` is a function whose chain methods must return a plain builder.
    if (
      value === undefined && removals === undefined &&
      (attrs === noFields || !Object.hasOwn(attrs, name)) &&
      typeof this !== "function"
    ) return this
    const out = copyBuilder(this) as Mutable<this>
    if (value === undefined && removals !== undefined) {
      setRare(out, "removals", [...removals, name])
    }
    if (attrs === noFields) {
      if (value !== undefined) {
        out.elementAttrs = name === "class"
          ? classOnly(value)
          : assoc(attrs, name, value)
      }
      // Removing an attribute that isn't set leaves the record as it is.
    } else if (value !== undefined || Object.hasOwn(attrs, name)) {
      out.elementAttrs = value !== undefined && Object.isFrozen(attrs) &&
          !Object.hasOwn(attrs, name)
        ? extended(attrs, name, value)
        : withEntry(attrs, name, value)
    }
    return out
  }
  /**
   * Sets multiple attributes, removing any whose value is `undefined`.
   *
   * @since 0.1.0
   */
  attrs(attributes: Readonly<Record<string, string | undefined>>): this {
    if (this.attr !== ElementBuilder.prototype.attr) {
      let out: this | undefined
      for (const name in attributes) {
        if (Object.hasOwn(attributes, name)) {
          out = (out ?? this).attr(name, attributes[name])
        }
      }
      return out ?? copyBuilder(this)
    }
    const out = copyBuilder(this) as Mutable<this>
    const current = this.elementAttrs
    let removals: Array<string> | undefined
    let next: Record<string, string> | undefined
    for (const name in attributes) {
      if (!Object.hasOwn(attributes, name)) continue
      const value = attributes[name]
      if (value === undefined) {
        if (this.removals !== undefined) {
          removals ??= this.removals.slice()
          removals.push(name)
        }
        if (current !== noFields && Object.hasOwn(next ?? current, name)) {
          next ??= { ...current }
          delete next[name]
        }
      } else {
        next ??= current === noFields ? {} : { ...current }
        if (Object.hasOwn(next, name)) delete next[name]
        put(next, name, value)
      }
    }
    if (removals !== undefined) setRare(out, "removals", removals)
    if (next !== undefined) out.elementAttrs = next
    return out
  }
  /**
   * Sets a property. The host decides what it means. For built-in elements,
   * the HTML host removes the reflected attribute when a URL property is set
   * to a `javascript:` or `vbscript:` URL; see `Html`.
   *
   * @since 0.1.0
   */
  prop(name: string, value: unknown): this {
    const out = copyBuilder(this) as Mutable<this>
    out.props = assoc(this.props, name, value)
    return out
  }
  /**
   * Names this element for ref Commands, which reach it through
   * `Renderer.Refs` within the instance that renders it. A ref declared for
   * another kind of node doesn't compile.
   *
   * @since 0.1.0
   */
  ref(ref: Renderer.Ref<HostNode>): this {
    return withOwnFields(this, { refKey: ref.key })
  }
  /**
   * Starts `mount` with this element's host node after it's committed (just
   * before, for a mount made with `beforeCommit`), in a Scope that closes
   * when the element goes and survives patches. A message it ends with comes
   * back to the component, and one that ends with `Component.noop` sends
   * nothing and logs no `Update`. Its requirements join the component's.
   *
   * **Details**
   *
   * `mount` is an issued mount: a definition from `Mount.make` called with
   * its args, and mapped to the component's message with `Mount.map` when
   * its result isn't one. A mount whose body needs another kind of host node
   * than this element's doesn't compile.
   *
   * The body runs once per element. A later render's args reach it through
   * its `changes` Stream, when they differ by the args Schema's equivalence.
   * A render that gives the element a mount of another definition stops the
   * running one and starts the new one, and a render without a mount stops
   * it.
   *
   * A defect fails the instance. It never runs on the server or on a host that
   * doesn't run mounts, such as `TestHost`, where a test sends the message
   * itself. It returns the builder's own class.
   *
   * **Gotchas**
   *
   * An element takes one mount: calling `onMount` again throws. A mount from
   * `Mount.make` ends with one message. One that sends messages as it goes,
   * such as a widget's events, is defined with `Mount.makeStream`.
   *
   * A body that is an `Effect<void>` doesn't compile here, because a `void`
   * type can hold any value, which would be sent as a message. When there is
   * nothing to report, use `Effect.as(Component.noop)`. This sends no message;
   * the log records the body's completion as `MountEnded` with `silent: true`.
   *
   * @since 0.1.0
   */
  onMount<This, R2>(
    this: This,
    mount: MountModule.Issued<
      Msg | Component.Noop,
      R2,
      HostNodeOf<This>,
      never
    >
  ): WithRequirements<This, R2>
  /**
   * Rejects any other mount result, with a type error that says what to end
   * it with.
   *
   * @since 0.1.0
   */
  onMount<This>(
    this: This,
    mount: MountModule.Issued<
      Msg | Component.Noop | MountHint,
      any,
      HostNodeOf<This>,
      never
    >
  ): never
  onMount(mount: Mount<Msg>): any {
    const current = ownFields(this).mount
    if (current !== undefined) {
      throw new Error(
        `onMount(${mount.name}): this element already has the mount ${current.name}, and an element takes one`
      )
    }
    return withOwnFields(this, { mount })
  }
  /**
   * Lets a chain land on an element that sits below the root of what is
   * rendered. `place` gets the finished element, with everything chained
   * after this call and its children in it, and returns the element to
   * render: one around it, or the finished element itself.
   *
   * **When to use**
   *
   * Use when a function takes a builder and returns it, and the element
   * needs markup around it, or the function's own attributes written after
   * the caller's.
   *
   * **Details**
   *
   * `place` runs when the builder becomes an element: as another element's
   * child, or as what a view returns. What it returns has to be an
   * element, and the requirements of what it adds join this element's.
   *
   * The finished element is still a builder. `place` can read what the
   * caller chained, such as `node.handlers`, and write attributes after
   * it. Children it adds come after the caller's.
   *
   * A key set on the builder, before or after this call, goes on the
   * element `place` returns, as siblings are matched by their outermost
   * node. The ref, the mount and the handlers stay on the finished element.
   *
   * A builder can hold several of these functions, from this method and
   * from the parts applied to it. The last one set runs first, and building
   * the finished element it gets runs the one before. So the last call's
   * markup is outermost, and the first call writes its attributes last.
   *
   * **Example** (A frame around the caller's input)
   *
   * ```ts import.meta.vitest
   * import { View } from "@effect/ui"
   * import { Html } from "@effect/ui/html"
   *
   * const h = View.makeHelper<never, {}, Html.Elements>({}, Html)
   *
   * // The class and the attribute land on the input, inside the frame.
   * const framed = h.input.forward((node) => h.div.class("frame").children(node))
   * const frame = View.build(framed.class("amount").attr("inputmode", "decimal"), [])
   *
   * if (frame.tag !== "div" || frame.attrs.class !== "frame") throw new Error("the frame isn't outermost")
   * ```
   *
   * @since 0.1.0
   */
  forward<This, R2 = never>(
    this: This,
    place: (
      node: WithRequirements<This, never>
    ) => Element<Msg, R2> | ElementBuilder<Msg, R2, any, any>
  ): WithRequirements<This, R2>
  forward(place: Forward): unknown {
    return withForward(this, place)
  }
}

type HostNodeOf<B> = B extends
  { readonly "~HostNode"?: (_: infer HostNode) => unknown } ? HostNode
  : never

/**
 * The builder `B`, of its own class, with `R2` added to its requirements:
 * what `children`, `onMount` and `forward` return. A union gives a union,
 * and a `Shorthand` root gives its builder.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type WithRequirements<B, R2> = B extends unknown ?
    & (B extends { readonly attr: (...args: any) => infer Chain } ? Chain : B)
    & { readonly "~Add": R2 } extends { readonly "~With"?: infer With } ? With
  : never
  : never

/**
 * The builder of an element that takes children: what `h.el` returns.
 *
 * **Details**
 *
 * `children` returns the builder with the children added after the ones it
 * holds. So a function that takes a builder can add children of its own and
 * still return a builder, for its caller to add more.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class ContainerBuilder<
  out Msg,
  out R = never,
  in out Handlers = Record<string, unknown>,
  in out HostNode = unknown,
  out Tag extends string = string
> extends ElementBuilder<Msg, R, Handlers, HostNode, Tag> {
  /** @internal */
  static override readonly [baseFieldsOnly] = true
  /**
   * Phantom: keeps `ContainerBuilder` through `WithRequirements`.
   *
   * @since 0.1.0
   */
  declare readonly "~With"?: ContainerBuilder<
    Msg,
    R | this["~Add"],
    Handlers,
    HostNode,
    Tag
  >
  /**
   * Adds children after the ones the builder holds, and returns the
   * builder: nodes, builders, text, arrays to flatten, and holes (`false`,
   * `null`, `undefined`). Their requirements join the element's.
   *
   * @since 0.1.0
   */
  children<This, const C extends ReadonlyArray<Input<Msg, unknown>>>(
    this: This,
    ...inputs: C
  ): WithRequirements<This, Requirements<C[number]>>
  children(...inputs: ReadonlyArray<Input<Msg, unknown>>): unknown {
    return withContent(this, inputs)
  }
}

/**
 * A root builder that is also callable: `b(...inputs)` is
 * `b.children(...inputs)`. What a vocabulary puts on `h` for a tag that
 * takes children, such as `h.button("Add")`.
 *
 * **Details**
 *
 * The chain methods and the call return the builder `B`, which isn't
 * callable: `h.div(a).children(b)` adds `b`, and `h.div(a)(b)` doesn't
 * compile. `B`'s `children` must return `WithRequirements` of `B` too.
 *
 * Calling a choice of roots, `(cond ? h.h2 : h.h1)(title)`, doesn't compile,
 * as it would lose the children's requirements. Write
 * `(cond ? h.h2 : h.h1).children(title)`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Shorthand<
  B extends { readonly children: (...inputs: any) => WithRequirements<B, any> }
> =
  & Omit<B, never>
  // `_Root` is never inferred. It makes two roots' calls differ, so a union
  // of roots isn't callable instead of inferring `any` requirements.
  & (<const C extends InputsOf<B>, _Root extends B = B>(
    ...inputs: C
  ) => WithRequirements<B, Requirements<C[number]>>)

type InputsOf<B> = B extends {
  readonly children: (
    ...inputs: infer Inputs extends ReadonlyArray<unknown>
  ) => unknown
} ? Inputs
  : never

/**
 * Makes a builder callable as `Shorthand` describes, for a vocabulary's
 * `tags`. Make one per tag, once: `h` shares it across renders.
 *
 * **Details**
 *
 * The result is a function with the builder's class and fields. Its chain
 * methods copy only the builder's fields, so the function's own `name` and
 * `length` never reach a node.
 *
 * @stability experimental
 * @category vocabularies
 * @since 0.1.0
 */
export const shorthand = <
  B extends ElementBuilder<any, any, any, any> & {
    readonly children: (...inputs: any) => WithRequirements<B, any>
  }
>(
  builder: B
): Shorthand<B> => {
  const root = (...inputs: ReadonlyArray<Input<any, any>>) =>
    (root as any).children(...inputs)
  Object.setPrototypeOf(root, Object.getPrototypeOf(builder))
  Object.assign(root, builder)
  return markRoot(root as any)
}

/**
 * Marks a vocabulary's root builder, which every render shares and nothing
 * gives another field, to be copied as a copier's builders are when it holds
 * the base fields only. A `shorthand` root is marked already. Returns it.
 *
 * @internal
 */
export const markRoot = <B extends ElementBuilder<any, any, any, any>>(
  builder: B
): B => {
  let fields = 0
  for (const _ in builder) fields++
  if (fields === builderFields.length) (builder as any)[copied] = true
  return builder
}

/**
 * A type-level function from a message type to a set of element constructors,
 * which a vocabulary implements.
 *
 * **Details**
 *
 * `Tags` is read with `Msg` bound: `(V & { Msg })["Tags"]`. `Host` is the
 * service a host's Layer provides to say it can show these elements, which
 * `mount` requires for the root.
 *
 * `Head` is the entry type a component's `head` returns, and `HeadValue`
 * the value the vocabulary's merge folds them into.
 * A vocabulary that declares neither has `Head`'s host-neutral title
 * entries. Read them with `HeadEntry` and `HeadValue`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Elements {
  readonly Msg: unknown
  readonly Tags: unknown
  readonly Host: unknown
  readonly Head?: unknown
  readonly HeadValue?: unknown
}

/**
 * The entries a component of vocabulary `V` may return from `head`: the
 * vocabulary's `Head`, or `Head.Entry` when `V` is `never` or declares none.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type HeadEntry<V> = [V] extends [never] ? Head.Entry
  : V extends { readonly Head: infer E } ? E
  : Head.Entry

/**
 * The folded head of vocabulary `V`: the vocabulary's `HeadValue`, or
 * `Head.Head` when `V` is `never` or declares none.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type HeadValue<V> = [V] extends [never] ? Head.Head
  : V extends { readonly HeadValue: infer H } ? H
  : Head.Head

/**
 * How a vocabulary folds its head: `merge` folds a tree of entries into the
 * vocabulary's value, reporting conflicts, and `title` reads the title out of
 * that value for the Router's announcement.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HeadFold<E = any, H = any> {
  readonly merge: (tree: Head.Tree<E>, options?: Head.MergeOptions) => H
  readonly title: (head: H) => string | undefined
}

/**
 * The runtime half of a vocabulary: its root element builders, installed on
 * `h` and shared by every render.
 *
 * **Details**
 *
 * A tag that takes children is a `shorthand` builder, so `h.span(title)`
 * works; a void tag is a plain builder.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Vocabulary<out V extends Elements = Elements> {
  readonly name: string
  readonly tags: Readonly<Record<string, ElementBuilder<any, any, any, any>>>
  /**
   * The only tags that may hold text, for a vocabulary such as a native one
   * where text lives in a text primitive. `h.el` checks it at runtime. Text
   * goes anywhere when it's left out.
   */
  readonly textParents?: ReadonlyArray<string> | undefined
  /**
   * How the vocabulary folds its head, when the root of a mount is of this
   * vocabulary. Without it, `Head.merge` folds the title only.
   */
  readonly head?: HeadFold | undefined
  /**
   * Phantom: the type-level half of the vocabulary. A vocabulary written as a
   * module, such as `Html`, exports it as an `undefined` value, so the module
   * namespace itself is a `Vocabulary`.
   */
  readonly Elements?: V | undefined
}

/**
 * The element names a vocabulary adds to `h`, bound to a component's message
 * type. Nothing when `V` is `never`.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type Tags<V, Msg> = [V] extends [never] ? {}
  : V extends Elements ? (V & { readonly Msg: Msg })["Tags"]
  : {}

/**
 * Combines {@link Helper} with a vocabulary's {@link Tags}. When the
 * vocabulary declares its own `text` tag (such as a terminal or native
 * vocabulary), the vocabulary's `text` replaces `Helper.text`.
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type WithTags<Msg, Props, V> =
  & ("text" extends keyof Tags<V, Msg> ? HelperBase<Msg, Props>
    : Helper<Msg, Props>)
  & Tags<V, Msg>

/**
 * The view helper, `h` in `view`: bound to the component's message type and
 * carrying its props.
 *
 * **Details**
 *
 * The core helper has `el` and `text`. A vocabulary's element names
 * are mixed in by `Component.define`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Helper<Msg, Props> extends HelperBase<Msg, Props> {
  /** A text node. The only way to put text in a native view. */
  text(text: string): Text
}

/**
 * The view helper without `text`: what every `h` has, including one whose
 * vocabulary declares its own `text` tag. A function that takes any `h`
 * types it with this.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface HelperBase<Msg, Props> {
  readonly props: Props
  /**
   * Any host element by name, with untyped event payloads. What host-neutral
   * code uses: `h.el("x-foo").attr("a", "b").children(...)`.
   */
  el(tag: string): ContainerBuilder<Msg>
  /** Shorthand for `h.el(tag).children(...children)`, with at least one child. */
  el<
    const C extends readonly [
      Input<Msg, any>,
      ...ReadonlyArray<Input<Msg, any>>
    ]
  >(
    tag: string,
    ...children: C
  ): ContainerBuilder<Msg, Requirements<C[number]>>
  /**
   * Whether this instance has a run of the Command in flight, of the group if
   * a pick of its `group` fields is given: queued, running, awaiting, or
   * stopping until its fiber exits, cleanup included. It ends when the run's
   * message has been delivered, or at fiber exit for a run that sends none.
   * Per instance and view only: `update` can't read it, so what `update`
   * decides on, such as ignoring a submit while saving, belongs in the Model.
   */
  isRunning<Args, G extends string>(
    command: Command.Definition<Args, any, boolean, any, G>,
    ...group: Command.GroupArg<Args, G>
  ): boolean
  /**
   * An element id derived from the instance's path, matching server and client.
   * Use distinct mount `key` options for repeated roots in one document to
   * avoid collisions.
   */
  id(name: string, key?: string | number | undefined): string
  /**
   * The node `fn` builds from `args`, built again only when an argument
   * changes. `fn` gets this helper first, then `args`.
   *
   * **Details**
   *
   * The arguments are compared with `===` to the ones of the last render's
   * call with the same `fn` and first argument. When they're the same, `fn`
   * isn't called and the last node is used again. When that node holds only
   * elements and text, the runtime skips its patch and only sets its
   * controlled properties again, such as an input's `value`.
   *
   * `fn` must depend only on its arguments: what it reads from the helper,
   * such as `h.isRunning`, may be out of date. Declare it outside the view,
   * since a new function each render never matches. The first argument tells
   * calls apart, so give each call its own, such as the row it shows. A call
   * whose first argument an earlier call of the same render used is built
   * every render.
   *
   * **Example** (Rows built again only when they change)
   *
   * ```ts
   * import type { Html } from "@effect/ui/html"
   *
   * type Row = { readonly id: number; readonly label: string }
   *
   * const row = <M>(h: Html.H<M>, row: Row, selected: boolean) =>
   *   h.tr.key(String(row.id)).class(selected && "danger").children(row.label)
   *
   * const rows = <M>(h: Html.H<M>, rows: ReadonlyArray<Row>, selected: number) =>
   *   h.tbody.children(rows.map((item) => h.lazy(row, item, item.id === selected)))
   * ```
   */
  lazy<H, A extends ReadonlyArray<unknown>, C extends Content<Msg, any>>(
    this: H,
    fn: (h: H, ...args: A) => C,
    ...args: A
  ): Node<Msg, Requirements<C>>
  /**
   * The nodes `render` builds for `items`, each built again only when its
   * item, or whether it's the selected one, changes: what a keyed list of
   * rows, one of which may be selected, renders with.
   *
   * **Details**
   *
   * `key` names an item; `selected`, if given, is the key of the selected
   * one, and `render` is told whether its item is it. An item is the same as
   * the last render's when it's the same value, compared with `===`, so a
   * Model that keeps the items it doesn't change keeps their nodes. `key`
   * must give an item the same key on every render, as the keys of any keyed
   * list do: it may be a new function each time, but one that names the
   * items differently, such as by another field, keeps the last render's
   * nodes and selection for items that didn't change. Show such a list under
   * another `render`, or with new items.
   *
   * When `items` and `selected` are both the ones of the last render, the
   * result is the last render's array, and the runtime skips the list. When
   * only `selected` changes, only the rows that gain or lose it are built.
   * `render` must depend only on its arguments, as `h.lazy`'s `fn` does, and
   * should be declared outside the view: it tells lists apart, so a view that
   * shows two lists gives each its own.
   *
   * **Example** (A table whose rows can be selected)
   *
   * ```ts
   * import type { Html } from "@effect/ui/html"
   *
   * type Row = { readonly id: number; readonly label: string }
   *
   * const row = <M>(h: Html.H<M>, row: Row, selected: boolean) =>
   *   h.tr.key(String(row.id)).class(selected && "danger").children(row.label)
   *
   * const rows = <M>(h: Html.H<M>, rows: ReadonlyArray<Row>, selected: number) =>
   *   h.tbody.children(h.list(rows, { key: (row) => row.id, selected }, row))
   * ```
   */
  list<H, A, K, C extends Content<Msg, any>>(
    this: H,
    items: ReadonlyArray<A>,
    options: {
      readonly key: (item: A) => K
      readonly selected?: K | undefined
    },
    render: (h: H, item: A, selected: boolean) => C
  ): ReadonlyArray<Node<Msg, Requirements<C>>>
}

/**
 * What `h.lazy` keeps between one instance's renders: for each first
 * argument, the last call's function, arguments and node.
 *
 * @internal
 */
export class Lazies {
  entries = new Map<unknown, LazyEntry>()
  /** What `h.list` keeps, by its `render` function. */
  lists: Map<Function, ListState> | undefined = undefined
  /** The render the entries were last used in, and how many were. */
  round = 1
  used = 0
  /** Dev-only hook called on a miss before `fn` runs and `entry` is updated. */
  declare missed?: (
    entry: LazyEntry | undefined,
    fn: Function,
    args: ReadonlyArray<unknown>
  ) => void
  /** How many lists this render showed. */
  listsUsed = 0
  begin(): void {
    this.round++
    this.used = 0
    this.listsUsed = 0
  }
  /** Drops the lists this render didn't show. */
  endLists(): void {
    const lists = this.lists
    // A render that showed every list it kept, the usual case, has none to drop.
    if (lists === undefined || lists.size === this.listsUsed) return
    const round = this.round
    lists.forEach((state, render) => {
      if (state.round !== round) lists.delete(render)
    })
  }
  /**
   * Drops the entries renders haven't used, such as a removed row's, once
   * they are as many as the ones this render used. Looking for them reads
   * every entry, so a render that rebuilds a few rows doesn't: what a render
   * costs follows what it changed, and the entries kept are at most twice
   * the ones in use.
   */
  end(): void {
    const entries = this.entries
    const round = this.round
    if (entries.size - this.used < this.used || this.used === entries.size) {
      return
    }
    // `forEach`, as iterating with `for...of` makes an array for every entry.
    // When most go, the rest move to a new Map: a Map keeps its size after deletes.
    if (this.used * 4 <= entries.size) {
      const kept = new Map<unknown, LazyEntry>()
      entries.forEach((entry, key) => {
        if (entry.round === round) kept.set(key, entry)
      })
      this.entries = kept
      return
    }
    entries.forEach((entry, key) => {
      if (entry.round !== round) entries.delete(key)
    })
  }
}

interface ListState {
  items: ReadonlyArray<unknown>
  selected: unknown
  nodes: Array<Node<any, any>>
  /** The index of each key in `items`, made when a selection first changes. */
  at: Map<unknown, number> | undefined
  round: number
}

/**
 * The arrays `h.list` returns: nodes as `children` would make them, which an
 * element takes as they are, so a list given again is the same array.
 */
const lists = new WeakSet<ReadonlyArray<unknown>>()

/**
 * How an array `h.list` returned differs from the one it returned before,
 * `base`, when a runtime patching one in place of the other needs to look at
 * a few of its nodes only: the indexes in `changed`, the two being of one
 * length, or, when `changed` is `undefined`, `removed` nodes taken out at
 * `start` and `added` new ones put in there, with nothing else changed.
 *
 * @internal
 */
export interface ListHint {
  readonly base: ReadonlyArray<unknown>
  readonly changed: ReadonlyArray<number> | undefined
  readonly start: number
  readonly removed: number
  readonly added: number
  /**
   * With `changed` `undefined`, the index of the node that traded places
   * with the one at `start`, nothing else changed: `removed` and `added`
   * are 0 then.
   */
  readonly traded?: number | undefined
}

const hints = new WeakMap<ReadonlyArray<unknown>, ListHint>()

/**
 * The hint for `nodes`, taken: a hint holds the array before, which would
 * hold the one before it through its own hint, so each is read once.
 *
 * @internal
 */
export const takeListHint = (
  nodes: ReadonlyArray<unknown>
): ListHint | undefined => {
  const hint = hints.get(nodes)
  if (hint !== undefined) hints.delete(nodes)
  return hint
}

const changedHint = (
  base: ReadonlyArray<unknown>,
  changed: ReadonlyArray<number>
): ListHint => ({
  base,
  changed,
  start: 0,
  removed: 0,
  added: 0,
  traded: undefined
})

/**
 * `h.list`'s nodes for `items` when they are as many as the last render's,
 * with the same keys in the same order, and some changed in place: the last
 * render's nodes with those built again. `undefined` as soon as a key
 * differs, as when rows move. Only called when the selection didn't change.
 */
const inPlaceOf = (
  state: ListState,
  items: ReadonlyArray<unknown>,
  key: (item: unknown) => unknown,
  selected: unknown,
  make: (item: unknown, chosen: boolean) => Node<any, any>
): Array<Node<any, any>> | undefined => {
  const before = state.items
  const nodes = state.nodes
  let out: Array<Node<any, any>> | undefined
  let changed: Array<number> | undefined
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (before[index] === item) continue
    const itemKey = key(item)
    if (key(before[index]) !== itemKey) {
      return out === undefined ? tradedOf(state, items, index) : undefined
    }
    ;(out ??= nodes.slice())[index] = make(
      item,
      selected !== undefined && itemKey === selected
    )
    ;(changed ??= []).push(index)
  }
  if (out === undefined) return nodes
  hints.set(out, changedHint(nodes, changed!))
  return out
}

/**
 * `h.list`'s nodes for `items` when the item at `from`, the first that
 * differs from the last render's, traded places with one after it, and the
 * rest are the same values where they were, as when a row moves up or down
 * one: the last render's nodes with those two traded. `undefined` for any
 * other change.
 */
const tradedOf = (
  state: ListState,
  items: ReadonlyArray<unknown>,
  from: number
): Array<Node<any, any>> | undefined => {
  const before = state.items
  let to = items.length - 1
  while (to > from && before[to] === items[to]) to--
  if (to === from || before[from] !== items[to] || before[to] !== items[from]) {
    return undefined
  }
  for (let index = from + 1; index < to; index++) {
    if (before[index] !== items[index]) return undefined
  }
  const nodes = state.nodes
  const out = nodes.slice()
  out[from] = nodes[to]!
  out[to] = nodes[from]!
  hints.set(out, {
    base: nodes,
    changed: undefined,
    start: from,
    removed: 0,
    added: 0,
    traded: to
  })
  return out
}

/**
 * `h.list`'s nodes for `items` when they are the last render's items with
 * some inserted, or some removed, in one place, and the rest the same values
 * in the same order: the last render's nodes with the new ones put in, or
 * the old ones taken out. `undefined` for any other change. Only called when
 * the selection didn't change, so a kept item's node is still right.
 */
const spliceOf = (
  state: ListState,
  items: ReadonlyArray<unknown>,
  build: (item: unknown) => Node<any, any>
): Array<Node<any, any>> | undefined => {
  const before = state.items
  const nodes = state.nodes
  const shorter = Math.min(before.length, items.length)
  let start = 0
  while (start < shorter && before[start] === items[start]) start++
  let kept = 0
  while (
    kept < shorter - start &&
    before[before.length - 1 - kept] === items[items.length - 1 - kept]
  ) kept++
  const removed = before.length - start - kept
  const added = items.length - start - kept
  if (removed > 0 && added > 0) return undefined
  if (removed === 0 && added === 0) return nodes
  // An empty list needs no hint: a runtime removes everything.
  if (items.length === 0) return []
  let out: Array<Node<any, any>>
  if (added === 0) {
    out = nodes.slice()
    out.splice(start, removed)
  } else {
    out = new Array(items.length)
    for (let index = 0; index < start; index++) out[index] = nodes[index]!
    for (let index = start; index < start + added; index++) {
      out[index] = build(items[index])
    }
    for (let index = start + added; index < items.length; index++) {
      out[index] = nodes[index - added]!
    }
  }
  hints.set(out, {
    base: nodes,
    changed: undefined,
    start,
    removed,
    added,
    traded: undefined
  })
  return out
}

/** Whether `children` can take `input` as its nodes. @internal */
export const isList = (
  input: unknown
): input is ReadonlyArray<Node<any, any>> =>
  Array.isArray(input) && lists.has(input)

/** @internal */
export interface LazyEntry {
  fn: Function
  args: ReadonlyArray<unknown>
  node: Node<any, any>
  round: number
}

/**
 * Where a host keeps what `h.lazy` built between one instance's renders: an
 * object it keeps for the instance, with `lazy` `undefined` at first.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LazyStore {
  lazy: unknown
}

/**
 * `h.list`'s nodes for `items`, a new array: the node of an item the last
 * render showed, if it's still selected or not as it was, and a new one for
 * any other. The two arrays are walked side by side, so items kept in their
 * order, with some added, removed or changed in place, are matched without
 * a map.
 */
const reuse = (
  state: ListState,
  items: ReadonlyArray<unknown>,
  key: (item: unknown) => unknown,
  selected: unknown,
  build: (item: unknown) => Node<any, any>,
  changed: Array<number> | undefined
): Array<Node<any, any>> => {
  const before = state.items
  const nodes = state.nodes
  const moved = selected !== state.selected
  const out: Array<Node<any, any>> = new Array(items.length)
  let from = 0
  let byItem: Map<unknown, number> | undefined
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    let was = -1
    if (from < before.length && before[from] === item) was = from++
    else if (from + 1 < before.length && before[from + 1] === item) {
      was = from + 1
      from += 2
    } else if (from < before.length && key(before[from]) === key(item)) {
      // An item given again changed, in its place: built again.
      from++
    } else {
      if (byItem === undefined) {
        byItem = new Map()
        for (let at = 0; at < before.length; at++) byItem.set(before[at], at)
      }
      was = byItem.get(item) ?? -1
    }
    const node = out[index] = was >= 0 &&
        (!moved ||
          (key(item) !== selected && key(item) !== state.selected))
      ? nodes[was]!
      : build(item)
    if (changed !== undefined && node !== nodes[index]) changed.push(index)
  }
  return out
}

const sameArgs = (
  a: ReadonlyArray<unknown>,
  b: ReadonlyArray<unknown>
): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * What `h.isRunning` asks: whether the instance has a run of the named Command,
 * of the group key if given.
 *
 * @internal
 */
export type Running = (name: string, groupKey: string | undefined) => boolean

const notRunning: Running = () => false

class HelperImpl<Msg, Props> implements Helper<Msg, Props> {
  // Declared only: a declared field is defined by a function of its own
  // before the constructor runs, and a view makes a helper on every render.
  declare readonly props: Props
  declare readonly elements: Vocabulary<any> | undefined
  declare readonly runningFn: Running
  /** The instance's path, or the instance, whose path is read only when `id` is called. */
  declare readonly at: string | PathSource
  declare readonly store: LazyStore | undefined
  constructor(
    props: Props,
    elements: Vocabulary<any> | undefined,
    running: Running | undefined,
    at: string | PathSource,
    store: LazyStore | undefined
  ) {
    this.props = props
    this.elements = elements
    this.runningFn = running ?? notRunning
    this.at = at
    this.store = store
  }
  lazy(
    this: any,
    fn: (h: any, ...args: Array<any>) => Content<Msg, any>,
    ...args: Array<any>
  ): any {
    const store = this.store
    if (store === undefined) return toNode(fn(this, ...args))
    const lazies = (store.lazy ??= new Lazies()) as Lazies
    const key = args.length === 0 ? fn : args[0]
    const entry = lazies.entries.get(key)
    const round = lazies.round
    // Up to two arguments, the common case, compared in place: a view calls
    // this for every row it shows.
    const was = entry?.args
    if (
      entry !== undefined && entry.fn === fn && was!.length === args.length &&
      (args.length > 2
        ? sameArgs(was!, args)
        : was![0] === args[0] && was![1] === args[1])
    ) {
      if (entry.round !== round) {
        entry.round = round
        lazies.used++
      }
      return entry.node
    }
    if (dev) lazies.missed?.(entry, fn, args)
    const node = toNode(fn(this, ...args))
    // A key an earlier call of this render took stays theirs.
    if (entry !== undefined && entry.round === round) return node
    if (entry === undefined) lazies.entries.set(key, { fn, args, node, round })
    else {
      entry.fn = fn
      entry.args = args
      entry.node = node
      entry.round = round
    }
    lazies.used++
    return node
  }
  list(
    this: any,
    items: ReadonlyArray<unknown>,
    options: {
      readonly key: (item: any) => unknown
      readonly selected?: unknown
    },
    render: (h: any, item: any, selected: boolean) => Content<Msg, any>
  ): ReadonlyArray<Node<Msg, any>> {
    const key = options.key
    const selected = options.selected
    // `chosen`: whether the item is the selected one, for a caller that has
    // its key already.
    const make = (item: unknown, chosen: boolean) => {
      const content = render(this, item, chosen)
      // A template's element is a node already. Told apart by its field, not
      // its class, so an app without templates doesn't keep the class.
      const node = (content as TemplateNode)["~t"] !== undefined
        ? content as TemplateNode
        : toNode(content)
      // A row's text would join its neighbours'.
      if (node._tag === "Text") {
        throw new Error("h.list: render an element for each item, not text")
      }
      return node
    }
    const build = (item: unknown) =>
      make(item, selected !== undefined && key(item) === selected)
    const store = this.store
    const lazies = store === undefined
      ? undefined
      : (store.lazy ??= new Lazies()) as Lazies
    const state = lazies?.lists?.get(render)
    // A list whose render another list of this render took is built whole.
    if (lazies === undefined || state?.round === lazies.round) {
      return items.map(build)
    }
    // A hint the runtime didn't take is stale now, and would keep the arrays
    // before it.
    if (state !== undefined) hints.delete(state.nodes)
    let nodes: Array<Node<Msg, any>>
    let at: Map<unknown, number> | undefined
    if (state === undefined || state.items.length === 0) {
      nodes = items.map(build)
    } else if (items === state.items) {
      at = state.at
      if (selected === state.selected) nodes = state.nodes
      else {
        nodes = state.nodes.slice()
        if (at === undefined) {
          at = new Map()
          for (let index = 0; index < items.length; index++) {
            at.set(key(items[index]), index)
          }
        }
        const changed: Array<number> = []
        if (at.size === items.length) {
          for (const key of [state.selected, selected]) {
            const index = key === undefined ? undefined : at.get(key)
            if (index !== undefined) {
              nodes[index] = build(items[index])
              changed.push(index)
            }
          }
        } else {
          // Keys repeat, and the map holds the last item of each: every item
          // with either key gains or loses the selection.
          for (let index = 0; index < items.length; index++) {
            const named = key(items[index])
            if (
              named !== undefined &&
              (named === state.selected || named === selected)
            ) {
              nodes[index] = build(items[index])
              changed.push(index)
            }
          }
        }
        hints.set(nodes, changedHint(state.nodes, changed))
      }
    } else {
      const spliced = selected !== state.selected
        ? undefined
        : items.length === state.items.length
        ? inPlaceOf(state, items, key, selected, make)
        : spliceOf(state, items, build)
      if (spliced !== undefined) nodes = spliced
      else {
        const changed = items.length === state.nodes.length ? [] : undefined
        nodes = reuse(state, items, key, selected, build, changed)
        if (changed !== undefined) {
          hints.set(nodes, changedHint(state.nodes, changed))
        }
      }
    }
    const next: ListState = state ?? {
      items,
      selected,
      nodes,
      at: undefined,
      round: lazies.round
    }
    next.items = items
    next.selected = selected
    next.nodes = nodes
    next.at = at
    next.round = lazies.round
    lazies.listsUsed++
    if (state === undefined) (lazies.lists ??= new Map()).set(render, next)
    lists.add(nodes)
    return nodes
  }
  keepAlive(this: any, alive: any, content?: any): unknown {
    const s = Object.create(this)
    s["~alive"] = content ? alive : true
    return (content ?? alive)(s)
  }
  isRunning(command: Command.Definition.Any, group?: unknown): boolean {
    return this.runningFn(
      Command.nameOf(command),
      Command.groupKeyOf(command, group)
    )
  }
  id(name: string, key?: string | number | undefined): string {
    const at = this.at
    return idOf(typeof at === "string" ? at : at.path, name, key)
  }
  el(tag: string, ...inputs: ReadonlyArray<Input<Msg, any>>): any {
    const textParents = this.elements?.textParents
    const builder = textParents === undefined || textParents.includes(tag)
      ? new ContainerBuilder<Msg>(tag)
      : new NoTextBuilder<Msg>(tag, this.elements!)
    return inputs.length === 0 ? builder : builder.children(...inputs)
  }
  text(value: string): Text {
    return text(value)
  }
}

/** `h.el` of a tag that can't hold text in the helper's vocabulary. */
class NoTextBuilder<Msg> extends ContainerBuilder<Msg> {
  readonly vocabulary: Vocabulary<any>
  constructor(tag: string, vocabulary: Vocabulary<any>) {
    super(tag)
    this.vocabulary = vocabulary
  }
  override children(...inputs: ReadonlyArray<Input<Msg, unknown>>): any {
    return withNoTextContent(this, inputs, this.vocabulary)
  }
}

const helperClasses = new WeakMap<
  Vocabulary<any>,
  typeof HelperImpl<any, any>
>()
let lastElements: Vocabulary<any> | undefined
let lastHelperClass: typeof HelperImpl<any, any> | undefined

/**
 * What a runtime can give a view in place of its path: something whose
 * `path` is read only when `h.id` is called.
 *
 * @internal
 */
export interface PathSource {
  readonly path: string
}

const lazyPathViews = new WeakSet<object>()

/**
 * Marks `view` as taking a `PathSource` for its path. Only views that
 * `make` builds are marked: a view written or wrapped by hand is given the
 * path as a string, as its type says.
 *
 * @internal
 */
export const readsPathLazily = <F extends object>(view: F): F => {
  lazyPathViews.add(view)
  return view
}

/**
 * Whether `view` takes a `PathSource` for its path.
 *
 * @internal
 */
export const takesPathSource = (view: object): boolean =>
  lazyPathViews.has(view)

/**
 * Builds the view helper for one render, with a vocabulary's element names
 * mixed in when one is given.
 *
 * @internal
 */
export const makeHelper = <Msg, Props, V extends Elements = never>(
  props: Props,
  elements: Vocabulary<V> | undefined,
  running?: Running | undefined,
  path?: string | PathSource | undefined,
  store?: LazyStore | undefined
): WithTags<Msg, Props, V> => {
  if (elements === undefined) {
    return new HelperImpl(props, undefined, running, path ?? "", store) as any
  }
  let Class = elements === lastElements
    ? lastHelperClass
    : helperClasses.get(elements)
  if (Class === undefined) {
    const Made = class extends HelperImpl<any, any> {}
    Object.assign(Made.prototype, elements.tags)
    helperClasses.set(elements, Class = Made)
  }
  lastElements = elements
  lastHelperClass = Class
  return new Class(props, elements, running, path ?? "", store) as any
}

/**
 * The text of a view, with the text of every element concatenated in order.
 * A child contributes the text of what its parent passed for its slots, in
 * the order they were passed, and nothing of its own view.
 *
 * @stability experimental
 * @category queries
 * @since 0.1.0
 */
export const textOf = (node: Node<any, any>): string => {
  switch (node._tag) {
    case "Text":
      return node.text
    case "Element":
      return node.children.map(textOf).join("")
    case "Child":
      return slotNodes(node).map(textOf).join("")
    case "Outlet":
      return ""
  }
}

/**
 * Every node of a view in document order, the root first. A child is
 * followed by what its parent passed for its slots, in the order they were
 * passed.
 *
 * @stability experimental
 * @category queries
 * @since 0.1.0
 */
export const nodes = function*<Msg>(
  node: Node<Msg, any>
): Generator<Node<Msg, any>> {
  yield node
  if (node._tag === "Element") {
    for (const child of node.children) yield* nodes(child)
  } else if (node._tag === "Child") {
    for (const child of slotNodes(node)) yield* nodes(child)
  }
}

const noNodes: ReadonlyArray<never> = []

/**
 * The nodes a child's parent passed for its slots, in the order they were
 * passed.
 *
 * @internal
 */
export const slotNodes = <Msg>(
  child: Child<Msg, any>
): ReadonlyArray<Node<Msg, any>> => {
  if (child.slots === undefined) return noNodes
  const out: Array<Node<Msg, any>> = []
  for (const name in child.slots) {
    out.push(...children<Msg>([child.slots[name]]))
  }
  return out
}

/**
 * Turns a view of rows that differ only in a few values into one built once:
 * `build` writes the element with the given helper as any view does, and
 * reads the values that change from `slots`. The result is a function from
 * those values to the element, which costs one small object per call where
 * a view built with the helper costs one or more per element and chain call.
 *
 * **Details**
 *
 * `build` runs once, with each slot read as a placeholder. A slot may be the
 * whole value of an attribute, the whole text of a child, a handler, or the
 * key of the root: `h.tr.key($.key).class($.selected).children(h.td($.label))`.
 * A slot used inside a larger value, as in `"Hi " + $.name` or
 * `class("row", $.state)`, throws, as do components, slots of the
 * component, properties, mounts, refs and the parts of headless components
 * in the element: put those in the view around it. Another template may be
 * used in `build`, with this one's slots or fixed values as its values: it
 * becomes part of this one.
 *
 * A text slot takes a string. An attribute slot takes a string, or
 * `undefined`, `null` or `false` to leave the attribute out. A handler slot
 * takes what `on` does. A slot that is an element's only child, as in
 * `h.tbody.children($.rows)`, also takes an array of nodes, such as a list
 * `h.list` returns, which the element holds: the layout around a list can be
 * a template, and a render patches only the list.
 *
 * The browser host renders a template made with `Html.template` by copying
 * the nodes it built for the first one and writing the slots, and patches
 * one by comparing its slots with the last render's: the code for that
 * comes with `Html.template`, so an app that makes no template doesn't ship
 * it. A template made with this function, and anything else that reads the
 * element, such as the server renderer, hydration or a test host, sees the
 * same element a view built with the helper would.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const template = <Values extends Record<string, unknown>, H>(
  helper: H,
  build: (h: H, slots: Values) => Content<any, any>
): (values: Values) => Element<any, Requirements<Values[keyof Values]>> =>
  makeTemplate(helper, build, undefined)

/**
 * `template`, with the operations a host that copies nodes renders it with,
 * as `Html.template` gives them. Without them, every host builds the
 * template's element as it builds any other.
 *
 * @internal
 */
export const makeTemplate = <Values extends Record<string, unknown>, H>(
  helper: H,
  build: (h: H, slots: Values) => Content<any, any>,
  kernel: TemplateKernel | undefined
): (values: Values) => Element<any, Requirements<Values[keyof Values]>> => {
  const def = defineTemplate(
    toNode(build(helper, slotProxy as Values)),
    kernel
  )
  return (values) => new TemplateNode(def, values)
}

/**
 * How a host that copies nodes renders a template's elements: `create`
 * builds one, returning its record, and `patch` patches one record made by
 * `create` to the template's next element. Kept on the template, so the
 * kernel only reaches them through a template that has them.
 *
 * @internal
 */
export interface TemplateKernel {
  readonly create: (inst: unknown, view: TemplateNode) => unknown
  readonly patch: (
    inst: unknown,
    rec: unknown,
    prev: TemplateNode,
    view: TemplateNode
  ) => void
}

const slotMark = "\u0000@effect/ui/View/slot\u0000"
// Ends a slot's placeholder, so that one with text after it, as in
// `$.name + "!"`, is no slot's name but a slot inside a larger value.
const slotEnd = "\u0000"

const slotProxy = new Proxy({}, {
  get: (_, name) =>
    typeof name === "string" ? slotMark + name + slotEnd : undefined
})

const slotOf = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" || !value.startsWith(slotMark) ||
    !value.endsWith(slotEnd)
  ) return undefined
  const name = value.slice(slotMark.length, -slotEnd.length)
  return name.includes(slotEnd) ? undefined : name
}

const noSlot = (value: unknown, where: string): void => {
  if (typeof value === "string" && value.includes(slotMark)) {
    throw new Error(
      `View.template: a slot is ${where} with other text; give it the whole value`
    )
  }
}

/**
 * A slot of a template: where its value goes, as the index of the point that
 * holds it, and how it's written.
 *
 * @internal
 */
export interface TemplateHole {
  readonly point: number
  /**
   * `"content"` for a slot that is its element's only child: it takes text,
   * written as a `"text"` slot's is, or an array of nodes, which the element
   * holds instead.
   */
  readonly kind: "text" | "attr" | "handler" | "content"
  /** The attribute's or the event's name. */
  readonly name: string
  readonly slot: string
  /** A content slot's element, as the number of its node. */
  readonly owner: number
  /** A content slot's place among the template's content slots. */
  readonly index: number
}

/**
 * What an element of a template that has handlers dispatches through, in
 * place of a record, the same for every element the template makes: a host
 * reads a slot's handler off the values of the element it's in, the
 * nearest one up whose record a host marked as a template's.
 *
 * @internal
 */
export interface TemplateTarget {
  readonly v: TemplateTarget
  /** Each event's handler, or for a slot's the slot's name. */
  readonly handlers: Readonly<Record<string, unknown>>
  readonly eventOptions: Readonly<Record<string, EventOptions>>
  /** The slot of each event whose handler is one. */
  readonly slots: Readonly<Record<string, string>>
  readonly "~target": true
}

/**
 * What `template` makes once: the element with placeholders, the paths to the
 * nodes the slots write, its holes, and the element the host builds its
 * nodes from.
 *
 * @internal
 */
export interface TemplateDef {
  readonly root: Element<any, any>
  readonly keySlot: string | undefined
  /**
   * How to reach the nodes the slots write, from a copy's root: step `i`
   * reads node `i + 1`, the first child (`next[i]` 0) or the next sibling (1)
   * of node `from[i]`. Node 0 is the root. A hole's `point`, and a handled
   * element's, is the number of its node.
   */
  readonly walk: {
    readonly from: ReadonlyArray<number>
    readonly next: ReadonlyArray<number>
  }
  readonly holes: ReadonlyArray<TemplateHole>
  /** The text slots, the attribute slots and the content slots, apart: what a render writes. */
  readonly texts: ReadonlyArray<TemplateHole>
  readonly attrs: ReadonlyArray<TemplateHole>
  readonly contents: ReadonlyArray<TemplateHole>
  /** The slots a patch writes: all but the handlers, read when their events come. */
  readonly writes: ReadonlyArray<TemplateHole>
  /** Whether the root has children, which its record makes when patched. */
  readonly parent: boolean
  /** How far below the root its deepest element with handlers is. */
  readonly depth: number
  /** For each point that is an element with handlers, its static handlers and options. */
  readonly handled: ReadonlyArray<
    {
      /** The child indexes from the root to the element. */
      readonly path: ReadonlyArray<number>
      /**
       * The number of the element's node, as a hole's `point`: a host finds
       * which element an event came from by the node, not by where it is, as
       * a node something else put in the row would move it.
       */
      readonly point: number
      readonly target: TemplateTarget
    }
  >
  /** The element without its slots: no handlers, slot attributes left out and slot text a space. */
  readonly blank: Element<any, any>
  /** The operations a host that copies nodes renders the template with. */
  readonly kernel: TemplateKernel | undefined
}

const defineTemplate = (
  root: Node<any, any>,
  kernel: TemplateKernel | undefined
): TemplateDef => {
  if (root._tag !== "Element") {
    throw new Error("View.template: build an element")
  }
  const points: Array<ReadonlyArray<number>> = []
  const holes: Array<TemplateHole> = []
  const handled: Array<TemplateDef["handled"][number]> = []
  let keySlot: string | undefined
  let contents = 0
  const pointOf = (path: ReadonlyArray<number>): number => {
    const last = points[points.length - 1]
    if (last !== undefined && last.join() === path.join()) {
      return points.length - 1
    }
    points.push(path)
    return points.length - 1
  }
  const visit = (
    view: Node<any, any>,
    path: ReadonlyArray<number>
  ): Node<any, any> => {
    // A template built inside this one is its element, with this one's slots
    // in its own.
    const node = asElement(view)
    if (node._tag === "Text") {
      const slot = slotOf(node.text)
      if (slot === undefined) {
        noSlot(node.text, "in a text")
        return node
      }
      holes.push({
        point: pointOf(path),
        kind: "text",
        name: "",
        slot,
        owner: -1,
        index: -1
      })
      // A placeholder the copy holds, which every render writes.
      return text(" ")
    }
    if (node._tag !== "Element") {
      throw new Error(
        `View.template: a template holds elements and text, not a ${node._tag}`
      )
    }
    if (
      node.props !== noFields || node.mount !== undefined ||
      node.refKey !== undefined || (node.owned?.length ?? 0) > 0 ||
      node.tag === "form" || node.tag === "script" || node.tag.includes("-")
    ) {
      throw new Error(
        `View.template: <${node.tag}> holds properties, a mount, a ref or a part, or is a form, a script or a custom element; put it in the view around the template`
      )
    }
    const key = slotOf(node.elementKey)
    if (key !== undefined) {
      if (path.length > 0) {
        throw new Error("View.template: only the root's key can be a slot")
      }
      keySlot = key
    } else noSlot(node.elementKey, "in a key")
    let attrs: Record<string, string> | undefined
    for (const name in node.attrs) {
      const value = node.attrs[name]!
      const slot = slotOf(value)
      if (slot === undefined) {
        noSlot(value, `in the attribute ${name}`)
        continue
      }
      holes.push({
        point: pointOf(path),
        kind: "attr",
        name,
        slot,
        owner: -1,
        index: -1
      })
      attrs ??= { ...node.attrs }
      delete attrs[name]
    }
    if (node.handlers !== noFields || node.eventOptions !== noFields) {
      const handlers: Record<string, unknown> = {}
      const slots: Record<string, string> = {}
      for (const name in node.handlers) {
        const slot = slotOf(node.handlers[name])
        if (slot === undefined) handlers[name] = node.handlers[name]
        else {
          handlers[name] = slot
          slots[name] = slot
          // A handler is read off the values when its event comes: no node.
          holes.push({
            point: -1,
            kind: "handler",
            name,
            slot,
            owner: -1,
            index: -1
          })
        }
      }
      const target: Mutable<TemplateTarget> = {
        v: undefined!,
        handlers,
        eventOptions: node.eventOptions,
        slots,
        "~target": true
      }
      target.v = target
      handled.push({ path, point: pointOf(path), target })
    }
    // A slot that is the element's only child is its content: text, or the
    // nodes of an array, such as a list `h.list` gave.
    const only = node.children.length === 1 ? node.children[0]! : undefined
    const content = only?._tag === "Text" ? slotOf(only.text) : undefined
    let children: ReadonlyArray<Node<any, any>>
    if (content !== undefined) {
      const owner = pointOf(path)
      holes.push({
        point: pointOf([...path, 0]),
        kind: "content",
        name: "",
        slot: content,
        owner,
        index: contents++
      })
      children = [text(" ")]
    } else {
      children = node.children.map((child, index) =>
        visit(child, [...path, index])
      )
    }
    return {
      ...node,
      elementKey: undefined,
      attrs: attrs === undefined
        ? node.attrs
        : Object.keys(attrs).length === 0
        ? noFields
        : attrs,
      handlers: noFields,
      eventOptions: noFields,
      children
    }
  }
  const blank = visit(root, []) as Element<any, any>
  // Each path picks up from the node of the one before at the depth they
  // share, so every node on the way is read once.
  const from: Array<number> = []
  const next: Array<number> = []
  const at: Array<number> = []
  const trail: Array<number> = [0]
  points.forEach((path, index) => {
    const before = points[index - 1]
    let common = 0
    if (before !== undefined) {
      const length = Math.min(path.length, before.length)
      while (common < length && before[common] === path[common]) common++
    }
    for (let depth = common; depth < path.length; depth++) {
      let node: number
      let child: number
      if (depth === common && before !== undefined && before.length > depth) {
        node = trail[depth + 1]!
        child = before[depth]!
      } else {
        from.push(trail[depth]!)
        next.push(0)
        node = from.length
        child = 0
      }
      for (; child < path[depth]!; child++) {
        from.push(node)
        next.push(1)
        node = from.length
      }
      trail[depth + 1] = node
    }
    at.push(trail[path.length]!)
  })
  const placed = holes.map((hole) =>
    hole.point < 0 ? hole : {
      ...hole,
      point: at[hole.point]!,
      owner: hole.owner < 0 ? -1 : at[hole.owner]!
    }
  )
  return {
    root,
    keySlot,
    walk: { from, next },
    holes: placed,
    texts: placed.filter((hole) => hole.kind === "text"),
    attrs: placed.filter((hole) => hole.kind === "attr"),
    contents: placed.filter((hole) => hole.kind === "content"),
    writes: placed.filter((hole) => hole.kind !== "handler"),
    parent: root.children.length > 0,
    depth: handled.reduce(
      (deepest, entry) => Math.max(deepest, entry.path.length),
      0
    ),
    handled: handled.map((entry) => ({ ...entry, point: at[entry.point]! })),
    blank,
    kernel
  }
}

/**
 * The element a template made for one set of values. The kernel renders it
 * from `~t` and `values`; anything else reads its fields, which are the
 * template's element with the values in its slots, made when first read.
 *
 * @internal
 */
export class TemplateNode implements Element<any, never> {
  // Declared and set in the constructor: a field with a value, or one only
  // declared, would be defined by a function of its own before the
  // constructor runs, for every row a list renders.
  declare readonly _tag: "Element"
  declare readonly tag: string
  declare readonly elementKey: string | undefined
  declare readonly "~t": TemplateDef
  declare readonly values: Readonly<Record<string, unknown>>
  declare private made: Element<any, never> | undefined
  constructor(def: TemplateDef, values: Readonly<Record<string, unknown>>) {
    this._tag = "Element"
    this.tag = def.root.tag
    this.elementKey = def.keySlot === undefined
      ? def.root.elementKey
      : values[def.keySlot] as string | undefined
    this["~t"] = def
    this.values = values
    this.made = undefined
  }
  get attrs(): Readonly<Record<string, string>> {
    return this.element().attrs
  }
  get props(): Readonly<Record<string, unknown>> {
    return noFields
  }
  get handlers(): Readonly<Record<string, Handler<any, any>>> {
    return this.element().handlers
  }
  get eventOptions(): Readonly<Record<string, EventOptions>> {
    return this["~t"].root.eventOptions
  }
  get refKey(): undefined {
    return undefined
  }
  get mount(): undefined {
    return undefined
  }
  get owned(): ReadonlyArray<Owned> {
    return noOwned
  }
  get children(): ReadonlyArray<Node<any, never>> {
    return this.element().children
  }
  /** The template's element with this node's values in its slots. */
  element(): Element<any, never> {
    return this.made ??= fillSlots(this["~t"].root, this.values) as Element<
      any,
      never
    >
  }
}

const valueOf = (values: Readonly<Record<string, unknown>>, slot: string) => {
  const value = values[slot]
  return value === undefined || value === null || value === false
    ? undefined
    : value
}

const fillSlots = (
  view: Node<any, any>,
  values: Readonly<Record<string, unknown>>
): Node<any, any> => {
  // A template built inside this one: its element, whose slots are this
  // one's, as a spread of the template's node would drop its fields.
  const node = asElement(view)
  if (node._tag === "Text") {
    const slot = slotOf(node.text)
    return slot === undefined
      ? node
      : text(String(valueOf(values, slot) ?? ""))
  }
  if (node._tag !== "Element") return node
  let attrs: Record<string, string> | undefined
  for (const name in node.attrs) {
    const slot = slotOf(node.attrs[name])
    if (slot === undefined) continue
    attrs ??= { ...node.attrs }
    const value = valueOf(values, slot)
    if (value === undefined) delete attrs[name]
    else attrs[name] = String(value)
  }
  let handlers: Record<string, Handler<any, any>> | undefined
  for (const name in node.handlers) {
    const slot = slotOf(node.handlers[name])
    if (slot === undefined) continue
    handlers ??= { ...node.handlers }
    const value = values[slot]
    if (value === undefined) delete handlers[name]
    else handlers[name] = value as Handler<any, any>
  }
  const key = slotOf(node.elementKey)
  // A content slot holding an array: its nodes are the children, a list
  // `h.list` gave as it is.
  const only = node.children.length === 1 ? node.children[0]! : undefined
  const content = only?._tag === "Text" ? slotOf(only.text) : undefined
  const nodes = content === undefined ? undefined : values[content]
  return {
    ...node,
    elementKey: key === undefined
      ? node.elementKey
      : values[key] as string | undefined,
    attrs: attrs ?? node.attrs,
    handlers: handlers ?? node.handlers,
    children: Array.isArray(nodes)
      ? isList(nodes) ? nodes : children(nodes)
      : node.children.map((child) => fillSlots(child, values))
  }
}

/**
 * `node` as a plain element: a template's made with its values, any other
 * node as it is. For code that copies a node with a spread.
 *
 * @internal
 */
export const asElement = <N extends Node<any, any>>(node: N): N =>
  (node as unknown as TemplateNode)["~t"] !== undefined
    ? (node as unknown as TemplateNode).element() as unknown as N
    : node
