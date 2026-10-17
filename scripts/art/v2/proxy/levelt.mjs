// Level T (plan section 3, "render.mjs"): the writer's feedback against the template. The picture plus a conflict list.
//   conflict  a letter outside the ramp of the template part dilated by 1 px          (kind "ramp")
//             a light level more than one step from the template                        (kind "light-level")
//             a letter outside the template silhouette dilated by 1 px                  (kind "outside-silhouette")
//             a template cell inside the silhouette left transparent                    (kind "hole")
//             a locked copy cell that was changed                                       (kind "locked-changed")
//   warning   a letter that is only legal because a neighbor part is within 1 px (a seam cell)     (kind "seam")
//             an outline cell that is not painted with an outline letter of its part               (kind "outline-missing")
//             an edge cell of the silhouette left transparent                                      (kind "edge-missing")
// This is feedback against the template, not a truth. It never reads the given or a reference. It reads only the template data
// (template.json): part ids per cell, light level per cell, outline per cell, ramps, locked cells.
// This file goes into the writer kit. The kit builder rewrites the import paths to './lib.mjs'.
import { FAMILY_NAMES, drawLower, fillRect, zoomGrid, lumRgb, rgbOfLetter } from '../../headtest/lib.mjs';
import { N, gridToImage32 } from './grid32.mjs';

const LEVEL_NAMES = ['shadow', 'base', 'lit'];

const nbr9 = (x, y) => {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < N && y + dy < N) out.push((y + dy) * N + x + dx);
  return out;
};
const levelIn = (r, letter) => (r.shadow.includes(letter) ? 0 : r.base.includes(letter) ? 1 : r.lit.includes(letter) ? 2 : null);

/**
 * Check a painted grid (flat array of 1024 letters) against the template data.
 * Returns { conflicts, warnings, counts } where each entry is { x, y, kind, letter, part, detail }.
 */
export function levelT(td, flat) {
  const conflicts = [];
  const warnings = [];
  const ramps = td.ids.map((id) => td.ramps[id]);
  const sets = ramps.map((r) => new Set([...r.shadow, ...r.base, ...r.lit, ...r.outline]));
  const add = (list, k, kind, letter, idx, detail) => list.push({ x: k % N, y: Math.floor(k / N), kind, letter, part: idx >= 0 ? td.ids[idx] : null, detail });
  for (let k = 0; k < N * N; k++) {
    const x = k % N, y = Math.floor(k / N);
    const L = flat[k];
    const own = td.idx[k];
    if (L === '.') {
      if (own >= 0) {
        if (td.outline[k] === 0) add(conflicts, k, 'hole', '.', own, 'the template has an interior cell here; paint it');
        else add(warnings, k, 'edge-missing', '.', own, 'edge cell left transparent');
      }
      continue;
    }
    const near = [...new Set(nbr9(x, y).map((c) => td.idx[c]).filter((i) => i >= 0))];
    if (!near.length) { add(conflicts, k, 'outside-silhouette', L, -1, 'no template cell within 1 px'); continue; }
    const lockedLetter = td.locked?.[k];
    if (lockedLetter && lockedLetter !== L) add(conflicts, k, 'locked-changed', L, own, `locked copy cell must stay ${lockedLetter}`);
    const ownOk = own >= 0 && sets[own].has(L);
    const via = ownOk ? own : near.find((i) => sets[i].has(L));
    if (via === undefined) {
      add(conflicts, k, 'ramp', L, own >= 0 ? own : near[0], `${L} is outside the ramp of ${near.map((i) => td.ids[i]).join(', ')} (dilated by 1 px)`);
      continue;
    }
    if (!ownOk) add(warnings, k, 'seam', L, own >= 0 ? own : via, `${L} belongs to the ramp of ${td.ids[via]}, a neighbor part`);
    else {
      const lv = levelIn(ramps[own], L);
      const tl = td.level[k];
      if (lv !== null && tl >= 0 && Math.abs(lv - tl) > 1) add(conflicts, k, 'light-level', L, own, `${L} is ${LEVEL_NAMES[lv]}, the template says ${LEVEL_NAMES[tl]}`);
    }
    if (own >= 0 && td.outline[k] > 0 && !ramps[own].outline.includes(L)) add(warnings, k, 'outline-missing', L, own, `outline cell: use one of ${ramps[own].outline}`);
  }
  const counts = {};
  for (const c of conflicts) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return { conflicts, warnings, counts };
}

export function formatLevelT(r) {
  const line = (c) => `row ${String(c.y).padStart(2)} col ${String(c.x).padStart(2)}  ${c.kind}: ${c.detail}`;
  const lines = [`CONFLICTS ${r.conflicts.length}`, ...r.conflicts.map(line), `WARNINGS ${r.warnings.length}`, ...r.warnings.map(line)];
  return `${lines.join('\n')}\n`;
}

/** The 32x picture of the painted grid: grid lines, coordinates, the letter in each cell, a red frame on each conflict, a yellow square on each warning. */
export function levelTSheet(flat, result, k = 32) {
  const img = gridToImage32(flat);
  const bad = new Set(result.conflicts.map((c) => c.y * N + c.x));
  const warn = new Set(result.warnings.map((c) => c.y * N + c.x));
  return zoomGrid(img, {
    k, originX: 0, originY: 0,
    after: (out, ml, mt, kk) => {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const L = flat[i];
          const px = ml + x * kk, py = mt + y * kk;
          if (L !== '.') drawLower(out, L, px + (kk >> 1) - 3, py + (kk >> 1) - 5, lumRgb(rgbOfLetter(L)) > 110 ? [10, 10, 14, 255] : [240, 240, 245, 255], 2);
          if (bad.has(i)) for (let t = 0; t < 3; t++) { fillRect(out, px + t, py + t, kk - 2 * t, 1, [255, 0, 60, 255]); fillRect(out, px + t, py + kk - 1 - t, kk - 2 * t, 1, [255, 0, 60, 255]); fillRect(out, px + t, py + t, 1, kk - 2 * t, [255, 0, 60, 255]); fillRect(out, px + kk - 1 - t, py + t, 1, kk - 2 * t, [255, 0, 60, 255]); }
          else if (warn.has(i)) fillRect(out, px + kk - 8, py + 2, 6, 6, [255, 210, 0, 255]);
        }
    },
  });
}
/** Same views as the head test render: the 1x picture, the family separations and the 4-step poster, all with frame coordinates from 0. */
export function levelTViews(flat) {
  const img = gridToImage32(flat);
  const out = { '': img };
  for (const f of FAMILY_NAMES) out[`-sep-${f}`] = zoomGrid(img, { k: 32, originX: 0, originY: 0, family: f });
  out['-poster'] = zoomGrid(img, { k: 32, originX: 0, originY: 0, poster: true });
  return out;
}
