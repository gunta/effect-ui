#!/usr/bin/env bash
# Runs krausest/js-framework-benchmark for Effect UI (built from this checkout), Foldkit, React, Vue,
# Svelte, Solid and vanilla JS. See README.md.
#
# Run from the repository root, inside `nix develop` or on macOS:
#
#   packages/ui/benchmark/js-framework-benchmark/run.sh <dir> [--count <n>] [--benchmark <prefix>...]
#
# <dir> is where the harness is cloned, outside the repository. The browser is $CHROMIUM, else
# `chromium` on PATH. REVERSE=1 runs the frameworks in reverse order. INTERLEAVE=1 runs the
# harness's default benchmarks, or those given with --benchmark, one at a time, each for every
# framework in turn, alternating the order. Extra arguments go to each of the harness's
# `npm run bench`. Results and load.txt are written to <dir>/webdriver-ts/results and summarized
# by summarize.mjs.
set -euo pipefail

HARNESS_REV=0f4e78932bf85ed60b163b801bbdbd720fdda54f
FRAMEWORKS=(vanillajs effect-ui foldkit react-hooks vue svelte solid)

mkdir -p "$1"
dir=$(cd "$1" && pwd)
shift
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
chromium=$(readlink -f "${CHROMIUM:-$(command -v chromium)}")

if [ ! -d "$dir/.git" ]; then
  git clone --filter=blob:none --sparse https://github.com/krausest/js-framework-benchmark.git "$dir"
fi
cd "$dir"
git checkout --quiet "$HARNESS_REV"
sparse=('/*' '!/frameworks/')
for f in "${FRAMEWORKS[@]}"; do sparse+=("/frameworks/keyed/$f/"); done
git sparse-checkout set --no-cone "${sparse[@]}"

# The root package.json only holds lint tools, whose peer ranges conflict.
npm ci --legacy-peer-deps
(cd server && npm ci)
(cd webdriver-ts && npm ci && npm run compile)
(cd webdriver-ts-results && npm ci)

# Effect UI: a tarball of packages/ui as `pnpm publish` would pack it, versioned with the commit.
(cd "$repo" && pnpm build)
entry="$dir/frameworks/keyed/effect-ui"
rm -rf "$entry" && mkdir -p "$entry"
cp -r "$here/effect-ui/." "$entry/"
(cd "$repo/packages/ui" && pnpm pack --pack-destination "$entry")
version="0.0.0-$(git -C "$repo" rev-parse --short=7 HEAD)"
(cd "$entry" && node -e '
  const fs = require("node:fs")
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  pkg["js-framework-benchmark"].frameworkVersion = process.argv[1]
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
' "$version")

# Foldkit: the harness entry, moved to the latest Foldkit and the Effect that Effect UI uses.
effect=$(node -p 'require(process.argv[1]).dependencies.effect' "$entry/package.json")
(cd frameworks/keyed/foldkit && npm install --save-exact foldkit@0.171.0 "effect@$effect" "@effect/platform-browser@$effect")

for f in "${FRAMEWORKS[@]}"; do
  (cd "frameworks/keyed/$f" && if [ "$f" = effect-ui ]; then npm install; else npm ci; fi && npm run build-prod)
done

# In its own process group, so that stopping it stops npm's children too. Job control gives a
# background job a group of its own, where Linux's setsid would but macOS has none.
set -m
(cd server && exec npm start) &
server=$!
set +m
trap 'kill -- -$server' EXIT
until curl -sf localhost:8080/ls > /dev/null; do sleep 1; done

cd webdriver-ts
npm run isKeyed -- --headless --chromeBinary "$chromium" "${FRAMEWORKS[@]/#/keyed/}"
rm -rf results && mkdir results
# Without mapfile or tac, which macOS's bash 3.2 and BSD tools lack.
backward=()
for ((i = ${#FRAMEWORKS[@]} - 1; i >= 0; i--)); do backward+=("${FRAMEWORKS[$i]}"); done
if [ "${REVERSE:-}" = 1 ]; then
  order=("${backward[@]}")
  against=("${FRAMEWORKS[@]}")
else
  order=("${FRAMEWORKS[@]}")
  against=("${backward[@]}")
fi
loadavg() {
  if [ -r /proc/loadavg ]; then cut -d' ' -f1-3 /proc/loadavg; else sysctl -n vm.loadavg | tr -d '{}' | xargs; fi
}
load() { echo "$1 $(date -u +%FT%TZ) $(loadavg)" >> results/load.txt; }
bench() { npm run bench -- --headless --chromeBinary "$chromium" "$@"; }
if [ "${INTERLEAVE:-}" = 1 ]; then
  # The prefixes given with --benchmark are run one at a time, and the other arguments go to every
  # run: passed on as well, they'd select those benchmarks in every run, which would write over
  # each other's results.
  benchmarks=()
  rest=()
  taking=0
  for arg in "$@"; do
    case "$arg" in
      --benchmark) taking=1 ;;
      --benchmark=*) benchmarks+=("${arg#--benchmark=}") ;;
      --*) taking=0; rest+=("$arg") ;;
      *) if [ "$taking" = 1 ]; then benchmarks+=("$arg"); else rest+=("$arg"); fi ;;
    esac
  done
  # Else the harness's default benchmarks; 40_ is the one that measures sizes and first paint.
  if [ ${#benchmarks[@]} -eq 0 ]; then
    benchmarks=(01_ 02_ 03_ 04_ 05_ 06_ 07_ 08_ 09_ 21_ 22_ 25_ 40_)
  fi
  # Benchmark by benchmark, every framework in turn, the order reversed from one benchmark to the
  # next: a busy stretch of a shared machine then falls on every framework's runs of a benchmark
  # within minutes, not on one framework's whole run. `${rest[@]+...}`: bash 3.2 takes an empty
  # array as unset.
  turn=0
  for b in "${benchmarks[@]}"; do
    if ((turn % 2 == 0)); then frameworks=("${order[@]}"); else frameworks=("${against[@]}"); fi
    for f in "${frameworks[@]}"; do
      load "$f $b start"
      bench ${rest[@]+"${rest[@]}"} --benchmark "$b" --framework "keyed/$f"
    done
    turn=$((turn + 1))
  done
else
  # One framework at a time: given several, the harness sorts them by name.
  for f in "${order[@]}"; do
    load "$f start"
    bench "$@" --framework "keyed/$f"
  done
fi
load end
node "$here/summarize.mjs" results
