// Contact sheet: one PNG per call, for grading a character at several views (the pack's "First look").
//
//   node scripts/art/contact-sheet.mjs --out media/rook-turnaround/sheets/walk.png --given media/rook-turnaround/walk/spritesheet.png:4 media/rook-turnaround/walk/spritesheet.png:all
//
//   inputs        one or more  <png>  (the whole image is one sprite),  <png>:<n>  (frame n of a sheet) or  <png>:all  (every frame)
//   --given spec  the given frame, <png>:<n>. It is highlighted in the sheet and is the right-hand sprite of the side-by-side panel
//   --frame-size  WxH of a frame in a sheet (default 32x32)
//   --out file    the sheet to write (default media/rook-turnaround/sheets/sheet.png)
//   --context     x,y where the sprite's feet-center goes on the 640x360 street (default 250,128)
//   --bg file     the street screenshot (default docs/screenshots/04-lantern-row-street.png)
//
// One row per sprite. Panels, left to right:
//   1x         the sprite at its true size on a flat dark background
//   8x grid    the sprite at 8x with a pixel grid (a stronger line every 4 px) and coordinate labels every 4 px
//   gray       grayscale (luminance), 8x
//   silhouette solid black on light gray, 8x
//   context    the sprite pasted at 1x on the street screenshot. The screenshot is 1280x720 (the game at 2x), so it is brought to
//              640x360 by nearest-neighbor halving (every second pixel), then a 128x72 window around the sprite is shown at 2x
//   vs given   the sprite beside the given frame, both 8x
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { luminance } from './metrics.mjs';
import { crop, frames as splitFrames, newImage, readPng, writePng } from './pixkit/png.mjs';

// ---- a tiny 3x5 bitmap font (digits, capitals and a few signs). Each glyph is 15 chars, row by row, '#' = on. ----
const FONT = {
  '0': '###' + '#.#' + '#.#' + '#.#' + '###',
  '1': '.#.' + '##.' + '.#.' + '.#.' + '###',
  '2': '###' + '..#' + '###' + '#..' + '###',
  '3': '###' + '..#' + '###' + '..#' + '###',
  '4': '#.#' + '#.#' + '###' + '..#' + '..#',
  '5': '###' + '#..' + '###' + '..#' + '###',
  '6': '###' + '#..' + '###' + '#.#' + '###',
  '7': '###' + '..#' + '..#' + '..#' + '..#',
  '8': '###' + '#.#' + '###' + '#.#' + '###',
  '9': '###' + '#.#' + '###' + '..#' + '###',
  A: '.#.' + '#.#' + '###' + '#.#' + '#.#',
  B: '##.' + '#.#' + '##.' + '#.#' + '##.',
  C: '###' + '#..' + '#..' + '#..' + '###',
  D: '##.' + '#.#' + '#.#' + '#.#' + '##.',
  E: '###' + '#..' + '##.' + '#..' + '###',
  F: '###' + '#..' + '##.' + '#..' + '#..',
  G: '###' + '#..' + '#.#' + '#.#' + '###',
  H: '#.#' + '#.#' + '###' + '#.#' + '#.#',
  I: '###' + '.#.' + '.#.' + '.#.' + '###',
  J: '..#' + '..#' + '..#' + '#.#' + '###',
  K: '#.#' + '#.#' + '##.' + '#.#' + '#.#',
  L: '#..' + '#..' + '#..' + '#..' + '###',
  M: '#.#' + '###' + '###' + '#.#' + '#.#',
  N: '##.' + '#.#' + '#.#' + '#.#' + '#.#',
  O: '###' + '#.#' + '#.#' + '#.#' + '###',
  P: '###' + '#.#' + '###' + '#..' + '#..',
  Q: '###' + '#.#' + '#.#' + '###' + '..#',
  R: '###' + '#.#' + '##.' + '#.#' + '#.#',
  S: '###' + '#..' + '###' + '..#' + '###',
  T: '###' + '.#.' + '.#.' + '.#.' + '.#.',
  U: '#.#' + '#.#' + '#.#' + '#.#' + '###',
  V: '#.#' + '#.#' + '#.#' + '#.#' + '.#.',
  W: '#.#' + '#.#' + '###' + '###' + '#.#',
  X: '#.#' + '#.#' + '.#.' + '#.#' + '#.#',
  Y: '#.#' + '#.#' + '.#.' + '.#.' + '.#.',
  Z: '###' + '..#' + '.#.' + '#..' + '###',
  ' ': '...' + '...' + '...' + '...' + '...',
  ':': '...' + '.#.' + '...' + '.#.' + '...',
  '-': '...' + '...' + '###' + '...' + '...',
  '/': '..#' + '..#' + '.#.' + '#..' + '#..',
  '.': '...' + '...' + '...' + '...' + '.#.',
  ',': '...' + '...' + '...' + '.#.' + '#..',
  '+': '...' + '.#.' + '###' + '.#.' + '...',
  '=': '...' + '###' + '...' + '###' + '...',
  '(': '.#.' + '#..' + '#..' + '#..' + '.#.',
  ')': '.#.' + '..#' + '..#' + '..#' + '.#.',
};

const setPx = (img, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  img.data.set(rgba, (y * img.w + x) * 4);
};
const fillRect = (img, x, y, w, h, rgba) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(img, x + i, y + j, rgba);
};
/** Draw text with the 3x5 font at integer scale. Lower case is drawn as capitals. Returns the width drawn. */
export function drawText(img, text, x, y, rgba, scale = 1) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '#') fillRect(img, cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, rgba);
    cx += 4 * scale;
  }
  return cx - x;
}
/** Paste src into dst at x,y with nearest-neighbor scale k; map(rgba) may change each opaque source pixel. Transparent pixels are skipped. */
function blit(dst, src, x, y, k, map = (p) => p) {
  for (let j = 0; j < src.h * k; j++) {
    for (let i = 0; i < src.w * k; i++) {
      const s = (Math.floor(j / k) * src.w + Math.floor(i / k)) * 4;
      if (src.data[s + 3] === 0) continue;
      setPx(dst, x + i, y + j, map([src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3]]));
    }
  }
}

const BG = [38, 42, 54, 255];
const PAGE = [22, 24, 30, 255];
const TEXT = [220, 224, 232, 255];
const GOLD = [255, 200, 64, 255];

/** Load the street screenshot at 640x360 (nearest-neighbor halving when it is 1280x720). */
export function loadStreet(path) {
  const img = readPng(path);
  if (img.w === 640 && img.h === 360) return img;
  if (img.w !== 1280 || img.h !== 720) throw new Error(`street screenshot is ${img.w}x${img.h}; expected 1280x720 or 640x360`);
  const out = newImage(640, 360);
  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 640; x++) out.data.set(img.data.subarray(((y * 2) * 1280 + x * 2) * 4, ((y * 2) * 1280 + x * 2) * 4 + 4), (y * 640 + x) * 4);
  }
  return out;
}

/** Draw the panels of one sprite into `sheet` at row y. Returns nothing. `label` names the row. */
function drawRow(sheet, sprite, given, street, ctx, y, label, isGiven) {
  const k = 8;
  const w = sprite.w;
  const h = sprite.h;
  const lab = 18; // label margin for the grid panel (top and left)
  const x1 = 8;
  let x = x1;
  // row label
  drawText(sheet, label + (isGiven ? ' (GIVEN)' : ''), x, y, isGiven ? GOLD : TEXT, 2);
  const top = y + 16;
  if (isGiven) fillRect(sheet, 2, y - 4, 4, h * k + lab + 28, GOLD);

  // 1x panel
  drawText(sheet, '1X', x, top, TEXT, 1);
  fillRect(sheet, x, top + 8, w + 8, h + 8, BG);
  blit(sheet, sprite, x + 4, top + 12, 1);
  x += w + 8 + 12;

  // 8x grid panel with coordinates
  drawText(sheet, '8X GRID', x, top, TEXT, 1);
  const gx = x + lab;
  const gy = top + 8 + lab;
  fillRect(sheet, gx, gy, w * k, h * k, BG);
  blit(sheet, sprite, gx, gy, k);
  // grid lines, blended over the sprite: faint every pixel, stronger every 4 px
  for (let i = 0; i <= w; i++) shadeLine(sheet, gx + Math.min(i * k, w * k - 1), gy, 1, h * k, i % 4 === 0 ? 0.55 : 0.18);
  for (let j = 0; j <= h; j++) shadeLine(sheet, gx, gy + Math.min(j * k, h * k - 1), w * k, 1, j % 4 === 0 ? 0.55 : 0.18);
  for (let i = 0; i < w; i += 4) drawText(sheet, String(i), gx + i * k + 1, gy - 8, TEXT, 1);
  for (let j = 0; j < h; j += 4) drawText(sheet, String(j), gx - lab + 1, gy + j * k + 1, TEXT, 1);
  x = gx + w * k + 12;

  // grayscale 8x
  drawText(sheet, 'GRAY', x, top, TEXT, 1);
  fillRect(sheet, x, top + 8, w * k, h * k, [128, 128, 128, 255]);
  blit(sheet, sprite, x, top + 8, k, ([r, g, b, a]) => {
    const l = Math.round(luminance([r, g, b]));
    return [l, l, l, a];
  });
  x += w * k + 12;

  // silhouette 8x
  drawText(sheet, 'SILHOUETTE', x, top, TEXT, 1);
  fillRect(sheet, x, top + 8, w * k, h * k, [216, 216, 216, 255]);
  blit(sheet, sprite, x, top + 8, k, ([, , , a]) => [0, 0, 0, a]);
  x += w * k + 12;

  // in context: sprite at 1x on the 640x360 street, a 128x72 window at 2x
  drawText(sheet, 'CONTEXT 640X360, SPRITE 1X, WINDOW SHOWN 2X', x, top, TEXT, 1);
  const scene = crop(street, 0, 0, 640, 360);
  const px = ctx[0] - Math.floor(w / 2);
  const py = ctx[1] - h + 1;
  blit(scene, sprite, px, py, 1);
  const wx = Math.max(0, Math.min(640 - 128, ctx[0] - 64));
  const wy = Math.max(0, Math.min(360 - 72, ctx[1] - 48));
  const win = crop(scene, wx, wy, 128, 72);
  blit(sheet, win, x, top + 8, 2);
  const cw = 256;
  x += cw + 12;

  // vs given: sprite left, given right, both 8x
  drawText(sheet, 'VS GIVEN (LEFT SPRITE, RIGHT GIVEN)', x, top, TEXT, 1);
  fillRect(sheet, x, top + 8, w * k * 2 + 4, h * k, BG);
  blit(sheet, sprite, x, top + 8, k);
  blit(sheet, given, x + w * k + 4, top + 8, k);
  fillRect(sheet, x + w * k, top + 8, 4, h * k, GOLD);
  return x + w * k * 2 + 4;
}

function shadeLine(img, x, y, w, h, alpha) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = ((y + j) * img.w + (x + i)) * 4;
      if (x + i >= img.w || y + j >= img.h) continue;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(img.data[o + c] * (1 - alpha) + 255 * alpha);
    }
  }
}

function loadSpec(spec, fw, fh) {
  const m = /^(.*?)(?::(\d+|all))?$/.exec(spec);
  const path = m[1];
  const sel = m[2];
  const img = readPng(path);
  if (sel === undefined) return [{ img, label: path.split('/').pop() }];
  const fs = splitFrames(img, fw, fh);
  if (sel === 'all') return fs.map((f, i) => ({ img: f, label: `${path.split('/').pop()} F${i}`, index: i, path }));
  const i = Number(sel);
  if (!fs[i]) throw new Error(`${path} has no frame ${i}`);
  return [{ img: fs[i], label: `${path.split('/').pop()} F${i}`, index: i, path }];
}

/** Build a sheet. opts: { inputs: [spec], given: spec, frameSize: [w, h], ctx: [x, y], bg: path } -> image. */
export function buildSheet(opts) {
  const [fw, fh] = opts.frameSize ?? [32, 32];
  const street = loadStreet(opts.bg ?? 'docs/screenshots/04-lantern-row-street.png');
  const given = loadSpec(opts.given, fw, fh)[0];
  const rows = opts.inputs.flatMap((s) => loadSpec(s, fw, fh));
  const rowH = Math.max(...rows.map((r) => r.img.h)) * 8 + 18 + 28;
  const width = 1700;
  const sheet = newImage(width, 24 + rows.length * rowH + 8, PAGE);
  drawText(sheet, `CONTACT SHEET  GIVEN = ${given.label}`, 8, 6, GOLD, 2);
  rows.forEach((r, i) => {
    const isGiven = given.path !== undefined && r.path === given.path && r.index === given.index;
    drawRow(sheet, r.img, given.img, street, opts.ctx ?? [250, 128], 24 + i * rowH, r.label, isGiven);
  });
  return sheet;
}

function main() {
  const argv = process.argv.slice(2);
  const o = { inputs: [], out: 'media/rook-turnaround/sheets/sheet.png' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--given') o.given = argv[++i];
    else if (a === '--frame-size') o.frameSize = argv[++i].split('x').map(Number);
    else if (a === '--context') o.ctx = argv[++i].split(',').map(Number);
    else if (a === '--bg') o.bg = argv[++i];
    else o.inputs.push(a);
  }
  if (!o.inputs.length || !o.given) {
    console.error('usage: node scripts/art/contact-sheet.mjs --given <png>:<n> [--out file] [--frame-size WxH] [--context x,y] <png[:n|:all]>...');
    process.exit(2);
  }
  for (const s of [o.given, ...o.inputs]) {
    const p = s.replace(/:(\d+|all)$/, '');
    if (!existsSync(p)) {
      console.error(`contact-sheet: no such file ${p}`);
      process.exit(2);
    }
  }
  writePng(buildSheet(o), o.out);
  console.log(o.out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
