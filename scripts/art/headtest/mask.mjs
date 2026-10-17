// mask.mjs: Level 1 feedback. A 32x image of the head box with wrong cells marked and no colors shown.
// Wrong = the candidate cell is not exactly the given cell (transparent must match transparent).
// Usage: node mask.mjs <candidate.png|grid.txt> <out.png> [--given path]
import { BOX, crop, fillRect, letterAt, readPng, writePng, zoomGrid } from './lib.mjs';
import { GIVEN, loadImage, toBox } from './score.mjs';

export function wrongCells(cand, ref) {
  const out = [];
  for (let y = 0; y < BOX.h; y++)
    for (let x = 0; x < BOX.w; x++) {
      const a = letterAt(cand, x, y), b = letterAt(ref, x, y);
      if (a !== b || a === '?') out.push([x, y]);
    }
  return out;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const a = process.argv.slice(2);
  const gi = a.indexOf('--given');
  const givenPath = gi >= 0 ? a[gi + 1] : GIVEN;
  const pos = a.filter((x, i) => !x.startsWith('--') && a[i - 1] !== '--given');
  if (pos.length < 2) {
    console.error('usage: node mask.mjs <candidate.png|grid.txt> <out.png> [--given path]');
    process.exit(2);
  }
  const given = readPng(givenPath);
  const ref = crop(given, BOX.x, BOX.y, BOX.w, BOX.h);
  const cand = toBox(loadImage(pos[0]));
  const wrong = wrongCells(cand, ref);
  const bad = new Set(wrong.map(([x, y]) => `${x},${y}`));
  const img = zoomGrid(cand, {
    flat: (x, y) => (bad.has(`${x},${y}`) ? [215, 45, 45, 255] : [62, 68, 80, 255]),
    after: (out, ml, mt, k) => {
      for (const [x, y] of wrong)
        for (let i = 6; i < k - 6; i++) {
          fillRect(out, ml + x * k + i, mt + y * k + i, 2, 2, [255, 255, 255, 255]);
          fillRect(out, ml + x * k + (k - 1 - i), mt + y * k + i, 2, 2, [255, 255, 255, 255]);
        }
    },
  });
  writePng(img, pos[1]);
  console.log(`${wrong.length} wrong of ${BOX.w * BOX.h} cells (${((100 * (BOX.w * BOX.h - wrong.length)) / (BOX.w * BOX.h)).toFixed(1)} percent exact); mask at ${pos[1]}`);
}
