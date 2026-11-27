# js-framework-benchmark

Effect UI and Foldkit 0.x next to React, Vue, Svelte, Solid and vanilla JS on [krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), the keyed table benchmark that most UI frameworks publish numbers for.

The harness already has entries for Foldkit and the other frameworks. `effect-ui/` is the entry for Effect UI. It isn't in the harness, and it doesn't need `@effect/ui` on npm: `run.sh` builds `packages/ui` from this checkout, packs it the way `pnpm publish` would, and installs the tarball. The version in the results is the commit.

## Results

Measured on 2026-11-26 with harness revision [`0f4e789`](https://github.com/krausest/js-framework-benchmark/tree/0f4e78932bf85ed60b163b801bbdbd720fdda54f), headless Chromium 153.0.8010.52, Node 26.13 and Linux 6.18, on a shared Azure VM with an AMD EPYC 7763 (16 vCPUs) and 62 GB of RAM. Effect UI is commit `6f86af8`.

There were two full runs of the harness's defaults: 15 iterations of each CPU benchmark and one of each memory and size benchmark. The first run went through the frameworks in the order of the tables and the second in reverse, because other jobs share the VM. The load average when each framework started is in `results/*/load.txt`: below 9 through the first run, and in the second 27 when Solid started and below 2 from React on. An earlier first run started at a load average of 36, which about doubled vanilla JS's and Effect UI's script times, so it was discarded and repeated.

Each cell is the median of both runs' values pooled. Lower is better everywhere.

| CPU, total (ms)       | vanillajs | effect-ui |  foldkit | react-hooks |      vue |   svelte |    solid |
| --------------------- | --------: | --------: | -------: | ----------: | -------: | -------: | -------: |
| create 1,000 rows     |       101 |       120 |      140 |         121 |      120 |      108 |      106 |
| replace 1,000 rows    |       110 |       129 |      162 |         140 |      132 |      120 |      122 |
| update every 10th row |      41.9 |      63.6 |     68.6 |        61.0 |     55.2 |     48.4 |     47.2 |
| select row            |       8.9 |      15.6 |     19.3 |        17.6 |     12.3 |     17.0 |     11.4 |
| swap rows             |      50.5 |      61.7 |     60.0 |         487 |     59.9 |     63.0 |     64.2 |
| remove row            |      46.2 |      51.3 |     47.7 |        51.8 |     55.9 |     48.5 |     48.6 |
| create 10,000 rows    |      1130 |      1280 |     1486 |        1538 |     1320 |     1201 |     1198 |
| append 1,000 rows     |       113 |       132 |      156 |         134 |      131 |      129 |      121 |
| clear 1,000 rows      |      35.4 |      44.9 |     62.8 |        69.5 |     51.3 |     41.1 |     45.1 |
| **vs vanilla**        |  **1.00** |  **1.27** | **1.45** |    **1.75** | **1.25** | **1.19** | **1.14** |

| CPU, script (ms)      | vanillajs | effect-ui | foldkit | react-hooks |  vue | svelte | solid |
| --------------------- | --------: | --------: | ------: | ----------: | ---: | -----: | ----: |
| create 1,000 rows     |       6.9 |      23.3 |    41.6 |        23.6 | 22.9 |   11.5 |  10.1 |
| replace 1,000 rows    |      15.4 |      32.0 |    55.5 |        41.3 | 33.3 |   22.6 |  21.3 |
| update every 10th row |       1.1 |      16.1 |    24.0 |        12.9 |  7.3 |    3.4 |   2.8 |
| select row            |       0.8 |       6.9 |    10.3 |         8.4 |  3.4 |    7.3 |   2.7 |
| swap rows             |       0.6 |       6.3 |     8.3 |        62.3 |  3.8 |    4.7 |   3.3 |
| remove row            |       1.0 |       3.1 |     4.1 |         3.6 |  8.5 |    1.7 |   1.1 |
| create 10,000 rows    |      68.8 |       181 |     399 |         422 |  203 |    101 |  93.7 |
| append 1,000 rows     |       7.3 |      25.2 |    43.4 |        25.7 | 22.3 |   12.7 |  10.6 |
| clear 1,000 rows      |      30.9 |      40.0 |    57.5 |        64.3 | 46.5 |   36.1 |  40.6 |

| Memory and size           | vanillajs | effect-ui | foldkit | react-hooks |  vue | svelte | solid |
| ------------------------- | --------: | --------: | ------: | ----------: | ---: | -----: | ----: |
| ready memory (MB)         |       0.6 |       1.2 |     2.3 |         1.2 |  0.9 |    0.7 |   0.6 |
| run memory (MB)           |       1.9 |       4.1 |     6.1 |         4.4 |  3.9 |    2.9 |   2.7 |
| create/clear 5 times (MB) |       0.7 |       1.6 |     2.8 |         2.0 |  1.2 |    1.0 |   0.8 |
| uncompressed size (kB)    |      11.3 |       172 |     303 |         190 | 64.3 |   26.6 |  11.5 |
| compressed size (kB)      |       2.5 |      52.8 |    87.0 |        51.4 | 23.3 |    9.7 |   4.5 |
| first paint (ms)          |      64.8 |       381 |     691 |         419 |  154 |    106 |  68.2 |

| vs vanilla (total), per run | vanillajs | effect-ui | foldkit | react-hooks |  vue | svelte | solid |
| --------------------------- | --------: | --------: | ------: | ----------: | ---: | -----: | ----: |
| results/pass1               |      1.00 |      1.26 |    1.45 |        1.74 | 1.23 |   1.14 |  1.09 |
| results/pass2               |      1.00 |      1.27 |    1.45 |        1.76 | 1.30 |   1.33 |  1.26 |

`vs vanilla` is the geometric mean, over the nine CPU benchmarks, of each framework's median total over vanilla JS's. It's unweighted, unlike the harness's own result page. Compare frameworks within a run, not the two runs with each other. Effect UI, Foldkit and React score about the same in both. Vue, Svelte and Solid score higher in the second, Solid and Svelte because they started it, when the load was highest.

`total` is the harness's duration from the click to the end of the next paint, read from the Chrome trace. On this VM, painting 1,000 rows takes about 100 ms whatever the framework, so the `script` table (the JavaScript that ran in that window) separates the frameworks better. Sizes and first paint are one sample per run, so treat them as rough. The harness slows the CPU down 4 times for update every 10th row, select row, swap rows and clear 1,000 rows, and 2 times for remove row, so those rows of the tables are 4 (or 2) times what the same work takes at full speed.

## What the results say

In script time, Effect UI is ahead of Foldkit 0.x on every operation. It runs less than half the JavaScript to create 10,000 rows (181 ms against 399 ms), uses a third less memory with 1,000 rows (4.1 MB against 6.1 MB), and its bundle is 53 kB compressed against Foldkit's 87 kB.

Effect UI is also ahead of React overall. React's 487 ms swap rows makes the gap look larger than it is. That's a known cost of how React moves keyed rows when two distant ones trade places. Without swap rows, `vs vanilla` is 1.27 for Effect UI and 1.41 for React. In script time, Effect UI is ahead on creating 10,000 rows (181 ms against 422 ms), replacing rows and clearing, level on creating and appending 1,000 rows, and behind on update every 10th row (16.1 ms against 12.9 ms). Svelte and Solid are ahead of both. Vue is level with Effect UI in total time (1.25 against 1.27) and ahead in script time.

The gap is widest on small updates. Updating every 10th row, selecting a row and swapping two rows cost Effect UI 6 to 16 ms of script with the CPU slowed down 4 times, about 1.5 to 4 ms at full speed. Vue, Svelte and Solid need about 3 to 7 ms slowed down. In Effect UI each message runs `update`, then the whole `view`, and `h.lazy` compares the arguments of all 1,000 rows to find the few that changed. Svelte and Solid track which DOM nodes depend on which state and write only those, so their cost follows the size of the change, not the size of the table. Creating rows is closer, since every framework has to build every row.

Effect UI's bundle, 53 kB compressed, is about the size of React's (51 kB). Foldkit's is the largest at 87 kB. These three bundles also have the slowest first paint: 381 ms for Effect UI, 419 ms for React and 691 ms for Foldkit, against 65 to 154 ms for vanilla JS, Vue, Svelte and Solid.

## What the workloads measure

| Benchmark                        | What happens                                                               |
| -------------------------------- | -------------------------------------------------------------------------- |
| create 1,000 rows                | 1,000 rows into an empty table, after 5 warm-up runs                       |
| replace 1,000 rows               | 1,000 new rows over 1,000 existing ones                                    |
| update every 10th row            | the label of every 10th row of 1,000 gets `!!!` appended (16 warm-up runs) |
| select row                       | a click on a row's label highlights it                                     |
| swap rows                        | rows 2 and 999 of 1,000 swap places                                        |
| remove row                       | a click removes one of 1,000 rows                                          |
| create 10,000 rows               | 10,000 rows into an empty table                                            |
| append 1,000 rows                | 1,000 rows after 1,000 existing ones                                       |
| clear 1,000 rows                 | all 1,000 rows removed                                                     |
| ready memory                     | JS heap after the page loads                                               |
| run memory                       | JS heap after creating 1,000 rows                                          |
| create/clear 5 times             | JS heap after creating and clearing 1,000 rows 5 times                     |
| uncompressed and compressed size | the JavaScript the page loads                                              |
| first paint                      | from navigation to the first paint                                         |

Every entry renders the same DOM, and the harness checks that each one is keyed: a row's DOM node follows its data when rows move or are removed. The Effect UI entry, like the Foldkit one, puts each row behind its lazy helper (`h.lazy` and `createKeyedLazy`), so a row whose data and selection haven't changed isn't built again.

## Versions

| Entry         | Package                | Version          |
| ------------- | ---------------------- | ---------------- |
| `effect-ui`   | `@effect/ui`, `effect` | `6f86af8`, 4.1.6 |
| `foldkit`     | `foldkit`, `effect`    | 0.171.0, 4.1.6   |
| `react-hooks` | `react`                | 19.2.0           |
| `vue`         | `vue`                  | 3.5.39           |
| `svelte`      | `svelte`               | 5.42.1           |
| `solid`       | `solid-js`             | 1.9.3            |
| `vanillajs`   |                        |                  |

The React, Vue, Svelte, Solid and vanilla JS entries are the harness's own, installed from its lockfiles. The Foldkit entry is the harness's too, moved from 0.170.0 to 0.171.0 and from Effect 4.1.0 to 4.1.6 so that both Effect frameworks use the same Effect.

## Reproducing

From the repository root, inside `nix develop`, with Chromium on `PATH` (or `$CHROMIUM` set):

```sh
pnpm install
packages/ui/benchmark/js-framework-benchmark/run.sh ../js-framework-benchmark
```

The argument is where the harness is cloned, outside this repository. `run.sh` clones the harness at the pinned revision with only the seven entries, installs it, builds and packs `@effect/ui`, builds every entry, starts the harness's server on port 8080, checks that every entry is keyed and runs the benchmarks one framework at a time. A run takes about an hour. `REVERSE=1` runs the frameworks in reverse order, as the second run did. Arguments after the directory go to the harness, for example `--count 3 --benchmark 01_ 07_` for a quick check.

For a quicker comparison while working on a change, `quick.mjs` runs the CPU benchmarks in the harness's protocol against the harness's server, set up as above: a fresh page per sample, the harness's warm-up steps and CPU slowdowns, and the script time read from a trace of the measured click. The entries alternate sample by sample, so a change can be compared with the commit before it, or with another framework, in a few minutes:

```sh
node packages/ui/benchmark/js-framework-benchmark/quick.mjs --samples 11 solid effect-ui effect-ui:index-before.html
```

`effect-ui:index-before.html` is a copy of the entry's `index.html` that loads another build of it. Its figures are close to the harness's but not the same, so report the harness's.

To summarize one or more runs:

```sh
node packages/ui/benchmark/js-framework-benchmark/summarize.mjs <results dir>...
```

## Files

| Path                             | What it is                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `effect-ui/`                     | the harness entry for Effect UI                                                                                                  |
| `run.sh`                         | sets up the harness and runs it                                                                                                  |
| `quick.mjs`                      | compares entries on the CPU benchmarks in the harness's protocol, in minutes                                                     |
| `summarize.mjs`                  | turns the harness's result files into the tables above                                                                           |
| `results/pass1`, `results/pass2` | the harness's raw result files from the two runs, with every iteration's value, and the load average when each framework started |
