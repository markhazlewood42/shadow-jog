// Path B maps from a sheet: light map (3 levels), outline map, guide rows, and the measures shared by the checks.
import { SIZE, cellOf } from './sheet.mjs';

/** Light map values. 0 = no pixel. */
export const LEVEL = { none: 0, shadow: 1, base: 2, lit: 3 };
export const LEVEL_NAMES = ['none', 'shadow', 'base', 'lit'];
/** Outline map values: 0 none, 1 silhouette outline cell, 2 interior seam cell. */
export const OUTLINE = { none: 0, silhouette: 1, seam: 2 };

const norm3 = (v) => {
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
};
const boundsOf = (cells) => {
  let x0 = SIZE;
  let y0 = SIZE;
  let x1 = -1;
  let y1 = -1;
  for (const i of cells) {
    const [x, y] = cellOf(i);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};

/**
 * 3-level light map. The light is fixed in the screen (top-left, toward the viewer), the same for every facing (R2, T10).
 * A round part is shaded by a normal that bulges out of its own box. A flat part (coat, zipper, item) is base with a shadow strip on the side away from the light (R2, section 3: fabric has little or no highlight).
 * Returns Uint8Array(w*h) of LEVEL values.
 */
export function lightMap(data, sheet) {
  const L = norm3(data.character.light.vector);
  const flat = new Set(data.character.flatParts);
  const lit = data.character.shade?.litAbove ?? 0.62;
  const dark = data.character.shade?.shadowBelow ?? 0.3;
  const strip = data.character.shade?.flatShadowAbove ?? 0.5;
  const out = new Uint8Array(SIZE * SIZE);
  for (const [part, cells] of Object.entries(sheet.parts)) {
    if (!cells.length) continue;
    const b = boundsOf(cells);
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const hl = Math.hypot(L[0], L[1]);
    for (const i of cells) {
      const [x, y] = cellOf(i);
      const nx = Math.max(-1, Math.min(1, (x - cx) / (w / 2 + 0.5)));
      const ny = Math.max(-1, Math.min(1, (y - cy) / (h / 2 + 0.5)));
      if (w <= 2 || h <= 2) {
        out[i] = LEVEL.base;
      } else if (flat.has(part)) {
        const away = (nx * L[0] + ny * L[1]) / -hl; // negative = toward the light
        out[i] = away > strip ? LEVEL.shadow : LEVEL.base;
      } else {
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const s = nx * L[0] + ny * L[1] + nz * L[2];
        out[i] = s >= lit ? LEVEL.lit : s < dark ? LEVEL.shadow : LEVEL.base;
      }
    }
  }
  return out;
}

const labelAt = (sheet, x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? null : sheet.labels[y * SIZE + x]);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Outline map: silhouette edge cells (an opaque cell with a transparent 4-neighbor, outside counts as transparent) and seam cells from data.character.seams. */
export function outlineMap(data, sheet) {
  const out = new Uint8Array(SIZE * SIZE);
  const seams = data.character.seams;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const p = labelAt(sheet, x, y);
      if (!p) continue;
      if (N4.some(([dx, dy]) => !labelAt(sheet, x + dx, y + dy))) {
        out[y * SIZE + x] = OUTLINE.silhouette;
        continue;
      }
      if (seams.some(([a, b]) => p === a && N4.some(([dx, dy]) => labelAt(sheet, x + dx, y + dy) === b))) out[y * SIZE + x] = OUTLINE.seam;
    }
  return out;
}

// ---- measures (also run on the given part map, so both sides use one definition) ----
const countRow = (labels, y, parts) => {
  let n = 0;
  for (let x = 0; x < SIZE; x++) if (parts.includes(labels[y * SIZE + x])) n++;
  return n;
};
/** Top row, bottom row and height of the opaque cells. */
export function extent(labels) {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      if (labels[y * SIZE + x]) {
        if (top < 0) top = y;
        bottom = y;
      }
  return { top, bottom, height: top < 0 ? 0 : bottom - top + 1 };
}
/** Widest row extent of the head parts over the head rows. */
export function headAlone(labels, character) {
  let best = 0;
  for (let y = character.rows.headTop; y <= character.rows.headBottom; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < SIZE; x++)
      if (character.headParts.includes(labels[y * SIZE + x])) {
        if (lo < 0) lo = x;
        hi = x;
      }
    if (lo >= 0) best = Math.max(best, hi - lo + 1);
  }
  return best;
}
/** Shoulder row: one above the first row of the shoulder part (sleeves). Hip row: the last row of the torso parts. Both rules are in data.checks. */
export function torsoRows(labels, character, checks) {
  let shoulder = -1;
  let hip = -1;
  for (let y = 0; y < SIZE; y++) {
    if (shoulder < 0 && countRow(labels, y, [checks.shoulderRule.part]) > 0) shoulder = y + checks.shoulderRule.offset;
    if (countRow(labels, y, checks.hipRule.parts) > 0) hip = y;
  }
  return { shoulder, hip };
}
/** Cells per part. */
export const areas = (labels) => {
  const out = {};
  for (const p of labels) if (p) out[p] = (out[p] ?? 0) + 1;
  return out;
};
/** All the numbers the template checks read, from a label array. */
export function measure(labels, data) {
  const { top, bottom, height } = extent(labels);
  return { top, bottom, height, headAlone: headAlone(labels, data.character), ...torsoRows(labels, data.character, data.checks), areas: areas(labels) };
}
