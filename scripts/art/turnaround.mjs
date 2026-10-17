// Turnaround strip: the 8 directions of one character in one PNG, for the facing check and for Mark's review.
//
//   node scripts/art/turnaround.mjs --out strip.png --given walk.png:4 --down down.png --up up.png --right right.png --up-right up-right.png
//
//   --given spec     the given frame, <png>:<n> (frame n of a 32x32 sheet) or <png> (the whole image). It faces down-right
//   --down, --up, --right, --up-right  the four new facings, one 32x32 PNG each
//   --frame-size WxH frame size for --given (default 32x32)
//   --target file    target.json, for the katana colors (default docs/spikes/rook-turnaround/target.json)
//   --out file       the strip to write (default media/rook-turnaround/sheets/turnaround.png)
//
// Cell order: down, down-right, right, up-right, up, up-left, left, down-left.
// The mirrored cells: up-left mirrors up-right, left mirrors right, down-left mirrors the given frame (down-right).
// Each cell is drawn at 4x with its label above and at 1x below it. For each mirrored cell where the mirror moves the katana
// to the other shoulder, one line is printed. Each note names the side of the carried item in the source cell; the mirrored
// cell has it on the other side. The checker only reports it; Mark judges whether it matters.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { drawText } from './contact-sheet.mjs';
import { itemSide } from './metrics.mjs';
import { frames as splitFrames, newImage, readPng, writePng } from './pixkit/png.mjs';

/** The cells, left to right. `from` names the cell a mirrored cell copies. */
export const ORDER = [
  { id: 'down', label: 'DOWN' },
  { id: 'down-right', label: 'DOWN-RIGHT (GIVEN)' },
  { id: 'right', label: 'RIGHT' },
  { id: 'up-right', label: 'UP-RIGHT' },
  { id: 'up', label: 'UP' },
  { id: 'up-left', label: 'UP-LEFT (MIRROR)', from: 'up-right' },
  { id: 'left', label: 'LEFT (MIRROR)', from: 'right' },
  { id: 'down-left', label: 'DOWN-LEFT (MIRROR)', from: 'down-right' },
];

const PAGE = [22, 24, 30, 255];
const BG = [38, 42, 54, 255];
const TEXT = [220, 224, 232, 255];
const GOLD = [255, 200, 64, 255];
const K = 4; // the big scale
const PAD = 8;

/** Flip an image left to right. */
export function flipX(img) {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (y * img.w + (img.w - 1 - x)) * 4);
  }
  return out;
}

function blit(dst, src, x, y, k) {
  for (let j = 0; j < src.h * k; j++) {
    for (let i = 0; i < src.w * k; i++) {
      const s = (Math.floor(j / k) * src.w + Math.floor(i / k)) * 4;
      if (src.data[s + 3] === 0) continue;
      const dx = x + i;
      const dy = y + j;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      dst.data.set(src.data.subarray(s, s + 4), (dy * dst.w + dx) * 4);
    }
  }
}

function fillRect(img, x, y, w, h, rgba) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img.data.set(rgba, ((y + j) * img.w + x + i) * 4);
}

/**
 * Build the strip. sprites: { given, down, up, right, upRight } as images. katana: list of katana colors, or [].
 * Returns { sheet, cells: [{ id, label, mirror, img }], notes: [string] }.
 */
export function buildTurnaround(sprites, katana = []) {
  const src = { 'down-right': sprites.given, down: sprites.down, right: sprites.right, 'up-right': sprites.upRight, up: sprites.up };
  const cells = ORDER.map((c) => ({ id: c.id, label: c.label, mirror: !!c.from, img: c.from ? flipX(src[c.from]) : src[c.id] }));
  const notes = [];
  if (katana.length) {
    for (const c of ORDER.filter((o) => o.from)) {
      const a = itemSide(src[c.from], katana);
      const b = itemSide(cells.find((x) => x.id === c.id).img, katana);
      if (a && b && a.side !== 'center' && b.side !== 'center' && a.side !== b.side) {
        notes.push(`mirror ${c.id} (from ${c.from}): the katana moves from the ${a.side} shoulder to the ${b.side} shoulder`);
      }
    }
  }
  const w = Math.max(...cells.map((c) => c.img.w));
  const h = Math.max(...cells.map((c) => c.img.h));
  const colW = w * K + PAD;
  const top = 24; // label row
  const big = top + 12; // 4x sprite top
  const small = big + h * K + 14; // 1x sprite top
  const sheet = newImage(PAD + cells.length * colW, small + h + PAD + 8, PAGE);
  drawText(sheet, '8 DIRECTIONS: DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP, UP-LEFT, LEFT, DOWN-LEFT', PAD, 6, GOLD, 1);
  cells.forEach((c, i) => {
    const x = PAD + i * colW;
    drawText(sheet, c.label, x, top, c.id === 'down-right' ? GOLD : TEXT, 1);
    fillRect(sheet, x, big, w * K, h * K, BG);
    blit(sheet, c.img, x, big, K);
    drawText(sheet, '1X', x, small - 8, TEXT, 1);
    fillRect(sheet, x, small, w + 8, h + 8, BG);
    blit(sheet, c.img, x + 4, small + 4, 1);
  });
  return { sheet, cells, notes };
}

function loadGiven(spec, fw, fh) {
  const m = /^(.*?)(?::(\d+))?$/.exec(spec);
  const img = readPng(m[1]);
  if (m[2] === undefined) return img;
  const f = splitFrames(img, fw, fh)[Number(m[2])];
  if (!f) throw new Error(`${m[1]} has no frame ${m[2]}`);
  return f;
}

function main() {
  const argv = process.argv.slice(2);
  const o = { out: 'media/rook-turnaround/sheets/turnaround.png', target: 'docs/spikes/rook-turnaround/target.json', frameSize: [32, 32] };
  const flags = { '--given': 'given', '--down': 'down', '--up': 'up', '--right': 'right', '--up-right': 'upRight', '--out': 'out', '--target': 'target' };
  const usage = 'usage: node scripts/art/turnaround.mjs --given <png>:<n> --down <png> --up <png> --right <png> --up-right <png> [--out file] [--target target.json] [--frame-size WxH]';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frame-size' || flags[argv[i]]) {
      const flag = argv[i];
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) {
        console.error(`turnaround: ${flag} needs a value\n${usage}`);
        process.exit(2);
      }
      if (flag === '--frame-size') o.frameSize = v.split('x').map(Number);
      else o[flags[flag]] = v;
    } else {
      console.error(`turnaround: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  const need = ['given', 'down', 'up', 'right', 'upRight'];
  if (need.some((k) => !o[k])) {
    console.error(usage);
    process.exit(2);
  }
  try {
    for (const k of need) {
      const p = k === 'given' ? o.given.replace(/:\d+$/, '') : o[k];
      if (!existsSync(p)) throw new Error(`no such file ${p}`);
    }
    if (!existsSync(o.target)) throw new Error(`no such file ${o.target}`);
    const katana = JSON.parse(readFileSync(o.target, 'utf8')).katanaColors ?? [];
    const [fw, fh] = o.frameSize;
    if (o.frameSize.length !== 2 || !o.frameSize.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--frame-size needs WxH, for example 32x32');
    const sprites = { given: loadGiven(o.given, fw, fh), down: readPng(o.down), up: readPng(o.up), right: readPng(o.right), upRight: readPng(o.upRight) };
    for (const k of need) {
      const { w, h } = sprites[k];
      if (w !== fw || h !== fh) throw new Error(`${k} is ${w}x${h}, not ${fw}x${fh}`);
    }
    const { sheet, notes } = buildTurnaround(sprites, katana);
    writePng(sheet, o.out);
    for (const n of notes) console.log(n);
    console.log(o.out);
  } catch (e) {
    console.error(`turnaround: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
