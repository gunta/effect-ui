import { type Component, UiSchema } from "@effect/ui"
import { BrowserHost, Html } from "@effect/ui/html"
import { Effect, Layer, Schema } from "effect"

// DATA

const adjectives = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
  "clean",
  "elegant",
  "easy",
  "angry",
  "crazy",
  "helpful",
  "mushy",
  "odd",
  "unsightly",
  "adorable",
  "important",
  "inexpensive",
  "cheap",
  "expensive",
  "fancy"
]
const colours = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "brown",
  "white",
  "black",
  "orange"
]
const nouns = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
  "pizza",
  "mouse",
  "keyboard"
]

const random = (max: number) => Math.round(Math.random() * 1000) % max

// MODEL

const Row = Schema.Struct({ id: Schema.Number, label: Schema.String })
type Row = typeof Row.Type

const Model = Schema.Struct({
  rows: Schema.Array(Row),
  selected: Schema.Number,
  nextId: Schema.Number
})
type Model = typeof Model.Type

const buildRows = (nextId: number, count: number): Array<Row> =>
  Array.from({ length: count }, (_, index) => ({
    id: nextId + index,
    label: adjectives[random(adjectives.length)] + " " +
      colours[random(colours.length)] + " " +
      nouns[random(nouns.length)]
  }))

// MESSAGE

const Message = UiSchema.TaggedEnum({
  Run: {},
  RunLots: {},
  Add: {},
  Update: {},
  Clear: {},
  SwapRows: {},
  Select: { id: Schema.Number },
  Remove: { id: Schema.Number }
})
type Message = typeof Message.Type

// UPDATE

const replaceRows = (model: Model, count: number): Model => ({
  rows: buildRows(model.nextId, count),
  selected: 0,
  nextId: model.nextId + count
})

const update = (
  { model }: { readonly model: Model },
  message: Message
): Model => {
  switch (message._tag) {
    case "Run":
      return replaceRows(model, 1000)
    case "RunLots":
      return replaceRows(model, 10000)
    case "Add":
      return {
        ...model,
        rows: [...model.rows, ...buildRows(model.nextId, 1000)],
        nextId: model.nextId + 1000
      }
    case "Update":
      return {
        ...model,
        rows: model.rows.map((row, i) =>
          i % 10 === 0 ? { ...row, label: row.label + " !!!" } : row
        )
      }
    case "Clear":
      return { ...model, rows: [], selected: 0 }
    case "SwapRows": {
      if (model.rows.length <= 998) return model
      const rows = [...model.rows]
      const row1 = rows[1]
      rows[1] = rows[998]
      rows[998] = row1
      return { ...model, rows }
    }
    case "Select":
      return { ...model, selected: message.id }
    case "Remove":
      return {
        ...model,
        rows: model.rows.filter((row) => row.id !== message.id)
      }
  }
}

// VIEW

const MainDef = Html.component({
  name: "Main",
  model: Model,
  message: Message
})
type H = Component.Helper<typeof MainDef>

const button = (h: H, id: string, title: string, message: Message) =>
  h.div.class("col-sm-6", "smallpad").children(
    h.button.attr("id", id).attr("type", "button").class(
      "btn",
      "btn-primary",
      "btn-block"
    ).on("click", message)
      .children(title)
  )

const jumbotron = (h: H) =>
  h.div.class("jumbotron").children(
    h.div.class("row").children(
      h.div.class("col-md-6").children(h.h1.children("Effect UI keyed")),
      h.div.class("col-md-6").children(
        h.div.class("row").children(
          button(h, "run", "Create 1,000 rows", Message.Run()),
          button(h, "runlots", "Create 10,000 rows", Message.RunLots()),
          button(h, "add", "Append 1,000 rows", Message.Add()),
          button(h, "update", "Update every 10th row", Message.Update()),
          button(h, "clear", "Clear", Message.Clear()),
          button(h, "swaprows", "Swap Rows", Message.SwapRows())
        )
      )
    )
  )

// Built again only when its row or selection changes, like Foldkit's createKeyedLazy.
const row = (h: H, row: Row, selected: boolean) =>
  h.tr.key(String(row.id)).class(selected && "danger").children(
    h.td.class("col-md-1").children(String(row.id)),
    h.td.class("col-md-4").children(
      h.a.on("click", Message.Select({ id: row.id })).children(row.label)
    ),
    h.td.class("col-md-1").children(
      h.a.on("click", Message.Remove({ id: row.id })).children(
        h.span.class("glyphicon", "glyphicon-remove").attr(
          "aria-hidden",
          "true"
        )
      )
    ),
    h.td.class("col-md-6")
  )

const Main = MainDef.make({
  init: () => ({ rows: [], selected: 0, nextId: 1 }),
  update,
  view: (h, model) =>
    h.div.class("container").children(
      // Static, so built once and never patched.
      h.lazy(jumbotron),
      h.table.class("table", "table-hover", "table-striped", "test-data")
        .children(
          h.tbody.children(model.rows.map((item) =>
            h.lazy(row, item, item.id === model.selected)
          ))
        ),
      h.span.class("preloadicon", "glyphicon", "glyphicon-remove").attr(
        "aria-hidden",
        "true"
      )
    )
})

// RUN

Layer.launch(BrowserHost.mount(Main, {}, document.getElementById("main")!))
  .pipe(Effect.runFork)
