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
  type Host,
  type Instance,
  patchKids,
  Rec,
  restore,
  unmade
} from "./kernel.ts"

// Writes an attribute slot that held `was` and now holds `value`.
const writeAttr = (
  host: Host,
  hole: View.TemplateHole,
  node: unknown,
  value: unknown,
  was: unknown
): void => {
  const to = View.slotValue(value)
  const from = View.slotValue(was)
  host.setAttr(
    node,
    hole.name,
    to === undefined ? undefined : String(to),
    from === undefined ? undefined : String(from)
  )
}

// A template's element, built from a copy of the nodes the host built for
// it, with its slots written.
const createTemplate = (inst: Instance, view: View.TemplateNode): Rec => {
  const tree = inst.tree
  const host = tree.host
  const def = view["~t"]
  let copy = tree.lastTemplate === def
    ? tree.lastCopy
    : (tree.copies ??= new WeakMap()).get(def)
  // The first of the template in this tree listens for its events.
  const first = copy === undefined
  if (first) tree.copies!.set(def, copy = create(inst, def.blank).node)
  tree.lastTemplate = def
  tree.lastCopy = copy
  const node = host.clone!(copy)
  const points = host.pointsOf!(node, def.walk)
  const values = view.values
  // The copy holds a space in a text slot, so every one is written.
  const texts = def.texts
  for (let index = 0; index < texts.length; index++) {
    const hole = texts[index]!
    host.setText(points[hole.point], View.slotText(values[hole.slot]))
  }
  // And nothing in an attribute slot.
  const attrs = def.attrs
  for (let index = 0; index < attrs.length; index++) {
    const hole = attrs[index]!
    const value = View.slotValue(values[hole.slot])
    if (value !== undefined) {
      host.setAttr(points[hole.point], hole.name, String(value), undefined)
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
    if (Array.isArray(value)) fillContent(inst, rec, hole, value)
    else host.setText(points[hole.point], View.slotText(value))
  }
  host.row?.(node, rec)
  return rec
}

const noViews: ReadonlyArray<View.Node<any, any>> = Object.freeze([])

// What a content slot's record holds as its view: the nodes it holds, which
// `patchKids` patches from, on an element with nothing to release or restore.
const contentView = (
  children: ReadonlyArray<View.Node<any, any>>
): View.Element<any, any> =>
  ({
    _tag: "Element",
    props: View.noFields,
    children,
    mount: undefined
  }) as unknown as View.Element<any, any>

// The record of a template's content slot, of the ones the template's record
// holds as its kids, so releasing it releases what they hold. Made when a
// slot first holds nodes: a slot holding text needs none.
const contentRec = (inst: Instance, rec: Rec, hole: View.TemplateHole): Rec => {
  let kids = rec.kids
  if (kids === undefined || kids === unmade) {
    const contents = (rec.v as View.TemplateNode)["~t"].contents
    kids = rec.kids = new Array(contents.length)
    for (let index = 0; index < contents.length; index++) {
      kids[index] = new Rec(
        contentView(noViews),
        rec.points![contents[index]!.owner],
        undefined,
        inst
      )
    }
  }
  return kids[hole.index]!
}

// Patches a content slot's nodes to the ones `value` holds, or to none.
const patchNodes = (
  inst: Instance,
  slot: Rec,
  parent: unknown,
  views: ReadonlyArray<View.Node<any, any>>
): void => {
  slot.plain = false
  patchKids(inst, slot, parent, slot.v as View.Element<any, any>, views)
  slot.v = contentView(views)
}

// Puts nodes in a content slot that holds text: its text node is taken out,
// and kept to put back if the slot holds text again.
const fillContent = (
  inst: Instance,
  rec: Rec,
  hole: View.TemplateHole,
  value: ReadonlyArray<unknown>
): void => {
  const parent = rec.points![hole.owner]
  inst.tree.host.remove(parent, rec.points![hole.point])
  patchNodes(inst, contentRec(inst, rec, hole), parent, View.nodesIn(value))
}

// Patches a content slot that held `was` to `value`, when either is an array
// of nodes.
const patchContent = (
  inst: Instance,
  rec: Rec,
  hole: View.TemplateHole,
  was: unknown,
  value: unknown
): void => {
  if (!Array.isArray(was)) {
    return fillContent(inst, rec, hole, value as ReadonlyArray<unknown>)
  }
  const points = rec.points!
  const parent = points[hole.owner]
  const slot = rec.kids![hole.index]!
  if (Array.isArray(value)) {
    return patchNodes(inst, slot, parent, View.nodesIn(value))
  }
  // Text again: the nodes go, and the text node comes back.
  patchNodes(inst, slot, parent, noViews)
  const host = inst.tree.host
  host.setText(points[hole.point], View.slotText(value))
  host.insert(parent, points[hole.point], null)
}

// Patches an element a template made with the slots of the same template's
// next one: only the slots whose values changed are written. Handlers aren't
// among them: one is read off the values when its event comes.
const patchTemplate = (
  inst: Instance,
  rec: Rec,
  prev: View.TemplateNode,
  view: View.TemplateNode
): void => {
  rec.v = view
  // Patched, so `restore` looks inside it again, as for any element.
  rec.plain = false
  const host = inst.tree.host
  // Once the tree has set a property the host controls, the nodes of a
  // content slot given again have theirs written again, as a kept element's
  // are.
  const restores = inst.tree.restores === true
  const before = prev.values
  const after = view.values
  if (before === after) {
    if (restores) restore(host, rec)
    return
  }
  const points = rec.points!
  const def = view["~t"]
  const texts = def.texts
  for (let index = 0; index < texts.length; index++) {
    const hole = texts[index]!
    const value = after[hole.slot]
    if (value !== before[hole.slot]) {
      host.setText(points[hole.point], View.slotText(value))
    }
  }
  const attrs = def.attrs
  for (let index = 0; index < attrs.length; index++) {
    const hole = attrs[index]!
    const value = after[hole.slot]
    const was = before[hole.slot]
    if (value !== was) writeAttr(host, hole, points[hole.point], value, was)
  }
  const contents = def.contents
  for (let index = 0; index < contents.length; index++) {
    const hole = contents[index]!
    const value = after[hole.slot]
    const was = before[hole.slot]
    if (value === was) {
      if (restores && Array.isArray(value)) {
        restore(host, rec.kids![hole.index]!)
      }
    } else if (Array.isArray(value) || Array.isArray(was)) {
      patchContent(inst, rec, hole, was, value)
    } else host.setText(points[hole.point], View.slotText(value))
  }
}

/**
 * The views of the kids of `view`'s record, made by a template's
 * operations: one for each content slot, holding the slot's nodes.
 *
 * @internal
 */
export const kidViews = (
  view: View.TemplateNode
): ReadonlyArray<View.Node<any, any>> =>
  view["~t"].contents.map((hole) => {
    const value = view.values[hole.slot]
    return contentView(Array.isArray(value) ? View.nodesIn(value) : noViews)
  })

/**
 * The operations a template made with `Html.template` renders with.
 *
 * @internal
 */
export const kernel: View.TemplateKernel = {
  create: createTemplate as View.TemplateKernel["create"],
  patch: patchTemplate as View.TemplateKernel["patch"]
}
