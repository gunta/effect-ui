import { View } from "@effect/ui"
import { assert, describe, it } from "@effect/vitest"

// What `h.lazy` keeps between renders: a render that rebuilds a few rows
// leaves the entries of the rows it replaced until they are as many as the
// ones in use, and never more.

interface Row {
  readonly id: number
}

const row = (h: View.Helper<never, {}>, row: Row) =>
  h.el("li").key(String(row.id))

const render = (store: View.LazyStore, rows: ReadonlyArray<Row>) => {
  const h = View.makeHelper<never, {}>({}, undefined, undefined, "/List", store)
  const lazies = store.lazy as View.Lazies | undefined
  lazies?.begin()
  const nodes = rows.map((item) => h.lazy(row, item))
  ;(store.lazy as View.Lazies).end()
  return nodes
}

const sizeOf = (store: View.LazyStore) =>
  (store.lazy as View.Lazies).entries.size

describe("h.lazy's entries", () => {
  it("are dropped once the stale ones are as many as the used ones", () => {
    const store: View.LazyStore = { lazy: undefined }
    let rows: ReadonlyArray<Row> = Array.from(
      { length: 10 },
      (_, id) => ({ id })
    )
    const first = render(store, rows)
    assert.strictEqual(sizeOf(store), 10)
    // Each render replaces one row: its old entry stays, up to 10 stale ones.
    for (let round = 1; round <= 9; round++) {
      rows = rows.map((item, index) => index === round ? { id: item.id } : item)
      render(store, rows)
      assert.strictEqual(sizeOf(store), 10 + round)
    }
    rows = rows.map((item, index) => index === 0 ? { id: item.id } : item)
    render(store, rows)
    assert.strictEqual(sizeOf(store), 10)
    // A row that wasn't replaced keeps its node.
    const again = render(store, rows)
    assert.strictEqual(again[5], render(store, rows)[5])
    assert.notStrictEqual(again[0], first[0])
  })

  it("of a list replaced whole are dropped at once", () => {
    const store: View.LazyStore = { lazy: undefined }
    render(store, Array.from({ length: 10 }, (_, id) => ({ id })))
    render(store, Array.from({ length: 10 }, (_, id) => ({ id: id + 10 })))
    assert.strictEqual(sizeOf(store), 10)
    render(store, [])
    assert.strictEqual(sizeOf(store), 0)
  })
})
