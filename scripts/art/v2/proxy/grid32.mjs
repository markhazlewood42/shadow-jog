// The 32x32 letter grid: text format, parser, and conversions. One line per row: "NN|" and 32 characters (letters a to v, or . for transparent).
// This file goes into the writer kit. The kit builder rewrites the import path below to './lib.mjs'.
import { GridError, LETTERS, letterAt, newImage, rgbOfLetter, setPx } from '../../headtest/lib.mjs';

export const N = 32;
export { GridError };

/** Parse a grid text. Lines that start with # and blank lines are ignored. A row label "NN|" is optional but, when present, must match the row. */
export function parseGrid32(text) {
  const rows = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const m = /^\s*(\d+)\s*\|(.*)$/.exec(raw);
    const body = m ? m[2] : raw;
    if (rows.length >= N) throw new GridError(`line ${n + 1}: more than ${N} rows`);
    if (/^\s|\s$/.test(body)) throw new GridError(`line ${n + 1} (row ${rows.length}): leading or trailing spaces`);
    if (m && Number(m[1]) !== rows.length) throw new GridError(`line ${n + 1}: row label ${m[1]} but this is row ${rows.length}`);
    if (body.length !== N) throw new GridError(`line ${n + 1} (row ${rows.length}): ${body.length} columns, need ${N}`);
    for (const [c, ch] of [...body].entries())
      if (ch !== '.' && !LETTERS.includes(ch)) throw new GridError(`line ${n + 1} (row ${rows.length}), column ${c}: bad letter '${ch}' (use a to v or .)`);
    rows.push([...body]);
  }
  if (rows.length !== N) throw new GridError(`${rows.length} rows, need ${N}`);
  return rows;
}
/** The grid as a flat array of 1024 letters ('.' = transparent). */
export const flatCells = (rows) => rows.flat();
export const emptyCells32 = () => Array.from({ length: N }, () => Array(N).fill('.'));
export const GRID_HEADER = `# column (ones digit):   ${[...Array(N)].map((_, i) => i % 10).join('')}`;
/** Text of a grid. flat = 1024 letters or rows. */
export function formatGrid32(cells) {
  const rows = Array.isArray(cells[0]) ? cells : Array.from({ length: N }, (_, y) => cells.slice(y * N, (y + 1) * N));
  return `${GRID_HEADER}\n${rows.map((r, y) => `${String(y).padStart(2, '0')}|${r.join('')}`).join('\n')}\n`;
}
export function gridToImage32(cells) {
  const flat = Array.isArray(cells[0]) ? cells.flat() : cells;
  const img = newImage(N, N);
  flat.forEach((l, k) => { if (l !== '.') setPx(img, k % N, Math.floor(k / N), [...rgbOfLetter(l), 255]); });
  return img;
}
/** Letters of a 32x32 image as 1024 characters ('.' transparent, '?' off palette). */
export const imageToFlat32 = (img) => Array.from({ length: N * N }, (_, k) => letterAt(img, k % N, Math.floor(k / N)));
