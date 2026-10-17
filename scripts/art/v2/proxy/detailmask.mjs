// The LLM detail pass mask (consult C2 C2 step 3, interface only: no model is called here).
// The pass repaints only the face, the hands, the item and the seams, and at most 25 percent of the cells (facing-rules.json params.detailMaskCap).
//   face  cells of the skin, lenses and beard parts
//   hand  cells of the hands part
//   item  cells of the sheath, guard and wrap parts
//   seam  an opaque cell with a 4-neighbor that comes from another layer, from another flip or shift, or from the code painter (a place where two sources meet)
// When the lists are longer than the cap, the classes are kept in this order: face, hand, item, seam. Inside a class the order is raster order. The result is deterministic.
import { loadFacingRules } from './layout.mjs';

const N = 32;
const FACE = ['skin', 'lenses', 'beard'];
export const DETAIL_KINDS = ['face', 'hand', 'item', 'seam'];

/**
 * opts: { letters (final picture), labels (the part label of each cell: the layout template labels), prov (provenance per cell), origin (optional: transplant origin per cell), cap }
 * Returns { cells: [{ k, x, y, kind }], count, opaque, share, cap, capped, available: { kind: n } }.
 */
export function detailMask({ letters, labels, prov, origin = null, cap = null, rules = null }) {
  const capShare = cap ?? (rules ?? loadFacingRules()).params.detailMaskCap.value;
  let opaque = 0;
  for (let k = 0; k < N * N; k++) if (letters[k] !== '.') opaque++;
  const kindOfLayer = (k) => (prov[k] === 'painted' ? 'painted' : origin?.[k] ? `${origin[k].from}|${origin[k].flip ? 1 : 0}|${origin[k].part}` : prov[k]);
  const lists = Object.fromEntries(DETAIL_KINDS.map((d) => [d, []]));
  for (let k = 0; k < N * N; k++) {
    if (letters[k] === '.') continue;
    const L = labels[k];
    if (L && FACE.includes(L)) { lists.face.push(k); continue; }
    if (L === 'hands') { lists.hand.push(k); continue; }
    if (L === 'sheath' || L === 'guard' || L === 'wrap') { lists.item.push(k); continue; }
    const x = k % N, y = Math.floor(k / N);
    const mine = kindOfLayer(k);
    let seam = false;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const j = Y * N + X;
      if (letters[j] === '.') continue;
      if (kindOfLayer(j) !== mine) { seam = true; break; }
    }
    if (seam) lists.seam.push(k);
  }
  const limit = Math.floor(capShare * opaque);
  const cells = [];
  for (const kind of DETAIL_KINDS)
    for (const k of lists[kind]) {
      if (cells.length >= limit) break;
      cells.push({ k, x: k % N, y: Math.floor(k / N), kind });
    }
  const available = Object.fromEntries(DETAIL_KINDS.map((d) => [d, lists[d].length]));
  const total = DETAIL_KINDS.reduce((s, d) => s + lists[d].length, 0);
  return { cells, count: cells.length, opaque, share: opaque ? Math.round((cells.length / opaque) * 10000) / 10000 : 0, cap: limit, capped: total > limit, available };
}
