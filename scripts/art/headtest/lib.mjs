// Shared kit for the head test: palette letters, families, grid text, PNG helpers, zoom drawing.
// Safe to copy to the writer folder. It holds no pixel values of the given frame.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const palettePath = `${here}/palette.json`;
if (!existsSync(palettePath)) throw new Error('palette.json not found next to lib.mjs');
export const paletteJson = JSON.parse(readFileSync(palettePath, 'utf8'));

export const BOX = { x: 10, y: 0, w: 16, h: 14 };
export const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
export const LETTERS = 'abcdefghijklmnopqrstuv';
const sorted = [...paletteJson.palette].map((h) => h.toLowerCase()).sort((a, b) => lum(a) - lum(b));
if (sorted.length !== 22) throw new Error('palette must have 22 colors');
export const HEX_OF = Object.fromEntries([...LETTERS].map((l, i) => [l, sorted[i]]));
export const LETTER_OF = Object.fromEntries([...LETTERS].map((l, i) => [sorted[i], l]));

// Families: near-black wins first (the palette nearBlack list), then the palette ramps.
// ink -> near-black; steel -> hair; olive -> coat; brown-amber -> orange-gold; skin -> skin.
const nb = new Set(paletteJson.nearBlack.map((h) => h.toLowerCase()));
const rampOf = (h) => Object.entries(paletteJson.ramps).find(([, v]) => v.map((x) => x.toLowerCase()).includes(h))?.[0];
const FAMILY_OF_RAMP = { steel: 'hair', olive: 'coat', 'brown-amber': 'orange-gold', skin: 'skin', ink: 'near-black' };
export const FAMILY_NAMES = ['near-black', 'hair', 'skin', 'orange-gold', 'coat'];
export const FAMILIES = Object.fromEntries(FAMILY_NAMES.map((f) => [f, []]));
export const FAMILY_OF_LETTER = {};
for (const l of LETTERS) {
  const h = HEX_OF[l];
  const f = nb.has(h) ? 'near-black' : FAMILY_OF_RAMP[rampOf(h)];
  FAMILIES[f].push(l);
  FAMILY_OF_LETTER[l] = f;
}
export const familiesJson = () => ({
  note: 'Letters are the 22 palette colors sorted by luminance (0.299R+0.587G+0.114B), dark to light. "." is transparent.',
  letters: Object.fromEntries([...LETTERS].map((l) => [l, { hex: HEX_OF[l], luminance: +lum(HEX_OF[l]).toFixed(1), family: FAMILY_OF_LETTER[l] }])),
  families: FAMILIES,
  rule: 'near-black = palette nearBlack list (wins first); hair = steel ramp; coat = olive ramp; orange-gold = brown-amber ramp; skin = skin ramp. Inside a family letters run dark to light.',
});

// ---- PNG and images: { w, h, data } RGBA ----
export function readPng(path) {
  const p = PNG.sync.read(readFileSync(path));
  return { w: p.width, h: p.height, data: new Uint8Array(p.data) };
}
export function writePng(img, path) {
  const p = new PNG({ width: img.w, height: img.h });
  p.data = Buffer.from(img.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(p));
}
export function newImage(w, h, rgba = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}
export function crop(img, x, y, w, h) {
  const out = newImage(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      out.data.set(img.data.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (j * w + i) * 4);
    }
  return out;
}
export const px = (img, x, y) => img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
export const setPx = (img, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  img.data.set(rgba, (y * img.w + x) * 4);
};
export const fillRect = (img, x, y, w, h, rgba) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(img, x + i, y + j, rgba);
};
export const hexOfPx = (img, x, y) => {
  const p = px(img, x, y);
  return p[3] === 0 ? null : `#${[p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
/** Letter of a pixel: '.' transparent, '?' off-palette or half alpha. */
export function letterAt(img, x, y) {
  const p = px(img, x, y);
  if (p[3] === 0) return '.';
  if (p[3] !== 255) return '?';
  return LETTER_OF[hexOfPx(img, x, y)] ?? '?';
}
export const rgbOfLetter = (l) => [1, 3, 5].map((i) => Number.parseInt(HEX_OF[l].slice(i, i + 2), 16));
/** Paste src at x,y with nearest-neighbor scale k; transparent source pixels are skipped. */
export function blit(dst, src, x, y, k = 1) {
  for (let j = 0; j < src.h * k; j++)
    for (let i = 0; i < src.w * k; i++) {
      const s = (Math.floor(j / k) * src.w + Math.floor(i / k)) * 4;
      if (src.data[s + 3] === 0) continue;
      setPx(dst, x + i, y + j, [src.data[s], src.data[s + 1], src.data[s + 2], 255]);
    }
}
/** Paste src as is (including its alpha) at x,y, scale 1. */
export function paste(dst, src, x, y) {
  for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) setPx(dst, x + i, y + j, px(src, i, j));
}

// ---- grid text ----
export class GridError extends Error {}
export function parseGrid(text) {
  const rows = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = /^\s*(\d+)\s*\|(.*)$/.exec(line);
    const body = m ? m[2] : line;
    if (/^\s|\s$/.test(body)) throw new GridError(`line ${n + 1} (frame row ${BOX.y + rows.length}): leading or trailing spaces`);
    if (rows.length >= BOX.h) throw new GridError(`line ${n + 1}: more than ${BOX.h} rows`);
    if (m && Number(m[1]) !== BOX.y + rows.length)
      throw new GridError(`line ${n + 1}: row label ${m[1]} but this is frame row ${BOX.y + rows.length}`);
    if (body.length !== BOX.w)
      throw new GridError(`line ${n + 1} (frame row ${BOX.y + rows.length}): ${body.length} columns, need ${BOX.w}`);
    for (const [c, ch] of [...body].entries())
      if (ch !== '.' && !LETTERS.includes(ch))
        throw new GridError(`line ${n + 1} (frame row ${BOX.y + rows.length}), column ${BOX.x + c}: bad letter '${ch}' (use a to v or .)`);
    rows.push([...body]);
  }
  if (rows.length !== BOX.h) throw new GridError(`${rows.length} rows, need ${BOX.h}`);
  return rows;
}
export function gridToImage(cells) {
  const img = newImage(BOX.w, BOX.h);
  cells.forEach((row, y) => row.forEach((l, x) => { if (l !== '.') setPx(img, x, y, [...rgbOfLetter(l), 255]); }));
  return img;
}
export function imageToCells(img) {
  return Array.from({ length: img.h }, (_, y) => Array.from({ length: img.w }, (_, x) => letterAt(img, x, y)));
}
export const GRID_HEADER = `# column, frame x ${BOX.x}..${BOX.x + BOX.w - 1} (ones digit):   ${[...Array(BOX.w)].map((_, i) => (BOX.x + i) % 10).join('')}`;
export function formatGrid(cells) {
  return `${GRID_HEADER}\n${cells.map((r, y) => `${String(BOX.y + y).padStart(2, '0')}|${r.join('')}`).join('\n')}\n`;
}
export const emptyCells = () => Array.from({ length: BOX.h }, () => Array(BOX.w).fill('.'));

// ---- bitmap font (3x5), copied from contact-sheet.mjs, plus a few signs ----
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
  '#': '#.#' + '###' + '#.#' + '###' + '#.#',
  '%': '#.#' + '..#' + '.#.' + '#..' + '#.#',
  '|': '.#.' + '.#.' + '.#.' + '.#.' + '.#.',
  '_': '...' + '...' + '...' + '...' + '###',
  '>': '#..' + '.#.' + '..#' + '.#.' + '#..',
  '<': '..#' + '.#.' + '#..' + '.#.' + '..#',
  '*': '...' + '#.#' + '.#.' + '#.#' + '...',
  '?': '###' + '..#' + '.#.' + '...' + '.#.',
  '[': '##.' + '#..' + '#..' + '#..' + '##.',
  ']': '.##' + '..#' + '..#' + '..#' + '.##',
};

export function drawText(img, text, x, y, rgba, scale = 1) {
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '#') fillRect(img, cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, rgba);
    cx += 4 * scale;
  }
  return cx - x;
}
const LOWER = {
  a: '###..#####.####',
  b: '#..#..####.####',
  c: '...####..#..###',
  d: '..#..#####.####',
  e: '####.#####..###',
  f: '.###..##.#..#..',
  g: '####.####..####',
  h: '#..#..####.##.#',
  i: '.#.....#..#..#.',
  j: '..#.....##.#.#.',
  k: '#..#.###.#.##.#',
  l: '##..#..#..#.###',
  m: '...#######.##.#',
  n: '...##.#.##.##.#',
  o: '...####.##.####',
  p: '####.#####..#..',
  q: '####.####..#..#',
  r: '....###..#..#..',
  s: '.###...#...###.',
  t: '.#.###.#..#..##',
  u: '...#.##.##.####',
  v: '...#.##.##.#.#.',
};
/** Draw one lower-case letter a to v with the 3x5 lower-case glyphs. */
export function drawLower(img, ch, x, y, rgba, scale = 1) {
  const g = LOWER[ch];
  for (let i = 0; i < 15; i++) if (g[i] === '1' || g[i] === '#') fillRect(img, x + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, rgba);
}
export const textWidth = (text, scale = 1) => String(text).length * 4 * scale;

// ---- zoomed grid drawing ----
export const CELL = 32;
export const MARGIN_L = 28;
export const MARGIN_T = 16;
const CHECK_NEUTRAL = [[235, 235, 235], [205, 205, 205]];
const CHECK_MAGENTA = [[255, 0, 255], [190, 0, 190]];
const checker = (pal, x, y) => pal[(Math.floor(x / 8) + Math.floor(y / 8)) % 2];
export const lumRgb = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

/**
 * Draw an image (16x14, or any size) at cell size k with a grid line on every pixel and row/column numbers
 * in frame coordinates (originX, originY are the frame coordinates of pixel 0,0).
 * opts.family  a family name: pixels outside it dim to 20 percent over a magenta checker.
 * opts.poster  4-step gray (min(3, floor(lum/64)) * 85).
 * opts.marks   Map "x,y" -> function(img, px, py, k) to draw over a cell (px,py = top-left of the cell).
 * opts.flat    function(x, y) -> rgba | null: replace the cell color (used by mask.mjs).
 */
export function zoomGrid(img, { k = CELL, originX = BOX.x, originY = BOX.y, family = null, poster = false, flat = null, after = null } = {}) {
  const ml = MARGIN_L, mt = MARGIN_T;
  const out = newImage(ml + img.w * k + 1, mt + img.h * k + 1, [20, 20, 26, 255]);
  const sepLetters = family ? new Set(FAMILIES[family]) : null;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const p = px(img, x, y);
      const opaque = p[3] === 255;
      const f = flat ? flat(x, y) : null;
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          let c;
          if (f) c = f;
          else if (sepLetters) {
            const bg = checker(CHECK_MAGENTA, i, j);
            if (opaque && sepLetters.has(letterAt(img, x, y))) c = [p[0], p[1], p[2]];
            else if (opaque) c = [0, 1, 2].map((q) => Math.round(0.2 * p[q] + 0.8 * bg[q]));
            else c = bg;
          } else if (!opaque) c = checker(CHECK_NEUTRAL, i, j);
          else if (poster) c = Array(3).fill(Math.min(3, Math.floor(lumRgb(p) / 64)) * 85);
          else c = [p[0], p[1], p[2]];
          setPx(out, ml + x * k + i, mt + y * k + j, [c[0], c[1], c[2], 255]);
        }
    }
  const line = [90, 90, 105, 255];
  for (let i = 0; i <= img.w; i++) fillRect(out, ml + i * k, mt, 1, img.h * k + 1, line);
  for (let j = 0; j <= img.h; j++) fillRect(out, ml, mt + j * k, img.w * k + 1, 1, line);
  const txt = [225, 228, 235, 255];
  for (let x = 0; x < img.w; x++) {
    const s = String(originX + x);
    drawText(out, s, ml + x * k + Math.floor((k - textWidth(s, 1) + 1) / 2), 4, txt, 1);
  }
  for (let y = 0; y < img.h; y++) {
    const s = String(originY + y);
    drawText(out, s, 4, mt + y * k + Math.floor((k - 5) / 2), txt, 1);
  }
  if (after) after(out, ml, mt, k);
  return out;
}

/** A plain scaled copy (checker behind transparent), no grid. */
export function scaled(img, k, { gray = false, poster = false, bg = true } = {}) {
  const out = newImage(img.w * k, img.h * k);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const p = px(img, Math.floor(x / k), Math.floor(y / k));
      let c;
      if (p[3] === 0) c = bg ? checker(CHECK_NEUTRAL, x, y) : [0, 0, 0, 0];
      else if (poster) c = Array(3).fill(Math.min(3, Math.floor(lumRgb(p) / 64)) * 85);
      else if (gray) c = Array(3).fill(Math.round(lumRgb(p)));
      else c = p;
      setPx(out, x, y, [c[0], c[1], c[2], p[3] === 0 && !bg ? 0 : 255]);
    }
  return out;
}

/** The views the writer sees, same layout for the reference and for a candidate. Returns { name: image }. */
export function viewSet(img, prefix) {
  const out = { [`${prefix}-32x.png`]: zoomGrid(img) };
  for (const f of FAMILY_NAMES) out[`${prefix}-sep-${f}.png`] = zoomGrid(img, { family: f });
  out[`${prefix}-poster.png`] = zoomGrid(img, { poster: true });
  return out;
}

/** legend.png for writers: a 32 px swatch, the letter, hex, luminance and family for each of the 22 letters. Shared by the head test kit and the 6a kits. */
export function legendImage() {
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
  return img;
}
