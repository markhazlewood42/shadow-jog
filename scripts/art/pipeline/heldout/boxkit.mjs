// boxkit.mjs: the kit-safe half of the 6a held-out test. Grid text for any box, the mirror, and the pictures a writer sees.
// It holds no pixel values of the given frame and imports only headtest/lib.mjs, so it is copied into every writer kit
// (the kit builder rewrites the lib import to './lib.mjs'). Do not import the pipeline or any truth source from this file.
import {
  GridError, LETTERS, fillRect, newImage, paste, px, rgbOfLetter, scaled, setPx, zoomGrid,
} from '../../headtest/lib.mjs';

export { GridError };
/** Mirror about the body axis between columns 17 and 18: x <-> 35 - x (same axis as masks.mjs). */
export const AXIS = 35;
export const FRAME = 32;

// ---- colors that are not in the 22-color palette, so a picture color never reads as a hidden cell's true color ----
export const MASK_RGB = [40, 170, 200];
export const CHECK_BOX = [[150, 150, 150], [118, 118, 118]]; // the gray checker that marks blanked box cells
export const OUTLINE_BOX = [0, 200, 255, 255]; // cyan: the box
export const OUTLINE_MIRROR_HOME = [255, 210, 0, 255]; // yellow: where the box sits, drawn on the mirror picture

export const boxW = (b) => b.x1 - b.x0 + 1;
export const boxH = (b) => b.y1 - b.y0 + 1;
export const mirrorBox = (b) => ({ ...b, x0: AXIS - b.x1, x1: AXIS - b.x0 });

// ---- grid text for a box: 'NN|' + one letter per cell, '.' transparent ----
export const boxHeader = (b) => `# column, frame x ${b.x0}..${b.x1} (ones digit):   ${Array.from({ length: boxW(b) }, (_, i) => (b.x0 + i) % 10).join('')}`;
export const emptyBoxCells = (b) => Array.from({ length: boxH(b) }, () => Array(boxW(b)).fill('.'));
export const formatBoxGrid = (cells, b) => `${boxHeader(b)}\n${cells.map((r, y) => `${String(b.y0 + y).padStart(2, '0')}|${r.join('')}`).join('\n')}\n`;
/** Parse the grid text of a box. Same rules and messages as the head test parser; the size comes from the box. */
export function parseBoxGrid(text, b) {
  const w = boxW(b);
  const h = boxH(b);
  const rows = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const m = /^\s*(\d+)\s*\|(.*)$/.exec(raw);
    const body = m ? m[2] : raw;
    if (/^\s|\s$/.test(body)) throw new GridError(`line ${n + 1} (frame row ${b.y0 + rows.length}): leading or trailing spaces`);
    if (rows.length >= h) throw new GridError(`line ${n + 1}: more than ${h} rows`);
    if (m && Number(m[1]) !== b.y0 + rows.length) throw new GridError(`line ${n + 1}: row label ${m[1]} but this is frame row ${b.y0 + rows.length}`);
    if (body.length !== w) throw new GridError(`line ${n + 1} (frame row ${b.y0 + rows.length}): ${body.length} columns, need ${w}`);
    for (const [c, ch] of [...body].entries())
      if (ch !== '.' && !LETTERS.includes(ch)) throw new GridError(`line ${n + 1} (frame row ${b.y0 + rows.length}), column ${b.x0 + c}: bad letter '${ch}' (use a to v or .)`);
    rows.push([...body]);
  }
  if (rows.length !== h) throw new GridError(`${rows.length} rows, need ${h}`);
  return rows;
}
export function boxGridToImage(cells, b) {
  const img = newImage(boxW(b), boxH(b));
  cells.forEach((row, y) => row.forEach((l, x) => { if (l !== '.') setPx(img, x, y, [...rgbOfLetter(l), 255]); }));
  return img;
}

// ---- frames ----
/** The frame with a box image pasted in: the candidate frame. */
export function composite(blank, boxImg, b) {
  const out = { w: blank.w, h: blank.h, data: new Uint8Array(blank.data) };
  paste(out, boxImg, b.x0, b.y0);
  return out;
}
/** The frame mirrored about the axis. A cell whose source column is outside the frame is transparent. */
export function mirrorImage(img) {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const sx = AXIS - x;
      if (sx >= 0 && sx < img.w) setPx(out, x, y, px(img, sx, y));
    }
  return out;
}

// ---- box overlays: [{ box, fill, color }] ----
const inset = (out, x, y, w, h, t, color) => {
  for (let i = 0; i < t; i++) {
    fillRect(out, x + i, y + i, w - 2 * i, 1, color);
    fillRect(out, x + i, y + h - 1 - i, w - 2 * i, 1, color);
    fillRect(out, x + i, y + i, 1, h - 2 * i, color);
    fillRect(out, x + w - 1 - i, y + i, 1, h - 2 * i, color);
  }
};
/** Overlay for zoomGrid(..., { after }): gray checker on the cells of a filled box, then a 2 px outline just inside the box edge. */
export function gridOverlay(boxes, originX = 0, originY = 0) {
  return (out, ml, mt, k) => {
    for (const { box, fill, color } of boxes) {
      const x0 = ml + (box.x0 - originX) * k;
      const y0 = mt + (box.y0 - originY) * k;
      if (fill)
        for (let cy = 0; cy < boxH(box); cy++)
          for (let cx = 0; cx < boxW(box); cx++)
            for (let j = 1; j < k; j++)
              for (let i = 1; i < k; i++) setPx(out, x0 + cx * k + i, y0 + cy * k + j, [...CHECK_BOX[(Math.floor(i / 8) + Math.floor(j / 8)) % 2], 255]);
      inset(out, x0, y0, boxW(box) * k, boxH(box) * k, 2, color);
    }
  };
}
/** The whole frame at k with no grid (4x, 8x, 16x): the same box fill and outline, 1 px. */
export function frameScaled(img, boxes, k) {
  const out = scaled(img, k);
  for (const { box, fill, color } of boxes) {
    const x0 = (box.x0) * k;
    const y0 = (box.y0) * k;
    if (fill)
      for (let y = 0; y < boxH(box) * k; y++)
        for (let x = 0; x < boxW(box) * k; x++) setPx(out, x0 + x, y0 + y, [...CHECK_BOX[(Math.floor(x / 4) + Math.floor(y / 4)) % 2], 255]);
    inset(out, x0, y0, boxW(box) * k, boxH(box) * k, 1, color);
  }
  return out;
}
export const FAMILY_LIST = ['near-black', 'hair', 'skin', 'orange-gold', 'coat'];
/** The 32x grid picture of a frame, optionally with one family in color. The box is outlined (and filled when it is blank). */
export function frame32(img, boxes, family = null) {
  return zoomGrid(img, { k: 32, originX: 0, originY: 0, family, after: gridOverlay(boxes, 0, 0) });
}
/** The box alone at 32x with coordinates in frame numbers. */
export const box32 = (boxImg, b) => zoomGrid(boxImg, { k: 32, originX: b.x0, originY: b.y0 });
