// Fit report (plan stage S1): how well does the proxy, rendered at the given's facing, reproduce the given?
//   part mIoU against the given part map (decompose.mjs), landmark distance, light agreement, silhouette IoU.
// Blanked mode (T1, the 6a regression): pass blank = { x0, y0, x1, y1 }. Every cell in the box leaves the part map, the landmarks, the light fit
// and the score. The report then holds no number that was computed from a box cell of the given.
// Also here: the light fit and a numbers-only optimizer (coordinate descent over the spec numbers) for the spec author.
import { inBox, PART_NAMES } from '../../pipeline/decompose.mjs';
import { letterAt } from '../../headtest/lib.mjs';
import { AREA_GROUPS, labelMeasures } from './measures.mjs';
import { partPoint, project, renderTemplate } from './render.mjs';
import { SIZE, idsOfLabel, levelOfLetter } from './spec.mjs';

export const FIT_LINES = { mIoU: 0.85, landmarkPx: 1.0 };
const r4 = (v) => Math.round(v * 10000) / 10000;

/** True when the cell index lies in the blank box (always false with no box). */
export const maskedCell = (blank, k) => !!blank && inBox(blank, k % SIZE, Math.floor(k / SIZE));

/** Per-cell label of the given part map. Cells in the blank box are null (removed). */
export function givenLabels(pm, blank = null) {
  const out = Array(SIZE * SIZE).fill(null);
  for (const [name, cells] of Object.entries(pm.parts)) for (const k of cells) if (!maskedCell(blank, k)) out[k] = name;
  return out;
}

/** Level (0, 1, 2) of every given cell from its letter, through the ramp of the part ids that share its label. Null for outline letters, off-ramp letters and masked cells. */
export function givenLevels(spec, img, labels, blank = null) {
  const out = Array(SIZE * SIZE).fill(null);
  for (let k = 0; k < out.length; k++) {
    const l = labels[k];
    if (!l || maskedCell(blank, k)) continue;
    const letter = letterAt(img, k % SIZE, Math.floor(k / SIZE));
    for (const id of idsOfLabel(spec, l)) {
      const lv = levelOfLetter(spec, id, letter);
      if (lv !== null) { out[k] = lv; break; }
    }
  }
  return out;
}

const centroid = (cells) => {
  if (!cells.length) return null;
  let sx = 0, sy = 0;
  for (const k of cells) { sx += k % SIZE; sy += Math.floor(k / SIZE); }
  return [sx / cells.length, sy / cells.length];
};

/** IoU per label, over the cells outside the blank box. Labels in neither picture are left out. */
export function partIoU(tLabels, gLabels, blank = null) {
  const out = {};
  for (const name of PART_NAMES) {
    let inter = 0, uni = 0, nr = 0, ng = 0;
    const rc = [], gc = [];
    for (let k = 0; k < SIZE * SIZE; k++) {
      if (maskedCell(blank, k)) continue;
      const a = tLabels[k] === name;
      const b = gLabels[k] === name;
      if (a) { nr++; rc.push(k); }
      if (b) { ng++; gc.push(k); }
      if (a && b) inter++;
      if (a || b) uni++;
    }
    if (!uni) continue;
    out[name] = { iou: r4(inter / uni), render: nr, given: ng, rc: centroid(rc), gc: centroid(gc) };
  }
  return out;
}

/** Landmark distances in px between the projected 3D point and the given 2D point. Landmarks whose given point lies in the blank box are dropped. */
export function landmarkDistances(spec, t, blank = null) {
  const out = {};
  for (const [name, lm] of Object.entries(spec.landmarks ?? {})) {
    if (blank && inBox(blank, Math.floor(lm.given[0]), Math.floor(lm.given[1]))) continue;
    const P = partPoint(spec, t.joints, lm.part, lm.at);
    const s = project(spec, P);
    const d = Math.hypot(s.x - (lm.given[0] + 0.5), s.y - (lm.given[1] + 0.5));
    out[name] = { px: r4(d), at: [r4(s.x - 0.5), r4(s.y - 0.5)], given: lm.given };
  }
  return out;
}

/** Light agreement: over the cells where proxy and given hold the same label and the given letter has a level. */
export function lightAgreement(t, gLevels, gLabels, blank = null) {
  let n = 0, exact = 0, near = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (maskedCell(blank, k) || gLevels[k] === null || t.label[k] === null || t.label[k] !== gLabels[k]) continue;
    n++;
    const d = Math.abs(t.level[k] - gLevels[k]);
    if (d === 0) exact++;
    if (d <= 1) near++;
  }
  return { cells: n, exact: n ? r4(exact / n) : 0, withinOne: n ? r4(near / n) : 0 };
}

/**
 * Search the light vector (and the two level thresholds) for the best agreement with the given's letters.
 * Uses only given cells outside the blank box. Returns { vector, levels, agreement }. Does not change the spec.
 */
export function fitLight(spec, img, pm, { blank = null } = {}) {
  const gl = givenLabels(pm, blank);
  const lv = givenLevels(spec, img, gl, blank);
  const base = renderTemplate(spec, { facing: spec.givenFacing });
  const normals = base.normal;
  const score = (L, t1, t2) => {
    let n = 0, ok = 0;
    for (let k = 0; k < SIZE * SIZE; k++) {
      if (maskedCell(blank, k) || lv[k] === null || base.label[k] === null || base.label[k] !== gl[k]) continue;
      const nl = normals[k][0] * L[0] + normals[k][1] * L[1] + normals[k][2] * L[2] + (spec.parts[base.id[k]].bias ?? 0);
      const l = nl < t1 ? 0 : nl < t2 ? 1 : 2;
      n++;
      if (l === lv[k]) ok++;
    }
    return n ? ok / n : 0;
  };
  let best = { s: -1 };
  for (let az = -180; az < 180; az += 15)
    for (let el = 15; el <= 85; el += 10)
      for (const t1 of [-0.2, 0, 0.2, 0.35, 0.5])
        for (const t2 of [0.35, 0.5, 0.65, 0.8]) {
          if (t2 <= t1 + 0.1) continue;
          const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
          const L = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
          const s = score(L, t1, t2);
          if (s > best.s + 1e-9) best = { s, L, t1, t2, az, el };
        }
  return { vector: best.L.map((v) => r4(v)), levels: [best.t1, best.t2], azimuthDeg: best.az, elevationDeg: best.el, agreement: r4(best.s) };
}

/** The full fit report for one spec. opts: { blank } */
export function fitReport(spec, img, pm, { blank = null } = {}) {
  const t = renderTemplate(spec, { facing: spec.givenFacing });
  const gl = givenLabels(pm, blank);
  const iou = partIoU(t.label, gl, blank);
  const names = Object.keys(iou);
  const mIoU = names.length ? names.reduce((s, n) => s + iou[n].iou, 0) / names.length : 0;
  const big = names.filter((n) => iou[n].given >= 8);
  const mIoUBig = big.length ? big.reduce((s, n) => s + iou[n].iou, 0) / big.length : 0;
  let inter = 0, uni = 0, agree = 0, scored = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (maskedCell(blank, k)) continue;
    const a = t.label[k] !== null, b = gl[k] !== null;
    scored++;
    if (a && b) inter++;
    if (a || b) uni++;
    if (t.label[k] === gl[k]) agree++;
  }
  const lm = landmarkDistances(spec, t, blank);
  const worst = Object.entries(lm).sort((a, b) => b[1].px - a[1].px)[0];
  const lv = givenLevels(spec, img, gl, blank);
  const light = lightAgreement(t, lv, gl, blank);
  const minPart = names.length ? names.reduce((m, n) => (iou[n].iou < iou[m].iou ? n : m), names[0]) : null;
  return {
    facing: spec.givenFacing,
    blank,
    scoredCells: scored,
    mIoU: r4(mIoU),
    mIoUBigParts: r4(mIoUBig),
    silhouetteIoU: r4(uni ? inter / uni : 0),
    cellAccuracy: r4(scored ? agree / scored : 0),
    minPart: minPart ? { part: minPart, iou: iou[minPart].iou } : null,
    parts: Object.fromEntries(names.map((n) => [n, { iou: iou[n].iou, render: iou[n].render, given: iou[n].given }])),
    landmarks: lm,
    landmarkWorst: worst ? { name: worst[0], px: worst[1].px } : null,
    light,
    pass: {
      mIoU: mIoU >= FIT_LINES.mIoU,
      landmarks: Object.values(lm).every((v) => v.px <= FIT_LINES.landmarkPx),
    },
    centroids: Object.fromEntries(names.map((n) => [n, { render: iou[n].rc, given: iou[n].gc }])),
  };
}

export function formatFitReport(r) {
  const lines = [];
  lines.push(`fit at ${r.facing}${r.blank ? ` (blanked box x${r.blank.x0}..${r.blank.x1} y${r.blank.y0}..${r.blank.y1}; ${r.scoredCells} cells scored)` : ''}`);
  lines.push(`part mIoU ${r.mIoU.toFixed(4)} (line ${FIT_LINES.mIoU}) ${r.pass.mIoU ? 'PASS' : 'FAIL'}   parts of 8+ cells ${r.mIoUBigParts.toFixed(4)}   silhouette IoU ${r.silhouetteIoU.toFixed(4)}   cell accuracy ${r.cellAccuracy.toFixed(4)}`);
  lines.push(`weakest part ${r.minPart ? `${r.minPart.part} ${r.minPart.iou}` : 'none'}`);
  lines.push(`landmarks within ${FIT_LINES.landmarkPx} px: ${r.pass.landmarks ? 'PASS' : 'FAIL'}   worst ${r.landmarkWorst ? `${r.landmarkWorst.name} ${r.landmarkWorst.px} px` : 'none'}`);
  lines.push(`light agreement ${r.light.exact} exact, ${r.light.withinOne} within one level (${r.light.cells} cells)`);
  lines.push('part      iou    render given');
  for (const [n, p] of Object.entries(r.parts)) lines.push(`${n.padEnd(9)} ${p.iou.toFixed(3)}  ${String(p.render).padStart(5)} ${String(p.given).padStart(5)}`);
  lines.push('landmark              px   rendered       given');
  for (const [n, p] of Object.entries(r.landmarks)) lines.push(`${n.padEnd(20)} ${p.px.toFixed(2)}  (${p.at[0].toFixed(1)}, ${p.at[1].toFixed(1)})  (${p.given[0]}, ${p.given[1]})`);
  return lines.join('\n');
}

// ---- numbers-only optimizer ----
/** Rotation numbers the author may change: none by default. The head and the chest turn with the figure, so a facing never shows a head turned against its body. A spec may list limits here per joint to allow one. */
const ROT_LIMITS = {};
/** Paths of the numbers the author may change: prim numbers, joint offsets (not the root), limited joint rotations, camera pitch and origin y. A mirrored part or joint has none. */
export function tunablePaths(spec) {
  const paths = [];
  for (const [id, part] of Object.entries(spec.parts)) {
    if (part.mirrorOf) continue;
    const pr = part.prim;
    const keys = pr.type === 'ellipsoid' || pr.type === 'box' ? ['at', 'size'] : ['a', 'b'];
    for (const k of keys) for (let i = 0; i < 3; i++) if (!(part.center && i === 0 && k !== 'size')) paths.push(['parts', id, 'prim', k, i]);
    if (pr.type === 'capsule' || pr.type === 'cylinder') paths.push(['parts', id, 'prim', 'r']);
  }
  const mirrored = new Set(Object.values(spec.joints).map((j) => j.mirrorOf).filter(Boolean));
  for (const [n, j] of Object.entries(spec.joints)) {
    if (j.parent === null || j.mirrorOf) continue;
    const onAxis = !mirrored.has(n); // a joint that has no mirror partner sits on the figure axis: it never moves sideways
    for (let i = 0; i < 3; i++) if (!(onAxis && i === 0)) paths.push(['joints', n, 'offset', i]);
    for (const i of Object.keys(ROT_LIMITS[n] ?? {})) paths.push(['joints', n, 'rot', Number(i)]);
  }
  paths.push(['camera', 'pitchDeg'], ['camera', 'origin', 1], ['diagonalYaw'], ['diagonalHeadTurn']);
  return paths;
}
const getPath = (o, p) => p.reduce((a, k) => a[k], o);
const setPath = (o, p, v) => { getPath(o, p.slice(0, -1))[p[p.length - 1]] = v; };
const boundsOf = (p) => {
  if (p[p.length - 1] === 'r' || p[3] === 'size') return [0.3, Infinity];
  if (p[0] === 'joints' && p[2] === 'rot') return ROT_LIMITS[p[1]][p[3]];
  if (p[0] === 'camera' && p[1] === 'pitchDeg') return [5, 60];
  if (p[0] === 'diagonalYaw') return [15, 60];
  if (p[0] === 'diagonalHeadTurn') return [0, 35];
  return [-Infinity, Infinity];
};
/** Trust region: a number may move at most 3 units (positions) or 35 percent (sizes and radii) from its value in the anchor spec. Keeps the shapes meaning what the author set. */
const trustBounds = (p, a) => {
  if (a === undefined || p[0] === 'camera' || p[0] === 'diagonalYaw' || p[0] === 'diagonalHeadTurn') return [-Infinity, Infinity];
  if (p[p.length - 1] === 'r' || p[3] === 'size') return [a * 0.65, a * 1.35];
  if (p[2] === 'rot') return [-Infinity, Infinity];
  return [a - 3, a + 3];
};
const clampTo = (p, v, anchor) => {
  const [l1, h1] = boundsOf(p);
  const [l2, h2] = anchor ? trustBounds(p, getPath(anchor, p)) : [-Infinity, Infinity];
  return Math.min(h1, h2, Math.max(l1, l2, Math.round(v * 1000) / 1000));
};

const CAP = 7;
/** Distance (in cells, capped) from every cell to the nearest given cell of each label. Built once per optimizer run. */
function distanceMaps(gl, blank) {
  const maps = {};
  for (const name of PART_NAMES) {
    const cells = [];
    gl.forEach((l, k) => { if (l === name) cells.push(k); });
    if (!cells.length) continue;
    const m = new Float32Array(SIZE * SIZE).fill(CAP);
    for (let k = 0; k < SIZE * SIZE; k++) {
      if (maskedCell(blank, k)) continue;
      const x = k % SIZE, y = Math.floor(k / SIZE);
      let d = CAP;
      for (const c of cells) d = Math.min(d, Math.hypot(c % SIZE - x, Math.floor(c / SIZE) - y));
      m[k] = d;
    }
    maps[name] = m;
  }
  return maps;
}

/**
 * Objective for the optimizer: part mIoU, plus a smooth pull in both directions so a part that is hidden or misplaced has a slope:
 * rendered cells of a label should sit near given cells of that label, and given cells should sit near rendered cells of that label.
 */
/**
 * Guard against a spec that fits the given and breaks at the other facings: how far the templates of the guarded facings are from the structure lines
 * of the template checks (checks.mjs). 0 = every guarded line holds with a margin. Uses only the given's part map (gm = labelMeasures of it).
 */
export function guardPenalty(spec, gm, facings) {
  let pen = 0;
  for (const f of facings) {
    const m = labelMeasures(renderTemplate(spec, { facing: f }).label);
    pen += Math.max(0, Math.abs(m.height - 31) - 1) * 0.2 + Math.abs(m.bottom - 30) * 0.2;
    pen += Math.max(0, Math.abs(m.headAlone - gm.headAlone) - 1) * 0.1 + Math.max(0, (m.headAlone < 13 ? 13 - m.headAlone : 0) + (m.headAlone > 15 ? m.headAlone - 15 : 0)) * 0.1;
    for (const k of ['shoulder', 'hip']) pen += m[k] === null ? 0.3 : Math.max(0, Math.abs(m[k] - gm[k]) - 1) * 0.05;
    for (const [name, labels] of Object.entries(AREA_GROUPS)) {
      if (name === 'item') continue;
      const ga = labels.reduce((a, l) => a + gm.areas[l], 0);
      if (!ga) continue;
      const ta = labels.reduce((a, l) => a + m.areas[l], 0);
      pen += Math.max(0, Math.abs(ta / ga - 1) - 0.2);
    }
  }
  return pen;
}

export function fitObjective(spec, gl, blank, dmaps = distanceMaps(gl, blank), guard = null) {
  const t = renderTemplate(spec, { facing: spec.givenFacing });
  const iou = partIoU(t.label, gl, blank);
  const names = Object.keys(iou);
  let m = 0;
  for (const n of names) m += iou[n].iou;
  let rg = 0, nr = 0, gr = 0, ng = 0, inter = 0, uni = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (maskedCell(blank, k)) continue;
    const a = t.label[k], b = gl[k];
    if (a !== null) { nr++; rg += dmaps[a]?.[k] ?? CAP; }
    if (b !== null) {
      ng++;
      const x = k % SIZE, y = Math.floor(k / SIZE);
      let d = CAP;
      for (let dy = -6; dy <= 6 && d > 0; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE || t.label[yy * SIZE + xx] !== b) continue;
          const dd = Math.hypot(dx, dy);
          if (dd < d) d = dd;
        }
      gr += d;
    }
    if (a !== null && b !== null) inter++;
    if (a !== null || b !== null) uni++;
  }
  const pull = (nr ? rg / (nr * CAP) : 1) + (ng ? gr / (ng * CAP) : 1);
  return m / names.length - 0.15 * pull + 0.1 * (uni ? inter / uni : 0) - (guard ? 0.5 * guardPenalty(spec, guard.gm, guard.facings) : 0);
}

const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Numbers-only search over the spec. Returns a new spec (the input is not changed) and the objective before and after.
 *   steps    coordinate descent: the step sizes to sweep, in order. Each step size sweeps all numbers until a sweep changes nothing (at most maxSweeps).
 *   random   { iters, seed, sigma }: after the descent, seeded random moves of 1 to 3 numbers of one part (or one joint). A move stays if the objective rises.
 *   freeze   part ids whose numbers stay as they are.
 *   guard    facings (for example ['s', 'n']) whose templates must keep the structure lines of the template checks. Costs one extra render per facing per step. Ignored in blanked mode.
 * Deterministic for one input and one seed.
 */
export function optimizeSpec(spec, pm, { blank = null, steps = [1, 0.5, 0.25], maxSweeps = 6, paths = null, freeze = [], random = null, anchor = spec, guard = null } = {}) {
  const gl = givenLabels(pm, blank);
  const dmaps = distanceMaps(gl, blank);
  const guardArg = guard && !blank ? { facings: guard, gm: labelMeasures(givenLabels(pm)) } : null;
  const cur = JSON.parse(JSON.stringify(spec));
  const list = (paths ?? tunablePaths(cur)).filter((p) => !(p[0] === 'parts' && freeze.includes(p[1])));
  let best = fitObjective(cur, gl, blank, dmaps, guardArg);
  const start = best;
  const kOf = (p) => (p[2] === 'rot' || p[0] === 'diagonalYaw' || p[0] === 'diagonalHeadTurn' ? 5 : 1); // angles move in bigger steps
  for (const step of steps)
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let changed = false;
      for (const p of list) {
        const v0 = getPath(cur, p);
        for (const dir of [1, -1]) {
          const v = clampTo(p, v0 + dir * step * kOf(p), anchor);
          if (v === v0) continue;
          setPath(cur, p, v);
          const s = fitObjective(cur, gl, blank, dmaps, guardArg);
          if (s > best + 1e-9) { best = s; changed = true; break; }
          setPath(cur, p, v0);
        }
      }
      if (!changed) break;
    }
  if (random) {
    const rnd = mulberry32(random.seed ?? 1);
    const groups = new Map();
    for (const p of list) {
      const key = p[0] === 'parts' ? `parts:${p[1]}` : `joints:${p[1]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const keys = [...groups.keys()];
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    for (let it = 0; it < random.iters; it++) {
      const g = groups.get(keys[Math.floor(rnd() * keys.length)]);
      const n = 1 + Math.floor(rnd() * 3);
      const moved = [];
      for (let m = 0; m < n; m++) {
        const p = g[Math.floor(rnd() * g.length)];
        const v0 = getPath(cur, p);
        const v = clampTo(p, v0 + gauss() * (random.sigma ?? 0.5) * kOf(p), anchor);
        moved.push([p, v0]);
        setPath(cur, p, v);
      }
      const s = fitObjective(cur, gl, blank, dmaps, guardArg);
      if (s > best + 1e-9) best = s;
      else for (const [p, v0] of moved.reverse()) setPath(cur, p, v0);
    }
  }
  return { spec: cur, before: r4(start), after: r4(best) };
}
