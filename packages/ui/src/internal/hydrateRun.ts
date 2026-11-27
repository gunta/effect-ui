import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Component from "../Component.ts"
import type * as Renderer from "../Renderer.ts"
import type * as View from "../View.ts"
import { runCodec } from "./codecRun.ts"
import * as Kernel from "./kernel.ts"
import { segmentOf } from "./paths.ts"
import * as queryCore from "./queryCore.ts"
import { restored } from "./sharedRun.ts"
import { type Decoded, reportedOf, stateCodecOf } from "./stateCodec.ts"

/** @internal */
export interface Adopting<N = any> {
  readonly host: Kernel.Host<N>
  readonly hold: (path: string) => void
  readonly child: (path: string, served: boolean) => void
  readonly has: (path: string) => boolean
  readonly done: () => void
}

/** @internal */
export interface Adoption<N = any> {
  readonly root: Adopting<N> | undefined
  readonly resume: (placeholder: N) => Adopting<N> | undefined
  readonly live?:
    | ((nodes: ReadonlyArray<readonly [N, Kernel.Rec]>) => void)
    | undefined
}

/** @internal */
export type Adopt<N = any> = (
  base: Kernel.Host<N>,
  container: N,
  path: string
) => Adoption<N>

/** @internal */
export interface Hydration {
  readonly init: (
    inst: Kernel.Instance,
    first: Kernel.Next
  ) => Kernel.Next | undefined
  readonly adopts: (inst: Kernel.Instance) => boolean
  readonly parked: (inst: Kernel.Instance) => boolean
  readonly held: () => ReadonlyArray<string>
  readonly end: () => void
  readonly close: () => void
  readonly settled: () => boolean
}

const methods = [
  "createElement",
  "createText",
  "setAttr",
  "setProp",
  "made",
  "insert",
  "clone",
  "pointsOf"
] as const

const use = (target: Kernel.Host, from: Kernel.Host): void => {
  for (const name of methods) (target as any)[name] = from[name]
}

interface Shipped {
  (): queryCore.ShippedHydration | undefined
  readonly cancelPending: (all: boolean) => void
}

const shippedOf = (state: Renderer.State): Shipped => {
  const raw = state["~query"]
  let resolved: queryCore.ShippedHydration | undefined | null =
    raw === undefined
      ? undefined
      : null
  let swept = false
  const get = () => {
    if (resolved !== null) return resolved
    const loaded = queryCore.loaded
    if (loaded === undefined) return undefined
    resolved = loaded.makeShipped(raw)
    // A sweep that ran before Query loaded still applies to the new session.
    if (swept) resolved?.cancelPending(false)
    return resolved
  }
  return Object.assign(get, {
    cancelPending: (all: boolean) => {
      const shipped = get()
      if (shipped === undefined) swept = true
      else shipped.cancelPending(all)
    }
  })
}

const decode = (
  component: Kernel.Runnable,
  encoded: unknown,
  shipped?: queryCore.ShippedContext | undefined
): Exit.Exit<Decoded, unknown> | Fiber.Fiber<Decoded, unknown> =>
  runCodec(
    Effect.provideService(
      stateCodecOf(component as unknown as Component.Any).decode(encoded),
      queryCore.Shipped,
      shipped
    )
  )

const decodeRoot = (
  component: Kernel.Runnable,
  state: Renderer.State,
  path: string,
  shipped?: queryCore.ShippedContext | undefined
): Exit.Exit<Decoded, unknown> | Fiber.Fiber<Decoded, unknown> | undefined =>
  state["~deferred"]?.includes(path) === true || !Object.hasOwn(state, path)
    ? undefined
    : decode(component, state[path], shipped)

const noEvents: ReadonlyArray<unknown> = []

type Saved = Record<string, any>

/** @internal */
export const make = (
  state: Renderer.State,
  host: Kernel.Host,
  base: Kernel.Host,
  adoption: Adoption | undefined,
  settled: () => void,
  root?: readonly [string, Exit.Exit<Decoded, unknown>],
  waits?: (
    owner: Kernel.Instance,
    rec: Kernel.Rec,
    path: string,
    found: { readonly state: unknown; readonly reported: unknown }
  ) => () => void,
  shipped: Shipped = shippedOf(state)
): Hydration => {
  const deferred = new Set(state["~deferred"])
  const adopting = new WeakSet<Kernel.Instance>()
  const decoded = new Map<string, Decoded | undefined>()
  if (root !== undefined) {
    decoded.set(root[0], Exit.isSuccess(root[1]) ? root[1].value : undefined)
  }
  const resumed = new WeakSet<Kernel.Rec>()
  const started = new Map<string, Kernel.Instance>()
  const held = new Map<Kernel.Rec, string>()
  const drops = new Map<Kernel.Rec, readonly [Kernel.Instance, () => void]>()
  const owners: Array<Kernel.Instance> = []
  const supplies = new WeakMap<Kernel.Instance, Saved>()
  const claimed = new Set<string>()
  const parked = new Set<Kernel.Instance>()
  const given = new Map<string, Saved>()
  const supplyOf = (
    parent: Kernel.Instance,
    path: string,
    kept: boolean
  ): Saved | undefined => {
    const from = supplies.get(parent)
    if (!kept) return from
    if (claimed.has(path)) return undefined
    claimed.add(path)
    const base = from ?? (adopting.has(parent) ? state as Saved : undefined)
    const byChild = base?.["~kept"]?.[parent.path]
    const notes = byChild?.[path]
    if (notes !== undefined) return notes
    return base === state && deferred.has(path) ? undefined : base
  }
  let hooked = false
  let active = adoption?.root
  let pass = true
  let resuming = false
  const serves = (owner: Kernel.Instance | undefined, path: string) =>
    (owner === undefined ? pass : adopting.has(owner) && (pass || resuming)) &&
    (deferred.size === 0 || !deferred.has(path)) &&
    Object.hasOwn(state, path)
  if (active !== undefined) use(host, active.host)
  const setEvents = host.setEvents
  const inert = new WeakMap<
    Kernel.Env,
    Map<unknown, [Kernel.Rec, boolean | undefined]>
  >()
  ;(host as { setEvents: Kernel.Host["setEvents"] }).setEvents = (
    node,
    rec,
    first
  ) => {
    const env = rec.inst.env
    if (
      !adopting.has(rec.inst) || env.ctx !== undefined ||
      env.cause !== undefined
    ) return setEvents(node, rec, first)
    let queued = inert.get(env)
    if (queued === undefined) {
      const wanted = queued = new Map()
      inert.set(env, wanted)
      env.waiting.push(() => {
        inert.delete(env)
        const live: Array<readonly [unknown, Kernel.Rec]> = []
        for (const [node, [rec, first]] of wanted) {
          if (rec.inst.closed) continue
          setEvents(node, rec, first)
          live.push([node, rec])
        }
        adoption?.live?.(live)
      })
    }
    queued.set(node, [rec, queued.get(node)?.[1] ?? first])
  }
  const finish = () => {
    if (pass || held.size > 0) return
    for (const owner of owners.splice(0)) restored(owner)
    started.clear()
    shipped.cancelPending(false)
    settled()
  }
  const fallback = host.hold
  ;(host as { hold: Kernel.Host["hold"] }).hold = (
    owner,
    rec,
    at,
    component
  ) => {
    const view = rec.v as View.Child<any, any>
    const path = (view.alive === undefined && at || owner.path) + "/" +
      segmentOf(view.component, view.key)
    if (resuming && resumed.delete(rec)) return false
    const served = serves(owner, path)
    if (view.alive === undefined) active?.child(path, served)
    const from = served
      ? state as Saved
      : supplyOf(owner, path, view.alive !== undefined)
    if (from?.[path] === undefined) {
      return fallback?.(owner, rec, at, component) === true
    }
    let receiver: Kernel.Instance | undefined
    for (
      let above = view.alive === undefined ? undefined : at;
      above !== undefined && above.length > owner.path.length;
      above = above.slice(0, above.lastIndexOf("/"))
    ) {
      const env = started.get(above)?.env
      if (
        env !== undefined && env.ctx === undefined && env.cause === undefined
      ) {
        receiver = started.get(above)
        break
      }
    }
    const env = receiver?.env
    const behind = receiver !== undefined
    const away = served && view.alive !== undefined &&
      active?.has(path) === false
    const exit = behind
      ? undefined
      : decode(component, from[path], shipped()?.lookup)
    if (exit !== undefined && Exit.isExit(exit) && !away) {
      if (!served && Exit.isFailure(exit)) {
        return fallback?.(owner, rec, at, component) === true
      }
      if (!served) given.set(path, from)
      decoded.set(path, Exit.isSuccess(exit) ? exit.value : undefined)
      return false
    }
    if (served && !away) active?.hold(path)
    held.set(rec, path)
    const unwait = waits?.(owner, rec, path, {
      state: shipped()?.inline(component, from[path]) ?? from[path],
      reported: from["~reported"]?.[path]
    })
    const go = (exit: Exit.Exit<Decoded, unknown>) => {
      const tree = owner.tree
      drops.delete(rec)
      tree.schedule(() => {
        unwait?.()
        const placeholder = rec.kids?.[0]!.node
        const range = adoption?.resume(placeholder)
        if (rec.inst === owner && !owner.closed && !tree.closed) {
          decoded.set(path, Exit.isSuccess(exit) ? exit.value : undefined)
          if (!served) given.set(path, from)
          resumed.add(rec)
          const outer = active
          active = range
          if (range !== undefined) use(host, range.host)
          resuming = true
          try {
            Kernel.settle(owner, rec, at)
          } finally {
            resuming = false
            active = outer
            use(host, outer?.host ?? base)
            decoded.delete(path)
            given.delete(path)
          }
        }
        range?.done()
        Kernel.flush(tree)
        held.delete(rec)
        finish()
      })
    }
    if (exit !== undefined && Exit.isExit(exit)) go(exit)
    else if (exit !== undefined) {
      exit.addObserver(go)
      drops.set(rec, [owner, () => exit.interruptUnsafe()])
    } else {
      let waiting = true
      const wake = () => {
        if (!waiting) return
        waiting = false
        if (rec.inst !== owner || receiver!.closed) return go(Exit.interrupt())
        const exit = decode(
          component,
          from[path],
          shipped()?.lookup
        )
        if (Exit.isExit(exit)) go(exit)
        else exit.addObserver(go)
      }
      env!.waiting.push(() => owner.tree.schedule(wake))
      ;(receiver!.closers ??= []).push(wake)
      drops.set(rec, [owner, wake])
    }
    return true
  }
  return {
    init(inst, first) {
      const path = inst.path
      const tree = inst.tree
      if (!hooked) {
        hooked = true
        tree.served = (inst) =>
          adopting.has(inst)
            ? (state["~status"] as Record<string, string> | undefined)
              ?.[inst.path] ?? "Ready"
            : undefined
        const ended = tree.ended
        tree.ended = (author, at) => {
          ended?.(author, at)
          claimed.add(at)
        }
        const work = tree.work
        tree.work = (idle) => {
          for (const [rec, [owner, drop]] of drops) {
            if (rec.inst !== owner) drop()
          }
          return work?.(idle) === true
        }
        const drawn = tree.drawn
        tree.drawn = (kept, on) => {
          drawn?.(kept, on)
          const old = kept.rendered
          const env = kept.env
          if (
            on && !pass && old !== undefined && adopting.has(kept) &&
            env.ctx === undefined && env.cause === undefined
          ) {
            const at = tree.host.parentOf(Kernel.nodeOf(old))
            kept.rendered = Kernel.create(kept, old.v)
            if (at != null) Kernel.unplace(tree.host, at, old)
            Kernel.release(kept, old)
          }
          if (on) parked.delete(kept)
          else parked.add(kept)
          settled()
        }
      }
      let got: Decoded | undefined
      if (!serves(inst.parent, path)) {
        const from = given.get(path)
        got = decoded.get(path)
        given.delete(path)
        decoded.delete(path)
        if (from === undefined || got === undefined) return undefined
        supplies.set(inst, from)
        inst.results = got.results
        return {
          model: got.model,
          commands: first.commands,
          events: noEvents,
          lists: first.lists,
          sends: first.sends
        }
      }
      if (
        (inst.at?.v as View.Child<any, any> | undefined)?.alive !== undefined
      ) {
        claimed.add(path)
      }
      if (decoded.has(path)) {
        got = decoded.get(path)
        decoded.delete(path)
      } else {
        const exit = decode(inst.component, state[path], shipped()?.lookup)
        if (Exit.isExit(exit) && Exit.isSuccess(exit)) got = exit.value
      }
      if (got === undefined) return undefined
      adopting.add(inst)
      if (
        inst.component.layer !== undefined ||
        (inst.env.ctx === undefined && inst.env.cause === undefined)
      ) {
        started.set(path, inst)
      }
      inst.results = got.results
      const owning = reportedOf(
        inst.component as unknown as Component.Any,
        state["~reported"]?.[path],
        true
      )
      if (owning !== undefined) {
        inst.owning = owning
        owners.push(inst)
      }
      return {
        model: got.model,
        commands: first.commands,
        events: noEvents,
        lists: first.lists,
        sends: first.sends
      }
    },
    adopts: (inst) => adopting.has(inst),
    parked(inst) {
      const paths = [inst.path + "/"]
      for (let at: Kernel.Instance | undefined = inst; at; at = at.parent) {
        if (at.under !== undefined) paths.push(at.under + "/")
      }
      for (const kept of parked) {
        if (paths.some((path) => path.startsWith(kept.path + "/"))) return true
      }
      return false
    },
    held: () => [...held.values()],
    end() {
      pass = false
      const root = adoption?.root
      active = undefined
      use(host, base)
      root?.done()
      finish()
    },
    close: () => shipped.cancelPending(true),
    settled: () => !pass && held.size === 0
  }
}

type Draft = Parameters<Kernel.Recorder>[1]

class Waits {
  readonly waiting = new Map<Kernel.Instance, Draft>()
  readonly held = new Map<
    Kernel.Instance,
    readonly [Kernel.Instance, View.Child<any, any>]
  >()
  seq: ReturnType<Kernel.Recorder> = undefined
  readonly log: Kernel.Recorder
  readonly checkAdopted: () => void
  readonly state: Renderer.State
  constructor(
    log: Kernel.Recorder,
    checkAdopted: () => void,
    state: Renderer.State
  ) {
    this.log = log
    this.checkAdopted = checkAdopted
    this.state = state
  }
  readonly holds: NonNullable<Kernel.Tree["holds"]> = (child, inst, view) =>
    this.waiting.has(child) &&
    this.held.set(child, [inst, view as View.Child<any, any>]) !== undefined
  readonly heldAt = (at: string): boolean => {
    for (const inst of this.held.keys()) {
      if (at.startsWith(inst.path + "/")) return true
    }
    return false
  }
  behindOf(inst: Kernel.Instance): Kernel.Instance | undefined {
    const parent = inst.parent
    if (parent !== undefined && this.waiting.has(parent)) return parent
    for (const at of this.waiting.keys()) {
      if (at !== inst && inst.path.startsWith(at.path + "/")) return at
    }
    return undefined
  }
  mount(inst: Kernel.Instance): void {
    const draft = this.waiting.get(inst)
    if (draft === undefined) return
    const parent = inst.parent
    if (parent?.env.ctx !== undefined) this.mount(parent)
    const behind = this.behindOf(inst)
    if (behind !== undefined) {
      if (behind.env.ctx !== undefined) this.mount(behind)
      if (this.waiting.has(behind)) return
    }
    this.waiting.delete(inst)
    const latest = this.held.get(inst)
    this.held.delete(inst)
    if (!inst.closed) {
      this.log(inst, { ...draft, model: inst.model, props: inst.props })
    }
    this.checkAdopted()
    if (latest !== undefined && !inst.closed && !latest[0].closed) {
      Kernel.patchChild(latest[0], inst.at!, latest[1])
      Kernel.markDirty(latest[0])
    }
  }
  step(
    inst: Kernel.Instance,
    draft: Draft,
    hydration: Hydration
  ): Draft | undefined {
    if (draft._tag === "Mounted" && hydration.adopts(inst)) {
      draft = { ...draft, adopted: true }
      const env = inst.env
      const layered =
        (inst.component as unknown as Component.Any).layer !== undefined &&
        (this.state["~status"] as Record<string, unknown> | undefined)
            ?.[inst.path] === undefined
      const behind = this.behindOf(inst) !== undefined
      if (
        layered || behind ||
        (env.ctx === undefined && env.cause === undefined)
      ) {
        this.waiting.set(inst, draft)
        const bound = queryCore.boundOf(
          inst.component as unknown as Component.Any
        )
        this.seq = this.log(inst, {
          _tag: "Waiting",
          props: inst.props,
          model: draft.model,
          ...(bound === undefined
            ? undefined
            : { queries: inst.results ?? bound.empty })
        })
        if (!layered && !behind) env.waiting.push(() => this.mount(inst))
        return undefined
      }
    } else if (draft._tag === "LayerPending" && this.waiting.has(inst)) {
      inst.env.waiting.push(() => this.mount(inst))
    } else if (draft._tag === "Unmounted" && this.waiting.delete(inst)) {
      this.held.delete(inst)
      this.seq = this.log(inst, draft)
      this.checkAdopted()
      return undefined
    }
    return draft
  }
  commit(): void {
    for (const inst of this.waiting.keys()) {
      if (inst.env.ctx !== undefined || inst.env.cause !== undefined) {
        this.mount(inst)
      }
    }
  }
  parked(hydration: Hydration): boolean {
    for (const inst of this.waiting.keys()) {
      if (!hydration.parked(inst)) return false
    }
    return true
  }
  paths(): Array<string> {
    const out: Array<string> = []
    for (const inst of this.waiting.keys()) {
      if (!inst.closed) out.push(inst.path)
    }
    return out
  }
}

/** @internal */
export interface Session {
  readonly hasQuery: boolean
  readonly record: (
    inst: Kernel.Instance,
    draft: Draft
  ) => Draft | { readonly done: true; readonly seq: number | undefined | void }
  readonly commit: () => void
  readonly init: (
    inst: Kernel.Instance,
    first: Kernel.Next
  ) => Kernel.Next | undefined
  readonly onCache: (cache: queryCore.Cache) => void
  readonly closeWindow: () => void
  readonly end: () => void
  readonly close: () => void
  readonly finish: (head: () => unknown) => void
  readonly adopted: Effect.Effect<void>
  readonly adoptionHead: () => unknown
  readonly waiting: () => ReadonlyArray<string>
  readonly adopts: (inst: Kernel.Instance) => boolean
  readonly isWaiting: (inst: Kernel.Instance) => boolean
}

/** @internal */
export interface Hydrating {
  readonly static: boolean
  readonly shipped: () => queryCore.ShippedContext | undefined
  readonly decode: <A, E, R>(
    component: Kernel.Runnable,
    path: string,
    go: (decoded?: Exit.Exit<Decoded, unknown>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
  readonly open: (input: {
    readonly path: string
    readonly container: unknown
    readonly bridged: Kernel.Host
    readonly base: Kernel.Host
    readonly dom: boolean
    readonly record: Kernel.Recorder
    readonly at: number
    readonly decodedRoot:
      | readonly [string, Exit.Exit<Decoded, unknown>]
      | undefined
    readonly heldFor: Parameters<typeof make>[6]
    readonly cache: () => queryCore.Cache | undefined
  }) => Session
}

/** @internal */
export const hydrating = (
  state: Renderer.State,
  adopt?: Adopt
): Hydrating => {
  const shipped = shippedOf(state)
  return {
    static: state["~static"] === true,
    shipped: () => shipped()?.lookup,
    decode: (component, path, go) => {
      const decoded = decodeRoot(component, state, path, shipped()?.lookup)
      return decoded === undefined || Exit.isExit(decoded)
        ? go(decoded)
        : Effect.flatMap(Fiber.await(decoded), go)
    },
    open: (input) => {
      const fromStatic = state["~static"] === true
      let started = false
      let firstHeld = 0
      let adoptedDone = false
      let adoptionHead: unknown
      let headOf: (() => unknown) | undefined
      const adoptedWaiters: Array<() => void> = []
      let windowClosed = false
      const closeWindow = () => {
        windowClosed = true
        input.cache()?.closeWindow()
      }
      const checkAdopted = () => {
        if (adoptedDone || !started || !hydration.settled()) return
        if (!waits.parked(hydration)) return
        adoptedDone = true
        if (firstHeld > 0 || adoptionHead === undefined) {
          adoptionHead = headOf!()
        }
        closeWindow()
        for (const f of adoptedWaiters.splice(0)) f()
      }
      const waits = new Waits(input.record, checkAdopted, state)
      const hydration = make(
        state,
        input.bridged,
        input.base,
        !input.dom
          ? undefined
          : adopt?.(input.base, input.container, input.path),
        checkAdopted,
        input.decodedRoot,
        input.heldFor,
        shipped
      )
      return {
        hasQuery: state["~query"] !== undefined,
        record: (inst, draft) => {
          const next = waits.step(inst, draft, hydration)
          return next === undefined ? { done: true, seq: waits.seq } : next
        },
        commit: () => waits.commit(),
        init: (inst, first) => {
          if (inst.tree.holds === undefined) {
            inst.tree.holds = waits.holds
            inst.tree.held = waits.heldAt
          }
          return hydration.init(inst, first)
        },
        onCache: (cache) => {
          const raw = state["~query"]
          if (raw !== undefined) {
            cache.hydrate(raw, {
              static: fromStatic,
              at: input.at,
              decodeSuccess: shipped()?.decodeRaw
            })
            if (windowClosed) cache.closeWindow()
          }
        },
        closeWindow,
        end: () => {
          firstHeld = hydration.held().length
          hydration.end()
        },
        close: () => hydration.close(),
        finish: (head) => {
          headOf = head
          if (firstHeld === 0) adoptionHead = head()
          started = true
          checkAdopted()
        },
        adopted: Effect.callback<void>((resume) => {
          if (adoptedDone) return resume(Effect.void)
          const waiter = () => resume(Effect.void)
          adoptedWaiters.push(waiter)
          return Effect.sync(() => {
            const index = adoptedWaiters.indexOf(waiter)
            if (index >= 0) adoptedWaiters.splice(index, 1)
          })
        }),
        adoptionHead: () => adoptedDone ? adoptionHead : undefined,
        waiting: () => waits.paths().concat(hydration.held()),
        adopts: (inst) => hydration.adopts(inst),
        isWaiting: (inst) => waits.waiting.has(inst)
      }
    }
  }
}
