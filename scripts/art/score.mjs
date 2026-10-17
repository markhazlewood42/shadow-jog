// score: compare a candidate 32x32 PNG with the given frame (the answer key) of the Rook walk sheet.
//
// CLI:  node scripts/art/score.mjs <candidate.png> [--key <png>] [--key-frame N] [--frame-size WxH]
//                                   [--target <target.json>] [--palette <file> [--palette-key a.b]] [--range N] [--json]
//   --key <png>      the given frame; default media/rook-turnaround/walk/spritesheet.png
//   --key-frame N    frame of that sheet; default 4 (target.json givenFrame). Use 0 for a single-frame PNG.
//   --range N        shifts -N..N on both axes; default 6
//   --target/--palette  for the pixlint summary; default target.json and its walkPalette
// For every integer shift (dx, dy) the candidate moves by (dx, dy): candidate pixel (x, y) lands on (x+dx, y+dy).
//   IoU        opaque masks (alpha 255): overlap / union.
//   Copy match share of the key's opaque pixels where the shifted candidate has the exact same RGBA.
// Each best value is maximized on its own, so the two shifts can differ.
// Module: shiftScores(cand, key, range), scoreCandidate(cand, key, opts).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { colorsOf, measureFrame } from './metrics.mjs';
import { crop, readPng } from './pixkit/png.mjs';

const opaque = (img, x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[(y * img.w + x) * 4 + 3] === 255;

function count(img) {
  let n = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (opaque(img, x, y)) n++;
  return n;
}

/** Best IoU and best copy match over all shifts -range..range. Returns { iou: {value, dx, dy}, copy: {value, dx, dy} }. */
export function shiftScores(cand, key, range = 6) {
  const keyCount = count(key);
  const candCount = count(cand);
  const best = { iou: { value: 0, dx: 0, dy: 0 }, copy: { value: 0, dx: 0, dy: 0 } };
  if (!keyCount || !candCount) return best;
  let first = true;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      let inter = 0;
      let same = 0;
      for (let y = 0; y < key.h; y++) {
        for (let x = 0; x < key.w; x++) {
          if (!opaque(key, x, y)) continue;
          const sx = x - dx;
          const sy = y - dy;
          if (!opaque(cand, sx, sy)) continue;
          inter++;
          const k = (y * key.w + x) * 4;
          const c = (sy * cand.w + sx) * 4;
          if (key.data[k] === cand.data[c] && key.data[k + 1] === cand.data[c + 1] && key.data[k + 2] === cand.data[c + 2] && key.data[k + 3] === cand.data[c + 3]) same++;
        }
      }
      // Candidate pixels pushed off the canvas by the shift still count in the union.
      const iou = inter / (keyCount + candCount - inter);
      const copy = same / keyCount;
      // Strict > keeps the first shift found (smallest dy, then dx) on a tie, so the output is stable.
      if (first || iou > best.iou.value) best.iou = { value: iou, dx, dy };
      if (first || copy > best.copy.value) best.copy = { value: copy, dx, dy };
      first = false;
    }
  }
  return best;
}

/**
 * Full score of one candidate image.
 * opts.range, opts.target (parsed target.json), opts.lint (function (img) => summary)
 */
export function scoreCandidate(cand, key, opts = {}) {
  const { iou, copy } = shiftScores(cand, key, opts.range ?? 6);
  const m = measureFrame(cand, opts.target?.nearBlack ?? null);
  const out = {
    iou: { value: Number(iou.value.toFixed(4)), shift: [iou.dx, iou.dy] },
    copyMatch: { value: Number(copy.value.toFixed(4)), shift: [copy.dx, copy.dy] },
    colors: colorsOf(cand).length,
    outlineRatio: m.outlineRatio,
    bodyHeight: m.bodyHeight,
    pixlint: null,
  };
  if (opts.lint) out.pixlint = opts.lint(cand);
  return out;
}

function parseArgs(argv) {
  const o = { json: false, range: 6, keyFrame: 4, key: 'media/rook-turnaround/walk/spritesheet.png', targetFile: 'docs/spikes/rook-turnaround/target.json' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--json') o.json = true;
    else if (a === '--key') o.key = val();
    else if (a === '--key-frame') o.keyFrame = Number(val());
    else if (a === '--frame-size') o.frameSize = (val() ?? '').split('x').map(Number);
    else if (a === '--range') o.range = Number(val());
    else if (a === '--target') o.targetFile = val();
    else if (a === '--palette') o.paletteFile = val();
    else if (a === '--palette-key') o.paletteKey = val();
    else rest.push(a);
  }
  o.file = rest[0];
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.file || !existsSync(o.file)) {
    console.error('usage: node scripts/art/score.mjs <candidate.png> [--key <png>] [--key-frame N] [--range N] [--target <target.json>] [--palette <file> [--palette-key a.b]] [--json]');
    process.exit(2);
  }
  try {
    const { lintFile, hasFail, readPaletteFile } = await import('./pixlint.mjs');
    const target = existsSync(o.targetFile) ? JSON.parse(readFileSync(o.targetFile, 'utf8')) : null;
    const [fw, fh] = o.frameSize ?? target?.frameSize ?? [32, 32];
    const sheet = readPng(o.key);
    const perRow = Math.max(1, Math.floor(sheet.w / fw));
    const key = crop(sheet, (o.keyFrame % perRow) * fw, Math.floor(o.keyFrame / perRow) * fh, fw, fh);
    const cand = readPng(o.file);
    const palette = o.paletteFile ? readPaletteFile(o.paletteFile, o.paletteKey) : target?.walkPalette;
    const lint = palette
      ? () => {
          const items = lintFile(o.file, { palette, target, frameSize: [cand.w, cand.h] })[0].items;
          return { pass: !hasFail(items), failed: items.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}: ${i.value}`) };
        }
      : null;
    const res = scoreCandidate(cand, key, { range: o.range, target, lint });
    res.file = o.file;
    if (o.json) console.log(JSON.stringify(res, null, 2));
    else {
      console.log(o.file);
      console.log(`  IoU        ${res.iou.value} at shift ${res.iou.shift.join(',')}`);
      console.log(`  copy match ${res.copyMatch.value} at shift ${res.copyMatch.shift.join(',')}`);
      console.log(`  colors ${res.colors}, outline ratio ${res.outlineRatio}, height ${res.bodyHeight}`);
      if (res.pixlint) console.log(`  pixlint ${res.pixlint.pass ? 'PASS' : 'FAIL'}${res.pixlint.failed.length ? `: ${res.pixlint.failed.join('; ')}` : ''}`);
    }
  } catch (e) {
    console.error(`score: ${e.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
