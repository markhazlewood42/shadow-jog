// render.mjs: turn a grid text file into PNGs. Usage: node render.mjs <grid.txt> [outBase]
// Writes <outBase>.png (16x14 at 1x), <outBase>-sheet.png (32x, grid lines, frame-coordinate numbers),
// <outBase>-sep-<family>.png (one per family) and <outBase>-poster.png (4-step gray). Same layout as the ref-* images.
// Exit 2 on a bad letter, a wrong row count or a wrong column count.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { GridError, gridToImage, parseGrid, viewSet, writePng } from './lib.mjs';

const [, , gridPath, baseArg] = process.argv;
if (!gridPath) {
  console.error('usage: node render.mjs <grid.txt> [outBase]');
  process.exit(2);
}
let cells;
try {
  cells = parseGrid(readFileSync(gridPath, 'utf8'));
} catch (e) {
  if (e instanceof GridError || e.code === 'ENOENT') {
    console.error(`render.mjs: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
const base = baseArg ?? gridPath.slice(0, gridPath.length - extname(gridPath).length);
const img = gridToImage(cells);
writePng(img, `${base}.png`);
const views = viewSet(img, base);
const sheet = views[`${base}-32x.png`];
delete views[`${base}-32x.png`];
writePng(sheet, `${base}-sheet.png`);
for (const [p, v] of Object.entries(views)) writePng(v, p);
console.log(`rendered ${base}.png, ${base}-sheet.png and ${Object.keys(views).length} separation/poster images`);
