// Path B checks. Template checks (plan v2, section 7) run on a sheet and its maps. The se fit compares the se sheet with the given part map.
// Every check returns { name, ok, value, line, detail } and takes its lines from data.checks, so a new character changes the data, not the code.
import { buildPartMap } from '../../pipeline/decompose.mjs';
import { loadGiven } from '../../pipeline/given.mjs';
import { components } from './card.mjs';
import { LEVEL, OUTLINE, areas, lightMap, measure, outlineMap } from './maps.mjs';
import { SIZE, cellOf, mirrorSheet } from './sheet.mjs';

/** The given frame's part map as a label array (part name or null per cell), plus its measures. */
export function givenLabels() {
  const pm = buildPartMap(loadGiven());
  const labels = Array(SIZE * SIZE).fill(null);
  for (const [name, cells] of Object.entries(pm.parts)) for (const i of cells) labels[i] = name;
  return labels;
}

const res = (name, ok, value, line, detail = null) => ({ name, ok, value, line, detail });
const within = (v, target, tol) => Math.abs(v - target) <= tol;

// ---- single-sheet checks ----
export function checkHeight(data, sheet) {
  const m = measure(sheet.labels, data);
  const c = data.checks.height;
  return res('height', within(m.height, c.value, c.tol), m.height, `${c.value} +-${c.tol}`);
}
export function checkBottomRow(data, sheet) {
  const m = measure(sheet.labels, data);
  return res('bottomRow', m.bottom === data.checks.bottomRow, m.bottom, `${data.checks.bottomRow}`);
}
export function checkHeadAlone(data, sheet) {
  const m = measure(sheet.labels, data);
  const [lo, hi] = data.checks.headAlone;
  return res('headAlone', m.headAlone >= lo && m.headAlone <= hi, m.headAlone, `${lo} to ${hi}`);
}
export function checkGuideRows(data, sheet, given) {
  const m = measure(sheet.labels, data);
  const g = measure(given, data);
  const tol = data.checks.guideRowTol;
  const shoulder = within(m.shoulder, g.shoulder, tol);
  const hip = within(m.hip, g.hip, tol);
  return res('guideRows', shoulder && hip, { shoulder: m.shoulder, hip: m.hip }, `given shoulder ${g.shoulder}, hip ${g.hip}, +-${tol}`);
}
/** Each compared group's area is within areaTol of the given's. A group is a list of parts; a part the facing hides must stay under its limit (data facings.<f>.hidden). */
export function checkPartAreas(data, sheet, given) {
  const f = data.facings[sheet.facing] ?? data.facings[sheet.mirroredFrom];
  const a = areas(sheet.labels);
  const g = areas(given);
  const hidden = f.hidden ?? {};
  const groups = [...f.compare];
  const inGroup = new Set(groups.flat());
  for (const p of data.character.parts) if (!inGroup.has(p) && !(p in hidden)) groups.push([p]);
  const tol = data.checks.areaTol;
  const rows = groups.map((grp) => {
    const have = grp.reduce((s, p) => s + (a[p] ?? 0), 0);
    const ref = grp.reduce((s, p) => s + (g[p] ?? 0), 0);
    const ratio = ref ? have / ref : null;
    return { group: grp.join('+'), have, given: ref, ratio, ok: ratio !== null && Math.abs(ratio - 1) <= tol + 1e-9 };
  });
  const hid = Object.entries(hidden).map(([p, max]) => ({ group: `${p} (hidden, max ${max})`, have: a[p] ?? 0, given: g[p] ?? 0, ratio: null, ok: (a[p] ?? 0) <= max }));
  const all = [...rows, ...hid];
  return res('partAreas', all.every((r) => r.ok), all.filter((r) => !r.ok).map((r) => r.group), `each group within ${Math.round(tol * 100)} percent of the given`, all);
}
/** One piece: no cell floats. The silhouette is one 8-connected shape. */
export function checkConnected(_data, sheet) {
  const opaque = new Set(sheet.labels.flatMap((p, i) => (p ? [i] : [])));
  const start = [...opaque][0];
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const [x, y] = cellOf(stack.pop());
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * SIZE + nx;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && opaque.has(j) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
  }
  return res('connected', seen.size === opaque.size, opaque.size - seen.size, '0 cells outside the main shape');
}
/** R2 T5 to T8: eyes exist only on a facing with a face; the eye offset from the head center is in the facing's range. */
export function checkEyes(data, sheet) {
  const f = data.facings[sheet.facing] ?? data.facings[sheet.mirroredFrom];
  const lens = (sheet.parts.lenses ?? []).map(cellOf);
  if (!f.face) return res('eyes', lens.length === 0, lens.length, 'no eye cells (no face)');
  if (!lens.length) return res('eyes', false, 0, 'eye cells present');
  const off = lens.reduce((s, [x]) => s + x, 0) / lens.length - sheet.anchors.head;
  const dir = sheet.mirroredFrom ? -1 : 1;
  const [lo, hi] = f.eyeOffset ?? [-99, 99];
  const o = off * dir;
  return res('eyes', o >= lo && o <= hi, Math.round(o * 100) / 100, f.eyeOffset ? `offset ${lo} to ${hi} toward the turn` : 'any offset');
}
/** R2 T15: fold strokes per panel. */
export function checkFolds(data, sheet, card) {
  const per = {};
  for (const s of card.folds) per[s.panel] = (per[s.panel] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(per));
  const insidePanel = card.folds.every((s) => {
    const part = s.panel.split('#')[0];
    return s.cells.every(([x, y]) => sheet.labels[y * SIZE + x] === part);
  });
  return res('folds', max <= data.checks.maxFoldsPerPanel && insidePanel, max, `at most ${data.checks.maxFoldsPerPanel} per panel, inside the panel`);
}
/** Light map: levels only on opaque cells, every opaque cell has a level, and the light side is the same sign (R2 T10): for round parts the left half is not darker than the right. */
export function checkLight(data, sheet, light = lightMap(data, sheet)) {
  let bad = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const has = Boolean(sheet.labels[i]);
    if (has !== (light[i] !== LEVEL.none)) bad++;
    if (light[i] > LEVEL.lit) bad++;
  }
  const wrongSide = [];
  for (const part of ['hair', 'coat', 'sleeves']) {
    const cells = sheet.parts[part] ?? [];
    if (!cells.length) continue;
    const xs = cells.map((i) => cellOf(i)[0]);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const mean = (pick) => {
      const l = cells.filter((i) => pick(cellOf(i)[0]));
      return l.length ? l.reduce((s, i) => s + light[i], 0) / l.length : 0;
    };
    if (mean((x) => x < mid) < mean((x) => x > mid)) wrongSide.push(part);
  }
  return res('light', bad === 0 && wrongSide.length === 0, { bad, wrongSide }, 'levels on opaque cells only; lit side on the left');
}
/** Outline map: every silhouette edge cell is an outline cell, and no other cell is. */
export function checkOutline(data, sheet, outline = outlineMap(data, sheet)) {
  let missing = 0;
  let extra = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const p = sheet.labels[i];
      const edge = p && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !sheet.labels[(y + dy) * SIZE + x + dx] || x + dx < 0 || x + dx >= SIZE);
      if (edge && outline[i] !== OUTLINE.silhouette) missing++;
      if (!p && outline[i] !== OUTLINE.none) extra++;
      if (p && !edge && outline[i] === OUTLINE.silhouette) extra++;
    }
  return res('outline', missing === 0 && extra === 0, { missing, extra }, 'all edge cells outlined, nothing else');
}

// ---- set checks ----
export const silhouetteIoU = (a, b) => {
  let i = 0;
  let u = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    const pa = Boolean(a.labels[k]);
    const pb = Boolean(b.labels[k]);
    if (pa && pb) i++;
    if (pa || pb) u++;
  }
  return u ? i / u : 0;
};
/** Plan section 7: the s template agrees with the mirror of the sw template (sw is the mirror of se). Guide measures within the row tolerance, part areas within the area tolerance, silhouette IoU above the data line. */
export function checkMirrorAgree(data, s, se) {
  const sw = mirrorSheet(se, 'sw');
  const back = mirrorSheet(sw, 'sw-mirrored-back'); // the mirror of the sw template
  const a = measure(s.labels, data);
  const b = measure(back.labels, data);
  const tol = data.checks.guideRowTol;
  const guides = ['height', 'bottom', 'headAlone', 'shoulder', 'hip'].map((k) => ({ k, s: a[k], sw: b[k], ok: Math.abs(a[k] - b[k]) <= tol }));
  const tolA = data.checks.areaTol;
  const parts = data.character.parts.map((p) => {
    const x = a.areas[p] ?? 0;
    const y = b.areas[p] ?? 0;
    const ratio = y ? x / y : null;
    return { part: p, s: x, sw: y, ratio, ok: (x === 0 && y === 0) || (ratio !== null && Math.abs(ratio - 1) <= tolA + 1e-9) };
  });
  const iou = silhouetteIoU(s, back);
  const ok = guides.every((g) => g.ok) && parts.every((p) => p.ok) && iou >= data.checks.mirrorAgree.minSilhouetteIoU;
  return res('mirrorAgree', ok, { silhouetteIoU: Math.round(iou * 1000) / 1000, badGuides: guides.filter((g) => !g.ok).map((g) => g.k), badParts: parts.filter((p) => !p.ok).map((p) => p.part) }, `guides +-${tol}, areas +-${Math.round(tolA * 100)} percent, silhouette IoU at least ${data.checks.mirrorAgree.minSilhouetteIoU}`, { guides, parts });
}
const diffCells = (la, lb) => {
  let n = 0;
  for (let k = 0; k < SIZE * SIZE; k++) if (la[k] !== lb[k]) n++;
  return n;
};
const flipLabels = (l, axis2 = 35) => {
  const out = Array(SIZE * SIZE).fill(null);
  l.forEach((p, i) => {
    const x = axis2 - (i % SIZE);
    if (p && x >= 0 && x < SIZE) out[Math.floor(i / SIZE) * SIZE + x] = p;
  });
  return out;
};
/** R2 T1: each facing differs from every other facing and from the flip of every other facing by at least N cells. */
export function checkDistinct(data, sheets) {
  const min = data.checks.distinctMinCells;
  const names = Object.keys(sheets);
  let worst = { cells: Infinity, pair: null };
  for (const a of names)
    for (const b of names) {
      if (a === b) continue;
      for (const [kind, lb] of [['direct', sheets[b].labels], ['flip', flipLabels(sheets[b].labels)]]) {
        const n = diffCells(sheets[a].labels, lb);
        if (n < worst.cells) worst = { cells: n, pair: `${a} vs ${kind} ${b}` };
      }
    }
  return res('distinct', worst.cells >= min, worst, `at least ${min} cells differ`);
}

// ---- se fit against the given ----
/** Landmarks of a label array, from one definition used on both sides. */
export function landmarks(labels, data) {
  const c = data.character;
  const cellsOf = (pick) => labels.flatMap((p, i) => (p && pick(p) ? [cellOf(i)] : []));
  const centroid = (cs) => (cs.length ? [cs.reduce((s, [x]) => s + x, 0) / cs.length, cs.reduce((s, [, y]) => s + y, 0) / cs.length] : null);
  const head = cellsOf((p) => c.headParts.includes(p));
  const headRows = head.filter(([, y]) => y <= c.rows.headBottom);
  const xs = headRows.map(([x]) => x);
  const m = measure(labels, data);
  const hands = cellsOf((p) => p === 'hands');
  const midX = hands.length ? hands.reduce((s, [x]) => s + x, 0) / hands.length : 17.5;
  return {
    headTopRow: Math.min(...head.map(([, y]) => y)),
    headCenterCol: (Math.min(...xs) + Math.max(...xs)) / 2,
    eyeCentroid: centroid(cellsOf((p) => p === 'lenses')),
    zipperCentroid: centroid(cellsOf((p) => p === 'zipper')),
    shoulderRow: m.shoulder,
    hipRow: m.hip,
    footRow: m.bottom,
    handLeftCentroid: centroid(hands.filter(([x]) => x < midX)),
    handRightCentroid: centroid(hands.filter(([x]) => x >= midX)),
    itemCentroid: centroid(cellsOf((p) => c.itemParts.includes(p))),
    bootsCentroid: centroid(cellsOf((p) => p === 'boots')),
  };
}
const dist = (a, b) => (typeof a === 'number' ? Math.abs(a - b) : a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null);
/** Part mIoU, per-part IoU, silhouette IoU and landmark distances of a sheet against a label array (the given for se). No pass line here: the numbers are the result. */
export function fitReport(data, sheet, given) {
  const perPart = {};
  for (const p of data.character.parts) {
    let i = 0;
    let u = 0;
    for (let k = 0; k < SIZE * SIZE; k++) {
      const a = sheet.labels[k] === p;
      const b = given[k] === p;
      if (a && b) i++;
      if (a || b) u++;
    }
    perPart[p] = u ? i / u : null;
  }
  const vals = Object.values(perPart).filter((v) => v !== null);
  const la = landmarks(sheet.labels, data);
  const lb = landmarks(given, data);
  const landmarkDist = Object.fromEntries(Object.keys(lb).map((k) => [k, dist(la[k], lb[k])]));
  const ds = Object.values(landmarkDist).filter((v) => v !== null);
  return {
    partMIoU: vals.reduce((s, v) => s + v, 0) / vals.length,
    minPartIoU: Math.min(...vals),
    perPart,
    silhouetteIoU: silhouetteIoU(sheet, { labels: given }),
    landmarkDist,
    maxLandmarkDist: Math.max(...ds),
    landmarks: { sheet: la, given: lb },
  };
}

/** All single-sheet template checks for one facing. */
export function templateChecks(data, sheet, given, card, light, outline) {
  return [
    checkHeight(data, sheet),
    checkBottomRow(data, sheet),
    checkHeadAlone(data, sheet),
    checkGuideRows(data, sheet, given),
    checkPartAreas(data, sheet, given),
    checkConnected(data, sheet),
    checkEyes(data, sheet),
    checkFolds(data, sheet, card),
    checkLight(data, sheet, light),
    checkOutline(data, sheet, outline),
  ];
}
export { components };
