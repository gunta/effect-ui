// A quick A/B of harness entries in the harness's own protocol, for iterating on a change: minutes
// where a run of the harness takes an hour.
//
//   node packages/ui/benchmark/js-framework-benchmark/quick.mjs [--samples 11] [--ops select,swap]
//     [--chromium <path>] <entry[:page]>...
//
// An entry is a directory of the harness's frameworks/keyed, served by its server on port 8080 (run.sh
// sets both up), and `page` an HTML file in it other than index.html, such as a copy pointing at
// another build. Each sample opens a fresh page, runs the harness's init steps for the operation with
// its CPU slowdown, and traces the one measured click as the harness does: with V8's sampling
// profiler on, after a forced garbage collection, which sends code back to its unoptimized tiers. `script` is the time in the harness's
// JavaScript events from the click to the end of the next commit, `total` the time to that commit.
// The entries alternate sample by sample, so drift on the machine reaches them all alike. Each cell
// is the median of the samples, `script / total` in milliseconds.
//
// The browser is `--chromium`, else `$CHROMIUM`, else `chromium` on PATH, else the Chromium that the
// `playwright` dev dependency installed.
import { execSync } from "node:child_process"
import { parseArgs } from "node:util"
import { chromium } from "playwright"

const { positionals: entries, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    samples: { type: "string", default: "11" },
    ops: { type: "string" },
    chromium: { type: "string" }
  }
})
if (entries.length === 0) {
  console.error("usage: quick.mjs [--samples n] [--ops a,b] <entry[:page]>...")
  process.exit(1)
}

const which = () => {
  try {
    return execSync("which chromium", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || undefined
  } catch {
    return undefined
  }
}
const browser = await chromium.launch({
  executablePath: args.chromium ?? process.env.CHROMIUM ?? which(),
  headless: true,
  args: ["--js-flags=--expose-gc"]
})

const has = (page, selector, text) =>
  page.waitForFunction(
    ([s, t]) => {
      const element = document.querySelector(s)
      return element !== null &&
        (t === undefined || element.textContent.includes(t))
    },
    [selector, text],
    { polling: "raf" }
  )
const gone = (page, selector) =>
  page.waitForFunction((s) => document.querySelector(s) === null, selector, {
    polling: "raf"
  })
const cell = (row, td) => `tbody>tr:nth-of-type(${row})>td:nth-of-type(${td})`
const createAndClear = async (page, times) => {
  for (let i = 0; i < times; i++) {
    await page.click("#run")
    await has(page, cell(1, 1), String(i * 1000 + 1))
    await page.click("#clear")
    await gone(page, cell(1000, 1))
  }
}

// The harness's init and measured steps (webdriver-ts/src/benchmarksPuppeteer.ts), and its CPU
// slowdowns (benchmarksCommon.ts).
const operations = {
  create1k: {
    init: (page) => createAndClear(page, 5),
    run: "#run",
    done: (page) => has(page, cell(1000, 1), "6000")
  },
  replace1k: {
    init: async (page) => {
      for (let i = 0; i < 5; i++) {
        await page.click("#run")
        await has(page, cell(1, 1), String(i * 1000 + 1))
      }
    },
    run: "#run",
    done: (page) => has(page, cell(1, 1), "5001")
  },
  update10th: {
    slowdown: 4,
    init: async (page) => {
      await page.click("#run")
      await has(page, cell(1000, 1))
      for (let i = 0; i < 3; i++) {
        await page.click("#update")
        await has(page, cell(991, 2) + ">a", " !!!".repeat(i + 1))
      }
    },
    run: "#update",
    done: (page) => has(page, cell(991, 2) + ">a", " !!!".repeat(4))
  },
  select: {
    slowdown: 4,
    init: async (page) => {
      await page.click("#run")
      await has(page, cell(1000, 1))
      await page.click(cell(5, 2) + ">a")
      await has(page, "tbody>tr.danger")
    },
    run: cell(2, 2) + ">a",
    done: (page) => has(page, "tbody>tr:nth-of-type(2).danger")
  },
  swap: {
    slowdown: 4,
    init: async (page) => {
      await page.click("#run")
      await has(page, cell(1000, 1))
      for (let i = 0; i <= 5; i++) {
        await page.click("#swaprows")
        await has(page, cell(999, 1), i % 2 === 0 ? "2" : "999")
      }
    },
    run: "#swaprows",
    done: (page) => has(page, cell(999, 1), "2")
  },
  remove: {
    slowdown: 2,
    init: async (page) => {
      await page.click("#run")
      await has(page, cell(1000, 1))
      for (let i = 0; i < 5; i++) {
        const row = 5 - i + 4
        await page.click(cell(row, 3) + ">a>span")
        await has(page, cell(row, 1), "10")
      }
      await page.click(cell(6, 3) + ">a>span")
      await has(page, cell(6, 1), "12")
    },
    run: cell(4, 3) + ">a>span",
    done: (page) => has(page, cell(4, 1), "10")
  },
  create10k: {
    init: (page) => createAndClear(page, 5),
    run: "#runlots",
    done: (page) => has(page, cell(10000, 2))
  },
  append1k: {
    init: async (page) => {
      await createAndClear(page, 5)
      await page.click("#run")
      await has(page, cell(1000, 1))
    },
    run: "#add",
    done: (page) => has(page, cell(2000, 1))
  },
  clear1k: {
    slowdown: 4,
    init: async (page) => {
      await createAndClear(page, 5)
      await page.click("#run")
      await has(page, cell(1, 1))
    },
    run: "#clear",
    done: (page) => gone(page, cell(1000, 1))
  }
}

// The events the harness counts as script (webdriver-ts/src/timeline.ts).
const scriptEvents = new Set([
  "EventDispatch",
  "EvaluateScript",
  "v8.evaluateModule",
  "FunctionCall",
  "TimerFire",
  "FireIdleCallback",
  "FireAnimationFrame",
  "RunMicrotasks",
  "V8.Execute"
])

const sample = async (entry, name) => {
  const [directory, file = "index.html"] = entry.split(":")
  const operation = operations[name]
  const page = await browser.newPage()
  await page.goto(`http://localhost:8080/frameworks/keyed/${directory}/${file}`)
  await page.waitForSelector("#run")
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: operation.slowdown ?? 1
  })
  await operation.init(page)
  await page.waitForTimeout(50)
  await browser.startTracing(page, {
    categories: [
      "disabled-by-default-v8.cpu_profiler",
      "blink.user_timing",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline"
    ]
  })
  await page.waitForTimeout(50)
  await page.evaluate(() => globalThis.gc())
  await page.click(operation.run)
  await operation.done(page)
  await page.waitForTimeout(50)
  const events = JSON.parse((await browser.stopTracing()).toString())
    .traceEvents
  await page.close()
  const click = events.find((event) =>
    event.name === "EventDispatch" && event.args?.data?.type === "click"
  )
  const commit = events.find((event) =>
    event.name === "Commit" && event.ph === "X" && event.ts > click.ts
  )
  const end = commit === undefined
    ? click.ts + click.dur
    : commit.ts + commit.dur
  // Nested events overlap their parents: each moment is counted once.
  let script = 0
  let until = 0
  for (
    const event of events.filter((event) =>
      event.ph === "X" && event.pid === click.pid &&
      scriptEvents.has(event.name) && event.ts >= click.ts && event.ts <= end
    ).sort((a, b) => a.ts - b.ts)
  ) {
    const from = Math.max(event.ts, until)
    const to = event.ts + event.dur
    if (to > from) {
      script += to - from
      until = to
    }
  }
  return { script: script / 1000, total: (end - click.ts) / 1000 }
}

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const samples = Number(args.samples)
console.log(
  "operation".padEnd(12) + entries.map((entry) => entry.padStart(24)).join("")
)
for (const name of args.ops?.split(",") ?? Object.keys(operations)) {
  const results = new Map(entries.map((entry) => [entry, []]))
  for (let i = 0; i < samples; i++) {
    for (const entry of i % 2 === 0 ? entries : [...entries].reverse()) {
      results.get(entry).push(await sample(entry, name))
    }
  }
  console.log(
    name.padEnd(12) + entries.map((entry) => {
      const runs = results.get(entry)
      return (median(runs.map((run) => run.script)).toFixed(2) + " / " +
        median(runs.map((run) => run.total)).toFixed(1)).padStart(24)
    }).join("")
  )
}
await browser.close()
