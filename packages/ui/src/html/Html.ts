/**
 * The HTML element vocabulary for `@effect/ui`: element names on `h`, typed
 * events with plain payloads, controlled properties, and refs typed by tag.
 * The Commands that use those refs are in `HtmlCommand`, and document and
 * window events in `HtmlSubscription`.
 *
 * Define HTML components with `Html.component`, which supplies the HTML
 * vocabulary automatically, and type reusable pure HTML view functions with
 * `Html.H<Msg>`. The module is also a `View.Vocabulary<Html.Elements>`.
 *
 * Event handlers get plain data, never a DOM event: `input` has the field's
 * `value`, `keydown` the `key` and the modifier keys, and `submit` the
 * form's `fields`. A handler set with `{ preventDefault: true }` cancels the
 * browser's default when it produces a message and leaves it alone when it
 * returns `undefined`, so it decides per event. A form's `submit` is always
 * cancelled when it has a handler or uses the `dialog` method. Otherwise,
 * the host leaves the browser default intact. Nothing stops an event's
 * propagation: only the innermost element with a handler for an event gets
 * it.
 *
 * Use `draggable(data)` for a drag source and
 * `dropTarget({ accepts }).on("drop", handler)` for a drop target. The host
 * transfers the data and cancels browser defaults to allow accepted drops.
 * `dragenter` and `dragleave` go to the active drop target only, not to every
 * element the pointer crosses. Drag and drop needs a pointer, so provide a
 * button or menu that sends the same message.
 *
 * `value`, `checked`, `selected` and `open` are controlled: the host puts the
 * Model's value back after every patch and after every event that could have
 * changed it, so the element always shows what the Model says. While an input
 * method composes text in a field, its `value` is left alone until
 * `compositionend`. When the host writes a focused field's `value`, the
 * selection stays where the user left it: a rejected edit puts it back, and a
 * normalized value keeps it with the text around it.
 *
 * A `dialog` is closed, open, or open as a modal: `.open(b)` and `.modal(b)`
 * set the same state, and the last call wins. A modal's close requests, such
 * as Escape, come to `cancel`, and it closes when the Model says so. Forms
 * in a dialog are the app's like any other, so read the choice in
 * `submit`, not `returnValue`.
 *
 * Any element can be a popover with `.popover(mode, open)`, its state
 * separate from a `dialog`'s or `details`'s `open`. A `"manual"` popover is
 * controlled by the Model. An `"auto"` popover is followed: the browser
 * closes it on Escape, a click outside or another popover opening, `toggle`
 * reports it, and the Model must follow. Position a popover next to its
 * trigger with CSS anchor positioning.
 *
 * SVG tags have builders of their own, such as `h.svg`, `h.path` and
 * `h.circle`, with `id`, `class`, `style`, events and children as on HTML
 * elements. `attr` and `attrs` check SVG's case-sensitive attribute names
 * by tag, so `viewbox` or `strok-width` doesn't compile. SVG's `text` is
 * `h.svgText`, since `h.text` makes a text node.
 *
 * The HTML renderers omit `href`, `src`, `action`, `formaction`, `xlink:href`
 * and `data` attributes containing `javascript:` or `vbscript:` URLs. Setting
 * a built-in element's `href`, `src`, `action`, `formAction` or `data` property
 * to a blocked URL removes its reflected attribute instead. Custom element
 * properties are unchanged. These checks apply to server rendering, browser
 * updates, hydration and head attributes. For `set`, `animate` and
 * `animateTransform` elements, the renderers also omit `to`, `from` and
 * `by` attributes containing blocked URLs, and the entire `values` attribute
 * if any semicolon-separated item is blocked. These animation checks apply
 * regardless of `attributeName`. Scheme checks ignore case, ASCII controls
 * and spaces; relative URLs and other schemes pass through unchanged.
 *
 * **Example** (A controlled text field)
 *
 * ```ts import.meta.vitest
 * import { UiSchema } from "@effect/ui"
 * import { Html } from "@effect/ui/html"
 * import { Schema } from "effect"
 *
 * const Message = UiSchema.TaggedEnum({ UpdatedDraft: { value: Schema.String }, SubmittedForm: {} })
 *
 * const NewTodo = Html.ref("NewTodo", "input")
 *
 * const Form = Html.component({
 *   name: "Form",
 *   model: Schema.String,
 *   message: Message
 * }).make({
 *   init: () => "",
 *   update: (_, message) => (message._tag === "UpdatedDraft" ? message.value : ""),
 *   view: (h, draft) =>
 *     h.form.on("submit", Message.SubmittedForm()).children(
 *       h.input.ref(NewTodo).attr("aria-label", "New todo").value(draft)
 *         .on("input", ({ value }) => Message.UpdatedDraft({ value })),
 *       h.button.attr("type", "submit").children("Add")
 *     )
 * })
 * ```
 *
 * **Example** (Sending on Enter, keeping Shift+Enter's new line)
 *
 * ```ts import.meta.vitest
 * import { UiSchema } from "@effect/ui"
 * import { Html } from "@effect/ui/html"
 * import { Schema } from "effect"
 *
 * const Message = UiSchema.TaggedEnum({ UpdatedDraft: { value: Schema.String }, PressedEnter: {} })
 *
 * const Composer = Html.component({
 *   name: "Composer",
 *   model: Schema.String,
 *   message: Message
 * }).make({
 *   init: () => "",
 *   update: (_, message) => (message._tag === "UpdatedDraft" ? message.value : ""),
 *   view: (h, draft) =>
 *     h.textarea.attr("aria-label", "Message").value(draft)
 *       .on("input", ({ value }) => Message.UpdatedDraft({ value }))
 *       // Enter that ends an IME composition only confirms the text.
 *       .on("keydown",
 *         ({ key, shift, composing }) =>
 *           key === "Enter" && !shift && !composing ? Message.PressedEnter() : undefined,
 *         { preventDefault: true }
 *       )
 * })
 * ```
 *
 * **Example** (An icon)
 *
 * ```ts import.meta.vitest
 * import { Html } from "@effect/ui/html"
 *
 * const ArrowIcon = <M>(h: Html.H<M>) =>
 *   h.svg
 *     .class("icon")
 *     .attrs({
 *       viewBox: "0 0 24 24",
 *       fill: "none",
 *       stroke: "currentColor",
 *       "stroke-width": "2",
 *       "aria-hidden": "true"
 *     })
 *     .children(
 *       h.circle.attrs({ cx: "12", cy: "12", r: "10" }),
 *       h.path.attr("d", "M8 12h8m-3-3 3 3-3 3")
 *     )
 * ```
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import type * as Types from "effect/Types"
import * as Component from "../Component.ts"
import { handle } from "../internal/handler.ts"
import * as Templates from "../internal/templates.ts"
import * as Renderer from "../Renderer.ts"
import * as View from "../View.ts"
import type * as HtmlHead from "./HtmlHead.ts"
import { cssProperty } from "./internal/cssProperty.ts"
import * as elements from "./internal/elements.ts"

// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

/**
 * The HTML host marker: a host Layer that can show HTML elements provides it.
 *
 * **Details**
 *
 * `mount` requires it for an HTML root, so mounting one on another host is a
 * type error. It's a framework service, so a Command may use it without it
 * appearing in a component's requirements. It holds the element operations
 * the ref Commands use, which a test on `TestHost` fakes with
 * `Layer.succeed(Html.Host, ...)`. `showPicker` returns whether the browser
 * opened the picker.
 *
 * @stability experimental
 * @category services
 * @since 0.1.0
 */
export class Host extends Context.Service<Host, {
  readonly focus: (element: globalThis.Element, options: FocusOptions) => void
  readonly blur: (element: globalThis.Element) => void
  readonly scrollIntoView: (
    element: globalThis.Element,
    options: ScrollOptions
  ) => void
  readonly measure: (element: globalThis.Element) => Rect
  readonly select: (
    element: globalThis.Element,
    options?: SelectOptions | undefined
  ) => void
  readonly requestSubmit: (element: globalThis.Element) => boolean
  readonly showPicker: (element: globalThis.Element) => boolean
}>()("@effect/ui/html/Html/Host") {}

declare module "../Command.ts" {
  interface FrameworkServices {
    readonly HtmlHost: Host
  }
}

/**
 * An element's box, from `measure`, in CSS pixels relative to the viewport.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * The options of `focus`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FocusOptions {
  readonly preventScroll?: boolean | undefined
}

/**
 * The options of `scrollIntoView`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScrollOptions {
  readonly behavior?: "auto" | "instant" | "smooth" | undefined
  readonly block?: "start" | "center" | "end" | "nearest" | undefined
  readonly inline?: "start" | "center" | "end" | "nearest" | undefined
}

/**
 * The options of `select`: the range to select, in UTF-16 code units. `end`
 * defaults to `start`, which places the caret there.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SelectOptions {
  readonly start: number
  readonly end?: number | undefined
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/**
 * What pressed an element: `"mouse"`, `"touch"` or `"pen"`, or `""` for a
 * click no pointer made, such as a button activated with Enter or Space.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export type PointerType = "mouse" | "touch" | "pen" | ""

/**
 * The payload of `click`, `dblclick`, `contextmenu`, `mousedown`,
 * `mouseup` and the pointer events: the button, the position in the
 * viewport, the modifier keys, and the pointer.
 *
 * **Details**
 *
 * `pointerType` is `""` for a click from the keyboard or a script. A pointer
 * event reports its own. Otherwise the browser host reads it from the
 * `pointerdown` before the event, since some browsers report a tap's `click`
 * as a mouse's. A browser that sends no pointer events reports `"mouse"`.
 *
 * `pointerId` tells the pointers of a multi-touch apart, and is `-1` for an
 * event that carries none, such as a `mousedown` or a click from the keyboard.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface PointerPayload {
  readonly button: number
  readonly x: number
  readonly y: number
  readonly shift: boolean
  readonly ctrl: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly pointerId: number
  readonly pointerType: PointerType
}

/**
 * The payload of `mouseenter` and `mouseleave`: where the pointer is in the
 * viewport.
 *
 * **Details**
 *
 * An element drawn over another takes the pointer off the one below without
 * a move, and gives it back once it is gone. The `mouseleave` and the
 * `mouseenter` then report the same position, which tells them from the
 * pointer leaving and coming back.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface HoverPayload {
  readonly x: number
  readonly y: number
}

/**
 * The payload of `keydown` and `keyup`. `composing` is true while an input
 * method composes text, including for the key that ends the composition, so
 * a handler for Enter can leave it to the input method.
 *
 * **Details**
 *
 * `repeat` is true while a key is held down and firing auto-repeats.
 *
 * `editable` is true when the event's innermost target (through open shadow
 * roots) takes typed characters: a `textarea`, a `select`, an `input` other
 * than `button`, `checkbox`, `color`, `file`, `image`, `radio`, `range`,
 * `reset` or `submit`, or an element with `isContentEditable` true. A
 * `readonly` field still counts. On element handlers `editable` describes the
 * event's target, not the element holding the handler.
 *
 * `selectionStart` and `selectionEnd` are the target's selection as the key
 * finds it, as `SelectionPayload` describes.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface KeyPayload extends SelectionPayload {
  readonly key: string
  readonly shift: boolean
  readonly ctrl: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly composing: boolean
  readonly repeat: boolean
  readonly editable: boolean
}

/**
 * The payload of `selectionchange` on an `input` or `textarea`: the current
 * caret or selection. The browser queues the event, so changes in one task
 * can arrive as one.
 *
 * **Details**
 *
 * Offsets are in UTF-16 code units. They are `null` unless the target is a
 * `textarea` or an `input` type with a selection, such as `text` or
 * `search`: an `email` or `number` input reports none.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface SelectionPayload {
  readonly selectionStart: number | null
  readonly selectionEnd: number | null
}

/**
 * The payload of `input` and `change` on a `textarea` or `select`: the
 * value the user left in the element, and how the edit was made.
 *
 * **Details**
 *
 * `composing` is true for an `input` sent while an input method composes
 * text, which `compositionend` commits. `inputType` is the browser's name
 * for the edit, such as `"insertText"`, `"deleteContentBackward"` or
 * `"insertReplacementText"` for autofill and spelling corrections. It is
 * `""` for a `change`, and for an `input` the browser names no edit for,
 * such as choosing an option.
 *
 * `selectionStart` and `selectionEnd` are the selection the edit left, as
 * `SelectionPayload` describes. Read the caret here to keep it in step with
 * `value`: `selectionchange` comes later, or not at all if the range didn't
 * move.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface ValuePayload extends SelectionPayload {
  readonly value: string
  readonly composing: boolean
  readonly inputType: string
}

/**
 * The payload of `input` and `change` on an `input`: its value, whether
 * it's checked (a checkbox or radio button), the files it holds (a file
 * input), and how the edit was made, as `ValuePayload` describes.
 *
 * **Details**
 *
 * `files` is empty unless the input is `type="file"`. A `File` isn't plain
 * data: send it on to a Command whose args type it with
 * `Schema.instanceOf(File)`, and keep plain facts about it, such as its name
 * and size, in the Model, which must stay encodable. A `Schema.File` in the
 * Model encodes the file's bytes into the page state.
 *
 * Give a file input `.value("")` to report each choice once: the browser
 * host sends the files in `change`, then empties the input, so choosing the
 * same file again sends `change` again. Without `.value` the input keeps
 * what the user chose.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface InputPayload extends ValuePayload {
  readonly checked: boolean
  readonly files: ReadonlyArray<File>
}

/**
 * The payload of `paste`: the clipboard's plain text, or `""` when it has
 * none or the browser won't let it be read. With `{ preventDefault: true }`
 * a handler that returns a message cancels the paste, so the element's text
 * stays as it is and the Model decides what the pasted text does.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface PastePayload {
  readonly text: string
}

/**
 * The payload of `compositionend` on an `input` or `textarea`: the value
 * the field holds once an input method has committed the composed text. The
 * `input` events sent while it composed have `composing` set, so a handler
 * can wait for this one to act on the text.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface CompositionPayload {
  readonly value: string
}

/**
 * The payload of `submit`: the form's fields.
 *
 * **Details**
 *
 * `fields` holds the first value of each named field, and `entries` every
 * name and value in document order, for names used more than once. Files are
 * left out. The browser's own submission is always prevented.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface SubmitPayload {
  readonly fields: Readonly<Record<string, string>>
  readonly entries: ReadonlyArray<readonly [name: string, value: string]>
}

/**
 * The payload of `toggle` on a `details` or `dialog`: whether it's open now.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface TogglePayload {
  readonly open: boolean
}

/**
 * The payload of `toggle`, which any element can get as a popover: `open`
 * is whether it's showing now, and `newState` and `oldState` are what the
 * browser reported.
 *
 * **Details**
 *
 * Browsers coalesce the toggles queued for an element into one, from the
 * first change's `oldState` to the latest `newState`, so the two can be
 * equal, such as `"closed"` to `"closed"` for a popover shown and dismissed
 * before the event. `open` and `newState` are the state when it's sent;
 * follow them rather than the transition. On a `details` or `dialog`, a
 * browser without `ToggleEvent` gets states derived from `open`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface PopoverTogglePayload extends TogglePayload {
  readonly newState: "open" | "closed"
  readonly oldState: "open" | "closed"
}

/**
 * How a popover behaves, set with `popover`.
 *
 * **Details**
 *
 * A `"manual"` popover is controlled: it shows what the Model says, and the
 * browser host puts it back when anything else changes it. An `"auto"`
 * popover is followed: the browser closes it on Escape, a click outside,
 * another auto popover opening or a modal dialog opening, the host reports
 * that as `toggle`, and the Model must follow. The host shows or hides an
 * auto popover only when the Model's value changes, and never reverts the
 * browser.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export type PopoverMode = "manual" | "auto"

/**
 * The payload of `scroll`: the element's scroll offsets.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface ScrollPayload {
  readonly top: number
  readonly left: number
}

/**
 * The payload of `drop`: the dragged strings by type, the dragged files, and
 * the pointer's position in the drop target's box, from its top-left corner,
 * with the box's size. `y < height / 2` tells the upper half from the lower.
 *
 * **Details**
 *
 * `data` holds every string type the drag carries, read when it's dropped,
 * since a browser hides them until then. `files` is empty unless the drag
 * carries files. A `File` isn't plain data: send it on to a Command, and keep
 * plain facts about it, such as its name and size, in the Model, which must
 * stay encodable.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface DropPayload {
  readonly data: Readonly<Record<string, string>>
  readonly files: ReadonlyArray<File>
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The payload of `dragover`: the pointer's position in the drop target's box,
 * from its top-left corner, with the box's size.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface DragOverPayload {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The payload of `dragend`, on the drag's source: whether the drag was
 * dropped, on one of the app's drop targets or anywhere the browser reports
 * it accepted, or was cancelled.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface DragEndPayload {
  readonly dropped: boolean
}

/**
 * What a drop does, as a drop target shows it with the pointer: `"copy"`,
 * `"move"` or `"link"`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export type DropEffect = "copy" | "move" | "link"

/**
 * The drop effects a drag source allows. A drop target whose `dropEffect` the
 * source doesn't allow can't take the drop.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export type EffectAllowed =
  | "none"
  | "copy"
  | "copyLink"
  | "copyMove"
  | "link"
  | "linkMove"
  | "move"
  | "all"

/**
 * A drag source, set with `draggable`: the strings it carries by type, and
 * the drop effects it allows. Stored as the element's `dragstart` options.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface DragSourceOptions extends View.EventOptions {
  readonly data: Readonly<Record<string, string>>
  readonly effectAllowed?: EffectAllowed | undefined
}

/**
 * A drop target, set with `dropTarget`: the drag types it accepts, matched without
 * case with `"Files"` for files, and the drop effect it shows. Stored as the
 * element's `drop` options.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface DropTargetOptions extends View.EventOptions {
  readonly accepts: ReadonlyArray<string>
  readonly dropEffect?: DropEffect | undefined
}

/**
 * The options of `pointerdown`. With `capturePointer: true`, a press whose
 * handler sends a message captures its pointer on the handler's element, so
 * the element gets the press's `pointermove`, `pointerup` and
 * `pointercancel` wherever the pointer goes.
 *
 * **Details**
 *
 * The browser releases the capture when the press ends. Capture sends the
 * rest of the press to the element, so a `click` on a child goes to the
 * element instead. A touch drag needs CSS `touch-action: none` on the
 * element, or the browser scrolls and sends `pointercancel`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface PointerDownOptions extends View.EventOptions {
  readonly capturePointer?: boolean | undefined
}

type EventOptionsOf<K> = [K] extends ["pointerdown"] ? PointerDownOptions
  : View.EventOptions

/**
 * The payload of `focusin` and `focusout`: whether the other end of the
 * move is inside the handler's element. For `focusin` that is where focus
 * came from, and for `focusout` where it goes.
 *
 * **Details**
 *
 * An element that handles both can tell focus moving between its
 * descendants from focus arriving or leaving: `within` is `true` for the
 * first, and `false` for the second. Focus coming from or going to
 * another window, or nowhere, counts as outside, as does an event a script
 * dispatched with a `relatedTarget` that isn't a node, such as the window.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface FocusWithinPayload {
  readonly within: boolean
}

/**
 * The payload of `focus`: whether the element shows a focus ring, as
 * `:focus-visible` matches it as the event fires.
 *
 * **Details**
 *
 * A browser shows the ring for focus that came from the keyboard, and not
 * for focus that came from a press, on the element or on another one whose
 * handler moved focus. A component that opens on keyboard focus only reads
 * it here. `focusVisible` is `true` where the browser can't tell.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface FocusPayload {
  readonly focusVisible: boolean
}

/**
 * The payload of `blur`: whether the element that lost focus is disabled
 * as the event fires.
 *
 * **Details**
 *
 * A user can't leave a disabled element, so `disabled` is `true` only when
 * the element lost focus by being disabled, by its own `disabled` or by a
 * `<fieldset disabled>` around it. A browser may send no `blur` at all for
 * that. One that does can send it while a render is still writing, before
 * the components below the disabled element have their new props, so a
 * handler reads it here and not from its own state.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface BlurPayload {
  readonly disabled: boolean
}

/**
 * The payload of `focusout`: `within`, as for `focusin`, and `disabled`,
 * as for `blur`, read from the descendant that lost focus.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface FocusOutPayload extends FocusWithinPayload, BlurPayload {}

/**
 * The events every HTML element has, with their payloads.
 *
 * **Details**
 *
 * `focus`, `blur`, `mouseenter`, `mouseleave` and `scroll` don't bubble: only
 * the element they happen on gets them. The others go to the innermost element
 * with a handler, except the drop target's events: `dragenter`, `dragleave`,
 * `dragover` and `drop` go to the active drop target, as `dropTarget` describes.
 *
 * `pointerdown` starts every press. A `mousedown` may not follow it: a
 * touch may send no mouse events, and a `pointerdown` whose default was
 * cancelled sends none.
 *
 * `pointermove` is sent at most once per animation frame for each pointer,
 * with its latest position, and its default can't be cancelled. A queued
 * move is sent before its pointer's `pointerdown` or `pointerup` element
 * event, and dropped at `pointercancel`, so the Model can revert at once.
 * A capture-phase document subscriber hears the press or release before
 * that move. To follow a drag outside the element, see `PointerDownOptions`.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export interface Events {
  readonly click: PointerPayload
  readonly dblclick: PointerPayload
  readonly contextmenu: PointerPayload
  readonly mousedown: PointerPayload
  readonly mouseup: PointerPayload
  readonly pointerdown: PointerPayload
  readonly pointermove: PointerPayload
  readonly pointerup: PointerPayload
  readonly pointercancel: PointerPayload
  readonly mouseenter: HoverPayload
  readonly mouseleave: HoverPayload
  readonly keydown: KeyPayload
  readonly keyup: KeyPayload
  readonly focus: FocusPayload
  readonly blur: BlurPayload
  readonly focusin: FocusWithinPayload
  readonly focusout: FocusOutPayload
  readonly scroll: ScrollPayload
  readonly dragstart: {}
  readonly dragend: DragEndPayload
  readonly dragenter: {}
  readonly dragleave: {}
  readonly dragover: DragOverPayload
  readonly drop: DropPayload
  readonly toggle: PopoverTogglePayload
  readonly paste: PastePayload
}

/**
 * The events of one tag: the shared `Events` plus the tag's own.
 *
 * **Details**
 *
 * A `dialog`'s `cancel` is a close request, such as Escape. For a modal the
 * browser host cancels it, and the Model decides whether the dialog closes.
 * `cancelable` is `false` when the browser won't let the request be
 * cancelled, as after repeated cancelled requests: it closes the dialog
 * itself, and `close` follows. `close` is sent after every close, the
 * Model's included, except the close the browser host makes to switch a
 * dialog between modal and non-modal, and a close the browser reports after
 * the dialog was shown again.
 *
 * A `slot`'s `slotchange` carries no data, and hydration doesn't replay earlier
 * `slotchange` events. Read the initial assigned nodes in a mount.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export type EventsOf<K extends string> =
  & Events
  & (K extends "input"
    ? { readonly input: InputPayload; readonly change: InputPayload }
    : {})
  & (K extends "textarea" | "select"
    ? { readonly input: ValuePayload; readonly change: ValuePayload }
    : {})
  & (K extends "input" | "textarea" ? {
      readonly compositionend: CompositionPayload
      readonly selectionchange: SelectionPayload
    }
    : {})
  & (K extends "form" ? { readonly submit: SubmitPayload; readonly reset: {} }
    : {})
  & (K extends "details" ? { readonly toggle: TogglePayload } : {})
  & (K extends "dialog" ? {
      readonly toggle: TogglePayload
      readonly close: { readonly returnValue: string }
      readonly cancel: { readonly cancelable: boolean }
    }
    : {})
  & (K extends "img" | "iframe" | "video" | "audio"
    ? { readonly load: {}; readonly error: {} }
    : {})
  & (K extends "slot" ? { readonly slotchange: {} } : {})

// ---------------------------------------------------------------------------
// elements
// ---------------------------------------------------------------------------

/**
 * The nodes whose `value` is controlled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ValueNode =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement

/**
 * A builder without children, such as `h.input` or `h.textarea`. Extends the
 * core builder with typed events, controlled properties, drag and drop,
 * and attribute helpers. `Element` adds children.
 *
 * **Details**
 *
 * `Events` are the tag's events, `Node` the DOM element it renders to,
 * which types `ref` and `onMount`, and `Tag` the tag, which a part of a
 * headless component checks. Every method returns a copy. A builder
 * is itself a valid child or view, so `h.input.value(draft)` needs no
 * terminal call.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class VoidElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  in out Node = unknown,
  out Tag extends string = string
> extends View.ElementBuilder<Msg, R, E, Node, Tag> {
  /** @internal */
  static override readonly [View.baseFieldsOnly] = true
  /**
   * Phantom: keeps the HTML methods through `View.WithRequirements`.
   *
   * @since 0.1.0
   */
  declare readonly "~With"?: VoidElement<Msg, R | this["~Add"], E, Node, Tag>
  /**
   * Sets the `id` attribute.
   *
   * @since 0.1.0
   */
  id(id: string): this {
    return this.attr("id", id)
  }
  /**
   * Sets inline CSS from camelCase properties and `--custom` properties.
   *
   * **Details**
   *
   * Values are strings with explicit units. Skips `false`, `null`, `undefined`
   * and `""`. Each call replaces the previous style; an empty result removes
   * the attribute. Merge objects with spread to keep earlier declarations.
   * Raw CSS text can still be set with `attr("style", text)`.
   *
   * Declarations written through `element.style` (such as from `onMount`)
   * whose value or priority differs from the previous view's survive when the
   * view's style text changes and win over the view on the same property,
   * except shorthands set to a `var()` value. A Content Security Policy must
   * allow inline style attributes (for example,
   * `style-src-attr 'unsafe-inline'`). Values are not
   * parsed: a semicolon can start another declaration. Do not pass untrusted
   * input as a raw value.
   *
   * **Example** (Defining inline styles)
   *
   * ```ts
   * import type { Html } from "@effect/ui/html"
   *
   * declare const h: Html.Tags<never>
   * declare const model: { readonly error: string | undefined }
   *
   * const note = h.div.style({
   *   color: model.error !== undefined && "red",
   *   marginTop: "1rem",
   *   "--accent": "#09f"
   * }).children("Note")
   * ```
   *
   * @since 0.1.0
   */
  style(style: Style): this {
    const declarations: Array<string> = []
    for (const [name, value] of Object.entries(style)) {
      if (!value) continue
      declarations.push(cssProperty(name) + ":" + value)
    }
    return this.attr(
      "style",
      declarations.length === 0 ? undefined : declarations.join(";")
    )
  }
  /**
   * Appends class tokens to the `class` attribute, skipping `false`, `null`,
   * `undefined` and `""`.
   *
   * **Details**
   *
   * Tokens are joined with one space after any existing classes. The attribute
   * is omitted when no classes remain. Use
   * `attr("class", value)` to replace or `attr("class", undefined)` to clear.
   *
   * **Example** (Adding classes conditionally)
   *
   * ```ts
   * import type { Html } from "@effect/ui/html"
   *
   * declare const h: Html.Tags<never>
   * declare const model: { readonly saving: boolean; readonly error: string | undefined }
   *
   * const save = h.button.class(
   *   "rounded px-3 py-1",
   *   model.saving && "opacity-50",
   *   model.error !== undefined && "ring-2 ring-red-500"
   * ).children("Save")
   * ```
   *
   * @since 0.1.0
   */
  class(...tokens: ReadonlyArray<ClassToken>): this {
    const added = tokens.length === 1
      ? tokens[0] || ""
      : joinClassTokens(tokens)
    const current = this.elementAttrs.class
    return this.attr(
      "class",
      current && added ? current + " " + added : current || added || undefined
    )
  }
  /**
   * Sets or removes the `disabled` boolean attribute.
   *
   * @since 0.1.0
   */
  disabled(disabled: boolean): this {
    return this.attr("disabled", disabled ? "" : undefined)
  }
  /**
   * The controlled `value` of an `input`, `textarea` or `select`. The element
   * always shows it, whatever the user types, until the Model changes.
   *
   * A browser lets a file input's value only be emptied, so the browser host
   * writes `""` to one and skips any other value. See `InputPayload`.
   *
   * @since 0.1.0
   */
  value<N extends ValueNode>(
    this: VoidElement<Msg, R, E, N>,
    value: string
  ): this {
    return this.prop("value", value) as any
  }
  /**
   * The controlled `checked` state of a checkbox or radio button.
   *
   * @since 0.1.0
   */
  checked(
    this: VoidElement<Msg, R, E, HTMLInputElement>,
    checked: boolean
  ): this {
    return this.prop("checked", checked) as any
  }
  /**
   * The controlled `selected` state of an `option`.
   *
   * @since 0.1.0
   */
  selected(
    this: VoidElement<Msg, R, E, HTMLOptionElement>,
    selected: boolean
  ): this {
    return this.prop("selected", selected) as any
  }
  /**
   * The controlled `open` state of a `details` or `dialog`. On a `dialog`
   * it shows a non-modal dialog. `open` and `modal` set the same state, and
   * the last call wins.
   *
   * @since 0.1.0
   */
  open<N extends HTMLDetailsElement | HTMLDialogElement>(
    this: VoidElement<Msg, R, E, N>,
    open: boolean
  ): this {
    return this.prop("open", open) as any
  }
  /**
   * Shows a `dialog` as a modal while `modal` is true: in the top layer, with
   * a backdrop, the rest of the page inert and focus kept inside, and closed
   * otherwise. `open` and `modal` set the same state, `false`, `true` or
   * `"modal"`, and the last call wins.
   *
   * **Details**
   *
   * The Model decides when the modal closes. The browser host cancels its
   * close requests, such as Escape and, where `closedby` is supported, a
   * click on the backdrop, and sends them as `cancel`; a modal without a
   * `cancel` handler ignores them. Browsers may still close a modal whose close
   * requests keep being cancelled: Chromium 153 did after one or two
   * cancelled Escapes, depending on user activation, and other browsers may
   * differ. When the Model still says `true`, the host shows it again on the
   * next frame, which moves focus to the dialog's first focusable element.
   *
   * A form in the dialog is the app's, like any other: its submission comes
   * to `submit`, with the submitter's `name` and `value` in `entries`, and
   * `method="dialog"` neither closes the dialog nor sets `returnValue`.
   * `close` is sent for every close, the Model's included, except the
   * closes the host makes to switch between modal and non-modal.
   *
   * The server renders a modal dialog closed, since HTML has no attribute
   * for one, and the browser host shows it once the page is live.
   *
   * @since 0.1.0
   */
  modal<N extends HTMLDialogElement>(
    this: VoidElement<Msg, R, E, N>,
    modal: boolean
  ): this {
    return this.prop("open", modal ? "modal" : false) as any
  }
  /**
   * Makes this element a popover in the top layer, `"manual"` or `"auto"`,
   * showing while `open` is true. Its state is its own, separate from a
   * `details` or `dialog`'s `open`. The last call wins.
   *
   * **Details**
   *
   * A `"manual"` popover is controlled: the browser host shows and hides it
   * as the Model says at every commit, whether or not its component
   * rendered, and when anything else changes it, such as a `popovertarget`
   * button, puts it back on the next frame. Use a `click` handler to open it.
   *
   * An `"auto"` popover is followed: the browser closes it on Escape, a
   * click outside, another auto popover opening or a modal dialog opening,
   * and sends `toggle`. The Model must follow it. The host shows or hides
   * it only when the Model's value changes, so a Model that ignores the
   * toggle still says open while the popover is closed, and it reopens only
   * once the value goes to `false` and back. The same holds when the
   * browser closes it without a `toggle`, as it does when the element moves
   * in the document. `popovertarget` and `commandfor` buttons work with an
   * auto popover.
   *
   * The server renders a popover closed, and the browser host shows it at
   * the first commit once the page is live. A popover removed while showing
   * closes without a `toggle`.
   *
   * @since 0.1.0
   */
  popover(mode: PopoverMode, open: boolean): this {
    return this.attr("popover", mode).prop("popoverOpen", open)
  }
  /**
   * Makes this element a drag source carrying `data`, strings by type such
   * as `{ "application/x-todo": id }`, and sets `draggable="true"`. The host
   * puts the data on the drag when it starts. Calling it again replaces the
   * data. Pair it with `on("dragstart", handler)` without options in either
   * order to keep both the data and the handler.
   *
   * @since 0.1.0
   */
  draggable(
    data: Readonly<Record<string, string>>,
    options?: { readonly effectAllowed?: EffectAllowed | undefined } | undefined
  ): this {
    const source: DragSourceOptions = {
      data,
      effectAllowed: options?.effectAllowed
    }
    return View.withOwnFields(this, {
      eventOptions: { ...View.ownFields(this).eventOptions, dragstart: source }
    }).attr(
      "draggable",
      "true"
    )
  }
  /**
   * Registers an event handler. Without options, `on("dragstart", handler)`
   * preserves `draggable` options and `on("drop", handler)` preserves
   * `dropTarget` options. Explicit options replace them; options from an
   * earlier `on` call are replaced even when options are omitted.
   *
   * @since 0.1.0
   */
  override on<K extends string>(
    event: K & keyof E,
    handler: View.Handler<Msg, E[K & keyof E]>,
    options?: EventOptionsOf<K> | undefined
  ): this {
    if (options === undefined && (event === "dragstart" || event === "drop")) {
      const set = View.ownFields(this).eventOptions[event]
      const key = event === "dragstart" ? "data" : "accepts"
      if (set !== undefined && key in set) options = set
    }
    return super.on(event as any, handler as any, options)
  }
  /**
   * Makes this element a drop target for drags carrying one of the
   * `accepts` types. Requires `on("drop", handler)` without options; call
   * them in either order. Calling `dropTarget` again replaces its options
   * and keeps the handler.
   *
   * **Details**
   *
   * While an accepted drag is over the target, the host cancels `dragenter`
   * and `dragover` so the browser allows the drop, and shows `dropEffect`. A
   * drag it doesn't accept is left alone, so the browser shows that it can't
   * be dropped and no `drop` comes. The drop's default is always cancelled,
   * whatever the handler returns, so a handler that returns `undefined`
   * still stops a dropped file from opening in the page.
   *
   * The active drop target is the innermost one on the pointer's path that
   * accepts the drag. Unlike `mouseenter`, `dragenter` and `dragleave` go
   * to the active target only: moving between its children sends nothing,
   * and moving into a nested target leaves the outer one.
   *
   * The active target is worked out from the drag's events, not from
   * rendering. After a `dragenter`, one `dragleave` follows when a later
   * drag event finds the drag over another target or none, the drag leaves
   * the window, is dropped (after `drop`) or ends. A render that removes
   * the target's `drop` handler or changes what it accepts takes effect on
   * the next `dragenter` or `dragover`, or when the drag ends, not during
   * the render, and the leave then goes to the handler the element has at
   * that point. Nothing is sent once the element's `dragleave` handler is
   * removed or its component is gone.
   *
   * `dragover` is for an active drop target that needs the pointer's
   * position, such as a list reordered by halves of its items. The host
   * sends at most one per animation frame, only when the position changed,
   * and drops a queued one when the target stops being active, goes away,
   * stops accepting the drag after a render or the drag ends.
   *
   * **Example** (A drop target for todos)
   *
   * ```ts
   * import type { Html } from "@effect/ui/html"
   *
   * declare const h: Html.Tags<string>
   *
   * const column = h.section
   *   .dropTarget({ accepts: ["application/x-todo"], dropEffect: "move" })
   *   .on("drop", ({ data }) => data["application/x-todo"])
   * ```
   *
   * @since 0.1.0
   */
  dropTarget(options: Omit<DropTargetOptions, "preventDefault">): this {
    const target: DropTargetOptions = { ...options, preventDefault: "always" }
    return View.withOwnFields(this, {
      eventOptions: { ...View.ownFields(this).eventOptions, drop: target }
    })
  }
}

/**
 * The builder of an HTML element that takes children: a `VoidElement` plus
 * `children`.
 *
 * **Details**
 *
 * On `h`, a tag's root builder is also callable as shorthand for
 * `children`, for an element with no attributes: `h.span(title)` is
 * `h.span.children(title)`. Either way the result is the builder, so more
 * children and attributes can follow, and a second `children` adds after
 * the first.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class Element<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  in out Node = unknown,
  out Tag extends string = string
> extends VoidElement<Msg, R, E, Node, Tag> {
  /** @internal */
  static override readonly [View.baseFieldsOnly] = true
  /**
   * Phantom: keeps `children` through `View.WithRequirements`.
   *
   * @since 0.1.0
   */
  declare readonly "~With"?: Element<Msg, R | this["~Add"], E, Node, Tag>
  /**
   * Adds children after the ones the builder holds, and returns the
   * builder: nodes, builders, text, arrays to flatten, and holes (`false`,
   * `null`, `undefined`). Their requirements join the element's.
   *
   * @since 0.1.0
   */
  children<This, const C extends ReadonlyArray<View.Input<Msg, unknown>>>(
    this: This,
    ...inputs: C
  ): View.WithRequirements<This, View.Requirements<C[number]>>
  children(...inputs: ReadonlyArray<View.Input<Msg, unknown>>): unknown {
    return View.withContent(this, inputs)
  }
}

/**
 * One class token for `classNames` and `Element.class`: a class string, or
 * `false`, `null` or `undefined` for a class that is left out.
 *
 * **Details**
 *
 * `true` and numbers aren't tokens, which catches `cond || "x"` and
 * `count && "x"` mistakes at compile time.
 *
 * @stability experimental
 * @category attributes
 * @since 0.1.0
 */
export type ClassToken = string | false | null | undefined

/**
 * An inline CSS value, or `false`, `null` or `undefined` to omit a declaration.
 *
 * @stability experimental
 * @category attributes
 * @since 0.1.0
 */
export type StyleValue = string | false | null | undefined

type StyleProperty = {
  [K in keyof CSSStyleDeclaration]: K extends string
    ? CSSStyleDeclaration[K] extends string ? K : never
    : never
}[keyof CSSStyleDeclaration]

/**
 * Inline styles with camelCase CSS property names and `--custom` properties.
 *
 * **Details**
 *
 * Property names come from the DOM library. Values are strings, not numbers;
 * include units where CSS requires them. Use `float` rather than `cssFloat`.
 * Empty strings and other falsy values omit the declaration.
 *
 * @stability experimental
 * @category attributes
 * @since 0.1.0
 */
export type Style =
  & {
    readonly [K in Exclude<StyleProperty, "cssText" | "cssFloat"> | "float"]?:
      StyleValue
  }
  & { readonly [K in `--${string}`]?: StyleValue }

/**
 * Joins class tokens with one space, skipping `false`, `null`, `undefined`
 * and `""`.
 *
 * **When to use**
 *
 * Use to build a class string outside `Element.class`, such as an attribute
 * other than `class` or a value passed to a child component.
 *
 * **Details**
 *
 * Tokens are kept as written: there is no splitting, deduplication or
 * conflict resolution between utility classes. With no tokens left it returns
 * `""`.
 *
 * **Example** (Building a class string)
 *
 * ```ts import.meta.vitest
 * import { Html } from "@effect/ui/html"
 *
 * const tabClass = (active: boolean) => Html.classNames("tab", active && "tab-active")
 *
 * tabClass(true) // => "tab tab-active"
 * tabClass(false) // => "tab"
 * ```
 *
 * @stability experimental
 * @category attributes
 * @since 0.1.0
 */
export const classNames = (...tokens: ReadonlyArray<ClassToken>): string =>
  joinClassTokens(tokens)

// The last tokens joined after each first token, and what they made: a view
// gives the same class list on every render, and joining it again would make
// a new string, which the attribute record shared per class then hashes.
interface Joined {
  tokens: ReadonlyArray<ClassToken>
  value: string
}

const joins = new Map<ClassToken, Joined>()

const joinClassTokens = (tokens: ReadonlyArray<ClassToken>): string => {
  const first = tokens[0]
  const last = joins.get(first)
  if (last !== undefined && last.tokens.length === tokens.length) {
    let same = true
    for (let i = 1; same && i < tokens.length; i++) {
      same = last.tokens[i] === tokens[i]
    }
    if (same) return last.value
  }
  let out = ""
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token) out = out === "" ? token : out + " " + token
  }
  // A first token seen before keeps its entry, written over.
  if (last !== undefined) {
    last.tokens = tokens
    last.value = out
  } else {
    if (joins.size >= 512) joins.clear()
    joins.set(first, { tokens, value: out })
  }
  return out
}

/**
 * The tags that take children.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const containerTags = [
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "i",
  "iframe",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "mark",
  "menu",
  "meter",
  "nav",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "video"
] as const

/**
 * Tags whose builders take no children, including `textarea`.
 * Set textarea content with `.value(...)`; it is not an HTML void element.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const voidTags = [
  "br",
  "col",
  "hr",
  "img",
  "input",
  "source",
  "textarea",
  "track",
  "wbr"
] as const

/**
 * A tag that takes children.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export type ContainerTag = typeof containerTags[number]

/**
 * A tag that takes no children.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export type VoidTag = typeof voidTags[number]

// ---------------------------------------------------------------------------
// svg
// ---------------------------------------------------------------------------

/**
 * Tags with named builders on `h` that render in the SVG namespace.
 *
 * @stability experimental
 * @category svg
 * @since 0.1.0
 */
export const svgTags = elements.svgTags

/**
 * An SVG tag.
 *
 * @stability experimental
 * @category svg
 * @since 0.1.0
 */
export type SvgTag = typeof svgTags[number]

/**
 * Pointer, mouse, keyboard and focus events supported by SVG builders.
 *
 * @stability experimental
 * @category svg
 * @since 0.1.0
 */
export type SvgEvents = Pick<
  Events,
  | "click"
  | "dblclick"
  | "contextmenu"
  | "mousedown"
  | "mouseup"
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "mouseenter"
  | "mouseleave"
  | "keydown"
  | "keyup"
  | "focus"
  | "blur"
  | "focusin"
  | "focusout"
>

type SvgGlobalAttribute =
  | "id"
  | "class"
  | "style"
  | "lang"
  | "tabindex"
  | "role"
  | `aria-${string}`
  | `data-${string}`

type SvgPresentationAttribute =
  | "alignment-baseline"
  | "baseline-shift"
  | "clip"
  | "clip-path"
  | "clip-rule"
  | "color"
  | "color-interpolation"
  | "color-interpolation-filters"
  | "color-rendering"
  | "cursor"
  | "direction"
  | "display"
  | "dominant-baseline"
  | "fill"
  | "fill-opacity"
  | "fill-rule"
  | "filter"
  | "flood-color"
  | "flood-opacity"
  | "font-family"
  | "font-size"
  | "font-size-adjust"
  | "font-stretch"
  | "font-style"
  | "font-variant"
  | "font-weight"
  | "image-rendering"
  | "letter-spacing"
  | "lighting-color"
  | "marker-end"
  | "marker-mid"
  | "marker-start"
  | "mask"
  | "mask-type"
  | "opacity"
  | "overflow"
  | "paint-order"
  | "pointer-events"
  | "shape-rendering"
  | "stop-color"
  | "stop-opacity"
  | "stroke"
  | "stroke-dasharray"
  | "stroke-dashoffset"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "stroke-miterlimit"
  | "stroke-opacity"
  | "stroke-width"
  | "text-anchor"
  | "text-decoration"
  | "text-rendering"
  | "transform"
  | "transform-origin"
  | "unicode-bidi"
  | "vector-effect"
  | "visibility"
  | "white-space"
  | "word-spacing"
  | "writing-mode"

type SvgBox = "x" | "y" | "width" | "height"
type SvgViewport = "viewBox" | "preserveAspectRatio"
type SvgLink = "href"
type SvgTextPosition =
  | "x"
  | "y"
  | "dx"
  | "dy"
  | "rotate"
  | "textLength"
  | "lengthAdjust"
type SvgGradient =
  | SvgLink
  | "gradientUnits"
  | "gradientTransform"
  | "spreadMethod"

interface SvgOwnAttributes {
  readonly svg: SvgBox | SvgViewport | "xmlns" | "version"
  readonly g: never
  readonly path: "d" | "pathLength"
  readonly circle: "cx" | "cy" | "r" | "pathLength"
  readonly ellipse: "cx" | "cy" | "rx" | "ry" | "pathLength"
  readonly line: "x1" | "y1" | "x2" | "y2" | "pathLength"
  readonly polyline: "points" | "pathLength"
  readonly polygon: "points" | "pathLength"
  readonly rect: SvgBox | "rx" | "ry" | "pathLength"
  readonly text: SvgTextPosition
  readonly tspan: SvgTextPosition
  readonly textPath:
    | SvgLink
    | "path"
    | "startOffset"
    | "method"
    | "spacing"
    | "side"
    | "textLength"
    | "lengthAdjust"
  readonly defs: never
  readonly use: SvgBox | SvgLink
  readonly symbol: SvgBox | SvgViewport | "refX" | "refY"
  readonly clipPath: "clipPathUnits"
  readonly mask: SvgBox | "maskUnits" | "maskContentUnits"
  readonly pattern:
    | SvgBox
    | SvgViewport
    | SvgLink
    | "patternUnits"
    | "patternContentUnits"
    | "patternTransform"
  readonly marker:
    | SvgViewport
    | "refX"
    | "refY"
    | "markerUnits"
    | "markerWidth"
    | "markerHeight"
    | "orient"
  readonly linearGradient: SvgGradient | "x1" | "y1" | "x2" | "y2"
  readonly radialGradient: SvgGradient | "cx" | "cy" | "r" | "fx" | "fy" | "fr"
  readonly stop: "offset"
  readonly filter: SvgBox | "filterUnits" | "primitiveUnits"
  readonly image:
    | SvgBox
    | SvgLink
    | "preserveAspectRatio"
    | "crossorigin"
    | "decoding"
  readonly foreignObject: SvgBox
}

/**
 * Attribute names accepted by an SVG tag's `attr` and `attrs`: global and
 * presentation attributes, plus tag-specific names such as `d` on `path`.
 * Names are case-sensitive: use `viewBox`, not `viewbox`. For an unlisted
 * name, pass a `Record<string, string>` to `attrs`, or use `h.el(tag)`.
 *
 * @stability experimental
 * @category svg
 * @since 0.1.0
 */
export type SvgAttribute<Tag extends SvgTag> =
  | SvgGlobalAttribute
  | SvgPresentationAttribute
  | SvgOwnAttributes[Tag]

/**
 * An SVG builder with `id`, `class`, `style` and attribute names checked
 * by tag. HTML-only helpers such as `value` and `disabled` are excluded.
 * Root builders on `h` are callable as shorthand for `children`.
 *
 * `Node` types the DOM element for `ref` and `onMount`; `Tag` selects the
 * attribute names. See the module example for an icon.
 *
 * @stability experimental
 * @category svg
 * @since 0.1.0
 */
export interface SvgElement<
  Msg,
  R = never,
  Node = unknown,
  Tag extends SvgTag = SvgTag
> extends View.ContainerBuilder<Msg, R, SvgEvents, Node, Tag> {
  /**
   * Sends a message when `event` fires, as `View.ElementBuilder.on` does.
   *
   * @since 0.1.0
   */
  on<K extends string>(
    event: K & keyof SvgEvents,
    handler: View.Handler<Msg, SvgEvents[K & keyof SvgEvents]>,
    options?: EventOptionsOf<K> | undefined
  ): this
  /**
   * Sets one attribute; `undefined` removes it.
   *
   * @since 0.1.0
   */
  attr(name: SvgAttribute<Tag>, value: string | undefined): this
  /**
   * Sets several attributes; `undefined` removes one.
   *
   * @since 0.1.0
   */
  attrs(
    attributes: { readonly [K in SvgAttribute<Tag>]?: string | undefined }
  ): this
  /**
   * Sets the `id` attribute.
   *
   * @since 0.1.0
   */
  id(id: string): this
  /**
   * Appends class tokens to the `class` attribute.
   *
   * @since 0.1.0
   */
  class(...tokens: ReadonlyArray<ClassToken>): this
  /**
   * Sets inline CSS.
   *
   * @since 0.1.0
   */
  style(style: Style): this
  /**
   * Phantom: keeps the SVG methods through `View.WithRequirements`.
   *
   * @since 0.1.0
   */
  readonly "~With"?: SvgElement<Msg, R | this["~Add"], Node, Tag>
}

/**
 * The element names the vocabulary adds to `h`, bound to a component's
 * message type. Document-level tags (`html`, `head`, `body`, `title`, `meta`,
 * `link`, `base`, `script`, `style`) aren't here: the document head is managed
 * through a component's `head`, with `HtmlHead` for its HTML entries.
 *
 * The SVG tags are here too, as `SvgElement` builders, with SVG's `text` as
 * `svgText`.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export type Tags<Msg> =
  & {
    readonly [K in ContainerTag]: View.Shorthand<
      Element<Msg, never, EventsOf<K>, HTMLElementTagNameMap[K], K>
    >
  }
  & {
    readonly [K in VoidTag]: VoidElement<
      Msg,
      never,
      EventsOf<K>,
      HTMLElementTagNameMap[K],
      K
    >
  }
  & {
    readonly [K in SvgTag as K extends "text" ? "svgText" : K]: View.Shorthand<
      SvgElement<Msg, never, SVGElementTagNameMap[K], K>
    >
  }

/**
 * The type-level HTML vocabulary.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export interface Elements extends View.Elements {
  readonly Tags: Tags<this["Msg"]>
  readonly Host: Host
  readonly Head: HtmlHead.Entry
  readonly HeadValue: HtmlHead.HtmlHead
}

/**
 * The view helper for reusable pure HTML view functions, without a component
 * definition.
 *
 * **Details**
 *
 * A shared view function takes the message as a type parameter,
 * `<M>(h: Html.H<M>, ...)`, whether or not it sends a message. `Html.H<never>`
 * only accepts the `h` of a component with `message: Schema.Never`.
 *
 * Props remain `unknown` and component-specific queries are not included. Use
 * `Component.Helper<D>` instead when a function needs a definition's props,
 * queries or custom elements.
 *
 * **Example** (A reusable button)
 *
 * ```ts import.meta.vitest
 * import { Html } from "@effect/ui/html"
 * import { Schema } from "effect"
 *
 * const Button = <Msg>(h: Html.H<Msg>, label: string, message: Msg) =>
 *   h.button.on("click", message).children(label)
 *
 * export const Counter = Html.component({
 *   name: "Counter",
 *   model: Schema.Number,
 *   message: Schema.Literal("ClickedIncrement")
 * }).make({
 *   init: () => 0,
 *   update: ($) => $.model + 1,
 *   view: (h, count) => Button(h, String(count), "ClickedIncrement")
 * })
 * ```
 *
 * @stability experimental
 * @category utility types
 * @since 0.1.0
 */
export type H<Msg> = View.WithTags<Msg, unknown, Elements>

/**
 * Phantom: carries `Elements` on the module, so the module namespace is a
 * `View.Vocabulary<Elements>`. It's `undefined` at runtime.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const Elements: Elements | undefined = undefined

/**
 * The vocabulary's name, which a host lists to show it.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const name = "html"

const makeTags = (): Readonly<
  Record<string, VoidElement<any, any, any, any>>
> => {
  const out: Record<string, VoidElement<any, any, any, any>> = {}
  for (const tag of containerTags) out[tag] = View.shorthand(new Element(tag))
  for (const tag of voidTags) out[tag] = View.markRoot(new VoidElement(tag))
  // An SVG element is an `Element` at runtime; `SvgElement` narrows its type.
  for (const tag of svgTags) {
    out[tag === "text" ? "svgText" : tag] = View.shorthand(new Element(tag))
  }
  return out
}

/**
 * The root element builders installed on `h`, one per tag, shared by every
 * render: a callable `View.shorthand` builder for a tag that takes
 * children, SVG tags included, and a `VoidElement` for a void tag.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const tags: Readonly<Record<string, VoidElement<any, any, any, any>>> =
  makeTags()

/**
 * The vocabulary alone: its name and its tags. `Html.component` passes it to
 * `Component.define`.
 *
 * **When to use**
 *
 * Use wherever `elements` is written by hand, in place of the module. A
 * bundler keeps every export of a module that is passed as a value, such as
 * `Host`, `classNames` and `ref`. With `Html.vocabulary` a bundle holds
 * only the exports the app names.
 *
 * @stability experimental
 * @category vocabulary
 * @since 0.1.0
 */
export const vocabulary: View.Vocabulary<Elements> = { name, tags }

/**
 * Defines a component with the HTML element vocabulary already supplied,
 * equivalent to `Component.define({ ...options, elements: Html.vocabulary })`.
 *
 * **Example** (A counter component)
 *
 * ```ts import.meta.vitest
 * import { Html } from "@effect/ui/html"
 * import { Schema } from "effect"
 *
 * const Counter = Html.component({
 *   name: "Counter",
 *   model: Schema.Number,
 *   message: Schema.Literal("ClickedIncrement")
 * }).make({
 *   init: () => 0,
 *   update: ($) => $.model + 1,
 *   view: (h, count) => h.button.on("click", "ClickedIncrement").children(String(count))
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const component: Component.Define<Elements> = Component
  .withElements(vocabulary)

/**
 * A row built once, for lists of rows that differ in a few values:
 * `View.template` with the HTML elements. `Msg` is the message type of the
 * component that shows it, and `Values` the values that change, read from
 * `$` in `build` and given to each call.
 *
 * **Example** (A table row)
 *
 * ```ts
 * import { Html } from "@effect/ui/html"
 *
 * type Msg = { readonly _tag: "Select"; readonly id: number }
 * const Row = Html.template<Msg, {
 *   readonly key: string
 *   readonly label: string
 *   readonly selected: string | undefined
 *   readonly select: Msg
 * }>((h, $) =>
 *   h.tr.key($.key).class($.selected).children(
 *     h.td.children(h.a.on("click", $.select).children($.label))
 *   )
 * )
 *
 * const row = Row({
 *   key: "1",
 *   label: "First",
 *   selected: undefined,
 *   select: { _tag: "Select", id: 1 }
 * })
 * ```
 *
 * A slot that is an element's only child takes text, or an array of nodes,
 * such as `h.list` returns: the layout around a list can be a template, and a
 * render then patches only the list.
 *
 * **Example** (A table around its rows)
 *
 * ```ts
 * import type { View } from "@effect/ui"
 * import { Html } from "@effect/ui/html"
 *
 * type Msg = { readonly _tag: "Clear" }
 * const Table = Html.template<Msg, {
 *   readonly rows: ReadonlyArray<View.Node<Msg>>
 * }>((h, $) =>
 *   h.div.children(
 *     h.button.on("click", { _tag: "Clear" }).children("Clear"),
 *     h.table.children(h.tbody.children($.rows))
 *   )
 * )
 *
 * const table = Table({ rows: [] })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const template = <Msg, Values extends Record<string, unknown>>(
  build: (h: H<Msg>, $: Values) => View.Content<Msg, any>
): (
  values: Values
) => View.Element<Msg, View.Requirements<Values[keyof Values]>> =>
  View.makeTemplate(
    View.makeHelper<Msg, unknown, Elements>({}, vocabulary),
    build,
    Templates.kernel
  )

// ---------------------------------------------------------------------------
// refs
// ---------------------------------------------------------------------------

/**
 * Declares a ref to an element of tag `tag`, HTML or SVG. Attaching it to
 * another tag doesn't compile. List rows use `Row.at(id)`.
 *
 * @stability experimental
 * @category refs
 * @since 0.1.0
 */
export const ref = <K extends keyof HTMLElementTagNameMap | SvgTag>(
  name: string,
  _tag: K
): Renderer.Ref<
  (HTMLElementTagNameMap & Pick<SVGElementTagNameMap, SvgTag>)[K]
> => Renderer.ref(name)

/**
 * The names that get no generated method on a custom element, because the
 * builder already uses them: its own fields and core methods, such as
 * `content`, `key`, `ref`, `children` and `onMount`, the names every
 * object has, such as `toString`, plus `id`, `class` and `style`. Set a
 * property with one of these names with `prop`.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export type CustomElementReserved =
  | keyof View.ContainerBuilder<any>
  | keyof typeof Object.prototype
  | "id"
  | "class"
  | "style"

type PropertyMethods<P> = {
  readonly [
    K in keyof P & string as K extends CustomElementReserved ? never : K
  ]: <
    Self
  >(
    this: Self,
    value: P[K]
  ) => Self
}

type TypesOf<S> = {
  readonly [K in keyof S]: S[K] extends Schema.Top ? S[K]["Type"] : never
}

type ElementOf<Tag extends string> = Tag extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[Tag]
  : HTMLElement

type IsCallback<V> = [V] extends [null | undefined] ? false
  : [V] extends [Function | null | undefined] ? true
  : false

type Properties<P, T> = Types.IsUnion<T> extends true ? P
  :
    & P
    & {
      readonly [
        K in Exclude<
          keyof T,
          keyof HTMLElement | keyof P
        > as IsCallback<T[K]> extends true ? never
          : Types.EqualsWith<Pick<T, K>, Types.Mutable<Pick<T, K>>, K, never>
      ]: T[K]
    }

/**
 * A custom element builder with typed properties and events. Declared
 * event handlers receive the decoded `detail` as their payload.
 *
 * **Details**
 *
 * `P` maps each declared property to its value type and `E` each declared
 * event to its `detail`. A declared event replaces an HTML event of the same
 * name. `Node` defaults to `HTMLElementTagNameMap[Tag]`, or `HTMLElement`
 * for an unregistered tag, and types `ref` and `onMount`.
 * `CustomElement` adds a method per declared property.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class CustomElementBuilder<
  out Msg,
  out R = never,
  in out P = {},
  in out E = {},
  out Tag extends string = string,
  in out Node = ElementOf<Tag>
> extends Element<Msg, R, Omit<Events, keyof E> & E, Node, Tag> {
  /** @internal */
  static override readonly [View.baseFieldsOnly] = true
  /**
   * Phantom: keeps the property methods through `View.WithRequirements`.
   *
   * @since 0.1.0
   */
  declare readonly "~With"?: CustomElement<
    Msg,
    R | this["~Add"],
    P,
    E,
    Tag,
    Node
  >
}

type Undeclared<P, K extends string> = K extends keyof P ? never : unknown

/**
 * A declared property method replaces any HTML method of the same name.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export interface CustomElementBuilder<
  out Msg,
  out R = never,
  in out P = {},
  in out E = {},
  out Tag extends string = string,
  in out Node = ElementOf<Tag>
> {
  /**
   * Writes the property `name` on the element as a JavaScript property,
   * typed by its Schema or by the element's class. The browser host writes
   * it when its value changes, and resets it when a render leaves it out.
   *
   * @since 0.1.0
   */
  prop<K extends keyof Properties<P, Node> & string>(
    name: K,
    value: Properties<P, Node>[K]
  ): this
  disabled(
    this: Undeclared<P, "disabled">,
    disabled: boolean
  ): this
  popover(
    this: Undeclared<P, "popover">,
    mode: PopoverMode,
    open: boolean
  ): this
  draggable(
    this: Undeclared<P, "draggable">,
    data: Readonly<Record<string, string>>,
    options?: { readonly effectAllowed?: EffectAllowed | undefined } | undefined
  ): this
  dropTarget(
    this: Undeclared<P, "dropTarget">,
    options: Omit<DropTargetOptions, "preventDefault">
  ): this
}

/**
 * The builder of a custom element: `CustomElementBuilder` plus a method per
 * declared property, named after it. Declared events are handled with `on`.
 *
 * **Details**
 *
 * A declared name wins over the HTML method of the same name, such as
 * `value` or `disabled`, and is typed by its Schema. A wrong
 * value for one of those reports "No overload matches this call", with the
 * declared signature as the first overload. A name in
 * `CustomElementReserved` gets no method.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export type CustomElement<
  Msg,
  R = never,
  P = {},
  E = {},
  Tag extends string = string,
  Node = ElementOf<Tag>
> =
  & PropertyMethods<P>
  & CustomElementBuilder<Msg, R, P, E, Tag, Node>

/**
 * What `customElement` takes: the element's `tag`, its JavaScript
 * `properties` and its `events`, each described by a Schema. An event's
 * Schema decodes its `detail`.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export interface CustomElementConfig<Tag extends string, P, E> {
  readonly tag: Tag
  readonly properties?: P | undefined
  readonly events?: E | undefined
}

/**
 * A custom element bound with `customElement`. Call it with a view's `h` to
 * get the element's root builder, which, like `h.div`, is also callable as
 * shorthand for `children`.
 *
 * **Details**
 *
 * It takes an `Html.H`, so only an HTML view can use it. `tag`,
 * `properties` and `events` are what it was defined with.
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export interface CustomElementBinding<Tag extends string, P, E> {
  <Msg>(
    h: H<Msg>
  ): View.Shorthand<
    CustomElement<Msg, never, TypesOf<P>, TypesOf<E>, Tag>
  >
  readonly tag: Tag
  readonly properties: P
  readonly events: E
}

/**
 * Binds a custom element, a web component another library or your own code
 * defines, to the HTML vocabulary, with typed properties and events.
 *
 * **When to use**
 *
 * Use when an element's contract is declarative: JavaScript properties go
 * in and `CustomEvent`s come out, as with most Lit, Stencil or Shoelace
 * components. For an imperative API, such as a map or an editor you call
 * methods on, use `onMount`.
 *
 * **Details**
 *
 * Each declared property gets a method that writes it as a JavaScript
 * property, not an attribute, so arrays and objects work. The value is
 * written as given: the Schema types it but doesn't encode it. The browser
 * host writes it when it isn't `===` to the last one written, so a new array
 * on every render is written on every render, and resets it to `""`,
 * `false` or `null` when a render leaves it out. `value`, `checked`,
 * `selected` and `open` are plain properties on a custom element, not
 * controlled as on an `input`.
 * The server renders none of them: the browser host sets them when it adopts
 * the element.
 *
 * Use `on(event, handler)` for declared events. The handler receives
 * `detail` decoded by the event's Schema. Invalid `detail` is logged with
 * `console.error` and sends no message. A missing or
 * `null` `detail` that the Schema rejects is decoded again as `{}`, so
 * `Schema.Struct({})` declares an event without a payload. An event that
 * doesn't bubble reaches the element's own handler only.
 *
 * `prop` accepts declared properties, including names without a method
 * (see `CustomElementReserved`). For a single tag registered in
 * `HTMLElementTagNameMap`, it also infers writable fields beyond
 * `HTMLElement`, excluding methods and callbacks. Inferred values use
 * the fields' read types; explicit schemas take precedence. The registered
 * class also types `ref` and `onMount`.
 *
 * Declare schemas in `properties` for fluent property methods, callback
 * properties, or accessors whose setters accept a different type from
 * their getters' return types. Explicit schemas are also needed when the
 * tag is absent from `HTMLElementTagNameMap` or has a union type.
 *
 * HTML methods such as `class`, `style` and `on("click", ...)` remain
 * available unless a declared property replaces them. The app must still
 * register the element with `customElements.define`, often by importing
 * its package.
 *
 * Throws when `tag` isn't a custom element name, lowercase with a hyphen.
 *
 * In a test, `HtmlScene.fireElement` and `HtmlPlay.fireElement` send a
 * declared event with a typed `detail`.
 *
 * **Example** (A color picker web component)
 *
 * ```ts import.meta.vitest
 * import { UiSchema } from "@effect/ui"
 * import { Html } from "@effect/ui/html"
 * import { Schema } from "effect"
 *
 * const ColorPicker = Html.customElement({
 *   tag: "hex-color-picker",
 *   properties: { color: Schema.String },
 *   events: { "color-changed": Schema.Struct({ value: Schema.String }) }
 * })
 *
 * const Message = UiSchema.TaggedEnum({ ChangedColor: { color: Schema.String } })
 *
 * const Swatch = Html.component({
 *   name: "Swatch",
 *   model: Schema.String,
 *   message: Message
 * }).make({
 *   init: () => "#1e1b4b",
 *   update: { ChangedColor: (_, { color }) => color },
 *   view: (h, color) =>
 *     ColorPicker(h)
 *       .class("swatch")
 *       .color(color)
 *       .on("color-changed", ({ value }) => Message.ChangedColor({ color: value }))
 * })
 * ```
 *
 * @stability experimental
 * @category custom elements
 * @since 0.1.0
 */
export const customElement = <
  const Tag extends string,
  const P extends { readonly [name: string]: Schema.Top } = {},
  const E extends {
    readonly [event: string]: Schema.Decoder<unknown>
  } = {}
>(
  config: CustomElementConfig<Tag, P, E>
): CustomElementBinding<Tag, P, E> => {
  const { tag } = config
  if (!/^[a-z][^A-Z\s]*-[^A-Z\s]*$/.test(tag)) {
    throw new Error(
      `Html.customElement: "${tag}" isn't a custom element name, which starts with a lowercase letter and holds a hyphen and no uppercase letter`
    )
  }
  const properties = config.properties ?? ({} as P)
  const events = config.events ?? ({} as E)
  const decoders = new Map(
    Object.entries(events).map((
      [event, schema]
    ) => [event, Schema.decodeUnknownExit(schema)])
  )
  class Bound extends CustomElementBuilder<any, any, any, any, any, any> {
    static override readonly [View.baseFieldsOnly] = true
    override on(
      event: string,
      handler: View.Handler<unknown, unknown>,
      options?: View.EventOptions | undefined
    ): this {
      const decode = decoders.get(event)
      return super.on(
        event as never,
        decode === undefined ? handler : (payload: unknown) => {
          const detail = (payload as { readonly detail?: unknown }).detail
          let exit = decode(detail)
          if (exit._tag === "Failure" && detail == null) exit = decode({})
          if (exit._tag === "Success") return handle(handler, exit.value)
          // oxlint-disable-next-line no-console
          console.error(
            `[@effect/ui/html/Html] <${tag}> sent "${event}" with a detail its Schema rejects, so it sends no message. ${exit.cause}`
          )
          return undefined
        },
        options
      )
    }
  }
  const core = new View.ContainerBuilder("")
  for (const name in properties) {
    if (name in core || name === "id" || name === "class" || name === "style") {
      continue
    }
    Object.defineProperty(Bound.prototype, name, {
      value(this: Bound, value: unknown) {
        return this.prop(name, value)
      },
      writable: true,
      configurable: true
    })
  }
  const root = View.shorthand(new Bound(tag))
  return Object.assign(() => root, { tag, properties, events }) as any
}
