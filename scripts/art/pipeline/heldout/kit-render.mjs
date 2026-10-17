// kit-render.mjs: the writer's only command in a 6a kit (copied to the kit as render.mjs).
//   node render.mjs <grid.txt> [outBase]
// Reads box.json and given-blank.png from the kit folder, puts the grid into the blanked given, and writes pictures only:
//   <outBase>.png            the box at 1x
//   <outBase>-box-32x.png    the box alone at 32x, frame coordinates
//   <outBase>-sheet.png      the whole frame at 32x with the box outlined (compare with given-blank-32x.png)
//   <outBase>-sep-<family>.png  the same sheet with one family in color
//   <outBase>-frame-4x.png and -8x.png  the whole frame without a grid
// It scores nothing. Exit 2 on a bad letter, a wrong row count or a wrong column count.
// The kit builder rewrites the imports below to the kit's own copies.
import { readFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from '../../headtest/lib.mjs';
import { FAMILY_LIST, GridError, OUTLINE_BOX, box32, boxGridToImage, composite, frame32, frameScaled, parseBoxGrid } from './boxkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [, , gridPath, baseArg] = process.argv;
if (!gridPath) {
  console.error('usage: node render.mjs <grid.txt> [outBase]');
  process.exit(2);
}
const box = JSON.parse(readFileSync(`${here}/box.json`, 'utf8'));
let cells;
try {
  cells = parseBoxGrid(readFileSync(gridPath, 'utf8'), box);
} catch (e) {
  if (e instanceof GridError || e.code === 'ENOENT') {
    console.error(`render.mjs: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
const base = baseArg ?? gridPath.slice(0, gridPath.length - extname(gridPath).length);
const boxImg = boxGridToImage(cells, box);
const frame = composite(readPng(`${here}/given-blank.png`), boxImg, box);
const boxes = [{ box, fill: false, color: OUTLINE_BOX }];
writePng(boxImg, `${base}.png`);
writePng(box32(boxImg, box), `${base}-box-32x.png`);
writePng(frame32(frame, boxes), `${base}-sheet.png`);
for (const f of FAMILY_LIST) writePng(frame32(frame, boxes, f), `${base}-sep-${f}.png`);
for (const k of [4, 8]) writePng(frameScaled(frame, boxes, k), `${base}-frame-${k}x.png`);
console.log(`rendered ${base}.png, ${base}-box-32x.png, ${base}-sheet.png, ${FAMILY_LIST.length} separations and the 4x and 8x frames`);
