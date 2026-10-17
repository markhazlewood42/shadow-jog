// Structure tier of the v2 grade (consult C2 section C4, Amendment 2): reference-free checks. Nothing here reads a Sprite Fusion reference.
// The numbers come from three places only: the given frame (rows, widths), the R2 craft rules and the pack rules (tolerances, in facing-checks.json,
// each entry with its rule id), and the Amendment 1 hard lines (gates.json). No number is taken from a reference picture.
//
//   ST-GUIDE   PA-22 / R2 T2: head top, eye row, shoulder, hip and foot rows within 1 px of the given
//   ST-EYES    PA-19 / R2 T5, T8: the eye clusters (lens glints): count per facing, one row, 1 to 2 px wide
//   ST-HANDS   PA-20: each hand is a distinct cluster of at least 2 px; the 3 px upper bound is a report line (see facing-checks.json)
//   ST-ITEM    PA-20 / R2 T9: the item has its own outline (its edge cells are near-black)
//   ST-LIT     R2 T10 / PA-23: lit-minus-shadow luma on hair, torso and legs has the same sign as at se (sw and nw)
//   ST-SIDE    R2 T2: e and w guide rows against the battle idle (head top, first skin row, leg split, foot row), not row widths
// The Amendment 1 rows (height, bottom row, head alone, shoulder, hip), HL-FACE and HL-DISTINCT are in hardlines.mjs and join this tier by id.
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIdleFrames } from '../../pipeline/given.mjs';
import { lumaOf } from './color.mjs';
import { N, bboxOf, opaqueAt } from './image.mjs';
import { GROUP_OF_PART, autoLabel, colorClass } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FACING_CHECKS_PATH = `${here}/facing-checks.json`;
export const loadFacingChecks = () => JSON.parse(readFileSync(FACING_CHECKS_PATH, 'utf8'));

const item = (id, name, status, value, detail = '') => ({ id, name, status, value, detail });
const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Connected components of a list of [x, y] cells. conn 4 or 8. */
export function clustersOf(cells, conn = 8) {
  const key = (x, y) => y * 1000 + x;
  const left = new Map(cells.map(([x, y]) => [key(x, y), [x, y]]));
  const out = [];
  const nb = conn === 4 ? N4 : N8;
  while (left.size) {
    const [k0, c0] = left.entries().next().value;
    left.delete(k0);
    const comp = [c0];
    for (let i = 0; i < comp.length; i++) {
      const [x, y] = comp[i];
      for (const [dx, dy] of nb) {
        const k = key(x + dx, y + dy);
        if (left.has(k)) {
          comp.push(left.get(k));
          left.delete(k);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

const classAt = (img, x, y) => colorClass(img.data[(y * img.w + x) * 4], img.data[(y * img.w + x) * 4 + 1], img.data[(y * img.w + x) * 4 + 2]);
const cellsWhere = (img, labels, pred) => {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (opaqueAt(img, x, y) && labels[y * N + x] && pred(labels[y * N + x], x, y)) out.push([x, y]);
  return out;
};

/** Eye cells: cells of the lens part in the lens glint colors (gold or warm class). The dark visor cells of the lens part are not eyes. */
export function eyeCells(img, labels) {
  return cellsWhere(img, labels, (p, x, y) => p === 'lenses' && ['gold', 'warm'].includes(classAt(img, x, y)));
}
/** Longest horizontal run of one cluster, in cells. */
export function maxRun(cells) {
  const rows = new Map();
  for (const [x, y] of cells) rows.set(y, [...(rows.get(y) ?? []), x].sort((a, b) => a - b));
  let best = 0;
  for (const xs of rows.values()) {
    let run = 1;
    for (let i = 1; i < xs.length; i++) {
      run = xs[i] === xs[i - 1] + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    best = Math.max(best, run);
  }
  return best;
}
/** Eye summary: the clusters, their widest run and the spread of their mean rows. */
export function eyeSummary(img, labels) {
  const cells = eyeCells(img, labels);
  const cl = clustersOf(cells, 8);
  const rows = cl.map((c) => c.reduce((s, [, y]) => s + y, 0) / c.length);
  return { cells: cells.length, clusters: cl.length, widthMax: cl.length ? Math.max(...cl.map(maxRun)) : 0, rowSpread: rows.length ? Math.max(...rows) - Math.min(...rows) : 0, meanRow: cells.length ? cells.reduce((s, [, y]) => s + y, 0) / cells.length : null };
}

const TORSO = ['coat', 'sleeves', 'zipper'];
/** The PA-22 guide rows: head top, eye (mean lens glint row), shoulder (first torso row), hip (last torso row), foot (first boot row). null when absent. */
export function guideRows(img, labels) {
  const b = bboxOf(img);
  const torso = cellsWhere(img, labels, (p) => TORSO.includes(p));
  const boots = cellsWhere(img, labels, (p) => p === 'boots');
  const eye = eyeCells(img, labels);
  return {
    headTop: b ? b.y0 : null,
    eye: eye.length ? eye.reduce((s, [, y]) => s + y, 0) / eye.length : null,
    shoulder: torso.length ? Math.min(...torso.map(([, y]) => y)) : null,
    hip: torso.length ? Math.max(...torso.map(([, y]) => y)) : null,
    foot: boots.length ? Math.min(...boots.map(([, y]) => y)) : null,
  };
}

/** Hand clusters: 8-connected skin-class cells of the hands part. Returns the list of cluster sizes and their widest runs. */
export function handClusters(img, labels) {
  const cells = cellsWhere(img, labels, (p, x, y) => p === 'hands' && classAt(img, x, y) === 'skin');
  const cl = clustersOf(cells, 8);
  return cl.map((c) => ({ size: c.length, width: maxRun(c), x: c.reduce((s, [x]) => s + x, 0) / c.length }));
}

/** Item edge: the share of the item cells (sheath, guard, wrap) that touch transparency and are near-black. */
export function itemEdge(img, labels) {
  const cells = cellsWhere(img, labels, (p) => GROUP_OF_PART[p] === 'item');
  let edge = 0;
  let dark = 0;
  for (const [x, y] of cells) {
    if (!N4.some(([dx, dy]) => !opaqueAt(img, x + dx, y + dy))) continue;
    edge++;
    if (lumaOf(img.data[(y * N + x) * 4], img.data[(y * N + x) * 4 + 1], img.data[(y * N + x) * 4 + 2]) < 60) dark++;
  }
  return { cells: cells.length, edge, dark, share: edge ? dark / edge : null };
}

/** Lit-minus-shadow luma of one part group: mean luma of the right half of its cells minus the left half (split at the median column; that column is left out). */
export function litMinusShadow(img, labels, group) {
  const cells = cellsWhere(img, labels, (p) => GROUP_OF_PART[p] === group);
  if (cells.length < 6) return null;
  const xs = cells.map(([x]) => x).sort((a, b) => a - b);
  const med = xs[Math.floor(xs.length / 2)];
  const mean = (list) => (list.length ? list.reduce((s, [x, y]) => s + lumaOf(img.data[(y * N + x) * 4], img.data[(y * N + x) * 4 + 1], img.data[(y * N + x) * 4 + 2]), 0) / list.length : null);
  const r = mean(cells.filter(([x]) => x > med));
  const l = mean(cells.filter(([x]) => x < med));
  return r === null || l === null ? null : r - l;
}

/** The side guide rows of a figure, as fractions of its height (0 = head top, 1 = foot row): head top, first skin row, leg split, foot. */
export function sideGuide(img) {
  const b = bboxOf(img);
  if (!b) return null;
  const rowRuns = (y) => {
    let runs = 0;
    for (let x = 0; x < img.w; x++) if (opaqueAt(img, x, y) && !opaqueAt(img, x - 1, y)) runs++;
    return runs;
  };
  let skin = null;
  for (let y = b.y0; y <= b.y1 && skin === null; y++)
    for (let x = 0; x < img.w; x++) if (opaqueAt(img, x, y) && classAt(img, x, y) === 'skin') {
      skin = y;
      break;
    }
  // Leg split: scanning up from the foot row, the highest row of the lowest stretch of rows that hold two or more runs.
  let split = null;
  for (let y = b.y1; y >= b.y0 + Math.floor(b.h / 2); y--) {
    if (rowRuns(y) >= 2) split = y;
    else if (split !== null) break;
  }
  const f = (y) => (y === null ? null : (y - b.y0) / (b.h - 1));
  return { headTop: 0, skin: f(skin), split: f(split), foot: 1, h: b.h };
}

let idleCache = null;
/** The side guide of the battle idle over its 8 frames: per metric the min and max fraction. */
export function idleSideGuide() {
  if (idleCache) return idleCache;
  const frames = loadIdleFrames();
  if (!frames) return null;
  const per = frames.map((f) => sideGuide({ w: f.w, h: f.h, data: f.data }));
  const range = (k) => {
    const v = per.map((p) => p[k]).filter((x) => x !== null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v), n: v.length } : null;
  };
  idleCache = { skin: range('skin'), split: range('split'), frames: per.length };
  return idleCache;
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * The structure lines for one candidate (the ones that are not in hardlines.mjs).
 * opts: { facing, spec, labels (candidate part labels, null for the automatic labeler), checks (facing-checks.json), idle }
 */
export function structureLines(img, { facing, spec, labels = null, checks = loadFacingChecks(), idle = undefined }) {
  const lab = labels ?? autoLabel(img);
  const out = [];
  const g = guideRows(spec.given, spec.givenLabels);
  const c = guideRows(img, lab);

  // ST-GUIDE (PA-22): within rowTol of the given. The eye row runs only on facings that show eyes.
  {
    const tol = checks.rowTol.value;
    const names = ['headTop', 'eye', 'shoulder', 'hip', 'foot'];
    const off = [];
    for (const n of names) {
      if (n === 'eye' && !checks.guideRows.eyeFacings.includes(facing)) continue;
      if (facing === 'e' || facing === 'w') {
        if (n !== 'headTop' && n !== 'foot') continue; // e and w compare with the battle idle (ST-SIDE), not with the given
      }
      if (c[n] === null || g[n] === null) {
        off.push(`${n} missing`);
        continue;
      }
      if (Math.abs(c[n] - g[n]) > tol + 1e-9) off.push(`${n} ${c[n]} against ${g[n]}`);
    }
    out.push(item('ST-GUIDE', `guide rows (head top, eye, shoulder, hip, foot) within ${tol} px of the given`, off.length ? 'fail' : 'pass', off.length ? off.join('; ') : `head top ${c.headTop}, shoulder ${c.shoulder}, hip ${c.hip}, foot ${c.foot}`, checks.rowTol.rule));
  }

  // ST-EYES (PA-19).
  {
    const e = checks.eyes[facing];
    if (!e) out.push(item('ST-EYES', `eyes at ${facing}`, 'skipped', 'no rule for this facing'));
    else {
      const s = eyeSummary(img, lab);
      const why = [];
      if (s.clusters < e.clustersMin) why.push(`${s.clusters} eye clusters, needs at least ${e.clustersMin}`);
      if (s.clusters > e.clustersMax) why.push(`${s.clusters} eye clusters, allows at most ${e.clustersMax}`);
      if (e.widthMax !== undefined && s.widthMax > e.widthMax) why.push(`an eye is ${s.widthMax} px wide, allows ${e.widthMax}`);
      if (e.rowSpreadMax !== undefined && s.rowSpread > e.rowSpreadMax + 1e-9) why.push(`the eyes sit ${s.rowSpread.toFixed(1)} rows apart, allows ${e.rowSpreadMax}`);
      out.push(item('ST-EYES', `eyes at ${facing}: ${e.clustersMin} to ${e.clustersMax} clusters${e.widthMax !== undefined ? `, at most ${e.widthMax} px wide` : ''}${e.rowSpreadMax !== undefined ? ', on one row' : ''}`, why.length ? 'fail' : 'pass', `${s.clusters} clusters, ${s.cells} cells`, why.join('; ') || e.rule));
    }
  }

  // ST-HANDS (PA-20).
  {
    const h = checks.hands;
    const hs = handClusters(img, lab);
    const want = h.count[facing];
    const why = [];
    if (want) {
      if (hs.length < want.min) why.push(`${hs.length} hand clusters, needs at least ${want.min}`);
      if (hs.length > want.max) why.push(`${hs.length} hand clusters, allows at most ${want.max}`);
    }
    // The far hand may be partly hidden at the side and 3/4 back facings (R2 section 2): the smallest cluster needs farHandMin px there.
    const sorted = [...hs].sort((a, b) => a.size - b.size);
    const far = h.farHandMin.facings.includes(facing);
    const small = sorted.filter((x, i) => x.size < (far && i === 0 ? h.farHandMin.value : h.minCells));
    if (small.length) why.push(`${small.length} hand cluster(s) too small (${small.map((x) => `${x.size}px`).join(', ')}; needs ${h.minCells}${far ? `, the far hand ${h.farHandMin.value}` : ''})`);
    out.push(item('ST-HANDS', `each hand is a distinct cluster of at least ${h.minCells} px`, why.length ? 'fail' : 'pass', hs.map((x) => `${x.size}px`).join(', ') || 'none', why.join('; ') || h.rule));
    const big = hs.filter((x) => x.size > h.maxCells);
    out.push(item('ST-HANDS-MAX', `hand clusters of at most ${h.maxCells} px (the pack's 2 to 3 px; a report line)`, 'info', big.length ? `${big.length} over` : 'ok', h.maxNote));
  }

  // ST-ITEM (PA-20, R2 T9).
  {
    const it = checks.item;
    const ie = itemEdge(img, lab);
    if (ie.edge < it.minEdgeCells) out.push(item('ST-ITEM', 'the item has its own outline', 'skipped', `${ie.edge} item edge cells`, `needs at least ${it.minEdgeCells}`));
    else out.push(item('ST-ITEM', `the item has its own outline: at least ${(it.edgeNearBlackMin * 100).toFixed(0)}% of its edge cells are near-black`, ie.share >= it.edgeNearBlackMin - 1e-9 ? 'pass' : 'fail', `${(ie.share * 100).toFixed(0)}% of ${ie.edge}`, it.rule));
  }

  // ST-LIT (R2 T10, PA-23): same sign as at se.
  if (checks.litSide.facings.includes(facing)) {
    const ls = checks.litSide;
    const why = [];
    const vals = [];
    for (const grp of ls.groups) {
      const ref = litMinusShadow(spec.given, spec.givenLabels, grp);
      const v = litMinusShadow(img, lab, grp);
      if (ref === null || Math.abs(ref) < ls.minAbsAtSe || v === null) continue; // a part without a clear lit side at se is not checked
      vals.push(`${grp} ${v.toFixed(1)} (se ${ref.toFixed(1)})`);
      if (sign(v) !== sign(ref)) why.push(`${grp} ${v.toFixed(1)} has the other sign than se ${ref.toFixed(1)}`);
    }
    const rep = ls.reportGroups.map((grp) => {
      const v = litMinusShadow(img, lab, grp);
      const ref = litMinusShadow(spec.given, spec.givenLabels, grp);
      return `${grp} ${v === null ? 'n/a' : v.toFixed(1)} (se ${ref === null ? 'n/a' : ref.toFixed(1)})`;
    });
    out.push(item('ST-LIT-REPORT', 'lit-minus-shadow luma of the report groups (legs change sign with the pose)', 'info', rep.join(', ')));
    out.push(item('ST-LIT', 'lit-minus-shadow luma has the same sign as at se (hair, torso, legs)', !vals.length ? 'skipped' : why.length ? 'fail' : 'pass', vals.join(', ') || 'no part', why.join('; ') || ls.rule));
  }

  // ST-SIDE: e and w guide rows against the battle idle.
  if (checks.sideGuide.facings.includes(facing)) {
    const sg = checks.sideGuide;
    const id = idle === undefined ? idleSideGuide() : idle;
    const cand = sideGuide(img);
    if (!id || !cand) out.push(item('ST-SIDE', 'e and w guide rows against the battle idle', 'skipped', 'no idle sheet or empty image'));
    else {
      const why = [];
      const rows = [];
      for (const k of ['skin', 'split']) {
        const r = id[k];
        const v = cand[k];
        if (!r) continue;
        if (v === null) {
          why.push(`${k} row missing`);
          continue;
        }
        const lo = (r.min * (cand.h - 1)) - sg.rowTol.value;
        const hi = (r.max * (cand.h - 1)) + sg.rowTol.value;
        const y = v * (cand.h - 1);
        rows.push(`${k} ${y.toFixed(0)} (idle ${(r.min * (cand.h - 1)).toFixed(1)} to ${(r.max * (cand.h - 1)).toFixed(1)})`);
        if (y < lo - 1e-9 || y > hi + 1e-9) why.push(`${k} row ${y.toFixed(0)} is outside ${lo.toFixed(1)} to ${hi.toFixed(1)}`);
      }
      const gh = bboxOf(spec.given)?.h ?? cand.h;
      if (Math.abs(cand.h - gh) > checks.rowTol.value) why.push(`height ${cand.h} against ${gh} (R2 T2: same total height)`);
      out.push(item('ST-SIDE', `e and w guide rows (head top, first skin row, leg split, foot) against the battle idle, within ${sg.rowTol.value} px of its bounce range`, why.length ? 'fail' : 'pass', rows.join(', '), why.join('; ') || sg.rowTol.rule));
    }
  }
  return out;
}
