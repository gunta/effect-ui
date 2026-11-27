export const frameworks = [
  "vanillajs",
  "effect-ui",
  "foldkit",
  "react-hooks",
  "vue",
  "svelte",
  "solid"
] as const
export type Framework = typeof frameworks[number]

// The order the tables show them in: the baseline, then Effect UI
// beside the two a reader is likeliest to compare it with.
export const columns: ReadonlyArray<Framework> = [
  "vanillajs",
  "effect-ui",
  "react-hooks",
  "foldkit",
  "vue",
  "svelte",
  "solid"
]

export const names: Record<Framework, string> = {
  vanillajs: "Vanilla JS",
  "effect-ui": "Effect UI",
  foldkit: "Foldkit 0.x",
  "react-hooks": "React",
  vue: "Vue",
  svelte: "Svelte",
  solid: "Solid"
}

export interface Row {
  readonly benchmark: string
  readonly label: string
  readonly unit: "ms" | "MB" | "kB"
  readonly slowdown?: number
  readonly values: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ]
}

export const script: ReadonlyArray<Row> = [
  {
    benchmark: "01_run1k",
    label: "Create 1,000 rows",
    unit: "ms",
    values: [1.2, 1.5, 11.9, 6.7, 5.4, 3.7, 2.7]
  },
  {
    benchmark: "02_replace1k",
    label: "Replace 1,000 rows",
    unit: "ms",
    values: [3.3, 4.5, 13.8, 11.3, 8.0, 6.2, 5.9]
  },
  {
    benchmark: "03_update10th1k_x16",
    label: "Update every 10th row",
    unit: "ms",
    slowdown: 4,
    values: [0.9, 1.7, 11.1, 6.2, 3.1, 2.6, 1.7]
  },
  {
    benchmark: "04_select1k",
    label: "Select a row",
    unit: "ms",
    slowdown: 4,
    values: [0.2, 0.9, 4.6, 4.2, 1.8, 3.7, 1.2]
  },
  {
    benchmark: "05_swap1k",
    label: "Swap two rows",
    unit: "ms",
    slowdown: 4,
    values: [0.6, 1.0, 4.0, 22.1, 2.2, 2.4, 1.5]
  },
  {
    benchmark: "06_remove-one-1k",
    label: "Remove a row",
    unit: "ms",
    slowdown: 2,
    values: [0.6, 0.5, 1.8, 1.8, 3.2, 1.1, 0.6]
  },
  {
    benchmark: "07_create10k",
    label: "Create 10,000 rows",
    unit: "ms",
    values: [12.4, 19.1, 98.9, 147, 42.2, 27.6, 24.4]
  },
  {
    benchmark: "08_create1k-after1k_x2",
    label: "Append 1,000 rows",
    unit: "ms",
    values: [1.5, 2.1, 10.8, 6.8, 5.0, 3.1, 3.0]
  },
  {
    benchmark: "09_clear1k_x8",
    label: "Clear 1,000 rows",
    unit: "ms",
    slowdown: 4,
    values: [8.5, 8.3, 16.9, 18.3, 12.7, 10.1, 9.4]
  }
]

export const load: ReadonlyArray<Row> = [
  {
    benchmark: "42_size-compressed",
    label: "Compressed size",
    unit: "kB",
    values: [2.5, 59.2, 87.0, 51.4, 23.3, 9.7, 4.5]
  },
  {
    benchmark: "43_first-paint",
    label: "First paint",
    unit: "ms",
    values: [56.7, 243, 379, 211, 97.5, 46.1, 53.0]
  },
  {
    benchmark: "21_ready-memory",
    label: "Memory after load",
    unit: "MB",
    values: [0.6, 1.3, 2.3, 1.2, 0.9, 0.7, 0.6]
  },
  {
    benchmark: "22_run-memory",
    label: "Memory with 1,000 rows",
    unit: "MB",
    values: [1.9, 3.0, 6.1, 4.4, 3.8, 2.8, 2.6]
  }
]

export const value = (row: Row, framework: Framework): number =>
  row.values[frameworks.indexOf(framework)]!

export interface Summary {
  readonly framework: Framework
  readonly multiple: number
}

export const summary: ReadonlyArray<Summary> = frameworks.map((
  framework
) => ({
  framework,
  multiple: Math.exp(
    script.reduce(
      (sum, row) =>
        sum +
        Math.log(value(row, framework) / value(row, "vanillajs")),
      0
    ) / script.length
  )
})).sort((a, b) => a.multiple - b.multiple)

export const format = (x: number): string =>
  x >= 100 ? x.toFixed(0) : x.toFixed(1)

const repo = "https://github.com/Effect-TS/ui"
const dir = "main/packages/ui/benchmark/js-framework-benchmark"

export const links = {
  methodology: `${repo}/blob/${dir}/README.md`,
  data: `${repo}/tree/${dir}/results`
}
