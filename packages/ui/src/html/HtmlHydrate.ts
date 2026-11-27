/**
 * Hydration: mounts a component tree over the HTML `HtmlServer.renderToHtml`
 * rendered of it, adopting the server's nodes and the Model each instance
 * rendered with. An app that mounts with `BrowserHost.mount` doesn't carry it.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import type * as Scope from "effect/Scope"
import type * as Component from "../Component.ts"
import * as hydrateRun from "../internal/hydrateRun.ts"
import type * as Kernel from "../internal/kernel.ts"
import { jsonCodecOf } from "../internal/stateCodec.ts"
import type * as Renderer from "../Renderer.ts"
import type * as View from "../View.ts"
import * as BrowserHost from "./BrowserHost.ts"
import type * as Html from "./Html.ts"
import { attributeOf, isRadio, radioGroup } from "./internal/dom.ts"
import * as markers from "./internal/markers.ts"
import * as url from "./internal/url.ts"

const ELEMENT = 1
const TEXT = 3
const COMMENT = 8

const markerOf = (node: Node) =>
  node.nodeType === COMMENT ? markers.parse((node as Comment).data) : undefined

const isOpen = (node: Node, path: string): boolean => {
  const marker = markerOf(node)
  return marker?._tag === "Open" && marker.path === path
}

const closeOf = (open: Node, path: string): Node | null => {
  let close = open.nextSibling
  while (close !== null) {
    const marker = markerOf(close)
    if (marker?._tag === "Close" && marker.path === path) return close
    close = close.nextSibling
  }
  return null
}

const matches = (node: Node, tag: string | null): boolean =>
  tag === null
    ? node.nodeType === TEXT
    : (node as Element).localName === tag

const emptyValue = (name: string): unknown => name === "value" ? "" : false

/** Input types whose `change` the browser fires when the field loses focus, not when the value changes. */
const changeOnBlur: ReadonlySet<string> = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number"
])

/** The property the user changes on `node`, if it's a control. */
const userProp = (node: Node): string | undefined => {
  switch ((node as Element).localName) {
    case "input": {
      const type = (node as HTMLInputElement).type
      return type === "checkbox" || type === "radio" ? "checked" : "value"
    }
    case "textarea":
    case "select":
      return "value"
    case "option":
      return "selected"
  }
}

const optionDisabled = (option: HTMLOptionElement): boolean =>
  option.disabled ||
  (option.parentElement?.localName === "optgroup" &&
    option.parentElement.hasAttribute("disabled"))

const selectionChanged = (select: HTMLSelectElement): boolean => {
  const options = Array.from(select.options)
  const marked = options.map((option) => option.hasAttribute("selected"))
  if (select.multiple) {
    return options.some((option, i) => option.selected !== marked[i])
  }
  const last = marked.lastIndexOf(true)
  const index = last !== -1
    ? last
    : select.size > 1
    ? -1
    : options.findIndex((option) => !optionDisabled(option))
  return options.some((option, i) => option.selected !== (i === index))
}

/** The control an option's change is reported on and held for: its `select`, if it has one. */
const controlOf = (node: Node): Element =>
  (node as Element).localName === "option"
    ? (node as Element).closest("select") ?? (node as Element)
    : node as Element

class Edits {
  readonly adopted = new WeakSet<Node>()
  readonly defaults = new WeakMap<Node, string>()
  readonly edited = new Set<Element>()
  readonly changedBefore = new Map<Node, boolean>()
  take(node: Node, tag: string): void {
    if (
      tag !== "input" && tag !== "textarea" && tag !== "select" &&
      tag !== "option"
    ) return
    this.adopted.add(node)
    if (tag === "textarea") {
      this.defaults.set(node, (node as HTMLTextAreaElement).defaultValue)
      this.changedBefore.set(node, this.changed(node as Element))
    }
  }
  changed(control: Element): boolean {
    switch (control.localName) {
      case "input":
      case "textarea": {
        const field = control as HTMLInputElement
        return userProp(field) === "checked"
          ? field.checked !== field.defaultChecked
          : field.value !== (this.defaults.get(field) ?? field.defaultValue)
      }
      case "select":
        return selectionChanged(control as HTMLSelectElement)
      default:
        return false
    }
  }
  wasChanged(control: Element): boolean {
    let changed = this.changedBefore.get(control)
    if (changed === undefined) {
      const group = isRadio(control) ? radioGroup(control) : [control]
      changed = group.some((member) => this.changed(member))
      for (const member of group) this.changedBefore.set(member, changed)
    }
    return changed
  }
  keeps(node: Node, name: string, value: unknown): boolean {
    if (name !== userProp(node)) return false
    const control = controlOf(node)
    if (
      !this.edited.has(control) && this.adopted.has(control) &&
      this.wasChanged(control) &&
      (node as any)[name] !== (value === undefined ? emptyValue(name) : value)
    ) this.edited.add(control)
    return this.edited.has(control)
  }
  report(): void {
    this.changedBefore.clear()
    const controls = Array.from(this.edited)
    this.edited.clear()
    for (const control of controls) {
      const field = control as HTMLInputElement
      if (!field.isConnected || (isRadio(field) && !field.checked)) continue
      field.dispatchEvent(new Event("input", { bubbles: true }))
      // A focused text field gets no `change`: the browser fires it when focus leaves.
      const typing = field.localName === "textarea" ||
        (field.localName === "input" && changeOnBlur.has(field.type))
      if (!typing || field.ownerDocument.activeElement !== field) {
        field.dispatchEvent(new Event("change", { bubbles: true }))
      }
    }
  }
}

const keeping = (
  node: Node,
  name: string,
  value: unknown,
  write: () => void
) => {
  Object.defineProperty(node, name, {
    value: value === undefined ? emptyValue(name) : value,
    configurable: true
  })
  try {
    write()
  } finally {
    delete (node as any)[name]
  }
}

interface Opened {
  readonly path: string
  readonly open: Node
}

interface Held {
  readonly first: Node
  readonly last: Node
}

interface Building {
  readonly node: Node
  names: Array<string> | undefined
  last: Node | undefined
  readonly rangeDepth: number
}

const between = (
  base: Kernel.Host<Node>,
  container: Node,
  start: Node | null,
  end: Node | null,
  edges: ReadonlyArray<Node>,
  holds: Map<Node, Held>,
  edits: Edits
): hydrateRun.Adopting<Node> => {
  let at = start
  let parent = container
  const ranges: Array<Opened> = []
  const passed: Array<Node> = [...edges]
  const span: Array<Node> = []
  for (
    let node = start;
    node !== null && node !== end;
    node = node.nextSibling
  ) span.push(node)
  const stack: Array<Building> = [{
    node: container,
    names: undefined,
    last: edges[0],
    rangeDepth: 0
  }]
  const fresh = new WeakSet<Node>()
  const taken = new WeakSet<Node>()
  const kept = new WeakSet<Node>()
  let freshDepth = 0
  let holding: Held | undefined
  let bare: Node | undefined
  const missed = new WeakSet<Node>()
  let missing = false
  const ours = new WeakSet<Node>()
  let made = false
  let propped: Node | undefined

  const scopeOf = (node: Node): Node => {
    const list = node.parentNode!
    const range = ranges[ranges.length - 1]
    return range !== undefined && range.open.parentNode === list
      ? range.open
      : list
  }

  const pass = (node: Node): void => {
    const marker = markerOf(node)
    if (marker?._tag === "Open") ranges.push({ path: marker.path, open: node })
    else if (marker !== undefined) ranges.pop()
    passed.push(node)
  }

  const next = (): Node | null => {
    for (;;) {
      if (at === null) {
        if (parent === container) return null
        while (
          ranges.length > 0 && parent.contains(ranges[ranges.length - 1]!.open)
        ) ranges.pop()
        at = parent.nextSibling
        parent = parent.parentNode!
      } else if (at === end) {
        return null
      } else if (at.nodeType === COMMENT) {
        pass(at)
        at = at.nextSibling
      } else if (made && ours.has(at)) {
        at = at.nextSibling
      } else {
        return at
      }
    }
  }

  const resync = (
    first: Node,
    tag: string | null
  ): Node | null => {
    const list = first.parentNode!
    let from = first
    for (
      let index = ranges.length - 1;
      index >= 0 && ranges[index]!.open.parentNode === list;
      index--
    ) {
      const close = closeOf(from, ranges[index]!.path)
      if (close === null) return null
      let candidate = close.nextSibling
      while (
        candidate !== null && candidate !== end &&
        candidate.nodeType === COMMENT
      ) {
        candidate = candidate.nextSibling
      }
      if (candidate === null || candidate === end) return null
      if (matches(candidate, tag)) {
        let resume: Node | null = null
        for (let node: Node = first; node !== candidate;) {
          const following = node.nextSibling!
          if (node.nodeType === COMMENT) resume ??= node
          else list.removeChild(node)
          node = following
        }
        if (at === first) at = resume ?? candidate
        return candidate
      }
      from = close
    }
    return null
  }

  const drop = (node: Node): void => {
    at = node.nextSibling
    node.parentNode!.removeChild(node)
  }

  const take = (tag: string | null): Node | null => {
    if (freshDepth > 0) return null
    let node = next()
    if (node === null) return null
    if (node === bare) {
      bare = undefined
      if (!matches(node, tag)) {
        drop(node)
        return null
      }
      if (parent === container) taken.add(node)
      return node
    }
    if ((missing && missed.has(scopeOf(node))) || !matches(node, tag)) {
      const scope = scopeOf(node)
      node = resync(node, tag)
      if (node === null) {
        missed.add(scope)
        missing = true
        return null
      }
      next()
    }
    if (parent === container) taken.add(node)
    return node
  }

  const building = (node: Node): Building | undefined => {
    if (freshDepth > 0) return
    for (let index = stack.length - 1; index > 0; index--) {
      if (stack[index]!.node === node) return stack[index]
    }
  }

  const complete = (
    into: Node,
    { node, names, last: previous, rangeDepth }: Building
  ): void => {
    const element = node as Element
    const inside = parent === element || element.contains(parent)
    for (
      let node = previous === undefined
        ? element.firstChild
        : previous.nextSibling;
      node !== null;
    ) {
      const following = node.nextSibling
      element.removeChild(node)
      node = following
    }
    if (names !== undefined || propped === element || element.hasAttributes()) {
      const served = element.getAttributeNames()
      if (propped === element || served.length !== (names?.length ?? 0)) {
        for (const name of served) {
          if (names === undefined || !names.includes(name)) {
            element.removeAttribute(name)
          }
        }
      }
    }
    if (inside) {
      while (
        ranges.length > rangeDepth &&
        element.contains(ranges[ranges.length - 1]!.open)
      ) ranges.pop()
      at = element.nextSibling
      parent = into
    }
  }

  const host: Kernel.Host<Node> = {
    ...base,
    // Adopting nodes, it creates each one.
    clone: undefined,
    pointsOf: undefined,
    createElement(tag) {
      const node = take(tag)
      if (node === null) {
        const element = tag === "form"
          ? container.ownerDocument!.createElement(tag)
          : base.createElement(tag)
        fresh.add(element)
        ours.add(element)
        made = true
        freshDepth++
        return element
      }
      stack.push({
        node,
        names: undefined,
        last: undefined,
        rangeDepth: ranges.length
      })
      edits.take(node, tag)
      parent = node
      at = node.firstChild
      return node
    },
    createText(text) {
      if (text === "" && holding !== undefined) {
        const node = base.createText(text)
        holds.set(node, holding)
        ours.add(node)
        made = true
        holding = undefined
        return node
      }
      if (bare !== undefined && next() === bare) drop(bare)
      bare = undefined
      const node = text === "" ? null : take(null) as Text | null
      if (node === null) {
        const fresh = base.createText(text)
        ours.add(fresh)
        made = true
        return fresh
      }
      const data = node.data
      if (data !== text) {
        if (!data.startsWith(text)) {
          drop(node)
          const fresh = base.createText(text)
          ours.add(fresh)
          made = true
          return fresh
        }
        node.splitText(text.length)
      }
      at = node.nextSibling
      return node
    },
    setAttr(node, name, value) {
      const entry = building(node)
      if (entry !== undefined) {
        const element = node as Element
        const normalized = attributeOf(element, name)
        if (normalized === undefined) return
        if (
          value !== undefined &&
          url.blockedAttribute(element.localName, normalized, value)
        ) {
          value = undefined
        }
        if (value !== undefined) (entry.names ??= []).push(normalized)
        const served = element.getAttribute(normalized)
        if (value === undefined ? served === null : served === value) return
        return base.setAttr(node, name, value, served ?? undefined)
      }
      base.setAttr(node, name, value)
    },
    setProp(node, name, value) {
      const entry = building(node)
      if (entry !== undefined) {
        ;(entry.names ??= []).push(name.toLowerCase())
        propped = node
      }
      if (edits.keeps(node, name, value)) {
        return keeping(node, name, value, () => base.setProp(node, name, value))
      }
      // An equal `href` property can still have its attribute, which the host removes.
      if (
        entry !== undefined && (node as any)[name] === value &&
        base.controlled?.has(name) !== true &&
        !url.blockedProperty((node as Element).localName, name, value)
      ) return
      base.setProp(node, name, value)
    },
    made(node, inst) {
      if (freshDepth > 0 && fresh.delete(node)) freshDepth--
      if ((node as Element).localName === "form") {
        const env = inst.env
        if (
          inst.tree.served?.(inst) !== undefined && env.ctx === undefined &&
          env.cause === undefined
        ) env.waiting.push(() => base.form?.(node))
        else base.form?.(node)
      }
    },
    insert(into, node, before) {
      let index = stack.length
      let own = 0
      while (--index > 0 && stack[index]!.node !== into) {
        if (stack[index]!.node === node) own = index
      }
      const list = stack[index]!.node === into ? stack[index] : undefined
      const held = holds.size > 0 && before === null
        ? holds.get(node)
        : undefined
      if (held !== undefined && held.first.parentNode === into) {
        into.insertBefore(node, held.first)
        if (list !== undefined) list.last = held.last
        return
      }
      if (before !== null || list === undefined) base.insert(into, node, before)
      else {
        const previous = list.last
        let ref = previous === undefined
          ? into.firstChild
          : previous.nextSibling
        while (
          ref !== node && ref !== null && ref !== end &&
          ref.nodeType === COMMENT
        ) {
          if (!kept.has(ref)) passed.push(ref)
          ref = ref.nextSibling
        }
        if (ref !== node) into.insertBefore(node, ref)
        list.last = node
      }
      if (own > 0) {
        complete(
          into,
          own < stack.length - 1 ? stack.splice(own, 1)[0]! : stack.pop()!
        )
      }
    }
  }

  return {
    host,
    child(path, served) {
      bare = undefined
      if (freshDepth > 0) return
      let node = at
      while (node !== null && node !== end && node.nodeType === COMMENT) {
        if (isOpen(node, path)) return
        node = node.nextSibling
      }
      if (node === null || node === end || node.nodeType !== ELEMENT) return
      for (
        let after = node.nextSibling;
        after !== null && after.nodeType === COMMENT;
        after = after.nextSibling
      ) if (isOpen(after, path)) return
      if (!served) {
        missed.add(scopeOf(node))
        missing = true
      } else if (!missing || !missed.has(scopeOf(node))) bare = node
    },
    has(path) {
      for (
        let node = freshDepth > 0 ? null : at;
        node !== null && node !== end && node.nodeType === COMMENT;
        node = node.nextSibling
      ) if (isOpen(node, path)) return true
      return false
    },
    hold(path) {
      holding = undefined
      if (freshDepth > 0) return
      while (
        at !== null && at !== end && at.nodeType === COMMENT &&
        !isOpen(at, path)
      ) {
        pass(at)
        at = at.nextSibling
      }
      if (at === null || at === end) return
      const close = at.nodeType === COMMENT
        ? closeOf(at, path)
        : at.nodeType === ELEMENT
        ? at
        : null
      if (close === null) return
      holding = { first: at, last: close }
      for (
        let node: Node | null = at;
        node !== null;
        node = node === close ? null : node.nextSibling
      ) kept.add(node)
      at = close.nextSibling
    },
    done() {
      for (const node of span) {
        if (!taken.has(node) && !kept.has(node)) {
          node.parentNode?.removeChild(node)
        }
      }
      for (const node of passed) node.parentNode?.removeChild(node)
      edits.report()
    }
  }
}

/** @internal */
export const adopt: hydrateRun.Adopt<Node> = (base, container, path) => {
  const holds = new Map<Node, Held>()
  const edits = new Edits()
  let open = container.firstChild
  while (open !== null && !isOpen(open, path)) open = open.nextSibling
  const close = open === null ? null : closeOf(open, path)
  return {
    root: open === null || close === null
      ? undefined
      : between(
        base,
        container,
        open.nextSibling,
        close,
        [open, close],
        holds,
        edits
      ),
    resume(placeholder) {
      const held = holds.get(placeholder)
      if (held === undefined) return undefined
      holds.delete(placeholder)
      const list = held.first.parentNode
      if (list === null) return undefined
      return held.first === held.last
        ? between(
          base,
          list,
          held.first,
          held.last.nextSibling,
          [],
          holds,
          edits
        )
        : between(
          base,
          list,
          held.first.nextSibling,
          held.last,
          [
            held.first,
            held.last
          ],
          holds,
          edits
        )
    },
    live(nodes) {
      for (const [node, rec] of nodes) {
        const name = userProp(node)
        if (name === undefined || !edits.adopted.has(node)) continue
        edits.keeps(node, name, (rec.v as View.Element<any, any>).props[name])
      }
      edits.report()
    }
  }
}

/**
 * Mounts a component tree over the HTML `HtmlServer.renderToHtml` rendered of
 * it in `container`, for the life of the current Scope, and returns its root.
 *
 * **When to use**
 *
 * Use when the caller needs the root: to read its Model, send it a message,
 * update its props with `setProps`, or wait for `root.adopted`, which
 * completes when no hydrating instance is still waiting. `hydrate` is the
 * form that runs an app.
 *
 * **Details**
 *
 * It mounts, checks the root and hydrates exactly as `hydrate` does, and
 * fails with the props Effect's error.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const hydrateEffect = <
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R,
  V extends View.Elements,
  RF = never,
  RP = never,
  EP = never
>(
  component:
    & Component.Members<Name, Props, Model, Msg, Events, R, V, any>
    & BrowserHost.HtmlRoot<V>,
  props: Props | Effect.Effect<Props, EP, RP>,
  container: globalThis.Element,
  state: Renderer.State,
  options?: Omit<BrowserHost.MountOptions<V, RF, Events>, "key">
): Effect.Effect<
  Renderer.Root<Model, Msg, Props>,
  EP,
  Exclude<R | RF | RP, Html.Host> | Scope.Scope
> =>
  Effect.suspend(() =>
    BrowserHost.mountRoot(
      component as unknown as Component.Any,
      props,
      container,
      { ...options, key: state["~key"] },
      hydrateRun.hydrating(state, adopt)
    )
  ) as any

/**
 * A Layer that mounts a component tree over the HTML
 * `HtmlServer.renderToHtml` rendered of it in `container`, for as long as
 * the Layer is built. It provides no service: launch it with
 * `Layer.launch`, or merge it into the app's Layer.
 *
 * **When to use**
 *
 * Use to run a server-rendered app in the browser, in place of
 * `BrowserHost.mount`. Reach for `hydrateEffect` when the caller needs the
 * root, to send it messages, update its props or wait for `root.adopted`.
 *
 * **Details**
 *
 * Pass the `state` from `HtmlServer.renderToHtml`, with the server's HTML
 * already in `container` and the same props, to adopt the server's nodes
 * instead of building them. `Router.props` gives the same props on both
 * sides when both Routers are at the same URL, and `decodeProps` reads the
 * props serialized with `includeProps: true`. If the props Effect fails,
 * the Layer fails with that error and leaves the server HTML unchanged.
 * Options are as in `BrowserHost.mount`, except `key`: hydration reads the
 * server's key from `state` automatically.
 *
 * Each instance adopts its server Model and replays `init` only to recover
 * its Commands, so the events `init` emits are dropped; server Commands the
 * Model already has the result of are skipped, and those that missed the
 * budget run now. `onMount` fires on adoption. Where an instance's view
 * stops matching the server's nodes, the nodes before stay adopted and the
 * rest is built fresh, and an instance the server deferred is built fresh.
 * An instance whose state decodes only asynchronously keeps the server's
 * nodes until it has.
 *
 * An instance the server rendered with its provided Layer ready, whose
 * Layer is still building here, keeps the server's nodes until the Layer is
 * ready, and everything else is live at once. Its `LayerPending` entry says
 * `Awaiting`. One whose Layer was pending or failed on the server adopts at
 * once, and its feature slots keep the server's `fallback` nodes while their
 * status is the one the server shipped. A waiting instance is inert: its
 * buttons do nothing, links still navigate through the Router, and a
 * `<form>` submits natively. What the user types or picks in its fields
 * stays, and reaches the fields' `input` and `change` handlers when it adopts.
 * Clicks and submits aren't kept, whether made on a waiting instance or
 * before the client runs. Head sync starts once no instance is waiting.
 *
 * The cache hydrates from the state's `~query` entries. Until `adopted`
 * completes or the Router first navigates, a watch, `get` or `prefetch`
 * over a hydrated entry doesn't fetch, even when it is stale.
 *
 * **Example** (Hydrating a server-rendered app)
 *
 * ```ts
 * import { HtmlHydrate, Html } from "@effect/ui/html"
 * import { Effect, Layer, Schema } from "effect"
 * import { Renderer } from "@effect/ui"
 *
 * const App = Html.component({
 *   name: "App",
 *   model: Schema.Struct({}),
 *   message: Schema.Never
 * }).make({
 *   init: () => ({}),
 *   update: ($) => $.model,
 *   view: (h) => h.h1("Hello")
 * })
 *
 * // The page embeds the state `HtmlServer.renderToHtml` returned.
 * declare const state: Renderer.State
 *
 * // In the browser entry module.
 * Effect.runFork(Layer.launch(HtmlHydrate.hydrate(App, {}, document.getElementById("app")!, state)))
 * ```
 *
 * @stability experimental
 * @category layers
 * @since 0.1.0
 */
export const hydrate = <
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R,
  V extends View.Elements,
  RF = never,
  RP = never,
  EP = never
>(
  component:
    & Component.Members<Name, Props, Model, Msg, Events, R, V, any>
    & BrowserHost.HtmlRoot<V>,
  props: Props | Effect.Effect<Props, EP, RP>,
  container: globalThis.Element,
  state: Renderer.State,
  options?: Omit<BrowserHost.MountOptions<V, RF, Events>, "key">
): Layer.Layer<never, EP, Exclude<R | RF | RP, Html.Host>> =>
  Layer.effectDiscard(
    hydrateEffect(component, props, container, state, options)
  ) as any

/**
 * Returns an Effect that decodes root props from server state using the
 * component's props Schema, failing with `Schema.SchemaError` if missing or invalid.
 *
 * **When to use**
 *
 * Use as the props of `hydrate` or `hydrateEffect` when the server rendered
 * with `includeProps: true` and the client has no other source for them,
 * such as a component embedded in a page another renderer built.
 *
 * **Details**
 *
 * Hydration propagates decoding errors without changing the server HTML.
 * Recover with `Effect.orElseSucceed` to supply fallback props; hydration
 * then adopts the nodes that still match.
 *
 * **Example** (Hydrating with the server's props)
 *
 * ```ts
 * import { HtmlHydrate, Html } from "@effect/ui/html"
 * import { Effect, Layer, Schema } from "effect"
 * import { Renderer } from "@effect/ui"
 *
 * const News = Html.component({
 *   name: "News",
 *   props: Schema.Struct({ items: Schema.Array(Schema.String) }),
 *   model: Schema.Struct({}),
 *   message: Schema.Never
 * }).make({
 *   init: () => ({}),
 *   update: ($) => $.model,
 *   view: (h) =>
 *     h.ul.children(...h.props.items.map((item) => h.li.key(item).children(item)))
 * })
 *
 * // From `HtmlServer.renderToHtml(News, props, { includeProps: true })`.
 * declare const state: Renderer.State
 *
 * const app = HtmlHydrate.hydrate(
 *   News,
 *   HtmlHydrate.decodeProps(News, state),
 *   document.getElementById("news")!,
 *   state
 * )
 * Effect.runFork(Layer.launch(app))
 * ```
 *
 * @stability experimental
 * @category utils
 * @since 0.1.0
 */
export const decodeProps = <Props>(
  component: { readonly props: Schema.Codec<Props, any> },
  state: Renderer.State
): Effect.Effect<Props, Schema.SchemaError> =>
  Effect.mapError(
    state["~props"] === undefined
      ? Effect.fail(
        new SchemaIssue.Forbidden({
          message: "the state has no ~props: render with includeProps: true"
        })
      )
      : jsonCodecOf(component.props).decode(state["~props"]),
    (issue) => new Schema.SchemaError(issue)
  ) as Effect.Effect<Props, Schema.SchemaError>
