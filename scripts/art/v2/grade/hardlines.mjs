// Hard-line checker for one candidate facing (plan v2 section 4, Amendment 1 of the spike doc).
// Every numeric line is read from the data: the given numbers from target.json and the plan's lines from gates.json.
// Reuses pixlint (PA-01, 02, 03, 04, 06, 07, 08, 09, 21) and the pipeline metrics (given part map, ramp families).
// Lines that need a template (ramp lock) run only when a template label grid is passed; they report 'skipped' otherwise.
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILY_OF_LETTER, LETTER_OF } from '../../headtest/lib.mjs';
import { colorAt, isOpaque, measureFrame, orphans as orphanList, outlineRatio } from '../../metrics.mjs';
import { PARTS } from '../../pipeline/decompose.mjs';
import { buildPartMap } from '../../pipeline/decompose.mjs';
import { loadGiven, readTarget } from '../../pipeline/given.mjs';
import { lintFrame } from '../../pixlint.mjs';
import { de00Packed } from './color.mjs';
import { N, bboxOf, flipH, opaqueAt, packedAt, toCanvas } from './image.mjs';
import { HEAD_ROWS, autoLabel, colorClass, labelsFromPartMap, toGroups } from './parts.mjs';
import { textureDensity, MIN_PART_CELLS } from './measures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const GATES_PATH = `${here}/gates.json`;
export const loadGates = () => JSON.parse(readFileSync(GATES_PATH, 'utf8'));

/**
 * The lines in force. hardLines holds the plan's lines. hardLines.reset holds the values that the calibration proposes for the lines that
 * failed should-pass items (orphanFactor, widthTol, headWidthTol, flatteningFloor). They apply only when hardLines.useReset is true,
 * because two of them re-set a line that Mark wrote into the spike exit criteria.
 */
export function effectiveLines(HL) {
  const base = { orphanFactor: HL.countFactor, smallFactor: HL.countFactor, headWidthTol: 1 };
  return { ...HL, ...base, ...(HL.useReset ? HL.reset : {}) };
}

const HEAD_PARTS = ['hair', 'skin', 'lenses', 'beard'];
const TORSO = ['coat', 'sleeves', 'zipper'];

const item = (id, name, status, value, detail = '') => ({ id, name, status, value, detail });
export const hasFail = (items) => items.some((i) => i.status === 'fail');

/** The given's numbers and palette from target.json plus the part labels of the given (the truth part map). */
export function loadSpec() {
  const target = readTarget();
  const img = loadGiven();
  const labels = labelsFromPartMap(buildPartMap(img));
  return { target, given: img, givenLabels: labels, palette: target.walkPalette, nearBlack: target.nearBlack };
}

/** Number of cells that differ between two canvases: opacity differs, or both opaque and dE00 above 5. */
export function cellDiff(a, b, tau = 5) {
  let n = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const oa = opaqueAt(a, x, y);
      const ob = opaqueAt(b, x, y);
      if (oa !== ob) n++;
      else if (oa && de00Packed(packedAt(a, x, y), packedAt(b, x, y)) > tau) n++;
    }
  return n;
}

/** Head alone: the widest row extent over the head-part cells in the top 13 rows of the box (hilt and sheath are not head parts). */
export function headAlone(labels, w, b) {
  let best = 0;
  for (let y = b.y0; y <= b.y0 + HEAD_ROWS - 2; y++) {
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x++)
      if (HEAD_PARTS.includes(labels[y * w + x])) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    if (hi >= 0) best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** First and last row that hold torso cells (coat, sleeves, zipper). */
export function torsoRows(labels, w, h) {
  let lo = -1;
  let hi = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (TORSO.includes(labels[y * w + x])) {
        if (lo < 0) lo = y;
        hi = y;
      }
  return { shoulder: lo, hip: hi };
}

/** Skin cells in the eye and nose rows (color class skin). Returns { count, cells }. */
export function faceSkin(img, b, [r0, r1]) {
  const cells = [];
  for (let y = b.y0 + r0; y <= b.y0 + r1; y++)
    for (let x = 0; x < img.w; x++) {
      if (!opaqueAt(img, x, y)) continue;
      const i = (y * img.w + x) * 4;
      if (colorClass(img.data[i], img.data[i + 1], img.data[i + 2]) === 'skin') cells.push([x, y]);
    }
  return { count: cells.length, cells };
}

const NB_FAMILY = 'near-black';
/** Family of a color (palette letter family), or null for an off-palette color. */
function familyOfColor(hex) {
  const l = LETTER_OF[hex];
  return l ? FAMILY_OF_LETTER[l] : null;
}
/** Ramp lock: every cell's family must be near-black or a family of a template part within 1 px (3x3). Returns violations. */
export function rampLock(img, templateLabels) {
  const bad = [];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      const fam = familyOfColor(colorAt(img, x, y));
      if (fam === NB_FAMILY) continue;
      let ok = false;
      for (let j = -1; j <= 1 && !ok; j++)
        for (let i = -1; i <= 1 && !ok; i++) {
          const p = templateLabels[(y + j) * img.w + (x + i)];
          if (x + i < 0 || y + j < 0 || x + i >= img.w || y + j >= img.h || !p) continue;
          if (PARTS[p]?.families.includes(fam)) ok = true;
        }
      if (!ok) bad.push([x, y, fam]);
    }
  return bad;
}

/**
 * Run every hard line on one candidate.
 * opts.facing        'se' (the given), 's', 'n', 'ne', 'nw', 'sw', 'e', 'w'
 * opts.spec          loadSpec() result (default: loaded)
 * opts.gates         gates.json (default: loaded)
 * opts.labels        label grid of the candidate: a template, or null for the automatic labeler
 * opts.template      true when opts.labels came from a template (then ramp lock runs)
 * opts.set           [{ name, img }] the other facings of the set (and the given), for PA-08 and the distinct line
 * opts.sheathSide    'left' or 'right': when given, the PA-21 side must match
 * opts.exempt        list of item names to leave out (a calibration helper)
 * Returns { pass, items, labelSource }.
 */
export function checkHardLines(candRaw, opts = {}) {
  const spec = opts.spec ?? loadSpec();
  const gates = opts.gates ?? loadGates();
  // Effective lines: the plan's lines, or the calibration's re-set values when gates.hardLines.useReset is true.
  const HL = effectiveLines(gates.hardLines);
  const facing = opts.facing ?? 'se';
  const img = toCanvas(candRaw, N);
  const b = bboxOf(img);
  const items = [];
  if (!b) return { pass: false, items: [item('HL-EMPTY', 'image has opaque cells', 'fail', 'empty image')], labelSource: 'none' };
  const labels = opts.labels ?? autoLabel(img);
  const labelSource = opts.labels ? (opts.template ? 'template' : 'given labels') : 'auto';
  const t = spec.target;
  const setColors = opts.set?.length ? [...new Set(opts.set.flatMap((s) => (s.img ? colorsHex(toCanvas(s.img, N)) : [])))] : null;

  // pixlint: PA-01, PA-02, PA-03, PA-04, PA-06, PA-07, PA-08, PA-09, PA-21.
  const lint = lintFrame(img, {
    palette: spec.palette,
    ref: t.given,
    refColors: spec.palette,
    katana: t.katanaColors,
    facing: true,
    setColors,
  });
  for (const it of lint) {
    if (it.status === 'skipped') continue;
    if (it.id === 'PA-06' && /box width/.test(it.name) && !(facing in HL.widthTol)) continue; // the width line is for down and up only
    if (it.id === 'PA-06' && /box width/.test(it.name)) {
      const tol = HL.widthTol[facing];
      const w = b.w - t.given.bboxWidth;
      items.push(item('PA-06', `box width within ${tol} px of the given`, Math.abs(w) <= tol ? 'pass' : 'fail', `${b.w}, given ${t.given.bboxWidth}`));
      continue;
    }
    if (it.id === 'PA-07' && /head width/.test(it.name)) {
      if (!HL.headWidthFacings.includes(facing)) continue;
      const m = measureFrame(img);
      items.push(item('PA-07', `head width within ${HL.headWidthTol} px of the given`, Math.abs(m.headWidth - t.given.headWidth) <= HL.headWidthTol ? 'pass' : 'fail', `${m.headWidth}, given ${t.given.headWidth}`));
      continue;
    }
    if (it.id === 'PA-03' && it.status !== 'info') {
      const ratio = Number.parseFloat(it.value) / 100;
      items.push(item('PA-03', `outline >= ${(HL.outlineMin * 100).toFixed(0)}% near-black`, ratio >= HL.outlineMin - 1e-9 ? 'pass' : 'fail', it.value, it.detail));
      continue;
    }
    if (it.id === 'PA-21') {
      const m = /^(left|right|center)/.exec(it.value);
      const mismatch = opts.sheathSide && m && m[1] !== opts.sheathSide;
      items.push(item('PA-21', 'sheath side', opts.sheathSide ? (mismatch ? 'fail' : 'pass') : 'info', it.value, opts.sheathSide ? `expected ${opts.sheathSide}` : 'reported, not a gate: the spec sets the side'));
      continue;
    }
    if (it.id === 'PA-06' && /baseline/.test(it.name)) continue; // replaced by the exact bottom-row line below
    if (it.id === 'PA-07' && /body height/.test(it.name)) continue; // replaced by the height line below
    if (it.id === 'PA-04' || it.id === 'PA-09') {
      const factor = it.id === 'PA-04' ? HL.orphanFactor : HL.smallFactor;
      const lim = Math.floor(factor * (it.id === 'PA-04' ? t.given.orphans : t.given.smallRegions));
      const v = Number.parseInt(it.value, 10);
      items.push(item(it.id, `${it.id === 'PA-04' ? 'orphans' : 'squint 1-2 px regions'} <= ${factor}x the given`, v <= lim ? 'pass' : 'fail', `${v} (limit ${lim})`, it.id === 'PA-04' ? it.detail : ''));
      continue;
    }
    items.push(it);
  }

  // Own lines.
  const heightOk = Math.abs(b.h - HL.height.given) <= HL.height.tol;
  items.push(item('HL-HEIGHT', `height ${HL.height.given} +/- ${HL.height.tol}`, heightOk ? 'pass' : 'fail', `${b.h}`));
  items.push(item('HL-BOTTOM', `bottom row ${HL.bottomRow}`, b.y1 === HL.bottomRow ? 'pass' : 'fail', `${b.y1}`));
  const ha = headAlone(labels, N, b);
  items.push(item('HL-HEAD', `head alone ${HL.headAlone.min} to ${HL.headAlone.max} px`, ha >= HL.headAlone.min && ha <= HL.headAlone.max ? 'pass' : 'fail', `${ha}`, `labels: ${labelSource}`));
  const tr = torsoRows(labels, N, N);
  const gTr = torsoRows(spec.givenLabels, N, N);
  items.push(item('HL-SHOULDER', `shoulder row within ${HL.shoulderTol} px of the given`, tr.shoulder >= 0 && Math.abs(tr.shoulder - gTr.shoulder) <= HL.shoulderTol ? 'pass' : 'fail', `${tr.shoulder}, given ${gTr.shoulder}`, `labels: ${labelSource}`));
  items.push(item('HL-HIP', `hip row within ${HL.hipTol} px of the given`, tr.hip >= 0 && Math.abs(tr.hip - gTr.hip) <= HL.hipTol ? 'pass' : 'fail', `${tr.hip}, given ${gTr.hip}`, `labels: ${labelSource}`));

  // Face skin rule.
  const rule = HL.faceSkin[facing];
  if (rule) {
    const fs = faceSkin(img, b, HL.faceSkin.eyeRows);
    let status = 'pass';
    let why = '';
    if (rule.min !== undefined && fs.count < rule.min) {
      status = 'fail';
      why = `needs at least ${rule.min}`;
    }
    if (rule.max !== undefined && fs.count > rule.max) {
      status = 'fail';
      why = `allows at most ${rule.max}`;
    }
    if (rule.edgeCols !== undefined && status === 'pass' && fs.cells.length) {
      // Skin only on the near cheek edge: each skin cell within edgeCols columns of the head's outer column in its row.
      const off = fs.cells.filter(([x, y]) => {
        let lo = N;
        let hi = -1;
        for (let X = 0; X < N; X++) if (HEAD_PARTS.includes(labels[y * N + X])) {
          lo = Math.min(lo, X);
          hi = Math.max(hi, X);
        }
        return !(x - lo <= rule.edgeCols || hi - x <= rule.edgeCols);
      });
      if (off.length) {
        status = 'fail';
        why = `${off.length} skin cells away from the cheek edge`;
      }
    }
    items.push(item('HL-FACE', `face skin rule for ${facing}`, status, `${fs.count} skin cells in rows ${HL.faceSkin.eyeRows.join(' to ')}`, why));
  } else items.push(item('HL-FACE', `face skin rule for ${facing}`, 'skipped', 'no rule for this facing'));

  // Distinct facings: differ from every other facing and from its flip by at least N cells.
  if (opts.set?.length && HL.distinctN !== null) {
    const worst = [];
    for (const s of opts.set) {
      if (s.name === opts.name) continue;
      const other = toCanvas(s.img, N);
      worst.push([cellDiff(img, other), s.name], [cellDiff(img, flipH(other)), `flip of ${s.name}`]);
    }
    worst.sort((x, y) => x[0] - y[0]);
    const low = worst[0];
    items.push(item('HL-DISTINCT', `differs from every other facing and its flip by at least ${HL.distinctN} cells`, low[0] >= HL.distinctN ? 'pass' : 'fail', `${low[0]} cells (${low[1]})`));
  } else items.push(item('HL-DISTINCT', 'distinct facings', 'skipped', opts.set?.length ? 'distinctN is not calibrated' : 'no set given'));

  // Ramp lock (needs a template).
  if (opts.template && opts.labels) {
    const bad = rampLock(img, opts.labels);
    items.push(item('HL-RAMP', 'ramp lock to the template part dilated by 1 px', bad.length === 0 ? 'pass' : 'fail', `${bad.length} cells`, bad.slice(0, 5).map(([x, y, f]) => `${x},${y} ${f}`).join(' ')));
  } else items.push(item('HL-RAMP', 'ramp lock to the template', 'skipped', 'needs a template'));

  // Flattening floor: per part group, the texture density is at least 0.8x the given's.
  const dc = textureDensity(img, toGroups(labels));
  const dg = textureDensity(toCanvas(spec.given, N), toGroups(spec.givenLabels));
  const low = [];
  let lowestRatio = Number.POSITIVE_INFINITY;
  for (const g of Object.keys(dc)) {
    if (dc[g].cells < MIN_PART_CELLS || dg[g].cells < MIN_PART_CELLS) continue;
    if (dg[g].density > 0) lowestRatio = Math.min(lowestRatio, dc[g].density / dg[g].density);
    if (dc[g].density < HL.flatteningFloor * dg[g].density) low.push(`${g} ${dc[g].density.toFixed(2)} < ${(HL.flatteningFloor * dg[g].density).toFixed(2)}`);
  }
  items.push(item('HL-FLAT', `texture density per part at least ${HL.flatteningFloor}x the given`, low.length ? 'fail' : 'pass', low.length ? low.join('; ') : 'ok', `labels: ${labelSource}`));

  // Numeric view of each line, for the calibration: { value, dir, limit }. dir 'min' means the value must be at least the limit.
  const mf = measureFrame(img);
  const metrics = {
    'PA-03 outline ratio': { value: outlineRatio(img).ratio, dir: 'min', limit: HL.outlineMin },
    'PA-04 orphans / given': { value: orphanList(img).length / t.given.orphans, dir: 'max', limit: HL.orphanFactor },
    'PA-09 small regions / given': { value: mf.smallRegions / t.given.smallRegions, dir: 'max', limit: HL.smallFactor },
    'PA-06 box width deviation': { value: Math.abs(b.w - t.given.bboxWidth), dir: 'max', limit: HL.widthTol[facing] ?? null },
    'PA-07 head width deviation': { value: Math.abs(mf.headWidth - t.given.headWidth), dir: 'max', limit: HL.headWidthFacings.includes(facing) ? HL.headWidthTol : null },
    'HL-HEIGHT deviation': { value: Math.abs(b.h - HL.height.given), dir: 'max', limit: HL.height.tol },
    'HL-HEAD deviation from 14': { value: Math.abs(ha - 14), dir: 'max', limit: Math.max(14 - HL.headAlone.min, HL.headAlone.max - 14) },
    'HL-SHOULDER deviation': { value: Math.abs(tr.shoulder - gTr.shoulder), dir: 'max', limit: HL.shoulderTol },
    'HL-HIP deviation': { value: Math.abs(tr.hip - gTr.hip), dir: 'max', limit: HL.hipTol },
    'HL-FLAT lowest part ratio': { value: lowestRatio, dir: 'min', limit: HL.flatteningFloor },
  };
  const out = items.filter((i) => !(opts.exempt ?? []).includes(i.id) && !(opts.exempt ?? []).includes(`${i.id}:${i.name}`));
  return { pass: !hasFail(out), items: out, labelSource, metrics };
}

function colorsHex(img) {
  const s = new Set();
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (isOpaque(img, x, y)) s.add(colorAt(img, x, y));
  return [...s];
}

