import {
  checkContent,
  checkDeclarer,
  checkFallback,
  checkKeys,
  checkPaths,
  checkPlaced,
  checkShown,
  dev
} from "#dev"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import type * as Fiber from "effect/Fiber"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { TypeId as FeatureId } from "../Feature.ts"
import * as View from "../View.ts"
import { propsEqual } from "./equal.ts"
import { segmentOf, slotSegment } from "./paths.ts"

/** @internal */
export interface Host<N = any> {
  readonly hold?:
    | ((
      owner: Instance,
      rec: Rec,
      slot: string | undefined,
      component: Runnable
    ) => boolean)
    | undefined
  readonly createElement: (tag: string) => N
  readonly createText: (text: string) => N
  readonly setText: (node: N, text: string) => void
  readonly setAttr: (
    node: N,
    name: string,
    value: string | undefined,
    previous?: string | undefined
  ) => void
  readonly normalizeAttrs?:
    | ((
      node: N,
      attrs: Readonly<Record<string, string>>
    ) => Readonly<Record<string, string>>)
    | undefined
  readonly setProp: (node: N, name: string, value: unknown) => void
  readonly made?: ((node: N, inst: Instance) => void) | undefined
  readonly form?: ((node: N) => void) | undefined
  readonly setEvents: (node: N, record: Rec, first: boolean) => void
  readonly insert: (parent: N, node: N, before: N | null) => void
  readonly remove: (parent: N, node: N) => void
  readonly clear?: ((parent: N) => void) | undefined
  readonly createContainer?: (() => N) | undefined
  readonly parentOf: (node: N) => N
  readonly nextOf: (node: N) => N | null
  /**
   * A deep copy of a node and its descendants, with their attributes and text,
   * and `firstOf` its first child. With both, a list of siblings of the same
   * shape is built by copying the one before. A host that adopts nodes, as
   * hydration does, leaves them out.
   */
  readonly clone?: ((node: N) => N) | undefined
  readonly firstOf?: ((node: N) => N | null) | undefined
  /**
   * With `clone`: what a node is, as a view names it: `"#text"` for text, an
   * element's tag for an element.
   */
  readonly kindOf?: ((node: N) => string) | undefined
  /** With `clone`: the record `setEvents` gave a node first. */
  readonly recOf?: ((node: N) => Rec | undefined) | undefined
  /**
   * With `clone`: the nodes of a copy whose root is `root`, read as `walk`
   * says, with `root` first. A host that has it renders `View.template`'s
   * elements from copies.
   */
  readonly pointsOf?:
    | ((root: N, walk: View.TemplateDef["walk"]) => Array<N>)
    | undefined
  /**
   * With `pointsOf`: marks `node` as the root of `record`, an element a
   * template made. The host dispatches the events of its elements through
   * the template's targets, finding the values in `record`.
   */
  readonly row?: ((node: N, record: Rec) => void) | undefined
  readonly commit?: (() => void) | undefined
  readonly unmounting?:
    | ((container: N, nodes: ReadonlyArray<N>) => void)
    | undefined
  readonly controlled?: ReadonlySet<string> | undefined
  readonly runsMounts?: boolean | undefined
  readonly head?: ((head: unknown) => void) | undefined
  readonly transitions?: ((tree: Tree) => Transitions) | undefined
  readonly server?: Server | undefined
  readonly inert?: boolean | undefined
  readonly skipped?: ((path: string) => void) | undefined
}

/** @internal */
export interface Server {
  readonly drop: (
    inst: Instance,
    name: string,
    issued: Issued | undefined
  ) => void
  readonly defer: (inst: Instance) => void
  readonly report: (problem: any) => void
}

/** @internal */
export interface Transitions {
  readonly request: (types: ReadonlyArray<string>) => void
  readonly waits: (inst: Instance) => boolean
  readonly wait: (f: () => void) => void
  readonly hold: () => boolean
  readonly settle: () => void
}

/** @internal */
export interface Attachable {
  readonly "~attach": (rec: Rec) => void
  readonly "~detach": (rec: Rec) => void
}

/** @internal */
export interface Runnable {
  readonly definition: { readonly name: string }
  readonly init: (props: any) => Next
  readonly update: (
    model: any,
    message: never,
    props: any,
    results?: unknown,
    shared?: unknown
  ) => Next | undefined
  readonly view: Function
  readonly layer?: unknown
  readonly boot?: ((inst: Instance) => void) | undefined
  readonly "~sync"?:
    | ((inst: Instance, next?: Next, seq?: number | undefined | void) => void)
    | undefined
  readonly "~content"?: Function | undefined
  readonly "~owned"?:
    | ((inst: Instance, view: View.Element<any, any>) => View.Element<any, any>)
    | undefined
  readonly "~first"?: ((inst: Instance) => void) | undefined
  readonly "~render"?: ((inst: Instance) => void) | undefined
  readonly "~kept"?: Keeper | undefined
  readonly "~load"?:
    | ((
      owner: Instance,
      rec: Rec,
      at: string | undefined
    ) => Runnable | undefined)
    | undefined
  readonly "~cause"?: (() => Cause.Cause<unknown> | undefined) | undefined
}

/** @internal */
export interface Keeper {
  readonly mount: (author: Instance, rec: Rec, slot: string | undefined) => void
  readonly patch: (
    inst: Instance,
    old: Rec,
    view: View.Child<any, any>,
    slot: string | undefined
  ) => Rec | undefined
  readonly release: (owner: Instance, rec: Rec) => boolean
  readonly shows: (
    author: Instance,
    view: View.Child<any, any>,
    fallback: View.Node<any, any>
  ) => View.Node<any, any>
}

/** @internal */
export interface Next {
  readonly model: unknown
  readonly commands: ReadonlyArray<unknown>
  readonly events: ReadonlyArray<unknown>
  readonly lists?: ReadonlyArray<unknown> | undefined
  readonly sends?: ReadonlyArray<unknown> | undefined
  readonly viewTransition?: ReadonlyArray<string> | undefined
}

/** @internal */
export type FailedIn =
  | "init"
  | "update"
  | "view"
  | "event"
  | "onEmit"
  | "onFailure"
  | "fallback"
  | "layer"
  | "command"
  | "subscription"
  | "mount"
  | "head"
  | "send"
  | "shares"
  | "shared"

/** @internal */
export interface Env {
  ctx: Context.Context<any> | undefined
  cause: Cause.Cause<unknown> | undefined
  readonly waiting: Array<() => void>
  readonly parent?: Env | undefined
}

/** @internal */
export type Recorder = (
  inst: Instance,
  draft: { readonly _tag: string; readonly [field: string]: unknown }
) => number | undefined | void

/** @internal */
export interface Issued {
  readonly seq: number
  readonly index: number
}

interface Issuable {
  readonly "~run": (
    inst: Instance,
    seq: number | undefined | void,
    index: number
  ) => void
}

/** @internal */
export interface Runs {
  readonly running: (name: string, groupKey: string | undefined) => boolean
  readonly pending: () => ReadonlyArray<
    { readonly name: string; readonly status: string }
  >
}

/**
 * Opt-in phase timing. Each hook gets the `now` reading from before its
 * phase, and `now` is read only for phases with a hook. `flush` gets `held`
 * when a transition holds the flush, which resumes later.
 *
 * @internal
 */
export interface Slow {
  readonly now: () => bigint
  readonly update?:
    | ((from: bigint, inst: Instance, message: unknown) => void)
    | undefined
  readonly view?: ((from: bigint, inst: Instance) => void) | undefined
  readonly flush?: ((from: bigint, held?: boolean) => void) | undefined
}

/** @internal */
export interface Tree {
  readonly host: Host
  readonly slow?: Slow | undefined
  readonly report: (
    path: string,
    where: FailedIn,
    cause: Cause.Cause<unknown>
  ) => void
  readonly init: (inst: Instance) => Next
  readonly onEmit?: ((event: unknown) => unknown) | undefined
  readonly log?: Recorder | undefined
  /** `false` when `log` has no use for renders starting and ending: they aren't logged then. */
  readonly logsRenders?: boolean | undefined
  /**
   * The nodes this tree's host built for each template, which its elements
   * are copied from, and the last template read, as most renders make many
   * elements of one. Weak, so a template made and dropped while the tree
   * lives isn't kept, and a template kept for the whole program keeps no
   * tree.
   */
  copies?: WeakMap<View.TemplateDef, unknown> | undefined
  lastTemplate?: View.TemplateDef | undefined
  lastCopy?: unknown
  readonly fallback?:
    | ((cause: Cause.Cause<unknown>) => View.Node<any, any>)
    | undefined
  readonly schedule: (task: () => void) => void
  readonly follow?: ((late?: boolean) => <A>(f: () => A) => A) | undefined
  owned?: Set<Fiber.Fiber<unknown, unknown>> | undefined
  closing?: Set<Fiber.Fiber<any, any>> | undefined
  building?: Set<{ readonly flush: number }> | undefined
  flush?: (() => number) | undefined
  builds?: number | undefined
  failedBuild?: number | undefined
  cached?: (() => void) | undefined
  watched?:
    | ((inst: Instance, query: string, argsKey: string) => void)
    | undefined
  served?: ((inst: Instance) => string | undefined) | undefined
  drawn?: ((inst: Instance, drawn: boolean) => void) | undefined
  ended?: ((author: Instance, path: string) => void) | undefined
  work?: ((idle: boolean) => boolean) | undefined
  committing?: Array<() => void> | undefined
  committed?: Array<() => void> | undefined
  head?:
    | { readonly value: unknown; readonly title: string | undefined }
    | undefined
  transitions?: Transitions | undefined
  shared?: unknown
  drew?: boolean | undefined
  holds?:
    | ((child: Instance, inst: Instance, view: View.Child<any, any>) => boolean)
    | undefined
  held?: ((at: string) => boolean) | undefined
  /**
   * Whether an element of the tree has had a property the host controls,
   * which a patch that keeps the element's node writes again: see `controls`.
   */
  restores?: boolean | undefined
  dirty: Array<Instance>
  scheduled: boolean
  flushing: boolean
  closed: boolean
}

/**
 * The `kids` of an element built from a copy, until a patch needs them: the
 * element and everything in it are elements and text with nothing to
 * release or restore, so a reader that looks for components, mounts or refs
 * finds none, as it would in the records. `kidsOf` makes them.
 *
 * @internal
 */
export const unmade: Array<Rec> = Object.freeze([]) as unknown as Array<Rec>

/** @internal */
export class Rec {
  declare v: View.Node<any, any>
  declare node: any
  declare kids: Array<Rec> | undefined
  declare inst: Instance
  declare plain: boolean
  /** For an element a template made, the nodes its slots write. */
  declare points: Array<unknown> | undefined
  constructor(
    v: View.Node<any, any>,
    node: unknown,
    kids: Array<Rec> | undefined,
    inst: Instance
  ) {
    this.v = v
    this.node = node
    this.kids = kids
    this.inst = inst
    this.plain = false
    this.points = undefined
  }
}

/** @internal */
export class Instance {
  declare readonly tree: Tree
  declare readonly component: Runnable
  declare readonly parent: Instance | undefined
  declare readonly at: Rec | undefined
  declare under: string | undefined
  declare readonly depth: number
  declare props: unknown
  declare env: Env
  model: unknown = undefined
  rendered: Rec | undefined = undefined
  dirty = false
  closed = false
  failure: Cause.Cause<unknown> | undefined = undefined
  live = 0
  lazy: unknown = undefined
  placed: Map<string, Placed> | undefined = undefined
  closers: Array<() => void> | undefined = undefined
  declare runs: Runs | undefined
  declare results: unknown
  declare hold: ((go: () => void) => boolean) | undefined
  declare swaps:
    | Array<(waits: Array<Fiber.Fiber<unknown, unknown>>) => void>
    | undefined
  declare look: ((owner: any, optional?: boolean) => unknown) | undefined
  declare owning: unknown
  declare reading: unknown
  declare kept:
    | {
      readonly done: () => void
      readonly parked: () => ReadonlyArray<Rec>
      readonly children: () => ReadonlyArray<
        { readonly inst: Instance; readonly rec: Rec | undefined }
      >
    }
    | undefined
  writing = 0
  named: string | undefined = undefined
  constructor(
    tree: Tree,
    component: Runnable,
    parent: Instance | undefined,
    at: Rec | undefined,
    props: unknown,
    env: Env
  ) {
    this.tree = tree
    this.component = component
    this.parent = parent
    this.at = at
    this.under = slot
    this.depth = parent === undefined ? 0 : parent.depth + 1
    this.props = props
    this.env = env
  }
  get path(): string {
    if (this.named !== undefined) return this.named
    const at = this.at
    if (at === undefined) {
      return this.named = "/" + this.component.definition.name
    }
    const view = at.v as View.Child<any, any>
    return this.named =
      (view.alive === undefined && this.under || this.parent!.path) + "/" +
      segmentOf(view.component, view.key)
  }
  /**
   * The message `handler` produces, unsent: `undefined` when it produces none, fails or the instance is closed.
   * `read` is called only for a function handler, and a failed read is the handler's failure.
   */
  message(
    handler: unknown,
    read: () => unknown,
    where: FailedIn = "event"
  ): unknown {
    if (this.closed) return undefined
    if (typeof handler !== "function") return handler
    try {
      return handler(read())
    } catch (error) {
      fail(this, where, Cause.die(error))
      return undefined
    }
  }
  fire(
    handler: unknown,
    payload: unknown,
    source: unknown,
    where: FailedIn = "event"
  ): boolean {
    const message = this.message(handler, () => payload, where)
    if (message === undefined) return false
    send(this, message, source)
    return true
  }
}

interface Placed {
  rec: Rec
  content: unknown
}

let slot: string | undefined
let busy = 0
let receiving: Instance | undefined
let shown = 0
const born: Array<Instance | Rec> = []
let fallen: Instance | undefined

/** @internal */
export const rendering = { _tag: "Render" } as const

/** @internal */
export const rendered = { _tag: "Rendered" } as const

const emptyText: View.Text = { _tag: "Text", text: "" }

const fallbackOf = (
  owner: Instance,
  view: View.Child<any, any>,
  cause: Cause.Cause<unknown> | undefined
): View.Node<any, any> => {
  const fallback = view.fallback
  if (dev) shown++
  if (fallback === undefined) return emptyText
  try {
    return View.children([
      fallback(
        (cause === undefined
          ? AsyncResult.initial(true)
          : AsyncResult.failure(cause)) as any
      )
    ])[0] ?? emptyText
  } catch (error) {
    owner.tree.schedule(() => fail(owner, "fallback", Cause.die(error)))
    return emptyText
  }
}

const loadingIn = (
  owner: Instance,
  view: View.Child<any, any>,
  cause: Cause.Cause<unknown> | undefined,
  show: (fallback: View.Node<any, any>) => Rec
): Rec => {
  if (view.alive === undefined) {
    return inFallback(owner, () => show(fallbackOf(owner, view, cause)))
  }
  const outer = slot
  slot = undefined
  try {
    return inFallback(owner, () => {
      const fallback = fallbackOf(owner, view, cause)
      return show(dev ? keeperOf(view)!.shows(owner, view, fallback) : fallback)
    })
  } finally {
    slot = outer
  }
}

const inFallback = <A>(owner: Instance, f: () => A): A => {
  const outer = fallen
  fallen = owner
  try {
    return f()
  } finally {
    fallen = outer
  }
}

const rootFallback = (
  inst: Instance,
  cause: Cause.Cause<unknown>
): View.Node<any, any> => {
  const tree = inst.tree
  try {
    return tree.fallback?.(cause) ?? emptyText
  } catch (error) {
    const failure = Cause.die(error)
    tree.log?.(inst, {
      _tag: "Failed",
      props: inst.props,
      in: "fallback",
      cause: failure
    })
    tree.report(inst.path, "fallback", failure)
    return emptyText
  }
}

/** @internal */
export const stand = (inst: Instance, cause: Cause.Cause<unknown>): Rec => {
  const parent = inst.parent
  const outer = slot
  const from = born.length
  slot = inst.under
  try {
    return parent === undefined
      ? create(inst, rootFallback(inst, cause))
      : create(
        parent,
        fallbackOf(parent, inst.at!.v as View.Child<any, any>, cause)
      )
  } catch (error) {
    orphans(from)
    inst.tree.report(inst.path, "fallback", Cause.die(error))
    return create(inst, emptyText)
  } finally {
    slot = outer
  }
}

/** @internal */
export const fail = (
  inst: Instance,
  where: FailedIn,
  cause: Cause.Cause<unknown>,
  update?: { readonly message: unknown; readonly source: unknown },
  from?: number,
  name?: string,
  issued?: Issued
): void => {
  if (inst.closed) return
  const tree = inst.tree
  const log = tree.log
  if (log !== undefined) {
    log(inst, {
      _tag: "Failed",
      props: inst.props,
      in: where,
      name,
      cause,
      update,
      issued
    })
  }
  inst.failure = cause
  const old = inst.rendered
  const path = inst.path
  close(inst)
  if (from !== undefined) orphans(from)
  const at = inst.at
  if (old !== undefined) {
    const host = tree.host
    const first = nodeOf(old)
    const parentNode = host.parentOf(first)
    const fallback = stand(inst, cause)
    if (parentNode != null) {
      place(host, parentNode, fallback, first)
      unplace(host, parentNode, old)
      wake(tree)
    }
    if (at === undefined) inst.rendered = fallback
    else {
      inst.rendered = undefined
      at.kids = [fallback]
      if (dev) tree.schedule(() => recheck(inst.parent!))
    }
  }
  const onFailure = at === undefined
    ? undefined
    : (at.v as View.Child<any, any>).onFailure
  if (onFailure !== undefined) {
    const parent = upOf(inst)
    tree.schedule(() =>
      parent.fire(onFailure, AsyncResult.failure(cause), inst, "onFailure")
    )
  }
  tree.report(path, where, cause)
}

const upOf = (inst: Instance): Instance =>
  ((inst.at!.v as View.Child<any, any>).owner as Instance | undefined) ??
    inst.parent!

const recheckPlaced = (author: Instance): void => {
  try {
    checkPlaced(author)
  } catch (error) {
    fail(author, "view", Cause.die(error))
  }
}

const recheck = (inst: Instance): void => {
  if (inst.closed || inst.rendered === undefined) return
  try {
    checkShown(inst.path, [inst.rendered])
  } catch (error) {
    fail(inst, "view", Cause.die(error))
  }
}

const orphans = (from: number): void => {
  for (let index = from; index < born.length; index += 2) {
    release(born[index] as Instance, born[index + 1] as Rec)
  }
  born.length = from
}

/** @internal */
export const send = (
  inst: Instance,
  message: unknown,
  source?: unknown
): void => {
  const transitions = inst.tree.transitions
  if (transitions?.waits(inst)) {
    return transitions.wait(() => send(inst, message, source))
  }
  renderAbove(inst)
  if (inst.closed) return
  const slow = inst.tree.slow
  const from = slow?.update && slow.now()
  let next: Next | undefined
  try {
    next = inst.component.update(
      inst.model,
      message as never,
      inst.props,
      inst.results,
      inst.look
    )
  } catch (error) {
    return fail(inst, "update", Cause.die(error), { message, source })
  }
  if (from !== undefined) slow!.update!(from, inst, message)
  if (next === undefined) return
  const seq = inst.tree.log?.(inst, {
    _tag: "Update",
    source,
    message,
    props: inst.props,
    model: next.model,
    commands: next.commands,
    events: next.events,
    lists: next.lists,
    sends: next.sends,
    viewTransition: next.viewTransition
  })
  if (next.model !== inst.model) {
    inst.model = next.model
    markDirty(inst)
  }
  if (next.viewTransition !== undefined) {
    transitions?.request(next.viewTransition)
  }
  if (next.commands.length > 0) issueAll(inst, next, seq)
  applied(inst, next, seq)
}

const issueAll = (
  inst: Instance,
  next: Next,
  seq: number | undefined | void
): void => {
  const commands = next.commands
  for (let index = 0; index < commands.length; index++) {
    if (inst.closed) return
    ;(commands[index] as Issuable)["~run"](inst, seq, index)
  }
}

const applied = (
  inst: Instance,
  next: Next,
  seq: number | undefined | void
): void => {
  if (inst.closed) return
  inst.component["~sync"]?.(inst, next, seq)
  const events = next.events
  if (events.length === 0) return
  const at = inst.at
  const to = at === undefined ? inst : upOf(inst)
  for (let index = 0; index < events.length; index++) {
    if (inst.closed) return
    const onEmit = at === undefined
      ? inst.tree.onEmit
      : (at.v as View.Child<any, any>).onEmit
    if (onEmit === undefined) return
    let message: unknown
    try {
      message = onEmit(events[index])
    } catch (error) {
      fail(to, "onEmit", Cause.die(error))
      return
    }
    if (at !== undefined && message !== undefined) send(to, message, inst)
  }
}

/** @internal */
export const wake = (tree: Tree): void => {
  if (tree.scheduled) return
  tree.scheduled = true
  tree.schedule(() => flush(tree))
}

/** @internal */
export const markDirty = (inst: Instance): void => {
  if (inst.dirty) return
  inst.dirty = true
  inst.tree.dirty.push(inst)
  wake(inst.tree)
}

const byDepth = (a: Instance, b: Instance): number => a.depth - b.depth

/** @internal */
export const renderAbove = (inst: Instance): void => {
  const dirty = inst.tree.dirty
  if (busy > 0 || dirty.length === 0) return
  const above: Array<Instance> = []
  let top = -1
  let drawn = inst.under !== undefined
  for (let at = inst.parent; at !== undefined; at = at.parent) {
    if (at.dirty) top = above.length
    above.push(at)
    if (at.under !== undefined) drawn = true
  }
  if (drawn) {
    const path = inst.path
    above.length = 0
    for (let index = 0; index < dirty.length; index++) {
      const at = dirty[index]!
      if (at.dirty && path.startsWith(at.path + "/")) above.push(at)
    }
    above.sort(byPathLength)
    top = above.length - 1
  }
  if (top < 0) return
  const outer = receiving
  receiving = inst
  try {
    for (let index = top; index >= 0; index--) {
      const next = above[index]!
      if (next.closed) return
      if (next.dirty) renderDirty(next)
    }
  } finally {
    receiving = outer
  }
}

const byPathLength = (a: Instance, b: Instance): number =>
  b.path.length - a.path.length

const renderDirty = (inst: Instance): void => {
  const tree = inst.tree
  const log = tree.logsRenders === false ? undefined : tree.log
  tree.drew = true
  if (log !== undefined) log(inst, rendering)
  render(inst)
  if (log !== undefined) log(inst, rendered)
}

/** @internal */
export const flush = (
  tree: Tree,
  from = tree.slow?.flush && tree.slow.now()
): void => {
  tree.scheduled = true
  tree.flushing = true
  for (;;) {
    if (tree.closed) return
    if (tree.transitions?.hold()) {
      tree.flushing = false
      if (from !== undefined) tree.slow!.flush!(from, true)
      return
    }
    const batch = tree.dirty
    if (tree.work?.(batch.length === 0)) continue
    if (batch.length === 0) {
      // Include renders triggered by `beforeCommit` mounts in this flush.
      const committing = tree.committing
      if (committing === undefined) break
      tree.committing = undefined
      for (let index = 0; index < committing.length; index++) {
        committing[index]!()
      }
      continue
    }
    tree.dirty = []
    if (batch.length > 1) batch.sort(byDepth)
    for (let index = 0; index < batch.length; index++) {
      const inst = batch[index]!
      if (inst.dirty && !inst.closed) renderDirty(inst)
    }
  }
  tree.scheduled = tree.flushing = false
  tree.host.commit?.()
  const committed = tree.committed
  if (committed !== undefined) {
    tree.committed = undefined
    for (let index = 0; index < committed.length; index++) committed[index]!()
  }
  if (from !== undefined) tree.slow!.flush!(from)
}

// A view is called through this, as it may have a `call` of its own.
const callView = Function.prototype.call

/**
 * Calls `component`'s view with the state of `inst`. `store` is where
 * `h.lazy` keeps its nodes.
 *
 * @internal
 */
export const draw = (
  inst: Instance,
  component: Runnable,
  store: Instance | undefined
): View.Node<any, any> | undefined => {
  const view = component.view ?? component["~content"]!
  return callView.call(
    view,
    component,
    inst.model,
    inst.props,
    inst.runs?.running,
    inst.results,
    View.takesPathSource(view) ? inst : inst.path,
    inst.look,
    store
  )
}

const viewOf = (inst: Instance): View.Node<any, any> | undefined => {
  const slow = inst.tree.slow
  const from = slow?.view && slow.now()
  try {
    const tree = draw(inst, inst.component, inst)
    if (from !== undefined) slow!.view!(from, inst)
    if (dev && tree !== undefined) {
      const author = checkPaths(inst, tree)
      if (author !== undefined) inst.tree.schedule(() => recheckPlaced(author))
    }
    return tree
  } catch (error) {
    fail(inst, "view", Cause.die(error))
    return undefined
  }
}

/** @internal */
export const authorOf = (inst: Instance): Instance =>
  inst.at !== undefined &&
    (inst.at.v as View.Child<any, any>).view !== undefined
    ? inst.parent!
    : inst

const start = (inst: Instance): Rec | undefined => {
  let first: Next
  const component = inst.component
  const outer = slot
  const from = born.length
  const fallbacks = shown
  const by = authorOf(inst)
  slot = by === inst ? undefined : inst.path
  busy++
  try {
    try {
      inst.tree.drew = true
      first = inst.tree.init(inst)
    } catch (error) {
      fail(inst, "init", Cause.die(error))
      return undefined
    }
    inst.model = first.model
    const seq = inst.tree.log?.(inst, {
      _tag: "Mounted",
      props: inst.props,
      model: first.model,
      commands: first.commands,
      events: first.events,
      adopted: false
    })
    component.boot?.(inst)
    issueAll(inst, first, seq)
    component["~first"]?.(inst)
    if (inst.closed) return undefined
    inst.dirty = false
    const tree = viewOf(inst)
    if (tree === undefined) return undefined
    let rendered: Rec
    by.writing++
    try {
      rendered = create(by, tree)
      if (dev && shown !== fallbacks) checkShown(inst.path, [rendered])
    } catch (error) {
      fail(inst, "view", Cause.die(error), undefined, from)
      return undefined
    } finally {
      by.writing--
    }
    if (inst.closed) {
      release(inst, rendered)
      return undefined
    }
    inst.rendered = rendered
    inst.kept?.done()
    applied(inst, first, seq)
    return rendered
  } finally {
    busy--
    born.length = from
    slot = outer
  }
}

const render = (inst: Instance): void => {
  inst.dirty = false
  const outer = slot
  const from = born.length
  const fallbacks = shown
  const by = authorOf(inst)
  slot = by === inst ? undefined : inst.path
  busy++
  by.writing++
  try {
    inst.component["~render"]?.(inst)
    const tree = viewOf(inst)
    if (tree === undefined) return
    inst.rendered = patch(by, inst.rendered!, tree)
    inst.kept?.done()
    if (dev && shown !== fallbacks) checkShown(inst.path, [inst.rendered])
  } catch (error) {
    fail(inst, "view", Cause.die(error), undefined, from)
  } finally {
    busy--
    by.writing--
    born.length = from
    slot = outer
  }
}

/** @internal */
export const clear = (inst: Instance): void => {
  inst.rendered = patch(authorOf(inst), inst.rendered!, emptyText)
}

/** @internal */
export const close = (inst: Instance): void => {
  if (inst.closed) return
  inst.closed = true
  inst.tree.drew = true
  inst.lazy = undefined
  if (inst.parent !== undefined) inst.parent.live--
  const by = authorOf(inst)
  if (inst.rendered !== undefined && by.live > 0) release(by, inst.rendered)
  const log = inst.tree.log
  if (log !== undefined) log(inst, { _tag: "Unmounted" })
  const closers = inst.closers
  if (closers !== undefined) {
    for (let index = closers.length - 1; index >= 0; index--) {
      closers[index]!()
    }
  }
}

const released = undefined as unknown as Instance

/** @internal */
export const release = (owner: Instance, rec: Rec): void => {
  if (owner.live === 0) return
  const view = rec.v
  const kids = rec.kids
  if (view._tag === "Child") {
    if (keeperOf(view)?.release(owner, rec)) return
    if (kids === undefined) return close(rec.inst)
    if (rec.inst === owner) {
      owner.live--
      rec.inst = released
    }
  } else if (view._tag === "Element") {
    if (view.mount !== undefined) {
      owner.live--
      ;(view.mount as unknown as Attachable)["~detach"](rec)
    }
  } else if (view._tag === "Outlet") {
    if (rec.inst !== owner) return
    rec.inst = released
    owner.live--
    if (owner.placed!.get(view.name)?.rec === rec) {
      owner.placed!.delete(view.name)
    }
    owner = owner.parent!
  }
  if (kids !== undefined) {
    for (let index = kids.length - 1; index >= 0; index--) {
      release(owner, kids[index]!)
    }
  }
}

/** @internal */
export const nodeOf = (rec: Rec): any => {
  while (rec.node === undefined) {
    rec = rec.kids !== undefined
      ? rec.kids[0]!
      : rec.inst.rendered!
  }
  return rec.node
}

const lastNodeOf = (rec: Rec): any => {
  while (rec.node === undefined) {
    rec = rec.kids !== undefined
      ? rec.kids[rec.kids.length - 1]!
      : rec.inst.rendered!
  }
  return rec.node
}

/** @internal */
export const place = (
  host: Host,
  parent: unknown,
  rec: Rec,
  before: unknown
): void => {
  if (rec.node !== undefined) host.insert(parent, rec.node, before)
  else if (rec.kids === undefined) {
    place(host, parent, rec.inst.rendered!, before)
  } else {for (let index = 0; index < rec.kids.length; index++) {
      place(host, parent, rec.kids[index]!, before)
    }}
}

const remove = (inst: Instance, parent: unknown, rec: Rec): void => {
  if (rec.node !== undefined) {
    release(inst, rec)
    inst.tree.host.remove(parent, rec.node)
    return
  }
  const nodes = nodesOf(rec, [])
  release(inst, rec)
  for (const node of nodes) inst.tree.host.remove(parent, node)
}

/** @internal */
export const nodesOf = (rec: Rec, out: Array<unknown>): Array<unknown> => {
  if (rec.node !== undefined) out.push(rec.node)
  else if (rec.kids === undefined) nodesOf(rec.inst.rendered!, out)
  else {for (let index = 0; index < rec.kids.length; index++) {
      nodesOf(rec.kids[index]!, out)
    }}
  return out
}

/** @internal */
export const unplace = (host: Host, parent: unknown, rec: Rec): void => {
  for (const node of nodesOf(rec, [])) host.remove(parent, node)
}

const keeperOf = (view: View.Child<any, any>): Keeper | undefined =>
  view.alive === undefined
    ? undefined
    : (view.component as Partial<Runnable>)["~kept"]

/** @internal */
export const mountChild = (
  owner: Instance,
  rec: Rec,
  fresh?: boolean
): void => {
  const view = rec.v as View.Child<any, any>
  let component = view.component as any
  if (!fresh) {
    const keeper = keeperOf(view)
    if (keeper !== undefined) return keeper.mount(owner, rec, slot)
  }
  let env = owner.env
  if (owner === fallen) {
    while (env.ctx === undefined && env.parent !== undefined) {
      env = env.parent
    }
  }
  const at = slot
  let held: Rec | undefined
  const lazy = component["~load"] !== undefined
  if (lazy) component = component["~load"](owner, rec, at) ?? component
  if (lazy && component === view.component) {
    held = loadingIn(
      owner,
      view,
      component["~cause"](),
      (fallback) => create(owner, fallback)
    )
  } else if (FeatureId in component) {
    const ctx = env.ctx
    if (ctx === undefined) {
      if (dev) checkFallback(owner.path, view)
      held = inFallback(
        owner,
        () => create(owner, fallbackOf(owner, view, env.cause))
      )
      if (env.cause === undefined) {
        env.waiting.push(() => settle(owner, rec, at))
      }
    } else {
      const found = Context.getOrUndefined(ctx, component) as any
      if (found === undefined) {
        throw new Error(owner.path + ": nothing provides " + component.key)
      }
      component = found.component
      env = {
        ctx: Context.merge(ctx, found.context),
        cause: undefined,
        waiting: []
      }
    }
  } else if (owner.tree.host.hold?.(owner, rec, at, component)) {
    held = create(owner, emptyText)
  }
  const child = rec.inst = held === undefined
    ? new Instance(owner.tree, component, owner, rec, view.props, env)
    : owner
  owner.live++
  born.push(owner, rec)
  if (held !== undefined) rec.kids = [held]
  else if (start(child) === undefined) rec.kids = [stand(child, child.failure!)]
  else if (owner.closed) close(child)
}

/** @internal */
export const settle = (
  owner: Instance,
  rec: Rec,
  at: string | undefined
): void => {
  if (rec.inst !== owner || owner.closed) return
  const host = owner.tree.host
  const old = rec.kids![0]!
  const outer = slot
  slot = at
  try {
    if (
      owner.env.ctx === undefined &&
      FeatureId in (rec.v as View.Child<any, any>).component
    ) {
      rec.kids![0] = inFallback(
        owner,
        () =>
          patch(
            owner,
            old,
            fallbackOf(owner, rec.v as View.Child<any, any>, owner.env.cause)
          )
      )
      return
    }
    const first = nodeOf(old)
    const parentNode = host.parentOf(first)
    rec.kids = undefined
    owner.live--
    try {
      mountChild(owner, rec)
    } catch (error) {
      rec.kids = [old]
      owner.live++
      throw error
    }
    place(host, parentNode, rec, first)
    unplace(host, parentNode, old)
    release(owner, old)
  } catch (error) {
    fail(owner, "view", Cause.die(error))
  } finally {
    slot = outer
  }
}

const noContent: ReadonlyArray<View.Node<any, any>> = [emptyText]

const contentOf = (
  view: View.Outlet,
  content: unknown
): ReadonlyArray<View.Node<any, any>> => {
  if (content === undefined) return noContent
  let views = View.children([content as View.Input<any, any>])
  if (views.length === 0) return noContent
  const noText = view.noText
  if (noText !== undefined) {
    views = views.map((node) => {
      if (node._tag === "Text") throw new Error(slot + ": " + noText)
      return node._tag === "Outlet" && node.noText !== noText
        ? { _tag: "Outlet", name: node.name, noText }
        : node
    })
  }
  if (dev) checkContent(slot!, views)
  return views
}

/** @internal */
export const failLater = (inst: Instance, error: unknown): void =>
  inst.tree.schedule(() => fail(inst, "view", Cause.die(error)))

const slotOf = (receiver: Instance, name: string): unknown =>
  receiver.at === undefined
    ? undefined
    : (receiver.at.v as View.Child<any, any>).slots?.[name]

const refresh = (receiver: Instance, placed: Placed): void => {
  const rec = placed.rec
  const view = rec.v as View.Outlet
  const content = slotOf(receiver, view.name)
  if (content === placed.content) return
  placed.content = content
  const declarer = receiver.parent!
  const host = receiver.tree.host
  const olds = rec.kids!
  const after = host.nextOf(lastNodeOf(olds[olds.length - 1]!))
  const outer = slot
  const fallbacks = shown
  slot = receiver.path + "/" + slotSegment(view.name)
  try {
    let views = noContent
    try {
      views = contentOf(view, content)
    } catch (error) {
      failLater(declarer, error)
    }
    const kids = rec.kids = patchList(
      declarer,
      host.parentOf(nodeOf(olds[0]!)),
      olds,
      views,
      after
    )
    if (dev && shown !== fallbacks) {
      try {
        checkShown(slot, kids, true)
      } catch (error) {
        failLater(declarer, error)
      }
    }
  } finally {
    slot = outer
  }
}

const setAttrs = (
  host: Host,
  node: unknown,
  attrs: Readonly<Record<string, string>>
): void => {
  if (host.normalizeAttrs !== undefined) {
    attrs = host.normalizeAttrs(node, attrs)
  }
  for (const name in attrs) host.setAttr(node, name, attrs[name])
}

const setProps = (
  host: Host,
  node: unknown,
  props: Readonly<Record<string, unknown>>
): void => {
  for (const name in props) host.setProp(node, name, props[name])
}

/**
 * Creates `views` and places them in `parent`, each after the one before. A
 * view of the same shape as the one before it is built from a copy of that
 * one's host nodes.
 *
 * @internal
 */
export const createAll = (
  inst: Instance,
  parent: unknown,
  views: ReadonlyArray<View.Node<any, any>>,
  from = 0,
  to = views.length,
  before: unknown = null
): Array<Rec> => {
  const host = inst.tree.host
  const kids: Array<Rec> = new Array(to - from)
  let like: Rec | undefined
  for (let index = from; index < to; index++) {
    const view = views[index]!
    const kernel = (view as View.TemplateNode)["~t"]?.kernel
    if (kernel !== undefined && host.pointsOf !== undefined) {
      const made = kids[index - from] = kernel.create(
        inst,
        view as View.TemplateNode
      ) as Rec
      host.insert(parent, made.node, before)
      continue
    }
    const copy = like === undefined ? undefined : createLike(inst, like, view)
    if (copy !== undefined) {
      place(host, parent, kids[index - from] = copy, before)
    } else {
      const made = kids[index - from] = create(inst, view)
      if (made.node !== undefined) host.insert(parent, made.node, before)
      else place(host, parent, made, before)
      like = host.clone !== undefined && copies(made.v) ? made : undefined
    }
  }
  return kids
}

// Whether a created element's host nodes can be copied for its siblings, so
// long as nothing has touched them since: one with children, all elements and
// text holding nothing but attributes and handlers, so that a copy is what
// `create` would build. An element with properties, a mount or a part's
// layer isn't, and nor is a form, a script or a custom element, whose host
// node is more than its attributes, or a template's, whose nodes carry its
// record.
const copies = (view: View.Node<any, any>): boolean =>
  view._tag === "Element" && (view as View.TemplateNode)["~t"] === undefined &&
  view.children.length > 0 && plainShape(view)

const plainShape = (view: View.Node<any, any>): boolean => {
  if (view._tag === "Text") return true
  if (
    view._tag !== "Element" ||
    (view as View.TemplateNode)["~t"] !== undefined ||
    !View.isPlain(view) || !View.isPlainTag(view.tag)
  ) return false
  const children = view.children
  for (let index = 0; index < children.length; index++) {
    if (!plainShape(children[index]!)) return false
  }
  return true
}

// Builds `view` from a copy of the host nodes of `like`, an element `copies`
// accepted, writing only the attributes and text that differ. `undefined`
// when `view` doesn't have the shape of `like`: the same tags and text in
// the same places, holding nothing else. The copy is then dropped.
//
// Only the root and the elements with handlers get records: the others are
// made when a patch first needs them, see `kidsOf`. A list of rows built
// this way keeps a few objects per row, not one per node.
const createLike = (
  inst: Instance,
  like: Rec,
  view: View.Node<any, any>
): Rec | undefined => {
  const was = like.v as View.Element<any, any>
  if (view._tag !== "Element" || !copiesAs(was, view)) return undefined
  const host = inst.tree.host
  const node = host.clone!(like.node)
  const rec = new Rec(
    view,
    node,
    view.children.length > 0 ? unmade : undefined,
    inst
  )
  return fill(inst, host, was, view, node, rec) ? rec : undefined
}

// Whether `view` has the shape of `was`, writing what differs into `node`,
// a copy of the nodes of `was`. `rec` is the record of `node`, if it has one.
const fill = (
  inst: Instance,
  host: Host,
  was: View.Node<any, any>,
  view: View.Node<any, any>,
  node: unknown,
  rec: Rec | undefined
): boolean => {
  if (was._tag === "Text") {
    if (view._tag !== "Text") return false
    if (was.text !== view.text) host.setText(node, view.text)
    return true
  }
  const prev = was as View.Element<any, any>
  if (view._tag !== "Element" || !copiesAs(prev, view)) return false
  if (prev.attrs !== view.attrs) patchAttrs(host, node, prev.attrs, view.attrs)
  const views = view.children
  if (views.length > 0) {
    if (dev && views.length > 1) checkKeys(inst.path, views)
    const befores = prev.children
    // The host node of `views[at]`, read only when a kid needs its own: a
    // node read from the host can cost an object, as a DOM node does.
    let child: unknown = undefined
    let at = -1
    for (let index = 0; index < views.length; index++) {
      const before = befores[index]!
      const kid = views[index]!
      if (untouched(before, kid)) continue
      if (at < 0) {
        child = host.firstOf!(node)
        at = 0
      }
      for (; at < index; at++) child = host.nextOf(child)
      if (!fill(inst, host, before, kid, child, undefined)) return false
    }
  }
  if (view.handlers !== View.noFields || view.eventOptions !== View.noFields) {
    host.setEvents(
      node,
      rec ?? new Rec(view, node, views.length > 0 ? unmade : undefined, inst),
      true
    )
  }
  return true
}

// Whether a copy of `was`'s node is already `view`'s, so `fill` has nothing
// to write to it: the same text, or the same element without children or
// handlers. Not every view that is `was` itself: a copy of a node doesn't
// carry its record, so an element with handlers, at any depth, needs `fill`
// to give the copy one.
const untouched = (
  was: View.Node<any, any>,
  view: View.Node<any, any>
): boolean => {
  if (was._tag === "Text") return view._tag === "Text" && was.text === view.text
  return view._tag === "Element" && view.children.length === 0 &&
    view.handlers === View.noFields && view.eventOptions === View.noFields &&
    copiesAs(was as View.Element<any, any>, view) &&
    sameAttrs((was as View.Element<any, any>).attrs, view.attrs)
}

// Whether `view` can be built from a copy of `prev`'s nodes, as far as the
// element itself goes. Its tag is `prev`'s, which `plainShape` accepted. A
// template's can't: its nodes are made from its own.
const copiesAs = (
  prev: View.Element<any, any>,
  view: View.Element<any, any>
): boolean =>
  prev.tag === view.tag && (view as View.TemplateNode)["~t"] === undefined &&
  prev.children.length === view.children.length && View.isPlain(view)

/**
 * The records of the kids of `rec`, an element whose view was `prev`, made
 * if `createLike` left them `unmade`: read off the host nodes, keeping the
 * records the elements with handlers already have. If the nodes no longer
 * match `prev`, because something other than the runtime changed them, the
 * element is built again.
 *
 * @internal
 */
export const kidsOf = (
  rec: Rec,
  prev: View.Element<any, any>
): Array<Rec> | undefined => {
  const kids = rec.kids
  if (kids !== unmade) return kids
  const host = rec.inst.tree.host
  const views = prev.children
  const made: Array<Rec> = new Array(views.length)
  let child = host.firstOf!(rec.node)
  for (let index = 0; index < views.length; index++) {
    const view = views[index]!
    // A node that isn't what the view made: something replaced it, and its
    // record would patch the wrong element.
    if (
      child === null ||
      host.kindOf!(child) !==
        (view._tag === "Text" ? "#text" : (view as View.Element<any, any>).tag)
    ) return rebuild(rec, prev)
    if (view._tag === "Text") {
      made[index] = new Rec(view, child, undefined, rec.inst)
    } else {
      let kid = host.recOf?.(child)
      if (kid === undefined || kid.v !== view) {
        kid = new Rec(
          view,
          child,
          (view as View.Element<any, any>).children.length > 0
            ? unmade
            : undefined,
          rec.inst
        )
        if (
          (view as View.Element<any, any>).handlers !== View.noFields ||
          (view as View.Element<any, any>).eventOptions !== View.noFields
        ) host.setEvents(child, kid, true)
      }
      made[index] = kid
    }
    child = host.nextOf(child)
  }
  if (child !== null) return rebuild(rec, prev)
  return rec.kids = made
}

// Builds `rec`'s element again from `prev`, its view, in place of nodes that
// changed under it.
const rebuild = (
  rec: Rec,
  prev: View.Element<any, any>
): Array<Rec> | undefined => {
  const host = rec.inst.tree.host
  const fresh = create(rec.inst, prev)
  const parent = host.parentOf(rec.node)
  if (parent !== null && parent !== undefined) {
    host.insert(parent, fresh.node, rec.node)
    host.remove(parent, rec.node)
  }
  rec.node = fresh.node
  if (prev.handlers !== View.noFields || prev.eventOptions !== View.noFields) {
    host.setEvents(fresh.node, rec, true)
  }
  return rec.kids = fresh.kids
}

/** @internal */
export const create = (inst: Instance, view: View.Node<any, any>): Rec => {
  const host = inst.tree.host
  switch (view._tag) {
    case "Text":
      return new Rec(view, host.createText(view.text), undefined, inst)
    case "Element": {
      // A template's element on a host that copies nodes, if the template
      // has the operations for it; built as any element otherwise.
      const kernel = (view as View.TemplateNode)["~t"]?.kernel
      if (kernel !== undefined && host.pointsOf !== undefined) {
        return kernel.create(inst, view as View.TemplateNode) as Rec
      }
      if (view.owned?.length) view = owned(inst, view, view.owned)
      const node = host.createElement(view.tag)
      if (view.attrs !== View.noFields) setAttrs(host, node, view.attrs)
      const views = view.children
      let kids: Array<Rec> | undefined
      if (dev && views.length > 1) checkKeys(inst.path, views)
      if (views.length > 0) kids = createAll(inst, node, views)
      if (view.props !== View.noFields) {
        if (inst.tree.restores !== true && controls(host, view.props)) {
          inst.tree.restores = true
        }
        setProps(host, node, view.props)
      }
      host.made?.(node, inst)
      const rec = new Rec(view, node, kids, inst)
      if (
        view.handlers !== View.noFields || view.eventOptions !== View.noFields
      ) host.setEvents(node, rec, true)
      if (view.mount !== undefined) {
        inst.live++
        ;(view.mount as unknown as Attachable)["~attach"](rec)
      }
      return rec
    }
    case "Child": {
      const rec = new Rec(view, undefined, undefined, inst)
      mountChild(inst, rec)
      return rec
    }
    case "Outlet":
      return createOutlet(inst, view)
  }
}

const createOutlet = (inst: Instance, view: View.Outlet): Rec => {
  if (dev) checkDeclarer(inst, view)
  const declarer = inst.parent!
  const content = slotOf(inst, view.name)
  const rec = new Rec(view, undefined, undefined, inst)
  inst.live++
  ;(inst.placed ??= new Map()).set(view.name, { rec, content })
  const outer = slot
  const from = born.length
  const fallbacks = shown
  slot = inst.path + "/" + slotSegment(view.name)
  try {
    const views = contentOf(view, content)
    const kids: Array<Rec> = rec.kids = new Array(views.length)
    for (let index = 0; index < views.length; index++) {
      kids[index] = create(declarer, views[index]!)
    }
    if (dev && shown !== fallbacks) checkShown(slot, kids, true)
  } catch (error) {
    orphans(from)
    rec.kids = [create(declarer, emptyText)]
    failLater(declarer, error)
  } finally {
    slot = outer
  }
  return rec
}

/** @internal */
export const pairs = (
  old: View.Node<any, any>,
  view: View.Node<any, any>
): boolean => {
  if (old === view) return true
  switch (old._tag) {
    case "Element":
      return view._tag === "Element" && pairsElement(old, view)
    case "Text":
      return view._tag === "Text"
    case "Child":
      return view._tag === "Child" && old.component === view.component &&
        old.key === view.key
    case "Outlet":
      return view._tag === "Outlet" && old.name === view.name
  }
}

const patch = (inst: Instance, old: Rec, view: View.Node<any, any>): Rec => {
  const prev = old.v
  if (prev === view) {
    if (inst.tree.restores === true && view._tag === "Element") {
      restore(inst.tree.host, old)
    }
    return old
  }
  if (!pairs(prev, view)) return replace(inst, old, view)
  return patchPaired(inst, old, prev, view)
}

// `pairs`, for two elements: the same tag, key and template.
const pairsElement = (
  old: View.Element<any, any>,
  view: View.Element<any, any>
): boolean =>
  old.tag === view.tag && old.elementKey === view.elementKey &&
  (old as View.TemplateNode)["~t"] === (view as View.TemplateNode)["~t"]

// `patch`, for a view that `pairs` with the one before, `prev`, and isn't it.
const patchPaired = (
  inst: Instance,
  old: Rec,
  prev: View.Node<any, any>,
  view: View.Node<any, any>
): Rec => {
  switch (view._tag) {
    case "Text":
      if ((prev as View.Text).text !== view.text) {
        inst.tree.host.setText(old.node, view.text)
      }
      old.v = view
      return old
    case "Element":
      patchElement(inst, old, prev as View.Element<any, any>, view)
      return old
    case "Child":
      return (keeperOf(view) ?? keeperOf(prev as View.Child<any, any>))
        ?.patch(inst, old, view, slot) ??
        patchChild(inst, old, view)
    case "Outlet": {
      const placed = inst.placed!.get(view.name)
      if (placed?.rec !== old) return old
      if ((prev as View.Outlet).noText !== view.noText) {
        placed.content = refreshed
      }
      old.v = view
      refresh(inst, placed)
      return old
    }
  }
}

const applyProps = (inst: Instance, props: unknown): boolean => {
  if (inst.closed || propsEqual(inst.props, props)) return false
  inst.props = props
  inst.tree.log?.(inst, { _tag: "PropsChanged", props })
  inst.component["~sync"]?.(inst)
  return !inst.closed
}

/** @internal */
export const patchChild = (
  inst: Instance,
  old: Rec,
  view: View.Child<any, any>
): Rec => {
  const child = old.inst
  const shown = old.kids
  if (shown === undefined && inst.tree.holds?.(child, inst, view) === true) {
    return old
  }
  old.v = view
  if (shown !== undefined) {
    shown[0] = child === inst
      ? (view.component as Runnable)["~load"] === undefined
        ? inFallback(
          inst,
          () =>
            patch(
              inst,
              shown[0]!,
              fallbackOf(inst, view, inst.env.cause)
            )
        )
        : loadingIn(
          inst,
          view,
          (view.component as Runnable)["~cause"]!() ?? inst.env.cause,
          (fallback) => patch(inst, shown[0]!, fallback)
        )
      : patch(inst, shown[0]!, fallbackOf(inst, view, child.failure))
    return old
  }
  const changed = applyProps(child, view.props)
  if (child.closed) return old
  if (changed || view.view !== undefined) {
    if (child === receiving) markDirty(child)
    else render(child)
  }
  const placed = child.placed
  if (placed !== undefined && !child.closed) {
    for (const entry of placed.values()) {
      refresh(child, entry)
    }
  }
  return old
}

/** @internal */
export const replace = (
  inst: Instance,
  old: Rec,
  view: View.Node<any, any>
): Rec => {
  const host = inst.tree.host
  const at = nodeOf(old)
  const parent = host.parentOf(at)
  const next = create(inst, view)
  place(host, parent, next, at)
  remove(inst, parent, old)
  return next
}

const refreshed = {}

// Whether `props` holds a property `host` controls, such as the DOM's
// `value`, which the user changes without a patch, so a patch writes it
// again even when it hasn't changed.
const controls = (
  host: Host,
  props: Readonly<Record<string, unknown>>
): boolean => {
  const controlled = host.controlled
  if (controlled === undefined) return false
  for (const name in props) {
    if (controlled.has(name)) return true
  }
  return false
}

/**
 * Writes the controlled properties of `rec`'s element and of the elements
 * below it again, as the user may have changed them. Whether there were
 * any. Only element descendants are scanned. Patching a changed element
 * also patches its element ancestors, clearing `plain` so the next restore
 * scans them again.
 *
 * @internal
 */
export const restore = (host: Host, rec: Rec): boolean => {
  if (rec.plain) return false
  const view = rec.v as View.Element<any, any>
  let found = false
  const kids = rec.kids
  if (kids !== undefined) {
    for (let index = 0; index < kids.length; index++) {
      const kid = kids[index]!
      if (kid.v._tag === "Element" && restore(host, kid)) found = true
    }
  }
  const props = view.props
  for (const name in props) {
    if (host.controlled!.has(name)) {
      host.setProp(rec.node, name, props[name])
      found = true
    }
  }
  rec.plain = !found
  return found
}

const sameAttrs = (
  before: Readonly<Record<string, string>>,
  attrs: Readonly<Record<string, string>>
): boolean => {
  // Shared records are common: `classOnly` and `extended` give one to every
  // element with the same class.
  if (before === attrs) return true
  let count = 0
  for (const name in before) {
    if (before[name] !== attrs[name]) return false
    count++
  }
  for (const _ in attrs) count--
  return count === 0
}

const patchAttrs = (
  host: Host,
  node: unknown,
  before: Readonly<Record<string, string>>,
  attrs: Readonly<Record<string, string>>
): void => {
  // Records that differ by being empty differ: only two full ones are read.
  if (
    before !== View.noFields && attrs !== View.noFields &&
    sameAttrs(before, attrs)
  ) {
    return
  }
  if (host.normalizeAttrs !== undefined) {
    before = host.normalizeAttrs(node, before)
    attrs = host.normalizeAttrs(node, attrs)
  }
  for (const name in before) {
    if (typeof attrs[name] !== "string") {
      host.setAttr(node, name, undefined, before[name])
    }
  }
  for (const name in attrs) {
    const value = attrs[name]
    const previous = before[name]
    if (previous !== value) host.setAttr(node, name, value, previous)
  }
}

const patchProps = (
  host: Host,
  node: unknown,
  was: Readonly<Record<string, unknown>>,
  props: Readonly<Record<string, unknown>>
): void => {
  const controlled = host.controlled
  for (const name in was) {
    if (!(name in props)) host.setProp(node, name, undefined)
  }
  for (const name in props) {
    if (was[name] !== props[name] || controlled?.has(name) === true) {
      host.setProp(node, name, props[name])
    }
  }
}

const patchElement = (
  inst: Instance,
  rec: Rec,
  prev: View.Element<any, any>,
  view: View.Element<any, any>
): void => {
  // `points` is set on a record a template's operations made, and `prev`
  // and `view` pair, so both are of that template.
  if (rec.points !== undefined) {
    return (view as View.TemplateNode)["~t"].kernel!.patch(
      inst,
      rec,
      prev as View.TemplateNode,
      view as View.TemplateNode
    )
  }
  const host = inst.tree.host
  // A row built from a copy makes its kids' records now, before anything is
  // written: if its nodes changed under it, it's built again from `prev`,
  // and this patch then goes to the new node.
  if (rec.kids === unmade) kidsOf(rec, prev)
  const node = rec.node
  const layers = view.owned?.length ? view.owned : prev.owned
  if (layers?.length) view = owned(inst, view, layers)
  rec.v = view
  rec.plain = false
  if (prev.attrs !== view.attrs) patchAttrs(host, node, prev.attrs, view.attrs)
  if (
    view.handlers !== prev.handlers || view.eventOptions !== prev.eventOptions
  ) {
    host.setEvents(
      node,
      rec,
      prev.handlers === View.noFields && prev.eventOptions === View.noFields
    )
  }
  patchKids(inst, rec, node, prev, view.children)
  patchRest(inst, rec, node, prev, view)
}

/**
 * Patches `rec`'s kids, made for `prev.children`, to `views`, in `node`: an
 * element's children, or the nodes a template's content slot holds. The
 * kids are made: `patchElement` makes a copied row's first.
 *
 * @internal
 */
export const patchKids = (
  inst: Instance,
  rec: Rec,
  node: unknown,
  prev: View.Element<any, any>,
  views: ReadonlyArray<View.Node<any, any>>
): void => {
  const host = inst.tree.host
  const before = prev.children
  // The same children, such as a list `h.list` gave again, are the same
  // nodes: nothing in them to patch, unless properties are set again.
  if (
    views === before && views.length > 0 &&
    inst.tree.restores !== true
  ) return
  const olds = rec.kids
  if (dev && views.length > 1) checkKeys(inst.path, views)
  // Children `h.list` gave, which say how they changed: only those nodes.
  const hint = olds === undefined ? undefined : View.takeListHint(views)
  if (
    hint !== undefined && views.length > 0 && hint.base === before &&
    olds!.length === hint.base.length &&
    inst.tree.restores !== true
  ) {
    if (hint.changed === undefined) {
      if (hint.traded !== undefined) {
        patchTraded(inst, node, olds!, views, hint.start, hint.traded)
      } else rec.kids = patchSplice(inst, node, olds!, views, hint)
      return
    }
    if (patchChanged(inst, olds!, views, hint.changed)) return
  }
  if (olds === undefined) {
    if (views.length > 0) rec.kids = createAll(inst, node, views)
  } else if (views.length === 0) {
    // `release` has nothing to do in an instance with nothing live in it,
    // such as a plain list's: not called for each of its rows then.
    if (inst.live > 0) {
      for (let index = 0; index < olds.length; index++) {
        release(inst, olds[index]!)
      }
    }
    if (host.clear !== undefined) host.clear(node)
    else {for (let index = 0; index < olds.length; index++) {
        unplace(host, node, olds[index]!)
      }}
    rec.kids = undefined
  } else if (views.length === 1 && olds.length === 1) {
    const old = olds[0]!
    const next = views[0]!
    if (next._tag === "Text" && old.v._tag === "Text") {
      if (old.v.text !== next.text) host.setText(old.node, next.text)
      old.v = next
    } else if (
      next._tag === "Element" && old.v !== next && old.v._tag === "Element" &&
      pairsElement(old.v, next)
    ) {
      patchElement(inst, old, old.v, next)
    } else olds[0] = patch(inst, old, next)
  } else rec.kids = patchList(inst, node, olds, views, null, true)
}

// Patches only the kids at `changed`, the indexes where a list `h.list` gave
// differs from the one before: each in its place, so only if each still
// pairs with the one there. Whether it did.
const patchChanged = (
  inst: Instance,
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  changed: ReadonlyArray<number>
): boolean => {
  // A kid that doesn't pair stops it: the ones before it are patched, and
  // `patchList`, which takes over, keeps them as they are.
  for (let index = 0; index < changed.length; index++) {
    const at = changed[index]!
    const old = olds[at]!
    const prev = old.v
    const view = views[at]!
    if (prev === view) continue
    if (!pairs(prev, view)) return false
    olds[at] = patchPaired(inst, old, prev, view)
  }
  return true
}

// Patches the kids of an element whose children were a list `h.list` gave
// with the nodes at `start` and `end` traded, the rest as they were: those
// two records trade places in `olds`, which the element keeps, and their
// nodes move, only one of them if they're neighbours, as `patchSwap` does.
const patchTraded = (
  inst: Instance,
  parent: unknown,
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  start: number,
  end: number
): void => {
  // `patch` keeps a node given again as it was: a tree that restores
  // properties doesn't take this path.
  const last = olds[start]!
  olds[start] = patch(inst, olds[end]!, views[start]!)
  olds[end] = patch(inst, last, views[end]!)
  moveTraded(inst.tree.host, parent, olds, start, end, null)
}

// Patches the kids of an element whose children were a list `h.list` gave
// with nodes inserted or removed in one place, as `splice` says: only those
// are created or removed, and the rest keep their records and nodes.
const patchSplice = (
  inst: Instance,
  parent: unknown,
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  splice: View.ListHint
): Array<Rec> => {
  const { added, removed, start } = splice
  for (let index = start; index < start + removed; index++) {
    remove(inst, parent, olds[index]!)
  }
  if (added === 0) {
    const out = olds.slice()
    out.splice(start, removed)
    return out
  }
  const made = createAll(
    inst,
    parent,
    views,
    start,
    start + added,
    start < olds.length ? nodeOf(olds[start]!) : null
  )
  const out: Array<Rec> = new Array(views.length)
  for (let index = 0; index < start; index++) out[index] = olds[index]!
  for (let index = 0; index < added; index++) out[start + index] = made[index]!
  for (let index = start + added; index < views.length; index++) {
    out[index] = olds[index - added]!
  }
  return out
}

// What `patchElement` does after the children: properties and the mount.
const patchRest = (
  inst: Instance,
  rec: Rec,
  node: unknown,
  prev: View.Element<any, any>,
  view: View.Element<any, any>
): void => {
  const host = inst.tree.host
  // After the children, so a select's value wins over its options'.
  if (
    prev.props !== view.props ||
    (host.controlled !== undefined && view.props !== View.noFields)
  ) {
    if (inst.tree.restores !== true && controls(host, view.props)) {
      inst.tree.restores = true
    }
    patchProps(host, node, prev.props, view.props)
  }
  const mount = view.mount as unknown as Attachable | undefined
  const was = prev.mount as unknown as Attachable | undefined
  if (mount !== was) {
    if (mount === undefined) {
      inst.live--
      was!["~detach"](rec)
    } else {
      if (was === undefined) inst.live++
      mount["~attach"](rec)
    }
  }
}

const owned = (
  inst: Instance,
  view: View.Element<any, any>,
  layers: ReadonlyArray<View.Owned>
): View.Element<any, any> =>
  (layers[0]!.owner as Instance).component["~owned"]!(inst, view)

const keyOf = (view: View.Node<any, any>): unknown =>
  view._tag === "Element"
    ? view.elementKey
    : view._tag === "Child"
    ? (view.key === "" ? view.component : view.key)
    : undefined

const patchList = (
  inst: Instance,
  parent: unknown,
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  after: unknown,
  whole?: boolean
): Array<Rec> => {
  const host = inst.tree.host
  let start = 0
  let oldEnd = olds.length - 1
  let end = views.length - 1
  let out: Array<Rec> = oldEnd === end ? olds : new Array(views.length)
  // A node given again as it was, such as `h.lazy`'s, is kept without a
  // call, unless the tree has properties to write again.
  const kept = inst.tree.restores !== true
  while (start <= oldEnd && start <= end) {
    const old = olds[start]!
    const view = views[start]!
    const prev = old.v
    if (prev === view) {
      out[start] = kept ? old : patch(inst, old, view)
    } else if (prev._tag === "Element" && view._tag === "Element") {
      // `pairs` and `patchPaired` for the common case, written out.
      if (!pairsElement(prev, view)) break
      patchElement(inst, old, prev, view)
      out[start] = old
    } else if (pairs(prev, view)) {
      out[start] = patchPaired(inst, old, prev, view)
    } else break
    start++
  }
  if (out === olds) {
    if (start > end) return out
    out = new Array(views.length)
    for (let index = 0; index < start; index++) out[index] = olds[index]!
  }
  // An unkeyed element pairs with the last one even when rows were added or
  // removed before it, so it keeps its node. The same view is kept without
  // `pairs`.
  while (start <= oldEnd && start <= end) {
    const prev = olds[oldEnd]!.v
    const view = views[end]!
    if (prev === view) {
      // Kept as it is, so set here: the loop after the middle skips it.
      if (kept) out[end] = olds[oldEnd]!
    } else if (!pairs(prev, view)) break
    oldEnd--
    end--
  }
  if (oldEnd === end && start < end && swaps(olds, views, start, end)) {
    return patchSwap(inst, parent, olds, views, out, start, end, after)
  }
  const count = end - start + 1
  const sources = count > 0 && start <= oldEnd
    ? new Int32Array(count)
    : undefined
  let byKey: Map<unknown, number> | undefined
  let same: Int32Array | undefined
  for (let index = sources === undefined ? -1 : end; index >= start; index--) {
    const key = keyOf(views[index]!)
    if (key === undefined) continue
    const next = (byKey ??= new Map()).get(key)
    if (next !== undefined) {
      ;(same ??= new Int32Array(count))[index - start] = next + 1
    }
    byKey.set(key, index)
  }
  let moved = false
  let last = 0
  let gone: Array<Rec> | undefined
  for (let index = start; index <= oldEnd; index++) {
    const old = olds[index]!
    const key = keyOf(old.v)
    let to = key !== undefined
      ? byKey?.get(key)
      : index <= end
      ? index
      : undefined
    while (
      to !== undefined &&
      (sources![to - start] !== 0 || !pairs(old.v, views[to]!))
    ) {
      const next = key === undefined || same === undefined
        ? 0
        : same[to - start]!
      to = next === 0 ? undefined : next - 1
    }
    if (to !== undefined) {
      sources![to - start] = index + 1
      if (to < last) moved = true
      else last = to
    } else (gone ??= []).push(old)
  }
  let like: Rec | undefined
  for (let index = start; index <= end; index++) {
    const source = sources === undefined ? 0 : sources[index - start]!
    if (source !== 0) {
      out[index] = patch(inst, olds[source - 1]!, views[index]!)
      continue
    }
    const view = views[index]!
    const copy = like === undefined ? undefined : createLike(inst, like, view)
    if (copy !== undefined) out[index] = copy
    else {
      const made = out[index] = create(inst, view)
      like = host.clone !== undefined && copies(made.v) ? made : undefined
    }
  }
  if (gone !== undefined) {
    if (whole && gone.length === olds.length && host.clear !== undefined) {
      if (inst.live > 0) {
        for (let index = 0; index < olds.length; index++) {
          release(inst, olds[index]!)
        }
      }
      host.clear(parent)
    } else for (const old of gone) remove(inst, parent, old)
  }
  for (
    let index = end + 1, shift = olds.length - views.length;
    index < views.length;
    index++
  ) {
    if (out[index] !== undefined) continue
    const old = olds[index + shift]!
    const view = views[index]!
    out[index] = old.v === view && kept ? old : patch(inst, old, view)
  }
  if (!moved) {
    for (let index = start, from = start; index <= end + 1; index++) {
      if (
        index > end || (sources !== undefined && sources[index - start] !== 0)
      ) {
        const ref = index < views.length ? nodeOf(out[index]!) : after
        while (from < index) place(host, parent, out[from++]!, ref)
        from = index + 1
      }
    }
    return out
  }
  const stay = increasing(sources!)
  let at = stay.length - 1
  let ref = end + 1 < views.length ? nodeOf(out[end + 1]!) : after
  for (let offset = count - 1; offset >= 0; offset--) {
    const index = start + offset
    if (sources![offset] !== 0 && at >= 0 && stay[at] === offset) at--
    else place(host, parent, out[index]!, ref)
    ref = nodeOf(out[index]!)
  }
  return out
}

// Whether the first and last of `olds[start..end]` trade places, with the
// ones between them where they were: the keyed list diff's most common move,
// done without a map of the keys.
const swaps = (
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  start: number,
  end: number
): boolean => {
  const first = keyOf(views[start]!)
  const last = keyOf(views[end]!)
  if (
    first === undefined || last === undefined ||
    keyOf(olds[start]!.v) !== last || keyOf(olds[end]!.v) !== first ||
    !pairs(olds[end]!.v, views[start]!) || !pairs(olds[start]!.v, views[end]!)
  ) return false
  for (let index = start + 1; index < end; index++) {
    const prev = olds[index]!.v
    const view = views[index]!
    if (prev !== view && !pairs(prev, view)) return false
  }
  return true
}

const patchSwap = (
  inst: Instance,
  parent: unknown,
  olds: Array<Rec>,
  views: ReadonlyArray<View.Node<any, any>>,
  out: Array<Rec>,
  start: number,
  end: number,
  after: unknown
): Array<Rec> => {
  const host = inst.tree.host
  const kept = inst.tree.restores !== true
  out[start] = patch(inst, olds[end]!, views[start]!)
  for (let index = start + 1; index < views.length; index++) {
    const old = olds[index === end ? start : index]!
    const view = views[index]!
    out[index] = old.v === view && kept ? old : patch(inst, old, view)
  }
  moveTraded(host, parent, out, start, end, after)
  return out
}

// Moves the nodes of `recs[start]` and `recs[end]`, two kids that traded
// places, to where they now belong. `after` is the node after the last kid.
// A move takes a node out of the document, so none moves that needn't: of
// two neighbours, only one.
const moveTraded = (
  host: Host,
  parent: unknown,
  recs: Array<Rec>,
  start: number,
  end: number,
  after: unknown
): void => {
  place(host, parent, recs[start]!, nodeOf(recs[end]!))
  if (end > start + 1) {
    const next = end + 1 < recs.length ? nodeOf(recs[end + 1]!) : after
    place(host, parent, recs[end]!, next)
  }
}

const increasing = (sources: Int32Array): Array<number> => {
  const before = new Int32Array(sources.length)
  const run: Array<number> = []
  for (let index = 0; index < sources.length; index++) {
    const value = sources[index]!
    if (value === 0) continue
    let low = 0
    let high = run.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sources[run[mid]!]! < value) low = mid + 1
      else high = mid
    }
    before[index] = low > 0 ? run[low - 1]! : -1
    run[low] = index
  }
  for (let index = run.length - 1, at = run[index]; index >= 0; index--) {
    run[index] = at!
    at = before[at!]
  }
  return run
}

/** @internal */
export interface Root {
  readonly instance: Instance
  readonly send: (message: unknown, source?: unknown) => void
  readonly setProps: (props: unknown) => void
  readonly close: () => void
}

/** @internal */
export interface Options {
  readonly report: Tree["report"]
  readonly slow?: Slow | undefined
  readonly path?: string | undefined
  readonly context?: Context.Context<any> | undefined
  readonly log?: Recorder | undefined
  readonly logsRenders?: Tree["logsRenders"]
  readonly fallback?: Tree["fallback"]
  readonly init?: Tree["init"] | undefined
  readonly onEmit?: Tree["onEmit"]
  readonly schedule?: Tree["schedule"] | undefined
  readonly follow?: Tree["follow"] | undefined
}

const initOf = (inst: Instance): Next => inst.component.init(inst.props)

/** @internal */
export const mount = (
  component: Runnable,
  props: unknown,
  container: unknown,
  host: Host,
  options: Options
): Root => {
  // The first mount is timed as one flush, from its first `init`.
  const from = options.slow?.flush && options.slow.now()
  const tree: Tree = {
    ...options,
    host,
    init: options.init ?? initOf,
    // Wrapped: called as the tree's method, the browser's `queueMicrotask` throws "Illegal invocation".
    schedule: options.schedule ?? ((task) => queueMicrotask(task)),
    dirty: [],
    scheduled: true,
    flushing: true,
    closed: false
  }
  tree.transitions = host.transitions?.(tree)
  const ctx: Context.Context<any> = options.context ??
    (Context.empty() as Context.Context<any>)
  const env: Env = { ctx, cause: undefined, waiting: [] }
  const instance = new Instance(
    tree,
    component,
    undefined,
    undefined,
    props,
    env
  )
  instance.named = options.path
  if (start(instance) === undefined) {
    instance.rendered = stand(instance, instance.failure!)
  }
  place(host, container, instance.rendered!, null)
  flush(tree, from)
  return {
    instance,
    send: (message, source) => send(instance, message, source),
    setProps: (props) => {
      if (applyProps(instance, props)) markDirty(instance)
    },
    close: () => {
      if (tree.closed) return
      tree.closed = true
      close(instance)
      unplace(host, container, instance.rendered!)
      host.commit?.()
    }
  }
}
