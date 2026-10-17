#!/usr/bin/env bash
# run-round.sh <n> <grid>... : render, score and make a compare sheet for each grid, then the vote grid when there are 3 or more.
# Output goes to $H/round-<n>/ (H defaults to the rook-head temp folder). Orchestrator side only.
set -euo pipefail
if [ $# -lt 2 ]; then echo "usage: run-round.sh <n> <grid>..." >&2; exit 2; fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H="${H:-C:/Users/markh/AppData/Local/Temp/rook-head}"
n="$1"; shift
out="$H/round-$n"
mkdir -p "$out"
one() { # name grid
  local name="$1" grid="$2"
  [ "$grid" -ef "$out/$name.txt" ] || cp "$grid" "$out/$name.txt"
  node "$here/render.mjs" "$out/$name.txt" "$out/$name" > /dev/null
  node "$here/score.mjs" "$out/$name.txt" > "$out/$name-score.txt"
  node "$here/score.mjs" "$out/$name.txt" --json > "$out/$name-score.json"
  node "$here/gradesheet.mjs" compare "$out/$name.txt" "$out/$name-compare.png" > /dev/null
  node "$here/gradesheet.mjs" compare-blind "$out/$name.txt" "$out/$name-compare-blind.png" > /dev/null
  echo "$name: $(grep -m1 'exact match %, no shift' "$out/$name-score.txt")"
}
i=0
for g in "$@"; do
  i=$((i + 1))
  one "cand-$i" "$g"
done
if [ $# -ge 3 ]; then
  node "$here/vote.mjs" "$out/vote.txt" "$@" > /dev/null
  one vote "$out/vote.txt"
fi
echo "round $n written to $out"
