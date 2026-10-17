#!/usr/bin/env bash
# One full run: render twice into two scratch dirs, compare every PNG hash (exit line 5), run the checkers, write the sheets.
#   scripts/art/rook3d/run.sh <scratch dir> [out dir, default docs/spikes/rook-3d/out]
set -euo pipefail
cd "$(dirname "$0")/../../.."
scratch="${1:?scratch dir}"
out="${2:-docs/spikes/rook-3d/out}"
mkdir -p "$scratch"
rm -rf "$scratch/a" "$scratch/b"
for r in a b; do
  blender --background --factory-startup --python scripts/art/rook3d/render.py -- --out "$scratch/$r" > "$scratch/render-$r.log" 2>&1
done
( cd "$scratch/a" && find . -type f \( -name '*.png' -o -name '*.json' \) | sort | xargs sha256sum ) > "$scratch/a.sha"
( cd "$scratch/b" && find . -type f \( -name '*.png' -o -name '*.json' \) | sort | xargs sha256sum ) > "$scratch/b.sha"
if diff -q "$scratch/a.sha" "$scratch/b.sha" > /dev/null; then
  echo "determinism: identical, $(wc -l < "$scratch/a.sha") files (png and json), sha256 of the list $(sha256sum "$scratch/a.sha" | cut -c1-16)"
else
  echo "determinism: DIFFERENT"; diff "$scratch/a.sha" "$scratch/b.sha" | head; exit 1
fi
node scripts/art/rook3d/check.mjs "$scratch/a" --json "$scratch/check.json" | tee "$scratch/check.txt"
rm -rf "$out"
node scripts/art/rook3d/sheets.mjs "$scratch/a" "$out"
cp "$scratch/a/manifest.json" "$out/manifest.json"
cp "$scratch/check.txt" "$out/check.txt"
cp "$scratch/a.sha" "$out/sha256.txt"
