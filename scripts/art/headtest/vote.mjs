// vote.mjs: per-cell majority grid from N grid files. A tie goes to the first file (in the order given) whose letter is among the tied ones.
// Usage: node vote.mjs <out.txt> <grid1.txt> <grid2.txt> <grid3.txt> [...]   (3 or more: a majority needs 3; the inputs may also be PNGs of 16x14 or 32x32)
import { writeFileSync } from 'node:fs';
import { BOX, GridError, emptyCells, formatGrid, imageToCells } from './lib.mjs';
import { loadImage, toBox } from './score.mjs';

export function vote(cellSets) {
  const out = emptyCells();
  for (let y = 0; y < BOX.h; y++)
    for (let x = 0; x < BOX.w; x++) {
      const counts = new Map();
      for (const c of cellSets) counts.set(c[y][x], (counts.get(c[y][x]) ?? 0) + 1);
      const top = Math.max(...counts.values());
      out[y][x] = cellSets.map((c) => c[y][x]).find((l) => counts.get(l) === top);
    }
  return out;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [, , outPath, ...inputs] = process.argv;
  if (!outPath || inputs.length < 3) {
    console.error('usage: node vote.mjs <out.txt> <grid1> <grid2> <grid3> [...] (3 or more grids)');
    process.exit(2);
  }
  try {
    const sets = inputs.map((p) => imageToCells(toBox(loadImage(p))));
    writeFileSync(outPath, formatGrid(vote(sets)));
    console.log(`vote of ${inputs.length} grids written to ${outPath}`);
  } catch (e) {
    if (e instanceof GridError) {
      console.error(`vote.mjs: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}
