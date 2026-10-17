// render.mjs for the writer kit (Level T). Usage: node render.mjs <grid.txt> [outBase] [--template template.json]
// Writes <outBase>.png (32x32 at 1x), <outBase>-sheet.png (32x, letters, red frame on each conflict, yellow square on each warning),
// <outBase>-sep-<family>.png, <outBase>-poster.png and <outBase>-conflicts.txt, and prints the conflict list.
// Exit 0 = zero conflicts, 1 = conflicts, 2 = a bad grid file (a bad letter, a wrong row or column count).
// In the repo this file lives next to the other proxy modules. The kit builder copies it to the kit as render.mjs and rewrites the import paths.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GridError, writePng } from '../../headtest/lib.mjs';
import { flatCells, parseGrid32 } from './grid32.mjs';
import { formatLevelT, levelT, levelTSheet, levelTViews } from './levelt.mjs';

const args = process.argv.slice(2);
const ti = args.indexOf('--template');
const templatePath = ti >= 0 ? args.splice(ti, 2)[1] : `${dirname(fileURLToPath(import.meta.url))}/template.json`;
const [gridPath, baseArg] = args;
if (!gridPath) {
  console.error('usage: node render.mjs <grid.txt> [outBase] [--template template.json]');
  process.exit(2);
}
let flat;
try {
  flat = flatCells(parseGrid32(readFileSync(gridPath, 'utf8')));
} catch (e) {
  if (e instanceof GridError || e.code === 'ENOENT') {
    console.error(`render.mjs: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
const td = JSON.parse(readFileSync(templatePath, 'utf8'));
const base = baseArg ?? gridPath.slice(0, gridPath.length - extname(gridPath).length);
const result = levelT(td, flat);
const views = levelTViews(flat);
writePng(views[''], `${base}.png`);
for (const [suffix, v] of Object.entries(views)) if (suffix) writePng(v, `${base}${suffix}.png`);
writePng(levelTSheet(flat, result), `${base}-sheet.png`);
const text = formatLevelT(result);
writeFileSync(`${base}-conflicts.txt`, text);
console.log(text);
console.log(`rendered ${base}.png, ${base}-sheet.png, ${Object.keys(views).length - 1} separation and poster images, ${base}-conflicts.txt`);
process.exit(result.conflicts.length ? 1 : 0);
