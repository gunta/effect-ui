// Summarizes js-framework-benchmark result files as Markdown tables, and draws them as charts.
//
//   node packages/ui/benchmark/js-framework-benchmark/summarize.mjs [--charts <dir>] <results dir>...
//
// Each directory is one run of the harness (webdriver-ts/results). The values of every run are
// pooled: a cell is the median of all of them. CPU times come from the trace, in milliseconds:
// `total` from the click to the end of paint, and `script` the part of it spent running JavaScript.
// Memory is the JS heap in MB; sizes are kB. `vs vanilla` is the geometric mean, over the nine CPU
// benchmarks, of each framework's median over vanillajs's: unweighted, unlike the harness's own
// result table.
//
// With `--charts`, the results are also drawn as SVG files in that directory, each in a light and a
// dark version for the README's <picture> elements: `summary-*.svg`, every framework's script
// `vs vanilla`, `script-*.svg`, every framework's script time on each benchmark, and `load-*.svg`,
// first paint, compressed size and memory.
import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"

const { positionals: dirs, values: options } = parseArgs({
  allowPositionals: true,
  options: { charts: { type: "string" } }
})
if (dirs.length === 0) {
  console.error("usage: summarize.mjs [--charts <dir>] <results dir>...")
  process.exit(1)
}

const order = [
  "vanillajs",
  "effect-ui",
  "foldkit",
  "react-hooks",
  "vue",
  "svelte",
  "solid"
]
const cpuLabels = {
  "01_run1k": "create 1,000 rows",
  "02_replace1k": "replace 1,000 rows",
  "03_update10th1k_x16": "update every 10th row",
  "04_select1k": "select row",
  "05_swap1k": "swap rows",
  "06_remove-one-1k": "remove row",
  "07_create10k": "create 10,000 rows",
  "08_create1k-after1k_x2": "append 1,000 rows",
  "09_clear1k_x8": "clear 1,000 rows"
}
const otherLabels = {
  "21_ready-memory": "ready memory (MB)",
  "22_run-memory": "run memory (MB)",
  "25_run-clear-memory": "create/clear 5 times (MB)",
  "41_size-uncompressed": "uncompressed size (kB)",
  "42_size-compressed": "compressed size (kB)",
  "43_first-paint": "first paint (ms)"
}

// key ("total" | "script" | "DEFAULT") -> benchmark -> framework -> values, pooled and per run
const pooled = new Map()
const runs = dirs.map(() => new Map())
const versions = new Map()
const add = (map, key, benchmark, framework, data) => {
  if (!map.has(key)) map.set(key, new Map())
  const byBenchmark = map.get(key)
  if (!byBenchmark.has(benchmark)) byBenchmark.set(benchmark, new Map())
  const byFramework = byBenchmark.get(benchmark)
  byFramework.set(framework, [...(byFramework.get(framework) ?? []), ...data])
}
dirs.forEach((dir, i) => {
  for (
    const file of fs.readdirSync(dir).filter((file) => file.endsWith(".json"))
  ) {
    const result = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
    const framework = order.find((f) =>
      result.framework === f + "-keyed" || result.framework.startsWith(f + "-v")
    )
    if (framework === undefined) continue
    versions.set(framework, result.framework)
    for (const [key, { values }] of Object.entries(result.values)) {
      add(pooled, key, result.benchmark, framework, values)
      add(runs[i], key, result.benchmark, framework, values)
    }
  }
})

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const frameworks = order.filter((f) => versions.has(f))
const cell = (map, key, benchmark, framework) => {
  const xs = map.get(key)?.get(benchmark)?.get(framework)
  return xs === undefined ? undefined : median(xs)
}
const format = (x) =>
  x === undefined || Number.isNaN(x)
    ? ""
    : x >= 100
    ? x.toFixed(0)
    : x.toFixed(1)
const multiples = (map, key) =>
  frameworks.map((f) => {
    const ratios = Object.keys(cpuLabels).map((b) =>
      cell(map, key, b, f) / cell(map, key, b, "vanillajs")
    )
    return Math.exp(
      ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length
    )
  })
const vsVanilla = (map, key) =>
  multiples(map, key).map((x) => Number.isNaN(x) ? "" : x.toFixed(2))
const row = (cells) => "| " + cells.join(" | ") + " |"
const header = (
  title
) => [
  row([title, ...frameworks]),
  row(["---", ...frameworks.map(() => "---:")])
]

for (const key of ["total", "script"]) {
  console.log(
    [
      ...header(`CPU, ${key} (ms)`),
      ...Object.entries(cpuLabels).map(([b, label]) =>
        row([label, ...frameworks.map((f) => format(cell(pooled, key, b, f)))])
      ),
      row([
        "**vs vanilla**",
        ...vsVanilla(pooled, key).map((x) => x && `**${x}**`)
      ])
    ].join("\n") + "\n"
  )
}
console.log(
  [
    ...header("Memory and size"),
    ...Object.entries(otherLabels).map(([b, label]) =>
      row([
        label,
        ...frameworks.map((f) => format(cell(pooled, "DEFAULT", b, f)))
      ])
    )
  ].join("\n") + "\n"
)
if (dirs.length > 1) {
  for (const key of ["script", "total"]) {
    console.log(
      [
        ...header(`vs vanilla (${key}), per run`),
        ...runs.map((run, i) => row([dirs[i], ...vsVanilla(run, key)]))
      ].join("\n") + "\n"
    )
  }
}
console.log("Versions: " + frameworks.map((f) => versions.get(f)).join(", "))

if (options.charts !== undefined) {
  const names = {
    vanillajs: "Vanilla JS",
    "effect-ui": "Effect UI",
    foldkit: "Foldkit 0.x",
    "react-hooks": "React",
    vue: "Vue",
    svelte: "Svelte",
    solid: "Solid"
  }
  const slowdowns = {
    "03_update10th1k_x16": 4,
    "04_select1k": 4,
    "05_swap1k": 4,
    "06_remove-one-1k": 2,
    "09_clear1k_x8": 4
  }
  // GitHub's text colors on its light and dark page. Effect UI's bars are blue and the others gray:
  // both clear 3:1 against the page, and each bar is named, so color isn't the only cue.
  const themes = {
    light: {
      text: "#1f2328",
      muted: "#59636e",
      rule: "#d1d9e0",
      ours: "#257de0",
      theirs: "#818b98"
    },
    dark: {
      text: "#f0f6fc",
      muted: "#9198a1",
      rule: "#3d444d",
      ours: "#338ced",
      theirs: "#6e7681"
    }
  }
  const n = (x) => Number(x.toFixed(1))
  // A cell or a multiple that a result is missing for: drawn as no bar, labelled "–".
  const known = (x) => x !== undefined && !Number.isNaN(x)
  const largest = (xs) => Math.max(...xs.filter(known))
  const text = (x, y, content, attributes = "") =>
    `<text x="${n(x)}" y="${n(y)}" ${attributes}>${content}</text>`
  // A bar from the baseline, rounded at its far end.
  const bar = (x, y, width, height, fill) => {
    const w = Math.max(width, 1)
    const r = Math.min(3, w / 2, height / 2)
    return `<path d="M${n(x)} ${n(y)}h${n(w - r)}a${n(r)} ${n(r)} 0 0 1 ${
      n(r)
    } ${n(r)}v${n(height - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}h${
      n(r - w)
    }z" fill="${fill}"/>`
  }
  const svg = (width, height, title, theme, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif" font-size="12" fill="${theme.muted}">
${body.join("\n")}
</g>
</svg>
`
  const heading = (theme, title, subtitle) => [
    text(0, 18, title, `font-size="15" font-weight="600" fill="${theme.text}"`),
    text(0, 38, subtitle)
  ]
  const axisLine = (theme, x, y1, y2) =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${theme.rule}"/>`
  // A framework's row of a chart whose axis is at `axis`: its name before the axis, `gap` + 2 away,
  // its bar, `value` of `max` over `plot`, and the value `gap` after the bar, as `show` writes it.
  // `font` is the row's font size attribute, if not the chart's.
  const barRow = (
    theme,
    { f, value, max, plot, axis, middle, barHeight, gap, font, show }
  ) => {
    const ours = f === "effect-ui"
    const length = known(value) ? (value / max) * plot : 0
    const weight = ours ? ` font-weight="600" fill="${theme.text}"` : ""
    return [
      text(
        axis - gap - 2,
        middle + 4,
        names[f],
        `${font === "" ? "" : font + " "}text-anchor="end"${weight}`
      ),
      ...(known(value)
        ? [bar(
          axis,
          middle - barHeight / 2,
          length,
          barHeight,
          ours ? theme.ours : theme.theirs
        )]
        : []),
      text(
        axis + length + gap,
        middle + 4,
        known(value) ? show(value) : "–",
        `${font}${weight}`
      )
    ]
  }

  const summary = (theme) => {
    const values = multiples(pooled, "script")
    // Frameworks missing a result go last.
    const entries = frameworks.map((f, i) => ({ f, x: values[i] }))
      .sort((a, b) =>
        known(a.x) && known(b.x)
          ? a.x - b.x
          : known(a.x)
          ? -1
          : known(b.x)
          ? 1
          : 0
      )
    const width = 640
    const top = 58
    const rowHeight = 28
    const barHeight = 12
    const labelWidth = 104
    const plot = width - labelWidth - 56
    const max = largest(values)
    const title = "JavaScript time as a multiple of vanilla JS"
    return svg(
      width,
      top + entries.length * rowHeight,
      title,
      theme,
      [
        ...heading(
          theme,
          title,
          "Geometric mean of the median script time on the nine CPU benchmarks. Shorter is faster."
        ),
        axisLine(theme, labelWidth, top, top + entries.length * rowHeight - 8),
        ...entries.flatMap(({ f, x }, i) =>
          barRow(theme, {
            f,
            value: x,
            max,
            plot,
            axis: labelWidth,
            middle: top + i * rowHeight + rowHeight / 2 - 4,
            barHeight,
            gap: 8,
            font: "",
            show: (x) => `${x.toFixed(2)}×`
          })
        )
      ]
    )
  }

  // One small bar chart per benchmark, each on its own scale: `entries` are the benchmarks, with a
  // label and an optional note after it, and `key` which of a result's values to draw.
  const panels = (theme, { title, subtitle, columns, key, entries }) => {
    const panelWidth = 284
    const gutter = 24
    const top = 62
    const titleHeight = 24
    const rowHeight = 17
    const barHeight = 9
    const labelWidth = 74
    const plot = panelWidth - labelWidth - 44
    const panelHeight = titleHeight + frameworks.length * rowHeight + 24
    const width = columns * panelWidth + (columns - 1) * gutter
    return svg(
      width,
      top + Math.ceil(entries.length / columns) * panelHeight - 24,
      title,
      theme,
      [
        ...heading(theme, title, subtitle),
        ...entries.flatMap(({ benchmark: b, label, note }, k) => {
          const x0 = (k % columns) * (panelWidth + gutter)
          const y0 = top + Math.floor(k / columns) * panelHeight
          const values = frameworks.map((f) => cell(pooled, key, b, f))
          const max = largest(values)
          return [
            text(
              x0,
              y0 + 12,
              label +
                (note === undefined
                  ? ""
                  : `<tspan font-weight="400" fill="${theme.muted}"> · ${note}</tspan>`),
              `font-size="13" font-weight="600" fill="${theme.text}"`
            ),
            axisLine(
              theme,
              x0 + labelWidth,
              y0 + titleHeight - 2,
              y0 + titleHeight + frameworks.length * rowHeight - 2
            ),
            ...frameworks.flatMap((f, i) =>
              barRow(theme, {
                f,
                value: values[i],
                max,
                plot,
                axis: x0 + labelWidth,
                middle: y0 + titleHeight + i * rowHeight + rowHeight / 2 - 2,
                barHeight,
                gap: 6,
                font: `font-size="11"`,
                show: format
              })
            )
          ]
        })
      ]
    )
  }

  const perBenchmark = (theme) =>
    panels(theme, {
      title: "JavaScript time on each benchmark, in milliseconds",
      subtitle:
        "Median script time. Each benchmark has its own scale. Shorter is faster.",
      columns: 3,
      key: "script",
      entries: Object.entries(cpuLabels).map(([benchmark, label]) => ({
        benchmark,
        label: label[0].toUpperCase() + label.slice(1),
        note: slowdowns[benchmark] === undefined
          ? undefined
          : `${slowdowns[benchmark]}× CPU slowdown`
      }))
    })

  const load = (theme) =>
    panels(theme, {
      title: "Page load and memory",
      subtitle:
        "Median of the samples. Each panel has its own scale. Shorter is better.",
      columns: 2,
      key: "DEFAULT",
      entries: [
        { benchmark: "43_first-paint", label: "First paint", note: "ms" },
        {
          benchmark: "42_size-compressed",
          label: "Compressed size",
          note: "kB"
        },
        {
          benchmark: "21_ready-memory",
          label: "Memory after load",
          note: "MB"
        },
        {
          benchmark: "22_run-memory",
          label: "Memory with 1,000 rows",
          note: "MB"
        }
      ]
    })

  fs.mkdirSync(options.charts, { recursive: true })
  const charts = { summary, script: perBenchmark, load }
  for (const [name, theme] of Object.entries(themes)) {
    for (const [chart, draw] of Object.entries(charts)) {
      fs.writeFileSync(
        path.join(options.charts, `${chart}-${name}.svg`),
        draw(theme)
      )
    }
  }
}
