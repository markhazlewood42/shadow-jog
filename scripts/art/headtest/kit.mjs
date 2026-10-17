// kit.mjs: build the writer folder. Usage: node kit.mjs [given.png] [outHome=H]
// H/writer-in/ gets pictures only (no given.png, no text file with its pixels) plus render.mjs and what it needs.
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOX, FAMILIES, FAMILY_NAMES, FAMILY_OF_LETTER, HEX_OF, LETTERS, crop, drawText, drawLower, emptyCells, fillRect, familiesJson,
  formatGrid, lum, newImage, paste, readPng, rgbOfLetter, scaled, viewSet, writePng,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const R3 = 'C:/Users/markh/AppData/Local/Temp/rook-step3';
const givenPath = process.argv[2] ?? `${R3}/input/given.png`;
const H = process.argv[3] ?? 'C:/Users/markh/AppData/Local/Temp/rook-head';
const OUT = `${H}/writer-in`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const given = readPng(givenPath);
const head = crop(given, BOX.x, BOX.y, BOX.w, BOX.h);

// families.json (orchestrator side)
writeFileSync(`${H}/families.json`, `${JSON.stringify(familiesJson(), null, 2)}\n`);

// legend.png: a 32 px swatch, the letter, hex, luminance, family
{
  const rowH = 36;
  const img = newImage(420, 12 + rowH * LETTERS.length + 8, [20, 20, 26, 255]);
  drawText(img, 'LETTER  SWATCH  HEX      LUM    FAMILY', 8, 4, [150, 155, 170, 255], 1);
  [...LETTERS].forEach((l, i) => {
    const y = 14 + i * rowH;
    drawLower(img, l, 12, y + 8, [240, 240, 245, 255], 3);
    fillRect(img, 60, y, 32, 32, [...rgbOfLetter(l), 255]);
    drawText(img, HEX_OF[l], 104, y + 13, [225, 228, 235, 255], 2);
    drawText(img, lum(HEX_OF[l]).toFixed(1), 220, y + 13, [225, 228, 235, 255], 2);
    drawText(img, FAMILY_OF_LETTER[l], 300, y + 13, [225, 228, 235, 255], 1);
  });
  writePng(img, `${OUT}/legend.png`);
}

// ref-head-32x, ref-sep-<family>, ref-poster
const views = viewSet(head, 'ref');
for (const [name, v] of Object.entries(views)) {
  const n = name === 'ref-32x.png' ? 'ref-head-32x.png' : name;
  writePng(v, `${OUT}/${n}`);
}

// ref-frame.png: whole frame at 1x and 4x
{
  const f1 = scaled(given, 1);
  const f4 = scaled(given, 4);
  const img = newImage(8 + 32 + 12 + 128 + 8, 8 + 128 + 8, [20, 20, 26, 255]);
  paste(img, f1, 8, 8);
  paste(img, f4, 8 + 32 + 12, 8);
  writePng(img, `${OUT}/ref-frame.png`);
}

// grid template and README
writeFileSync(`${OUT}/grid-template.txt`, formatGrid(emptyCells()));
copyFileSync(`${here}/render.mjs`, `${OUT}/render.mjs`);
copyFileSync(`${here}/lib.mjs`, `${OUT}/lib.mjs`);
copyFileSync(`${R3}/input/palette.json`, `${OUT}/palette.json`);
mkdirSync(`${OUT}/node_modules`, { recursive: true });
cpSync(`${here}/../../../node_modules/pngjs`, `${OUT}/node_modules/pngjs`, { recursive: true });
writeFileSync(`${OUT}/package.json`, '{"type":"module","private":true}\n');

const fam = FAMILY_NAMES.map((f) => `- ${f}: ${FAMILIES[f].join(' ')}`).join('\n');
writeFileSync(
  `${OUT}/README.md`,
  `# Head test: writer folder

You draw the head of a 32x32 pixel-art character as a text grid of palette letters.
The head box is frame x ${BOX.x} to ${BOX.x + BOX.w - 1}, y ${BOX.y} to ${BOX.y + BOX.h - 1}: ${BOX.w} columns by ${BOX.h} rows, ${BOX.w * BOX.h} cells.

## Pictures (look at these)
- legend.png: each letter, a swatch, the hex, the luminance and the family.
- ref-head-32x.png: the head at 32x. A grid line on every pixel. Numbers are frame coordinates (columns on top, rows at the left).
- ref-sep-<family>.png: the same picture with only one family in color. All other pixels are dimmed over a magenta checker.
- ref-poster.png: the same picture in 4 gray steps.
- ref-frame.png: the whole frame at 1x and 4x, for context.

## Letters
The 22 palette colors sorted by luminance, dark to light, are the letters a to v . A dot is a transparent pixel.
Families (dark to light inside each):
${fam}

## Grid format
- A text file. One line per row, 14 rows (frame y 0 to 13), in order.
- Each row line is: a two-digit row number, then \`|\`, then exactly 16 characters. One character per pixel, left to right (frame x 10 to 25).
- Each character is a letter a to v, or \`.\` for transparent. No spaces inside the 16 characters.
- Lines that start with \`#\` and blank lines are ignored. The row number must match the line's position.
- Start from grid-template.txt (all dots).

## Render (the only command you may run)
    node render.mjs my-grid.txt [outBase]
It writes <outBase>.png (16x14), <outBase>-sheet.png (32x, same grid and numbers as ref-head-32x.png), <outBase>-sep-<family>.png and <outBase>-poster.png.
It exits with code 2 and a message if a letter is not a to v or a dot, or if a row has the wrong number of columns, or the row count is not 14.
Open the images and compare them with the ref images side by side. Fix rows that differ, then render again.
Run node on render.mjs only. Do not write or run any other script.
`,
);
console.log(`writer-in built at ${OUT}`);
