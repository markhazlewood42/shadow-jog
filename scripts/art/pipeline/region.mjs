// Region-blank scorer for the held-out invention test (plan 6a): blank a named box in the given, score a candidate inside the box only.
//   node scripts/art/pipeline/region.mjs [--cand file.png] [--box hairWing|coat] [--out dir] [--write-target]
// The boxes are derived from the stage A part map, never typed by hand, and each holds 60 to 120 opaque cells:
//   hairWing  the bounding box of the hair cells left of the body axis (x <= 17). It holds the 20 hair-wing cells of the masks plus the crown on that side. Hair-dominant.
//   coat      the largest fully opaque rectangle of 60 to 120 cells that is at least 85 percent coat part, with S above 0 and orphans above 0 in the given.
// Scoring (box cells only): exact match, ramp-tolerant match (same family, within one step), and the plan section 4 bands on T, S, D and orphans of the box against the given's box.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isOpaque } from '../metrics.mjs';
import { crop, letterAt, newImage, paste, readPng, rgbOfLetter, setPx, writePng, zoomGrid } from '../headtest/lib.mjs';
import { flatten, matches, measure } from '../headtest/score.mjs';
import { blankBoxImage, buildPartMap, measureCells, validatePartMap } from './decompose.mjs';
import { AXIS } from './masks.mjs';
import { OUT_DIR, ensureDir, loadGiven, writeTargetKey } from './given.mjs';

/** Plan section 4 bands, relative to the given's box: T 0.8x to 1.2x, S 0.8x to 1.3x, orphans 0.7x to 1.5x, D within 0.08. */
export const BANDS = { T: [0.8, 1.2], S: [0.8, 1.3], orphans: [0.7, 1.5], D: 0.08 };
export const BOX_CELLS = [60, 120]; // opaque cells in a 6a box
export const COAT_SHARE = 0.85;
/**
 * The allowed range of a ratio band. A reference of 0 gives 0x to 0x, which fails a candidate with one stray pixel for no reason.
 * So a reference of 0 takes an absolute range of 0 to one unit: one change for T, one small component for S (both per opaque cell), one orphan.
 * One unit is the smallest nonzero value the measure can take, so "0 or one" is the tightest band that is not a coin flip.
 */
export function bandRange(ref, [lo, hi], unit) {
  return ref === 0 ? [0, unit] : [lo * ref, hi * ref];
}
/** Plan 6a pass: exact at least 60 percent in round 1 at Level 0, ramp-tolerant at least 80 percent. */
export const PASS = { exact: 60, tolerant: 80 };

const opaqueIn = (img, b) => {
  let n = 0;
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (isOpaque(img, x, y)) n++;
  return n;
};
const boxOf = (name, part, x0, y0, x1, y1, img, pm, how) => {
  const b = { name, part, x0, y0, x1, y1 };
  const own = new Set(pm.parts[part] ?? []);
  let partCells = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (own.has(y * pm.w + x)) partCells++;
  return { ...b, cells: (x1 - x0 + 1) * (y1 - y0 + 1), opaque: opaqueIn(img, b), partCells, how };
};

/** The largest axis-aligned rectangle whose cells all belong to one part. Ties go to the smaller y0, then the smaller x0. */
export function largestPartRect(pm, part) {
  const own = new Set(pm.parts[part] ?? []);
  const s = Array.from({ length: pm.h + 1 }, () => new Int32Array(pm.w + 1));
  for (let y = 0; y < pm.h; y++) for (let x = 0; x < pm.w; x++) s[y + 1][x + 1] = s[y][x + 1] + s[y + 1][x] - s[y][x] + (own.has(y * pm.w + x) ? 1 : 0);
  let best = null;
  for (let y0 = 0; y0 < pm.h; y0++)
    for (let x0 = 0; x0 < pm.w; x0++)
      for (let y1 = y0; y1 < pm.h; y1++)
        for (let x1 = x0; x1 < pm.w; x1++) {
          const area = (y1 - y0 + 1) * (x1 - x0 + 1);
          if (best && area <= best.area) continue;
          if (s[y1 + 1][x1 + 1] - s[y0][x1 + 1] - s[y1 + 1][x0] + s[y0][x0] === area) best = { area, x0, y0, x1, y1 };
        }
  return best;
}

/** Bounding box of the hair cells left of the body axis (x <= 17). */
export function hairHalfRect(pm) {
  const left = (pm.parts.hair ?? []).filter((i) => i % pm.w <= Math.floor(AXIS / 2));
  const xs = left.map((i) => i % pm.w);
  const ys = left.map((i) => Math.floor(i / pm.w));
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** Largest fully opaque rectangle with 60 to 120 cells, at least 85 percent in one part, and S and orphans above 0 in the given. Ties: smaller y0, then smaller x0. */
export function dominantRect(img, pm, part) {
  const own = new Set(pm.parts[part] ?? []);
  const sum = (f) => {
    const t = Array.from({ length: pm.h + 1 }, () => new Int32Array(pm.w + 1));
    for (let y = 0; y < pm.h; y++) for (let x = 0; x < pm.w; x++) t[y + 1][x + 1] = t[y][x + 1] + t[y + 1][x] - t[y][x] + (f(x, y) ? 1 : 0);
    return (x0, y0, x1, y1) => t[y1 + 1][x1 + 1] - t[y0][x1 + 1] - t[y1 + 1][x0] + t[y0][x0];
  };
  const opq = sum((x, y) => isOpaque(img, x, y));
  const inPart = sum((x, y) => own.has(y * pm.w + x));
  let best = null;
  for (let y0 = 0; y0 < pm.h; y0++)
    for (let x0 = 0; x0 < pm.w; x0++)
      for (let y1 = y0; y1 < pm.h; y1++)
        for (let x1 = x0; x1 < pm.w; x1++) {
          const area = (y1 - y0 + 1) * (x1 - x0 + 1);
          if (area < BOX_CELLS[0] || area > BOX_CELLS[1] || (best && area <= best.area)) continue;
          if (opq(x0, y0, x1, y1) !== area || inPart(x0, y0, x1, y1) < COAT_SHARE * area) continue;
          const cells = [];
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * pm.w + x);
          const m = measureCells(img, cells);
          if (m.S > 0 && m.orphans > 0) best = { area, x0, y0, x1, y1 };
        }
  return best;
}

/** The two named boxes of 6a, derived from the part map. */
export function deriveBoxes(img, pm) {
  const h = hairHalfRect(pm);
  const hair = boxOf('hairWing', 'hair', h.x0, h.y0, h.x1, h.y1, img, pm, 'bounding box of the hair cells left of the body axis (x <= 17); holds the 20 hair-wing cells and the crown on that side');
  const r = dominantRect(img, pm, 'coat');
  if (!r) throw new Error('no coat rectangle');
  const coat = boxOf('coat', 'coat', r.x0, r.y0, r.x1, r.y1, img, pm, 'largest fully opaque rectangle of 60 to 120 cells that is at least 85 percent coat part, with S and orphans above 0');
  return { hairWing: hair, coat };
}

/** The given with a box blanked: what the writers see. */
export const blankRegion = (img, box) => blankBoxImage(img, box);

const rng = (v, lo, hi) => v >= lo && v <= hi;
/** The candidate's box: a 32x32 frame (its box cells) or an image of exactly the box size. */
function candBox(cand, box) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  if (cand.w === 32 && cand.h === 32) return crop(cand, box.x0, box.y0, w, h);
  if (cand.w === w && cand.h === h) return cand;
  throw new Error(`candidate is ${cand.w}x${cand.h}: need 32x32 or ${w}x${h}`);
}

/**
 * Score a candidate inside the box only.
 * Rows (each has a name): exact, tolerant, T, S, D, orphans. ok = all rows pass. failed = the names that did not.
 * The candidate box is pasted into a copy of the given, so edge, interior and orphan rules see the real neighbors outside the box.
 */
export function scoreRegion(cand, given, box) {
  const cb = candBox(cand, box);
  const w = cb.w;
  const h = cb.h;
  const comp = { w: given.w, h: given.h, data: new Uint8Array(given.data) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(comp, box.x0 + x, box.y0 + y, [0, 0, 0, 0]);
  paste(comp, cb, box.x0, box.y0);
  const ref = crop(given, box.x0, box.y0, w, h);
  const mc = measure(cb, comp, [box.x0, box.y0]);
  const mr = measure(ref, given, [box.x0, box.y0]);
  const mt = matches(cb, ref);
  let opq = 0;
  let opqHit = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (isOpaque(ref, x, y)) {
        opq++;
        if (letterAt(cb, x, y) === letterAt(ref, x, y)) opqHit++;
      }
  const rows = [];
  const add = (name, value, band, pass, extra = '') => rows.push({ name, value, band, pass, extra });
  add('exact', +mt.exact.pct.toFixed(1), `>= ${PASS.exact}`, mt.exact.pct >= PASS.exact, `${mt.exact.n} of ${mt.exact.total} cells; on the given's opaque cells ${opqHit} of ${opq}`);
  add('tolerant', +mt.tolerant.pct.toFixed(1), `>= ${PASS.tolerant}`, mt.tolerant.pct >= PASS.tolerant, `${mt.tolerant.n} of ${mt.tolerant.total}`);
  const unit = 1 / (mr.opaque || 1);
  const bT = bandRange(mr.T, BANDS.T, unit);
  const bS = bandRange(mr.S, BANDS.S, unit);
  const bO = bandRange(mr.orphans, BANDS.orphans, 1);
  add('T', +mc.T.toFixed(3), `${bT[0].toFixed(2)} to ${bT[1].toFixed(2)} (ref ${mr.T.toFixed(2)})`, rng(mc.T, bT[0], bT[1]));
  add('S', +mc.S.toFixed(3), `${bS[0].toFixed(2)} to ${bS[1].toFixed(2)} (ref ${mr.S.toFixed(2)})`, rng(mc.S, bS[0], bS[1]));
  add('D', +mc.D.toFixed(3), `${(mr.D - BANDS.D).toFixed(2)} to ${(mr.D + BANDS.D).toFixed(2)} (ref ${mr.D.toFixed(2)})`, Math.abs(mc.D - mr.D) <= BANDS.D);
  add('orphans', mc.orphans, `${bO[0].toFixed(1)} to ${bO[1].toFixed(1)} (ref ${mr.orphans})`, rng(mc.orphans, bO[0], bO[1]));
  return { ok: rows.every((r) => r.pass), failed: rows.filter((r) => !r.pass).map((r) => r.name), rows, cand: mc, ref: mr, exactOpaque: { hit: opqHit, of: opq } };
}
export function formatRegion(res, title = '') {
  return [`== ${title} ==`, ...res.rows.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}: ${r.value}   [band ${r.band}]${r.extra ? `  (${r.extra})` : ''}`)].join('\n');
}

/** The given's box with each family flattened to its middle color (the head test's flattened baseline). Interior part boundaries keep some T. */
export function flattenedCandidate(given, box) {
  return flatten(crop(given, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1));
}
/** A texture-free candidate: every cell that is opaque in the given's box painted with one palette letter. T is 0 and S is 0. */
export function solidCandidate(given, box, letter) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const out = newImage(w, h);
  const rgb = rgbOfLetter(letter);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isOpaque(given, box.x0 + x, box.y0 + y)) setPx(out, x, y, [...rgb, 255]);
  return out;
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const out = opt('--out', OUT_DIR);
  const img = loadGiven();
  const pm = buildPartMap(img);
  if (!validatePartMap(img, pm).ok) { console.error('part map invalid; run decompose.mjs'); process.exit(1); }
  const boxes = deriveBoxes(img, pm);
  ensureDir(out);
  for (const b of Object.values(boxes)) {
    console.log(`${b.name}: x${b.x0}..${b.x1} y${b.y0}..${b.y1}  ${b.cells} cells, ${b.opaque} opaque, ${b.partCells} in part ${b.part}`);
    const blank = blankRegion(img, b);
    writePng(zoomGrid(blank, { k: 32, originX: 0, originY: 0 }), `${out}/blank-${b.name}-32x.png`);
  }
  let code = 0;
  const candPath = opt('--cand');
  if (candPath) {
    const b = boxes[opt('--box', 'hairWing')];
    if (!b) { console.error('--box must be hairWing or coat'); process.exit(2); }
    const res = scoreRegion(readPng(candPath), img, b);
    console.log(formatRegion(res, `${candPath} in ${b.name}`));
    code = res.ok ? 0 : 1;
  } else {
    for (const b of Object.values(boxes)) {
      const own = crop(img, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
      console.log(formatRegion(scoreRegion(newImage(own.w, own.h), img, b), `${b.name}: blank candidate (must FAIL)`));
      console.log(formatRegion(scoreRegion(flattenedCandidate(img, b), img, b), `${b.name}: family-flattened candidate`));
      console.log(formatRegion(scoreRegion(solidCandidate(img, b, b.part === 'hair' ? 'm' : 'n'), img, b), `${b.name}: solid one-color candidate (T and S must FAIL)`));
    }
  }
  writeFileSync(`${out}/regions.json`, `${JSON.stringify(boxes, null, 2)}\n`);
  if (a.includes('--write-target')) {
    writeTargetKey('regions', {
      note: 'Named boxes for the held-out invention test (plan 6a), derived from the stage A part map by region.mjs. x0..x1, y0..y1 inclusive. opaque = opaque cells of the given inside the box. Written by region.mjs --write-target.',
      bands: BANDS,
      pass: PASS,
      boxes,
    });
    console.log('wrote target.json pipeline.regions');
  }
  process.exit(code);
}
