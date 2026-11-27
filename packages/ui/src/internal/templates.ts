/**
 * How the kernel renders a template on a host that copies nodes: from a copy
 * of the nodes the host built for the template's first element, with its
 * slots written, and patched by slot. `Html.template` gives a template these
 * operations, so an app that makes no template doesn't ship them.
 *
 * @internal
 */
import * as View from "../View.ts"
import {
  create,
  createAll,
  type Host,
  type Instance,
  patchKids,
  Rec,
  unmade
} from "./kernel.ts"

// What a slot holds once given: `undefined`, `null` and `false` leave it out.
const slotValue = (
  values: Readonly<Record<string, unknown>>,
  slot: string
): unknown => {
  const value = values[slot]
  return value === null || value === false ? undefined : value
}

const writeHole = (
  host: Host,
  hole: View.TemplateHole,
  node: unknown,
  value: unknown,
  was: unknown
): void => {
  if (hole.kind === "text") {
    host.setText(node, value === undefined ? "" : String(value))
  } else {
    host.setAttr(
      node,
      hole.name,
      value === undefined ? undefined : String(value),
      was === undefined ? undefined : String(was)
    )
  }
}

// A template's element, built from a copy of the nodes the host built for
// it, with its slots written.
const createTemplate = (inst: Instance, view: View.TemplateNode): Rec => {
  const host = inst.tree.host
  const def = view["~t"]
  let copy = def.lastHost === host ? def.lastCopy : def.copies.get(host)
  // The first of the template on this host listens for its events.
  const first = copy === undefined
  if (first) {
    def.copies.set(host, copy = create(inst, def.blank).node)
    ;(inst.tree.templates ??= []).push(def)
  }
  def.lastHost = host
  def.lastCopy = copy
  const node = host.clone!(copy)
  const points = host.pointsOf!(node, def.walk)
  const values = view.values
  // The copy holds a space in a text slot, so every one is written.
  const texts = def.texts
  for (let index = 0; index < texts.length; index++) {
    const hole = texts[index]!
    const value = values[hole.slot]
    host.setText(
      points[hole.point],
      value === undefined || value === null || value === false
        ? ""
        : typeof value === "string"
        ? value
        : String(value)
    )
  }
  // And nothing in an attribute slot.
  const attrs = def.attrs
  for (let index = 0; index < attrs.length; index++) {
    const hole = attrs[index]!
    const value = slotValue(values, hole.slot)
    if (value !== undefined) {
      writeHole(host, hole, points[hole.point], value, undefined)
    }
  }
  // The host finds an element's handlers from the marked root, so only the
  // first on this host listens for the events: through a record of its own,
  // as a host, such as hydration's, may read the instance off it.
  if (first) {
    const handled = def.handled
    for (let index = 0; index < handled.length; index++) {
      host.setEvents(
        node,
        new Rec(handled[index]!.target as never, node, undefined, inst),
        false
      )
    }
  }
  const rec = new Rec(view, node, def.parent ? unmade : undefined, inst)
  rec.points = points
  // A content slot holds text as a text slot does, or nodes.
  const contents = def.contents
  for (let index = 0; index < contents.length; index++) {
    const hole = contents[index]!
    const value = values[hole.slot]
    if (Array.isArray(value)) fillContent(inst, rec, def, hole, value)
    else host.setText(points[hole.point], textIn(value))
  }
  host.row?.(node, rec)
  return rec
}

const noViews: ReadonlyArray<View.Node<any, any>> = Object.freeze([])

const textIn = (value: unknown): string =>
  value === undefined || value === null || value === false
    ? ""
    : typeof value === "string"
    ? value
    : String(value)

// A content slot's nodes: a list `h.list` gave as it is, which keeps what it
// says about how it changed, and any other array as `children` takes it.
const nodesIn = (
  value: ReadonlyArray<unknown>
): ReadonlyArray<View.Node<any, any>> =>
  View.isList(value) ? value : View.children(value as never)

// What a content slot's record holds as its view: the nodes it holds, which
// `patchKids` patches from, on an element with nothing to release.
const contentView = (
  children: ReadonlyArray<View.Node<any, any>>
): View.Element<any, any> =>
  ({ _tag: "Element", children, mount: undefined }) as unknown as View.Element<
    any,
    any
  >

// The records of a template's content slots, one for each, which the
// template's record holds as its kids, so releasing it releases what they
// hold. Made when a slot first holds nodes: a slot holding text needs none.
const contentRecs = (
  inst: Instance,
  rec: Rec,
  def: View.TemplateDef
): Array<Rec> => {
  if (rec.kids !== undefined && rec.kids !== unmade) return rec.kids
  const contents = def.contents
  const made: Array<Rec> = new Array(contents.length)
  for (let index = 0; index < contents.length; index++) {
    made[index] = new Rec(
      contentView(noViews),
      rec.points![contents[index]!.owner],
      undefined,
      inst
    )
  }
  rec.kids = made
  return made
}

// Puts nodes in a content slot that holds text: its text node is taken out,
// and kept to put back if the slot holds text again.
const fillContent = (
  inst: Instance,
  rec: Rec,
  def: View.TemplateDef,
  hole: View.TemplateHole,
  value: ReadonlyArray<unknown>
): void => {
  const slot = contentRecs(inst, rec, def)[hole.index]!
  slot.plain = false
  const parent = rec.points![hole.owner]
  const views = nodesIn(value)
  inst.tree.host.remove(parent, rec.points![hole.point])
  slot.kids = views.length > 0 ? createAll(inst, parent, views) : undefined
  slot.v = contentView(views)
}

// Patches a content slot whose value was or is an array of nodes.
const patchContent = (
  inst: Instance,
  rec: Rec,
  hole: View.TemplateHole,
  was: unknown,
  value: unknown
): void => {
  if (!Array.isArray(was)) {
    return fillContent(
      inst,
      rec,
      (rec.v as View.TemplateNode)["~t"],
      hole,
      value as ReadonlyArray<unknown>
    )
  }
  const host = inst.tree.host
  const points = rec.points!
  const parent = points[hole.owner]
  const slot = rec.kids![hole.index]!
  slot.plain = false
  if (Array.isArray(value)) {
    const views = nodesIn(value)
    patchKids(inst, slot, parent, slot.v as View.Element<any, any>, views)
    slot.v = contentView(views)
    return
  }
  // Text again: the nodes go, and the text node comes back.
  patchKids(inst, slot, parent, slot.v as View.Element<any, any>, noViews)
  slot.v = contentView(noViews)
  host.setText(points[hole.point], textIn(value))
  host.insert(parent, points[hole.point], null)
}

// Patches an element a template made with the slots of the same template's
// next one: only the slots whose values changed are written.
const patchTemplate = (
  inst: Instance,
  rec: Rec,
  prev: View.TemplateNode,
  view: View.TemplateNode
): void => {
  rec.v = view
  // Patched, so `restore` looks inside it again, as for any element.
  rec.plain = false
  const before = prev.values
  const after = view.values
  if (before === after) return
  const host = inst.tree.host
  // Handlers aren't among them: one is read off the values when its event comes.
  const holes = view["~t"].writes
  for (let index = 0; index < holes.length; index++) {
    const hole = holes[index]!
    const value = after[hole.slot]
    const was = before[hole.slot]
    if (value === was) continue
    if (
      hole.kind === "content" && (Array.isArray(value) || Array.isArray(was))
    ) {
      patchContent(inst, rec, hole, was, value)
    } else if (hole.kind === "text" || hole.kind === "content") {
      host.setText(
        rec.points![hole.point],
        value === undefined || value === null || value === false
          ? ""
          : String(value)
      )
    } else {
      writeHole(
        host,
        hole,
        rec.points![hole.point],
        slotValue(after, hole.slot),
        slotValue(before, hole.slot)
      )
    }
  }
}

/**
 * The operations a template made with `Html.template` renders with.
 *
 * @internal
 */
export const kernel: View.TemplateKernel = {
  create: createTemplate as View.TemplateKernel["create"],
  patch: patchTemplate as View.TemplateKernel["patch"]
}
