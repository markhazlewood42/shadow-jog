// Kit scan (plan v2 section 5) and the T1 box scan (plan v2 section 7).
// Kit scan: reject a kit file that holds an 8x8 patch matching a reference at 90 percent or more, at any shift, plain or mirrored.
// A patch is ignored when it equals the given at the same place, or equals the given after one of the S3 transforms at the same place.
// A match is counted over the 64 cells of the patch: both transparent, or both opaque with a color within `tol` dE00. The reference is
// tried as it is and quantized to the walk palette (a writer-visible copy of a reference would have the palette of the kit).
// Patches with fewer than `minOpaque` opaque cells or fewer than `minColors` distinct colors (kit patch and reference patch) are skipped,
// because an empty or flat patch matches any other empty or flat patch.
//   node scripts/art/v2/grade/kitscan.mjs <kit dir> [--box]
// Grader-only: this reads the references. It never copies reference data anywhere.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HEX_OF, LETTERS } from '../../headtest/lib.mjs';
import { readPng, unhex } from '../../pixkit/png.mjs';
import { loadGiven, readTarget } from '../../pipeline/given.mjs';
import { de00Packed, pack } from './color.mjs';
import { flipH, packedAt, quantizeTo, setPixel } from './image.mjs';
import { REF_FACINGS, refImagePath } from './refs/labels.mjs';

export const PATCH = 8;
export const MATCH_SHARE = 0.9;
export const MIN_OPAQUE = 16;
export const MIN_COLORS = 3; // a flat patch (fewer distinct colors) is not a copy of anything
export const COLOR_TOL = 2; // dE00

const TEXT_EXT = new Set(['.txt', '.md', '.json', '.mjs', '.html', '.csv']);

// ---------------------------------------------------------------- S3 transforms

/**
 * Apply an S3 transform to a canvas. A transform is a function (img) => img, or a descriptor:
 *   { kind: 'identity' }, { kind: 'mirror', axis } (x goes to axis - x; the 6a kit uses 35), { kind: 'shift', dx, dy }.
 */
export function applyTransform(img, t) {
  if (typeof t === 'function') return t(img);
  const out = { w: img.w, h: img.h, data: new Uint8Array(img.w * img.h * 4) };
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      let X = x;
      let Y = y;
      if (t.kind === 'mirror') X = (t.axis ?? img.w - 1) - x;
      else if (t.kind === 'shift') {
        X = x + t.dx;
        Y = y + t.dy;
      } else if (t.kind !== 'identity') throw new Error(`kit scan: unknown transform kind ${t.kind}`);
      if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
      out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (Y * img.w + X) * 4);
    }
  return out;
}
/** The S3 transforms of the Rook plan: the mirror about x = 17.5 (x to 35 - x), and a part shift of 1 px each way. */
export const S3_TRANSFORMS = [{ kind: 'identity' }, { kind: 'mirror', axis: 35 }, { kind: 'shift', dx: 1, dy: 0 }, { kind: 'shift', dx: -1, dy: 0 }, { kind: 'shift', dx: 0, dy: 1 }, { kind: 'shift', dx: 0, dy: -1 }];

// ---------------------------------------------------------------- loading kit files

/** Cut an upscaled picture back to cells: the largest k (32 down to 2) where every k x k block is one color. Returns the cell image, or null. */
export function downscale(img) {
  for (const k of [32, 24, 16, 12, 8, 6, 4, 3, 2]) {
    if (img.w % k || img.h % k || img.w / k > 64 || img.h / k > 64) continue;
    const w = img.w / k;
    const h = img.h / k;
    const out = { w, h, data: new Uint8Array(w * h * 4) };
    let ok = true;
    for (let y = 0; y < h && ok; y++)
      for (let x = 0; x < w && ok; x++) {
        const first = (y * k * img.w + x * k) * 4;
        for (let j = 0; j < k && ok; j++)
          for (let i = 0; i < k; i++) {
            const o = ((y * k + j) * img.w + x * k + i) * 4;
            if (img.data[o] !== img.data[first] || img.data[o + 1] !== img.data[first + 1] || img.data[o + 2] !== img.data[first + 2] || img.data[o + 3] !== img.data[first + 3]) {
              ok = false;
              break;
            }
          }
        out.data.set(img.data.subarray(first, first + 4), (y * w + x) * 4);
      }
    if (ok) return out;
  }
  return null;
}

/** Letter-grid blocks in a text file (palette letters a to v and '.', optional "NN|" row labels) as images. */
export function textGrids(text) {
  const grids = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 4) grids.push(cur);
    cur = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:\d+\s*\|)?([.a-v]{8,64})\s*$/.exec(raw);
    if (m) cur.push(m[1]);
    else flush();
  }
  flush();
  return grids.map((rows) => {
    const w = Math.max(...rows.map((r) => r.length));
    const img = { w, h: rows.length, data: new Uint8Array(w * rows.length * 4) };
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        if (r[x] === '.' || !LETTERS.includes(r[x])) continue;
        setPixel(img, x, y, pack(...unhex(HEX_OF[r[x]])));
      }
    });
    return img;
  });
}

/** All images of one kit file: [{ name, img }] where img is on its native cells, or null for a file that cannot be scanned. */
export function kitImages(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') {
    const raw = readPng(file);
    const cells = downscale(raw);
    return [{ name: file, img: cells ?? raw, scaled: Boolean(cells) }];
  }
  if (TEXT_EXT.has(ext)) return textGrids(readFileSync(file, 'utf8')).map((img, i) => ({ name: `${file}#${i}`, img, scaled: false }));
  return null;
}

// ---------------------------------------------------------------- patches

function cellKey(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h || img.data[(y * img.w + x) * 4 + 3] !== 255) return -1;
  return packedAt(img, x, y);
}
function opaqueIn(img, x0, y0, minColors = MIN_COLORS) {
  let n = 0;
  const colors = new Set();
  for (let j = 0; j < PATCH; j++)
    for (let i = 0; i < PATCH; i++) {
      const c = cellKey(img, x0 + i, y0 + j);
      if (c >= 0) {
        n++;
        colors.add(c);
      }
    }
  return colors.size >= minColors ? n : 0;
}
/** Share of the 64 patch cells that agree: both transparent, or both opaque within tol dE00. */
export function patchSimilarity(a, ax, ay, b, bx, by, tol = COLOR_TOL, maxMiss = PATCH * PATCH) {
  let miss = 0;
  for (let j = 0; j < PATCH; j++)
    for (let i = 0; i < PATCH; i++) {
      const p = cellKey(a, ax + i, ay + j);
      const q = cellKey(b, bx + i, by + j);
      const same = p < 0 && q < 0 ? true : p >= 0 && q >= 0 && de00Packed(p, q) <= tol;
      // A caller that only wants matches of a given share can stop early: past maxMiss misses the result is 0.
      if (!same && ++miss > maxMiss) return 0;
    }
  return (PATCH * PATCH - miss) / (PATCH * PATCH);
}

/** Reference pictures as scan targets: each reference as it is, quantized to the walk palette, and both mirrored. */
export function loadScanReferences(walkPalette = readTarget().walkPalette) {
  const out = [];
  for (const f of REF_FACINGS) {
    const raw = readPng(refImagePath(f));
    const q = quantizeTo(raw, walkPalette);
    out.push({ name: f, img: raw, mirrored: false }, { name: f, img: q, mirrored: false, quantized: true });
    out.push({ name: f, img: flipH(raw), mirrored: true }, { name: f, img: flipH(q), mirrored: true, quantized: true });
  }
  return out;
}

const patchCache = new WeakMap();
/** The usable patches of an image: [{ x, y, n }] with n the opaque count. A patch needs minOpaque opaque cells and minColors colors. */
function usablePatches(img, minOpaque, minColors) {
  const key = `${minOpaque}|${minColors}`;
  let per = patchCache.get(img);
  if (!per) {
    per = new Map();
    patchCache.set(img, per);
  }
  let list = per.get(key);
  if (!list) {
    list = [];
    for (let y = 0; y + PATCH <= img.h; y++)
      for (let x = 0; x + PATCH <= img.w; x++) {
        const n = opaqueIn(img, x, y, minColors);
        if (n >= minOpaque) list.push({ x, y, n });
      }
    per.set(key, list);
  }
  return list;
}

/**
 * Scan kit images against the references.
 * images: [{ name, img }]. opts.refs: loadScanReferences() output. opts.given: the given canvas. opts.transforms: the S3 transforms.
 * Returns findings: [{ file, at: [x, y], ref, refAt, mirrored, quantized, similarity }].
 */
export function scanImages(images, { refs = loadScanReferences(), given = loadGiven(), transforms = S3_TRANSFORMS, share = MATCH_SHARE, minOpaque = MIN_OPAQUE, minColors = MIN_COLORS } = {}) {
  const findings = [];
  const givens = transforms.map((t) => applyTransform(given, t));
  const maxMiss = Math.floor((1 - share) * PATCH * PATCH + 1e-9);
  const refPatches = refs.map((r) => ({ r, list: usablePatches(r.img, minOpaque, minColors) }));
  for (const { name, img } of images) {
    for (const k of usablePatches(img, minOpaque, minColors)) {
      // Ignored: equals the given, or a transform of the given, at the same place.
      if (givens.some((g) => patchSimilarity(img, k.x, k.y, g, k.x, k.y, COLOR_TOL, maxMiss) >= share)) continue;
      let hit = null;
      for (const { r, list } of refPatches) {
        for (const p of list) {
          if (Math.abs(p.n - k.n) > maxMiss) continue; // the transparency alone differs too much
          const sim = patchSimilarity(img, k.x, k.y, r.img, p.x, p.y, COLOR_TOL, maxMiss);
          if (sim >= share) {
            hit = { file: name, at: [k.x, k.y], ref: r.name, refAt: [p.x, p.y], mirrored: Boolean(r.mirrored), quantized: Boolean(r.quantized), similarity: sim };
            break;
          }
        }
        if (hit) break;
      }
      if (hit) findings.push(hit);
    }
  }
  return findings;
}

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

/**
 * Scan a kit folder. Every file is scanned; a file type that cannot be read fails closed (an 'unknown-type' finding).
 * Returns { ok, files, findings }.
 */
export function scanKit(kitDir, opts = {}) {
  const refs = opts.refs ?? loadScanReferences();
  const files = listFiles(kitDir);
  const findings = [];
  for (const f of files) {
    const imgs = kitImages(f);
    if (!imgs) {
      findings.push({ file: f.slice(kitDir.length + 1), kind: 'unknown-type' });
      continue;
    }
    for (const x of scanImages(imgs, { ...opts, refs })) findings.push({ ...x, file: f.slice(kitDir.length + 1) });
  }
  return { ok: findings.length === 0, files: files.length, findings };
}

/**
 * The T1 box scan: no kit file holds a cell of a 6a box (hairWing x11..17 y0..10, coat x13..17 y11..25) at its true or its mirrored place.
 * It reuses the 6a isolation check (heldout.mjs checkKit). The truth is the unblanked given, which only the grader holds.
 */
export async function boxScan(kitDir, { boxNames = ['hairWing', 'coat'], img = loadGiven() } = {}) {
  const H = await import('../../pipeline/heldout/heldout.mjs');
  const results = boxNames.map((name) => ({ box: name, ...H.checkKit(kitDir, { img, box: H.getBox(name, img) }) }));
  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/art/v2/grade/kitscan.mjs <kit dir> [--box]');
    process.exit(2);
  }
  const r = scanKit(dir);
  console.log(`reference scan: ${r.ok ? 'PASS' : 'FAIL'} (${r.files} files, ${r.findings.length} findings)`);
  for (const f of r.findings.slice(0, 20)) console.log(`  ${JSON.stringify(f)}`);
  let ok = r.ok;
  if (flag === '--box') {
    const b = await boxScan(dir);
    console.log(`box scan: ${b.ok ? 'PASS' : 'FAIL'}`);
    for (const x of b.results) for (const f of x.findings.slice(0, 10)) console.log(`  ${x.box}: ${JSON.stringify(f)}`);
    ok = ok && b.ok;
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

