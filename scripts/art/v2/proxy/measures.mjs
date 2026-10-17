// Measures of a per-cell label list (a template or the given part map): height, bottom row, head alone, shoulder and hip rows, area per label and per group.
// Shared by the template checks and by the fit guard. Pure functions.
import { HEAD_PARTS, PART_NAMES, SHEATH_PARTS } from '../../pipeline/decompose.mjs';
import { guideRows } from './render.mjs';
import { SIZE } from './spec.mjs';

const r4 = (v) => Math.round(v * 10000) / 10000;
export const HEAD_ALONE_ROWS = 12; // head rows are y 0 to 12 (pipeline/masks.mjs)
/** Groups for the area check. Parts that trade cells with a neighbor at other yaws (hair and face, coat and zipper) share a group. */
export const AREA_GROUPS = {
  head: HEAD_PARTS, torso: ['coat', 'zipper'], sleeves: ['sleeves'], hands: ['hands'], legs: ['legs'], boots: ['boots'], item: SHEATH_PARTS,
};
export const AREA_TOLERANCE = 0.3;

/** Measures of a per-cell label list: height, bottom row, head alone, shoulder and hip rows, area per label. */
export function labelMeasures(labels) {
  const rows = labels.map((l, k) => (l ? Math.floor(k / SIZE) : -1)).filter((y) => y >= 0);
  const top = rows.length ? Math.min(...rows) : null;
  const bottom = rows.length ? Math.max(...rows) : null;
  let headAlone = 0;
  for (let y = 0; y <= HEAD_ALONE_ROWS; y++) {
    const xs = [];
    for (let x = 0; x < SIZE; x++) { const l = labels[y * SIZE + x]; if (l && !SHEATH_PARTS.includes(l)) xs.push(x); }
    if (xs.length) headAlone = Math.max(headAlone, Math.max(...xs) - Math.min(...xs) + 1);
  }
  const g = guideRows(labels);
  const areas = Object.fromEntries(PART_NAMES.map((n) => [n, labels.filter((l) => l === n).length]));
  return { top, bottom, height: top === null ? 0 : bottom - top + 1, headAlone, shoulder: g.shoulder, hip: g.hip, areas };
}

/** Agreement of two label lists on the cells that hold no item part in either list (a carried item hides body cells on one side only, so those cells are left out). */
export function labelAgreement(a, b) {
  let inter = 0, uni = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (SHEATH_PARTS.includes(a[k] ?? '') || SHEATH_PARTS.includes(b[k] ?? '')) continue;
    if (a[k] === null && b[k] === null) continue;
    uni++;
    if (a[k] === b[k]) inter++;
  }
  return uni ? r4(inter / uni) : 1;
}
