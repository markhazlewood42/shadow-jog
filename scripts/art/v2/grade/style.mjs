// Style tier of the v2 grade (consult C2 section C4, Amendment 2): lines against the GIVEN, calibrated on the right population.
//   should pass = the 8 walk frames (same hand as the given).
//   should fail = round 8, rig v2, a blob, the given with each part flattened to its mean color, the given with 10 percent random speckle.
// Every line is a number with a direction, so the calibration can place it. A line gates only when it separates (see style-calibrate.mjs).
//
// Lines:
//   S-PALETTE     off-palette cells plus half-transparent cells (walk palette only, pack PA-01 and PA-02)
//   S-RAMP        ramp lock: cells whose color family is wrong for the template part dilated by 1 px (needs part labels)
//   S-OUTLINE     near-black share of the edge cells (pack PA-03)
//   S-ORPHAN      orphan pixels / the given's (pack PA-04)
//   S-SMALL       squint 1-2 px regions / the given's (pack PA-09)
//   S-FLAT-GROUP  the lowest texture-density ratio to the given over the part groups of at least `flatMinCells` cells (pack, Flattening)
//   S-FLAT-WHOLE  the texture-density ratio to the given over the whole figure
//   S-DENS-BAND   number of part groups whose texture density sits outside the walk band (two-sided)
//   S-SQUINT      PA-14: clusters of equal value in 3 value bands, inside the walk band (two-sided)
//   S-RUNORDER    PA-15 / R2 T12: aligned-end runs of two colors that stack as bands (counts, at most the walk maximum)
import { colorAt, halfAlpha, isOpaque, orphans as orphanList, outlineRatio } from '../../metrics.mjs';
import { measureFrame } from '../../metrics.mjs';
import { lumaOf } from './color.mjs';
import { N, opaqueAt, packedAt } from './image.mjs';
import { GROUP_NAMES, autoLabel } from './parts.mjs';
import { flattening } from './flat.mjs';
import { rampLock } from './hardlines.mjs';

export const STYLE_LINE_IDS = ['S-PALETTE', 'S-RAMP', 'S-OUTLINE', 'S-ORPHAN', 'S-SMALL', 'S-FLAT-GROUP', 'S-FLAT-WHOLE', 'S-DENS-BAND', 'S-SQUINT', 'S-RUNORDER'];

const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];

const band3 = (l) => (l < 85 ? 0 : l < 170 ? 1 : 2);
/** PA-14 squint check: the number of 4-connected clusters of equal value band (3 bands: luma under 85, under 170, the rest) over the opaque cells. */
export function squintClusters(img) {
  const seen = new Uint8Array(N * N);
  let n = 0;
  const at = (x, y) => band3(lumaOf(img.data[(y * N + x) * 4], img.data[(y * N + x) * 4 + 1], img.data[(y * N + x) * 4 + 2]));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (seen[y * N + x] || !opaqueAt(img, x, y)) continue;
      n++;
      const k = at(x, y);
      const stack = [[x, y]];
      seen[y * N + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        for (const [dx, dy] of N4) {
          const X = cx + dx;
          const Y = cy + dy;
          if (X < 0 || Y < 0 || X >= N || Y >= N || seen[Y * N + X] || !opaqueAt(img, X, Y) || at(X, Y) !== k) continue;
          seen[Y * N + X] = 1;
          stack.push([X, Y]);
        }
      }
    }
  return n;
}

/** Maximal same-color runs of length at least minLen along one line of cells. get(i) returns a packed color or -1. */
function runsOf(get, len, minLen) {
  const out = [];
  let i = 0;
  while (i < len) {
    const c = get(i);
    if (c < 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < len && get(j + 1) === c) j++;
    if (j - i + 1 >= minLen) out.push({ a: i, b: j, c });
    i = j + 1;
  }
  return out;
}
/**
 * PA-15 run-order check (R2 T12, banding): two runs of different colors on adjacent lines, both at least `minLen` long, whose two ends sit on the same axis.
 * Near-black runs (outline and dark lines) are left out. Rows and columns both count. Returns the number of aligned pairs.
 */
export function bandingPairs(img, minLen = 3) {
  const col = (x, y) => (isOpaque(img, x, y) && lumaOf(...[0, 1, 2].map((k) => img.data[(y * img.w + x) * 4 + k])) >= 60 ? packedAt(img, x, y) : -1);
  let pairs = 0;
  for (const vertical of [false, true]) {
    const get = (line, i) => (vertical ? col(line, i) : col(i, line));
    for (let line = 0; line + 1 < N; line++) {
      const A = runsOf((i) => get(line, i), N, minLen);
      const B = runsOf((i) => get(line + 1, i), N, minLen);
      for (const a of A) for (const b of B) if (a.a === b.a && a.b === b.b && a.c !== b.c) pairs++;
    }
  }
  return pairs;
}

/** Direction and kind of each line: 'max' (value at most the limit), 'min' (at least), 'band' (inside [lo, hi]). */
export const LINE_META = {
  'S-PALETTE': { name: 'walk palette only, no half-transparent cell', dir: 'max', start: 0, pinned: true, rule: 'spike GO hard line; pack PA-01, PA-02' },
  'S-RAMP': { name: 'ramp lock to the template part dilated by 1 px', dir: 'max', start: 0, pinned: false, needsLabels: true, rule: 'plan v2 section 4' },
  'S-OUTLINE': { name: 'outline near-black share', dir: 'min', start: 0.93, pinned: true, rule: 'spike GO hard line; pack PA-03' },
  'S-ORPHAN': { name: 'orphans / the given', dir: 'max', start: 1.25, pinned: true, rule: 'spike GO hard line; pack PA-04 (C5: stays 1.25x, calibrated on the walk frames)' },
  'S-SMALL': { name: 'squint 1-2 px regions / the given', dir: 'max', start: 1.25, pinned: true, rule: 'spike GO hard line; pack PA-09 (C5)' },
  'S-FLAT-GROUP': { name: 'lowest texture-density ratio over the part groups of at least N cells', dir: 'min', start: 0.8, pinned: false, rule: 'plan v2 section 4, Flattening (C5: per group of 20 or more cells)' },
  'S-FLAT-WHOLE': { name: 'texture-density ratio over the whole figure', dir: 'min', start: 0.8, pinned: false, rule: 'C5: and the whole figure' },
  'S-DENS-BAND': { name: 'part groups outside the walk density band', dir: 'max', start: 0, pinned: false, rule: 'C4: per-group texture density as a two-sided band' },
  'S-SQUINT': { name: 'PA-14 squint clusters (3 value bands)', dir: 'band', pinned: false, rule: 'C4: cluster count inside the walk band' },
  'S-RUNORDER': { name: 'PA-15 run order: aligned two-color runs (R2 T12 banding)', dir: 'max', start: null, pinned: false, rule: 'C4: PA-15 run-order check (R2 T12)' },
};

/** Does a value pass a line? The line data is gates.style.lines[id]. A null value passes (the line did not run). */
export function linePasses(meta, line, v) {
  if (v === null || v === undefined) return true;
  if (meta.dir === 'band') return v >= line.lo - 1e-9 && v <= line.hi + 1e-9;
  if (meta.dir === 'min') return v >= line.limit - 1e-9;
  return v <= line.limit + 1e-9;
}

/**
 * Raw values of every style line for one candidate.
 * opts: { spec, labels (candidate part labels or null for the automatic labeler), template (true when labels came from a template), flatMinCells }
 * Returns { values: { id: number|null }, detail: { id: string }, labelSource }.
 */
export function styleValues(img, { spec, labels = null, template = false, flatMinCells = 20, bands = null, rampLabels = null } = {}) {
  const labelSource = labels ? (template ? 'template' : 'given labels') : 'auto';
  const lab = labels ?? autoLabel(img);
  const t = spec.target;
  const pal = new Set(spec.palette.map((c) => c.toLowerCase()));
  let off = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (isOpaque(img, x, y) && !pal.has(colorAt(img, x, y).toLowerCase())) off++;
  const half = halfAlpha(img).count;
  const values = {};
  const detail = {};
  values['S-PALETTE'] = off + half;
  detail['S-PALETTE'] = `${off} off-palette cells, ${half} half-transparent`;
  const rl = rampLabels ?? labels;
  if (rl) {
    const bad = rampLock(img, rl);
    values['S-RAMP'] = bad.length;
    detail['S-RAMP'] = bad.slice(0, 5).map(([x, y, f]) => `${x},${y} ${f}`).join(' ');
  } else {
    values['S-RAMP'] = null; // needs template labels
    detail['S-RAMP'] = 'needs template labels';
  }
  values['S-OUTLINE'] = outlineRatio(img).ratio;
  values['S-ORPHAN'] = orphanList(img).length / t.given.orphans;
  values['S-SMALL'] = measureFrame(img).smallRegions / t.given.smallRegions;

  // Flattening per group and for the whole figure, against the given with the same labeler class.
  const fl = flattening(img, lab, spec, labelSource, flatMinCells);
  const dc = fl.densities;
  values['S-FLAT-GROUP'] = fl.lowest;
  detail['S-FLAT-GROUP'] = Object.entries(fl.groups).map(([g, v]) => `${g} ${v.ratio.toFixed(2)}`).join(' ');
  values['S-FLAT-WHOLE'] = fl.whole;
  detail['S-FLAT-WHOLE'] = `${fl.wholeCand.toFixed(3)} against ${fl.wholeGiven.toFixed(3)}`;

  // Band of the texture density per group (absolute density). Needs the band table; with none, the value is null.
  if (bands) {
    const out = [];
    for (const g of GROUP_NAMES) {
      const b = bands[g];
      if (!b || dc[g].cells < flatMinCells) continue;
      if (dc[g].density < b.lo - 1e-9 || dc[g].density > b.hi + 1e-9) out.push(`${g} ${dc[g].density.toFixed(2)} outside ${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}`);
    }
    values['S-DENS-BAND'] = out.length;
    detail['S-DENS-BAND'] = out.join('; ');
  } else values['S-DENS-BAND'] = null;
  values['S-SQUINT'] = squintClusters(img);
  values['S-RUNORDER'] = bandingPairs(img);
  return { values, detail, labelSource, groupDensity: dc };
}

