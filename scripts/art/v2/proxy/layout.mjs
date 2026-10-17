// Layout (consult C2 C1, path C): where each part sits at each facing, from the 3D proxy alone. No pixels of any picture.
// For a facing the layout holds, per proxy part: center (centroid of its cells, cell indices), row span, column span, depth (mean along the view ray, larger = farther),
// visible share (cells it shows in the full render / cells it would fill alone), and a light-level map (the template level of every cell).
// The rules come from facing-rules.json (R2 only, frozen). Nothing here reads a reference, a label file or a score.
//
//   const L = layoutFor(spec, 's');        // L.parts[id].center, .rows, .cols, .visibleShare, .depth; L.order back to front; L.light the level map
//   layoutAll(spec)                        // { s, se, e, ne, n, nw, w, sw }
//   compareGroups(L, givenGroups)          // per group: center distance, row span, column span, IoU, and the area weighted mean
//   ruleChecks(layoutByFacing, spec)       // the R2 rules T2 T3 T4 T5 T6 T8 T10 T15 as checks on the layouts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { faceAxis, foldStrokes } from './card.mjs';
import { axisSumOf, guideRows, mirrorCells, renderTemplate } from './render.mjs';
import { FACING_NAMES, SIZE, resolveSpec } from './spec.mjs';

export const FACING_RULES_PATH = fileURLToPath(new URL('./facing-rules.json', import.meta.url));

/** The frozen rule table. Throws when the file lacks the keys the layout needs. */
export function loadFacingRules(path = FACING_RULES_PATH) {
  const rules = JSON.parse(readFileSync(path, 'utf8'));
  const problems = [];
  if (rules.format !== 'facing-rules/1') problems.push('format must be facing-rules/1');
  if (!rules.light?.evidence) problems.push('light.evidence is missing (top and right numbers)');
  if (!Array.isArray(rules.allowList?.labels)) problems.push('allowList.labels is missing');
  if (!Number.isFinite(rules.params?.hideBelowVisibleShare?.value)) problems.push('params.hideBelowVisibleShare.value is missing');
  for (const r of rules.rules ?? []) if (!r.id || !r.r2 || !r.basis) problems.push(`rule ${r.id ?? '?'} has no id, r2 or basis`);
  if (problems.length) throw new Error(`facing-rules.json invalid:\n- ${problems.join('\n- ')}`);
  return rules;
}
export const ruleById = (rules, id) => rules.rules.find((r) => r.id === id);

/** The 7 part groups of the grade kit (grade/parts.mjs GROUPS), written here so the layout does not import the grader. A test keeps them equal. */
export const LAYOUT_GROUPS = {
  hair: ['hair'],
  face: ['skin', 'lenses', 'beard'],
  torso: ['coat', 'sleeves', 'zipper'],
  hands: ['hands'],
  legs: ['legs'],
  boots: ['boots'],
  item: ['sheath', 'guard', 'wrap'],
};
export const GROUP_OF_LABEL = Object.fromEntries(Object.entries(LAYOUT_GROUPS).flatMap(([g, ls]) => ls.map((l) => [l, g])));

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Centroid, row span and column span of a list of cell indices. null for an empty list. */
export function cellStats(cells) {
  if (!cells.length) return null;
  let sx = 0, sy = 0, x0 = SIZE, x1 = -1, y0 = SIZE, y1 = -1;
  for (const k of cells) {
    const x = k % SIZE, y = Math.floor(k / SIZE);
    sx += x; sy += y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { cells: cells.length, center: [r4(sx / cells.length), r4(sy / cells.length)], rows: [y0, y1], cols: [x0, x1] };
}

const bestCache = new WeakMap();
/**
 * The most cells each part shows in any of the 8 facings. The visible share is taken against this number, not against the part's own projection:
 * on the head the hair ellipsoid and the fringe cover the face by construction, so cells / projection would call the face hidden even at se.
 */
function bestVisible(spec) {
  let m = bestCache.get(spec);
  if (m) return m;
  m = Object.fromEntries(Object.keys(spec.parts).map((id) => [id, 0]));
  for (const f of FACING_NAMES) {
    const t = renderTemplate(spec, { facing: f });
    const n = {};
    t.id.forEach((id) => { if (id !== null) n[id] = (n[id] ?? 0) + 1; });
    for (const [id, c] of Object.entries(n)) m[id] = Math.max(m[id], c);
  }
  bestCache.set(spec, m);
  return m;
}

const soloCache = new WeakMap();
/** The cells one part fills when it is alone in the scene (its projection, with no occlusion). Cached per spec object and facing. */
function soloTemplate(spec, id, facing) {
  let byFacing = soloCache.get(spec);
  if (!byFacing) soloCache.set(spec, (byFacing = new Map()));
  const key = `${facing}:${id}`;
  let t = byFacing.get(key);
  if (!t) {
    t = renderTemplate({ ...spec, parts: { [id]: spec.parts[id] } }, { facing });
    byFacing.set(key, t);
  }
  return t;
}

/**
 * The layout of one facing. opts: { rules, template } (a template already rendered for this facing may be passed).
 * Returns { facing, yaw, template, parts, order, groups, light, rows, face, eyes }.
 */
export function layoutFor(rawSpec, facing, { rules = loadFacingRules(), template = null } = {}) {
  const spec = resolveSpec(rawSpec);
  const t = template ?? renderTemplate(spec, { facing });
  const hide = rules.params.hideBelowVisibleShare.value;
  const best = bestVisible(spec);
  const parts = {};
  for (const [id, part] of Object.entries(spec.parts)) {
    const solo = soloTemplate(spec, id, facing);
    const alone = [];
    let depthSum = 0;
    solo.id.forEach((v, k) => { if (v !== null) { alone.push(k); depthSum += solo.depth[k]; } });
    let visible = 0;
    t.id.forEach((v) => { if (v === id) visible++; });
    const st = cellStats(alone);
    const share = best[id] ? r4(visible / best[id]) : 0;
    let lv = 0, ln = 0;
    t.id.forEach((v, k) => { if (v === id) { lv += t.level[k]; ln++; } });
    parts[id] = {
      id, label: part.label, group: GROUP_OF_LABEL[part.label] ?? null, joint: part.joint, mirrorOf: part.mirrorOf ?? null, center: st?.center ?? null,
      rows: st?.rows ?? null, cols: st?.cols ?? null, cells: alone.length, visibleCells: visible, visibleShare: share, aloneShare: alone.length ? r4(visible / alone.length) : 0, hidden: share < hide, hiddenByRule: false,
      depth: alone.length ? r4(depthSum / alone.length) : null, meanLevel: ln ? r4(lv / ln) : null,
    };
  }
  // back to front: the farthest part first (a larger depth is farther along the view ray); ties break by part id so the order is stable
  const order = Object.values(parts).filter((p) => p.depth !== null).sort((a, b) => b.depth - a.depth || (a.id < b.id ? -1 : 1)).map((p) => p.id);
  const groups = {};
  for (const g of Object.keys(LAYOUT_GROUPS)) {
    const cells = [];
    t.label.forEach((l, k) => { if (l && GROUP_OF_LABEL[l] === g) cells.push(k); });
    groups[g] = cellStats(cells);
  }
  const head = t.label.map((l, k) => (l && ['hair', 'skin', 'lenses', 'beard'].includes(l) ? k : -1)).filter((k) => k >= 0);
  const hs = cellStats(head);
  const axis = faceAxis(spec, t);
  const headCenter = hs ? (hs.cols[0] + hs.cols[1]) / 2 : null;
  // R2 T8 wins over the proxy: the eye count per facing comes from the rule table. Extra lens parts (the ones farther from the camera) are hidden by rule.
  const lensIds = Object.keys(parts).filter((id) => parts[id].label === 'lenses');
  let lensShown = lensIds.filter((id) => !parts[id].hidden && parts[id].visibleCells > 0);
  const proxyCount = lensShown.length;
  const want = ruleById(rules, 'T8')?.eyeClusters?.[facing];
  if (want !== undefined && lensShown.length > want) {
    const nearFirst = [...lensShown].sort((a, b) => parts[a].depth - parts[b].depth);
    for (const id of nearFirst.slice(want)) parts[id].hiddenByRule = true;
    lensShown = nearFirst.slice(0, want);
  }
  return {
    facing, yaw: t.yaw, template: t, parts, order, groups, light: t.level, rows: guideRows(t.label),
    face: { axisCol: axis ? axis.col : null, headCenter, offset: axis && headCenter !== null ? r4(axis.col - headCenter) : null },
    eyes: { lensParts: lensShown, count: lensShown.length, proxyCount, rowCenters: lensShown.map((id) => parts[id].center[1]) },
  };
}

/** The 8 layouts of a spec. */
export function layoutAll(spec, opts = {}) {
  const rules = opts.rules ?? loadFacingRules();
  return Object.fromEntries(FACING_NAMES.map((f) => [f, layoutFor(spec, f, { rules })]));
}

/**
 * The part label of every cell of a layout, with the cells of the parts that a rule hid (T8: no eyes at the back facings) relabeled to the nearest cell of another part
 * (Chebyshev distance, then raster order). The code painter and the candidate labels use these, so no eye cell is painted where the rule says there is no eye.
 */
export function effectiveLabels(layout) {
  const t = layout.template;
  const hidden = new Set(Object.values(layout.parts).filter((p) => p.hiddenByRule).map((p) => p.id));
  const out = t.label.slice();
  if (!hidden.size) return out;
  const keep = [];
  t.id.forEach((id, k) => { if (id !== null && !hidden.has(id)) keep.push(k); });
  t.id.forEach((id, k) => {
    if (id === null || !hidden.has(id) || !keep.length) return;
    let best = null;
    for (const j of keep) {
      const d = Math.max(Math.abs((j % SIZE) - (k % SIZE)), Math.abs(Math.floor(j / SIZE) - Math.floor(k / SIZE)));
      if (best === null || d < best.d) best = { d, j };
    }
    out[k] = t.label[best.j];
  });
  return out;
}

/** Group grid (Array(1024) of group names or null) from a label grid. */
export const groupsOfLabels = (labels) => labels.map((l) => (l ? (GROUP_OF_LABEL[l] ?? null) : null));

/**
 * Compare the layout groups with a group grid (the given's template labels, grouped). Returns per group:
 * { cells, givenCells, centerDist, rows, givenRows, dRowTop, dRowBottom, cols, givenCols, iou } and the area weighted mean IoU.
 * The IoU weights follow the grader (weight = union size; a group with fewer than 4 cells in both is skipped).
 */
export function compareGroups(layout, givenGroups, { minCells = 4 } = {}) {
  const per = {};
  let wsum = 0, acc = 0;
  for (const g of Object.keys(LAYOUT_GROUPS)) {
    const a = [], b = [];
    let inter = 0, uni = 0;
    for (let k = 0; k < SIZE * SIZE; k++) {
      const ia = layout.template.label[k] && GROUP_OF_LABEL[layout.template.label[k]] === g;
      const ib = givenGroups[k] === g;
      if (ia) a.push(k);
      if (ib) b.push(k);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
    const sa = cellStats(a), sb = cellStats(b);
    if (Math.max(a.length, b.length) < minCells) continue;
    const iou = uni ? inter / uni : 0;
    per[g] = {
      cells: a.length, givenCells: b.length, iou: r4(iou),
      centerDist: sa && sb ? r4(Math.hypot(sa.center[0] - sb.center[0], sa.center[1] - sb.center[1])) : null,
      rows: sa?.rows ?? null, givenRows: sb?.rows ?? null,
      dRowTop: sa && sb ? Math.abs(sa.rows[0] - sb.rows[0]) : null, dRowBottom: sa && sb ? Math.abs(sa.rows[1] - sb.rows[1]) : null,
      cols: sa?.cols ?? null, givenCols: sb?.cols ?? null,
    };
    wsum += uni;
    acc += iou * uni;
  }
  return { per, mIoU: wsum ? r4(acc / wsum) : 0 };
}

/**
 * The C6 layout line at the given facing: each group has its center within `centerTol` px and its row span within `rowTol` px of the given
 * (both end rows), and the area weighted group mIoU is at least `miouMin`. Returns { ok, groups: { name: { ok, ... } }, mIoU, failures }.
 */
export function layoutLine(layout, givenGroups, { centerTol = 1.0, rowTol = 1, miouMin = 0.85 } = {}) {
  const cmp = compareGroups(layout, givenGroups);
  const failures = [];
  const groups = {};
  for (const [g, v] of Object.entries(cmp.per)) {
    const center = v.centerDist !== null && v.centerDist <= centerTol + 1e-9;
    const rows = v.dRowTop !== null && v.dRowTop <= rowTol && v.dRowBottom <= rowTol;
    groups[g] = { ...v, centerOk: center, rowsOk: rows };
    if (!center) failures.push(`${g} center ${v.centerDist} px (limit ${centerTol})`);
    if (!rows) failures.push(`${g} row span ${v.rows} against ${v.givenRows} (limit ${rowTol} at each end)`);
  }
  if (cmp.mIoU < miouMin) failures.push(`grouped mIoU ${cmp.mIoU} (needs ${miouMin})`);
  return { ok: failures.length === 0, groups, mIoU: cmp.mIoU, failures };
}

const item = (id, ok, detail) => ({ id, ok, detail });
const lumaSignOf = (L, spec) => {
  // lit-minus-shadow level on hair and torso cells: mean level of the right half minus the left half (split at the axis)
  const axis = (axisSumOf(spec)) / 2;
  const sums = { hair: [0, 0, 0, 0], torso: [0, 0, 0, 0] };
  L.template.label.forEach((l, k) => {
    const g = l ? GROUP_OF_LABEL[l] : null;
    if (g !== 'hair' && g !== 'torso') return;
    const x = k % SIZE;
    const s = sums[g];
    if (x > axis) { s[0] += L.template.level[k]; s[1]++; } else if (x < axis) { s[2] += L.template.level[k]; s[3]++; }
  });
  return Object.fromEntries(Object.entries(sums).map(([g, s]) => [g, s[1] && s[3] ? r4(s[0] / s[1] - s[2] / s[3]) : null]));
};

/**
 * The R2 rules of facing-rules.json as checks on the layouts (writer side, no picture). Returns [{ id, ok, detail }].
 * by = layoutAll(spec). The given facing is spec.givenFacing.
 */
export function ruleChecks(by, rawSpec, rules = loadFacingRules()) {
  const spec = resolveSpec(rawSpec);
  const out = [];
  const g = by[spec.givenFacing];
  // T2 rows
  {
    const r2 = ruleById(rules, 'T2');
    const tol = r2.rowTolerance;
    const bad = [];
    for (const [f, L] of Object.entries(by))
      for (const k of ['head', 'shoulder', 'hip', 'foot']) {
        if (r2.sideFacings.includes(f) && (k === 'shoulder' || k === 'hip')) continue;
        if (L.rows[k] === null || g.rows[k] === null) continue;
        if (Math.abs(L.rows[k] - g.rows[k]) > tol) bad.push(`${f} ${k} ${L.rows[k]} against ${g.rows[k]}`);
      }
    out.push(item('T2', bad.length === 0, bad.join('; ') || `head, shoulder, hip and foot rows within ${tol} px of ${spec.givenFacing} in all 8 facings`));
  }
  // T3 limb widths
  {
    const r = ruleById(rules, 'T3');
    const bad = [];
    for (const [f, L] of Object.entries(by))
      for (const p of Object.values(L.parts)) {
        if (!r.limbLabels.includes(p.label) || p.hidden || !p.cols) continue;
        // the source of a part is itself or its mirror partner (T4), so the width may match either
        const refs = [g.parts[p.id], p.mirrorOf ? g.parts[p.mirrorOf] : null, ...Object.values(g.parts).filter((q) => q.mirrorOf === p.id)].filter((q) => q && !q.hidden && q.cols);
        if (!refs.length) continue;
        const w = p.cols[1] - p.cols[0];
        const dw = Math.min(...refs.map((q) => Math.abs(w - (q.cols[1] - q.cols[0]))));
        if (dw > r.widthTolerance) bad.push(`${f} ${p.id} width differs by ${dw}`);
      }
    out.push(item('T3', bad.length === 0, bad.join('; ') || `limb part widths within ${r.widthTolerance} px of the given facing`));
  }
  // T4 mirrors (outside the allow-list): the label grid of a left facing is the mirror of its right facing
  {
    const r = ruleById(rules, 'T4');
    const allow = new Set(rules.allowList.labels);
    const bad = [];
    for (const [left, right] of Object.entries(r.mirrorOf)) {
      const m = mirrorCells(by[right].template.label, axisSumOf(spec));
      let diff = 0;
      for (let k = 0; k < SIZE * SIZE; k++) {
        const a = by[left].template.label[k], b = m[k];
        if (allow.has(a ?? '') || allow.has(b ?? '')) continue;
        if (a !== b) diff++;
      }
      if (diff) bad.push(`${left} differs from the mirror of ${right} in ${diff} cells`);
    }
    out.push(item('T4', bad.length === 0, bad.join('; ') || 'sw, w and nw are the mirror of se, e and ne outside the allow-list'));
  }
  // T5 eye rows, T8 eye clusters
  {
    const r5 = ruleById(rules, 'T5');
    const bad = [];
    for (const f of r5.facings) {
      const rc = by[f].eyes.rowCenters;
      if (rc.length > 1 && Math.max(...rc) - Math.min(...rc) > r5.eyeRowSpreadMax + 1e-9) bad.push(`${f} eye rows differ`);
    }
    out.push(item('T5', bad.length === 0, bad.join('; ') || 'the two eyes share one row at s, se and sw'));
    const r8 = ruleById(rules, 'T8');
    const bad8 = Object.entries(r8.eyeClusters).filter(([f, n]) => by[f].eyes.count !== n).map(([f, n]) => `${f}: ${by[f].eyes.count} eyes, rule ${n}`);
    const over = Object.entries(by).filter(([, L]) => L.eyes.proxyCount !== L.eyes.count).map(([f, L]) => `${f} ${L.eyes.proxyCount}->${L.eyes.count}`);
    out.push(item('T8', bad8.length === 0, bad8.join('; ') || `eye count per facing follows the rule table${over.length ? ` (the rule hid lens parts the proxy still shows: ${over.join(', ')})` : ''}`));
  }
  // T6 face offset
  {
    const r = ruleById(rules, 'T6');
    const bad = [];
    for (const [f, band] of Object.entries(r.faceOffset)) {
      const o = by[f].face.offset;
      if (o === null || o < band.min - 0.5 || o > band.max + 0.5) bad.push(`${f} face offset ${o}, rule ${band.min} to ${band.max}`);
    }
    out.push(item('T6', bad.length === 0, bad.join('; ') || 'face offset 0 at s and 2 to 3 px toward the turn at se and sw (half a cell of slack for the cell grid)'));
  }
  // T10 lit side: the right half of hair and torso is lighter than the left half in every facing
  {
    const r10 = ruleById(rules, 'T10');
    const bad = [];
    const info = [];
    for (const [f, L] of Object.entries(by)) {
      const s = lumaSignOf(L, spec);
      for (const [grp, v] of Object.entries(s)) {
        if (v === null || !r10.groups.includes(grp)) continue;
        if (r10.facings.includes(f)) { if (v <= 0) bad.push(`${f} ${grp} lit-minus-shadow ${v}`); } else info.push(`${f} ${grp} ${v}`);
      }
    }
    out.push(item('T10', bad.length === 0, bad.join('; ') || `the lit side (right) is lighter than the shadow side on hair and torso at ${r10.facings.join(', ')} (others, report: ${info.join(', ')})`));
  }
  // T15 folds: at most strokesPerPanelMax per panel
  {
    const r = ruleById(rules, 'T15');
    const bad = [];
    for (const [f, L] of Object.entries(by)) {
      const per = {};
      for (const s of foldStrokes(spec, L.template)) if (!s.hidden) per[s.part] = (per[s.part] ?? 0) + 1;
      for (const [p, n] of Object.entries(per)) if (n > r.strokesPerPanelMax) bad.push(`${f} ${p} ${n} strokes`);
    }
    out.push(item('T15', bad.length === 0, bad.join('; ') || `at most ${r.strokesPerPanelMax} fold strokes per panel`));
  }
  return out;
}
