// Transplant (consult C2 C2 step 1, path C): the given's own pixels, moved to a new facing.
// Each proxy part of the given is cut as a layer. For the target facing the layer is
//   1. chosen: the part itself, or its mirror partner (or itself, flipped), whichever has the nearer yaw (R2 T4: the part turns to show its other side);
//      the allow-list parts (sheath, guard, wrap) are never flipped and never swapped (PA-21);
//   2. flipped about the figure axis when the choice says so;
//   3. shifted by an integer: the layout center of the target part minus the layout center of the source part (so the shift at the given facing is 0);
//   4. narrowed or widened by at most one column, deleted or doubled inside a flat run that no diagonal run crosses (no resample, PA-05);
//   5. relit: a flipped cell takes the light level of the target layout (the flip moved the lit side) by ramp steps; an unflipped cell moves by the change of the proxy light level between the views;
//   6. dropped when the part is hidden (visible share under 0.3, or hidden by the T8 eye rule), or when a cell lies far outside the layout silhouette;
//   7. drawn back to front by the layout depth order.
// Output: the letter grid and a provenance map per cell: copied, flipped, relit, empty (inside the layout silhouette, no layer reached it), outside.
// No pixel of any reference is read. The input is the given frame, its part labels (writer side) and the proxy spec.
import { letterAt } from '../../headtest/lib.mjs';
import { layoutFor, loadFacingRules } from './layout.mjs';
import { relightLetter } from './ramp.mjs';
import { axisSumOf } from './render.mjs';
import { SIZE, idsOfLabel, levelOfLetter, resolveSpec } from './spec.mjs';

const N = SIZE;
const angDist = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const zero = (v) => (v === 0 ? 0 : v); // no -0

/** Letters of an image (1024 characters; '.' transparent). Throws on a half-transparent or off-palette pixel. */
export function lettersOfImage(img) {
  const out = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const l = letterAt(img, x, y);
      if (l === '?') throw new Error(`transplant: pixel ${x},${y} is off the walk palette or half transparent`);
      out.push(l);
    }
  return out;
}

/**
 * Cut the given into layers, one per proxy part. A given cell with label L goes to the part of that label that the source template shows at the cell,
 * else to the nearest cell (squared distance, then index) that shows a part of that label.
 * Returns { layers: { id: { cells: [{ k, x, y, letter, level, edge }] } }, assign: Array(1024) of part id | null }.
 */
export function cutLayers(spec, tSrc, letters, labels) {
  const layers = Object.fromEntries(Object.keys(spec.parts).map((id) => [id, { id, cells: [] }]));
  const assign = Array(N * N).fill(null);
  const idsFor = {};
  for (let k = 0; k < N * N; k++) {
    if (letters[k] === '.') continue;
    const L = labels[k];
    if (!L) throw new Error(`transplant: opaque cell ${k % N},${Math.floor(k / N)} has no part label`);
    const ids = (idsFor[L] ??= idsOfLabel(spec, L));
    if (!ids.length) throw new Error(`transplant: the spec has no part with label ${L}`);
    let id = ids.includes(tSrc.id[k]) ? tSrc.id[k] : null;
    if (id === null) {
      let best = null;
      for (let j = 0; j < N * N; j++) {
        if (!ids.includes(tSrc.id[j])) continue;
        const d = ((j % N) - (k % N)) ** 2 + (Math.floor(j / N) - Math.floor(k / N)) ** 2;
        if (best === null || d < best.d) best = { d, id: tSrc.id[j] };
      }
      id = best ? best.id : ids[0];
    }
    assign[k] = id;
    const x = k % N, y = Math.floor(k / N);
    const open = (xx, yy) => xx < 0 || yy < 0 || xx >= N || yy >= N || letters[yy * N + xx] === '.';
    const edge = open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1);
    // the proxy light level at the source cell, when the template shows this part (or a part of this label) there
    const level = tSrc.id[k] === id || tSrc.label[k] === L ? tSrc.level[k] : -1;
    layers[id].cells.push({ k, x, y, letter: letters[k], level: level >= 0 ? level : null, edge });
  }
  return { layers, assign };
}

/**
 * Which layer feeds a target part, and whether it is flipped. Candidates: the part itself (yaw of the given), its mirror partner flipped, or a centered part
 * flipped (yaw of the given mirrored). The nearer yaw wins. A tie (s and n, which sit halfway between a diagonal and its mirror) goes to the source that
 * shows more of itself in the given, then to no flip. The allow-list labels take only themselves, unflipped.
 */
export function chooseSource(spec, id, targetYaw, givenYaw, givenLayout, allowLabels) {
  const part = spec.parts[id];
  const cands = [{ id, flip: false, orient: givenYaw }];
  if (!allowLabels.includes(part.label)) {
    const partner = part.mirrorOf ?? Object.keys(spec.parts).find((q) => spec.parts[q].mirrorOf === id);
    if (partner) cands.push({ id: partner, flip: true, orient: -givenYaw });
    else if (part.center === true) cands.push({ id, flip: true, orient: -givenYaw });
  }
  let best = null;
  for (const c of cands) {
    const cost = angDist(targetYaw, c.orient);
    const share = givenLayout.parts[c.id]?.visibleShare ?? 0;
    const better = best === null || cost < best.cost - 1e-6 || (Math.abs(cost - best.cost) <= 1e-6 && (share > best.share + 1e-9 || (Math.abs(share - best.share) <= 1e-9 && !c.flip && best.flip)));
    if (better) best = { ...c, cost, share };
  }
  return best;
}

/**
 * Delete or double one column of a layer (a Map "x,y" -> value; letterOf(value) gives the letter) inside a flat run that no diagonal run crosses.
 * A column is eligible when every cell in it sits inside a horizontal run of 3 or more equal letters (not at the run's end), and no cell of it is the middle of a
 * diagonal run of 3 equal letters. The eligible column nearest the layer's center column is taken (the lower x on a tie). delta < 0 deletes it, delta > 0 doubles it.
 * Returns { cells: the new Map, edited: the column | null }. The input Map is not changed.
 */
export function editColumn(cells, delta, letterOf = (v) => v) {
  if (!delta || !cells.size) return { cells, edited: null };
  const entries = [...cells.entries()].map(([k, v]) => { const [x, y] = k.split(',').map(Number); return { x, y, v }; });
  const letterAtXY = (x, y) => { const v = cells.get(`${x},${y}`); return v === undefined ? undefined : letterOf(v); };
  const x0 = Math.min(...entries.map((e) => e.x)), x1 = Math.max(...entries.map((e) => e.x));
  const mid = (x0 + x1) / 2;
  const eligible = [];
  for (let x = x0 + 1; x < x1; x++) {
    const col = entries.filter((e) => e.x === x);
    if (!col.length) continue;
    const ok = col.every(({ y, v }) => {
      const l = letterOf(v);
      if (!(letterAtXY(x - 1, y) === l && letterAtXY(x + 1, y) === l)) return false;
      // a diagonal run is a thin line of one letter: the cell has the same letter on both ends of a diagonal and another letter above and below it
      const thin = letterAtXY(x, y - 1) !== l && letterAtXY(x, y + 1) !== l;
      const diag = (letterAtXY(x - 1, y - 1) === l && letterAtXY(x + 1, y + 1) === l) || (letterAtXY(x - 1, y + 1) === l && letterAtXY(x + 1, y - 1) === l);
      return !(thin && diag);
    });
    if (ok) eligible.push(x);
  }
  if (!eligible.length) return { cells, edited: null };
  eligible.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const cx = eligible[0];
  const out = new Map();
  for (const { x, y, v } of entries) {
    if (delta < 0) {
      if (x !== cx) out.set(`${x > cx ? x - 1 : x},${y}`, v);
    } else {
      out.set(`${x > cx ? x + 1 : x},${y}`, v);
      if (x === cx) out.set(`${x + 1},${y}`, v);
    }
  }
  return { cells: out, edited: cx };
}

/** Chebyshev distance of every cell to the nearest silhouette cell (0 inside). Infinity when the silhouette is empty. */
export function distanceToMask(inMask) {
  const d = new Float64Array(N * N).fill(Number.POSITIVE_INFINITY);
  const q = [];
  for (let k = 0; k < N * N; k++) if (inMask[k]) { d[k] = 0; q.push(k); }
  for (let i = 0; i < q.length; i++) {
    const k = q[i], x = k % N, y = Math.floor(k / N);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const j = Y * N + X;
        if (d[j] > d[k] + 1) { d[j] = d[k] + 1; q.push(j); }
      }
  }
  return d;
}

/**
 * Transplant the given to a facing.
 * opts: { given (letters, 1024) or givenImg, labels (the given's 13-part label per cell), facing, rules, layout (target; made when absent), givenLayout (made when absent), clip (default from rules) }
 * Returns { facing, letters, prov, layers, silhouette, counts, invented, layout }.
 */
export function transplant(rawSpec, { letters, givenImg = null, labels, facing, rules = loadFacingRules(), layout = null, givenLayout = null }) {
  const spec = resolveSpec(rawSpec);
  const src = letters ?? lettersOfImage(givenImg);
  const axisSum = axisSumOf(spec);
  const L = layout ?? layoutFor(spec, facing, { rules });
  const G = givenLayout ?? layoutFor(spec, spec.givenFacing, { rules });
  const tSrc = G.template;
  const allow = rules.allowList.labels;
  const clip = rules.params.overflowClip.distance;
  const minDelta = rules.params.columnEdit.minDelta ?? 2;
  const edits = rules.params.columnEdit.maxColumns;
  const { layers } = cutLayers(spec, tSrc, src, labels);
  const silhouette = L.template.id.map((v) => v !== null);
  const dist = distanceToMask(silhouette);
  const letters2 = Array(N * N).fill('.');
  const prov = Array(N * N).fill('outside');
  const origin = Array(N * N).fill(null); // { part, from, flip, srcK, srcEdge }
  const info = [];
  const givenYaw = G.yaw;
  for (const id of L.order) {
    const tp = L.parts[id];
    const rec = { id, label: tp.label, source: null, flip: false, dx: 0, dy: 0, drawn: 0, clipped: 0, hidden: null, columnEdit: null };
    if (tp.hidden || tp.hiddenByRule) { rec.hidden = tp.hiddenByRule ? 'rule' : 'share'; info.push(rec); continue; }
    const ch = chooseSource(spec, id, L.yaw, givenYaw, G, allow);
    rec.source = ch.id;
    rec.flip = ch.flip;
    const layer = layers[ch.id];
    const sp = G.parts[ch.id];
    if (!layer.cells.length || !sp.center || !tp.center) { info.push(rec); continue; }
    const fx = (x) => (ch.flip ? axisSum - x : x);
    const scx = ch.flip ? axisSum - sp.center[0] : sp.center[0];
    let dx = zero(Math.round(tp.center[0] - scx));
    const dy = zero(Math.round(tp.center[1] - sp.center[1]));
    // cells in layer space (after the flip): "x,y" -> the cut cell (letter, proxy level at the source, edge flag, source index)
    let cells = new Map(layer.cells.map((c) => [`${fx(c.x)},${c.y}`, c]));
    // narrow or widen by one column when the part's width differs by at least minDelta (the proxy gives the widths)
    const diff = tp.cols[1] - tp.cols[0] - (sp.cols[1] - sp.cols[0]);
    if (Math.abs(diff) >= minDelta && edits > 0) {
      const e = editColumn(cells, Math.sign(diff), (c) => c.letter);
      if (e.edited !== null) {
        rec.columnEdit = { column: e.edited, delta: Math.sign(diff) };
        // keep the part where the layout puts it: the pixel box center follows the layout center
        const before = [...cells.keys()].map((k) => Number(k.split(',')[0]));
        const after = [...e.cells.keys()].map((k) => Number(k.split(',')[0]));
        const cB = (Math.min(...before) + Math.max(...before)) / 2, cA = (Math.min(...after) + Math.max(...after)) / 2;
        dx = zero(Math.round(dx + cB - cA));
        cells = e.cells;
      }
    }
    rec.dx = dx;
    rec.dy = dy;
    for (const [key, c] of cells) {
      const letter = c.letter;
      const [x, y] = key.split(',').map(Number);
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= N || Y >= N) { rec.clipped++; continue; }
      const k = Y * N + X;
      if (dist[k] > clip) { rec.clipped++; continue; }
      // relight by the change of the proxy light level between the source view and the target layout
      let out = letter;
      const tLevel = L.template.id[k] === id || L.template.label[k] === tp.label ? L.template.level[k] : -1;
      if (tLevel >= 0) {
        // a flipped cell takes the light level of the target light map (consult C2 C1: the flip moved the lit side), counted from its own level in ramp steps;
        // an unflipped cell moves by the change of the proxy light between the two views (C2 C2 step 1)
        const own = levelOfLetter(spec, ch.id, letter);
        const shift = ch.flip ? (own === null ? 0 : tLevel - own) : c.level !== null ? tLevel - c.level : 0;
        if (shift) out = relightLetter(spec, ch.id, letter, shift);
      }
      letters2[k] = out;
      prov[k] = out !== letter ? 'relit' : ch.flip ? 'flipped' : 'copied';
      origin[k] = { part: id, from: ch.id, flip: ch.flip, srcK: c.k, srcEdge: c.edge };
      rec.drawn++;
    }
    info.push(rec);
  }
  let empty = 0, drawn = 0;
  for (let k = 0; k < N * N; k++) {
    if (letters2[k] !== '.') drawn++;
    else if (silhouette[k]) { prov[k] = 'empty'; empty++; }
  }
  const total = drawn + empty;
  const counts = { copied: 0, flipped: 0, relit: 0, empty: 0, outside: 0 };
  for (const p of prov) counts[p]++;
  return { facing, yaw: L.yaw, letters: letters2, prov, origin, layers: info, silhouette, counts, total, invented: total ? Math.round((empty / total) * 10000) / 10000 : 0, layout: L };
}
