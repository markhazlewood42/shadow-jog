// Code painter (consult C2 C2 step 2, path C): fill the cells that no layer reached, from the given's own texture. No model, no random pixel.
// Each cell to fill takes the center letter of the best 3x3 patch match among the given's cells that have the same part and the same light level
// (non-parametric sampling, Efros and Leung style: the cell with the most known neighbors goes first). A deterministic seed breaks ties.
// The cell to fill has a part label and a light level from the layout (or from the proxy at the given facing for an arbitrary mask), never from a picture.
// Then selOutline gives every painted cell on the silhouette edge its part's outline letter by the selout rule (darker on the shadow side, lighter on the lit side).
// It runs on any mask, so the same code paints the 6a boxes (T1-C): paintBox blanks a box of the given and fills it from the cells outside it.
import { idsOfLabel, levelOfLetter, resolveSpec } from './spec.mjs';
import { GROUP_OF_LABEL } from './layout.mjs';
import { isNearBlackLetter, letterRank, outlineLetter } from './ramp.mjs';
import { renderTemplate } from './render.mjs';

const N = 32;
const NB8 = [[-1, -1, 1], [0, -1, 2], [1, -1, 1], [-1, 0, 2], [1, 0, 2], [-1, 1, 1], [0, 1, 2], [1, 1, 1]];
const EDGE_PENALTY = 10;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Light level (0, 1, 2) of every letter cell through the ramps of the parts that share its label. null for '.', an outline letter or a letter off the ramp. */
export function levelsOfLetters(rawSpec, letters, labels) {
  const spec = resolveSpec(rawSpec);
  const out = Array(N * N).fill(null);
  for (let k = 0; k < N * N; k++) {
    const l = labels[k];
    if (letters[k] === '.' || !l) continue;
    for (const id of idsOfLabel(spec, l)) {
      const lv = levelOfLetter(spec, id, letters[k]);
      if (lv !== null) { out[k] = lv; break; }
    }
  }
  return out;
}

const letterDist = (a, b) => (a === '.' && b === '.' ? 0 : a === '.' || b === '.' ? EDGE_PENALTY : Math.abs(letterRank(a) - letterRank(b)));

/**
 * Fill the mask cells of a letter grid.
 * opts: {
 *   letters      Array(1024), '.' transparent. Cells outside the mask are known (opaque or transparent); mask cells are overwritten.
 *   mask         Array(1024) of 0/1 (or booleans): the cells to fill.
 *   labels       Array(1024) of part labels (the 13 parts): the part each mask cell belongs to.
 *   levels       Array(1024) of 0, 1, 2 (or null/-1): the light level of each mask cell.
 *   source       { letters, labels, levels }: the cells to sample from (the given). levels null at an outline letter.
 *   exclude      optional Array(1024) of 0/1: source cells that may not be sampled (the box of a blanked test) and are unknown as neighbors.
 *   seed         integer, default 1.
 *   edge         optional Array(1024) of 0/1: cells on the silhouette edge. A near-black source letter is sampled for a cell off the edge only when a known neighbor is near-black
 *                (a line continues next to a line; a flat area does not take a stray dark cell).
 * }
 * Returns { letters, filled: [k...], unfilled: [k...], picks: { k: { src, cost, tier } }, tiers: { 1: n, 2: n, 3: n, 4: n } }.
 */
export function codePaint(rawSpec, { letters, mask, labels, levels, source, exclude = null, seed = 1, edge = null }) {
  resolveSpec(rawSpec); // validates the spec shape early
  const rng = mulberry32(seed);
  const out = letters.slice();
  const left = new Set();
  for (let k = 0; k < N * N; k++) if (mask[k]) { left.add(k); out[k] = '.'; }
  const ex = (k) => !!exclude && !!exclude[k];
  // pools per label, in index order
  const pool = {};
  for (let k = 0; k < N * N; k++) {
    if (source.letters[k] === '.' || !source.labels[k] || ex(k)) continue;
    (pool[source.labels[k]] ??= []).push(k);
  }
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const picks = {};
  const filled = [];
  const unfilled = [];
  const knownCount = (k) => {
    const x = k % N, y = Math.floor(k / N);
    let n = 0;
    for (const [dx, dy] of NB8) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= N || Y >= N || !left.has(Y * N + X)) n++;
    }
    return n;
  };
  const candidates = (label, level) => {
    const own = pool[label] ?? [];
    const lvOk = (k, tol) => source.levels[k] === null || source.levels[k] === undefined || level === null || level < 0 || Math.abs(source.levels[k] - level) <= tol;
    let c = own.filter((k) => lvOk(k, 0));
    if (c.length) return { c, tier: 1 };
    c = own.filter((k) => lvOk(k, 1));
    if (c.length) return { c, tier: 2 };
    if (own.length) return { c: own, tier: 3 };
    const g = GROUP_OF_LABEL[label];
    const c4 = Object.entries(pool).filter(([l]) => GROUP_OF_LABEL[l] === g).flatMap(([, v]) => v);
    return { c: c4, tier: 4 };
  };
  while (left.size) {
    // the cell with the most known neighbors; the lowest index on a tie
    let k = -1, kn = -1;
    for (const c of left) { const n = knownCount(c); if (n > kn || (n === kn && c < k)) { kn = n; k = c; } }
    const x = k % N, y = Math.floor(k / N);
    const { c: cand, tier } = candidates(labels[k], levels?.[k] ?? null);
    left.delete(k);
    if (!cand.length) { unfilled.push(k); continue; }
    let best = [];
    let bestCost = Number.POSITIVE_INFINITY;
    const dark = (X, Y) => X >= 0 && Y >= 0 && X < N && Y < N && !mask[Y * N + X] && out[Y * N + X] !== '.' && isNearBlackLetter(out[Y * N + X]); // a painted cell never starts a line
    const lineNear = NB8.some(([dx, dy]) => dark(x + dx, y + dy));
    const onEdge = !edge || !!edge[k];
    const usable = cand.filter((s) => onEdge || lineNear || !isNearBlackLetter(source.letters[s]));
    for (const s of usable.length ? usable : cand) {
      const sx = s % N, sy = Math.floor(s / N);
      let cost = 0, w = 0;
      for (const [dx, dy, wt] of NB8) {
        const X = x + dx, Y = y + dy;
        const inside = X >= 0 && Y >= 0 && X < N && Y < N;
        if (inside && left.has(Y * N + X)) continue; // unknown on the target side
        const SX = sx + dx, SY = sy + dy;
        const sInside = SX >= 0 && SY >= 0 && SX < N && SY < N;
        if (sInside && ex(SY * N + SX)) continue; // unknown on the source side
        const a = inside ? out[Y * N + X] : '.';
        const b = sInside ? source.letters[SY * N + SX] : '.';
        cost += wt * letterDist(a, b);
        w += wt;
      }
      cost = w ? (cost / w) * 12 : 0;
      if (cost < bestCost - 1e-9) { bestCost = cost; best = [s]; } else if (Math.abs(cost - bestCost) <= 1e-9) best.push(s);
    }
    const s = best[Math.floor(rng() * best.length)];
    out[k] = source.letters[s];
    picks[k] = { src: s, cost: Math.round(bestCost * 1000) / 1000, tier };
    tiers[tier]++;
    filled.push(k);
  }
  return { letters: out, filled, unfilled, picks, tiers };
}

/**
 * Selout: every cell of `cells` that is opaque, not near-black and 4-adjacent to a transparent cell (or the frame edge) takes the outline letter of its part
 * for its light level. Returns { letters, changed: [k...] }.
 */
export function selOutline(rawSpec, letters, { labels, levels, cells }) {
  const spec = resolveSpec(rawSpec);
  const out = letters.slice();
  const changed = [];
  for (const k of cells) {
    if (out[k] === '.' || isNearBlackLetter(out[k]) || !labels[k]) continue;
    const x = k % N, y = Math.floor(k / N);
    const open = (X, Y) => X < 0 || Y < 0 || X >= N || Y >= N || letters[Y * N + X] === '.';
    if (!(open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1))) continue;
    const id = idsOfLabel(spec, labels[k])[0];
    if (!id) continue;
    const o = outlineLetter(spec, id, levels?.[k] ?? 1);
    if (o !== out[k]) { out[k] = o; changed.push(k); }
  }
  return { letters: out, changed };
}

/**
 * T1-C on a box: blank the box of the given and paint the cells the proxy shows inside it, from the given's cells outside the box.
 * The part label and the light level of each cell come from the proxy template at the given facing (writer side). Returns the codePaint result plus
 * { box, mask, template, letters (the picture with the box repainted) }.
 */
export function paintBox(rawSpec, { letters, labels, box, seed = 1, facing = null }) {
  const spec = resolveSpec(rawSpec);
  const t = renderTemplate(spec, { facing: facing ?? spec.givenFacing });
  const inBox = (k) => { const x = k % N, y = Math.floor(k / N); return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1; };
  const mask = Array.from({ length: N * N }, (_, k) => (inBox(k) && t.id[k] !== null ? 1 : 0));
  const exclude = Array.from({ length: N * N }, (_, k) => (inBox(k) ? 1 : 0));
  const blanked = letters.map((l, k) => (inBox(k) ? '.' : l));
  const res = codePaint(spec, {
    letters: blanked, mask, labels: t.label, levels: t.level, seed, exclude,
    source: { letters, labels, levels: levelsOfLetters(spec, letters, labels) },
  });
  // The pool is the given outside the box only: a source letter inside the box is never sampled (exclude), so the answer never sees the box.
  return { ...res, box, mask, template: t };
}
