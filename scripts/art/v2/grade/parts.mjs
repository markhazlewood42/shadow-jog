// Part labels, part groups, landmarks and the automatic labeler of the grade kit.
// A label grid is Array(w * h) of part names (the 13 parts of pipeline/decompose.mjs PARTS) or null for a transparent cell.
// The part mIoU measure (R3 rank 2) runs on 7 groups. Sleeves are merged with the coat and the zipper (one torso group), because the
// boundary between sleeve and coat is inside one olive ramp and no color rule can find it. The reference labels keep all 13 parts.
import { PARTS } from '../../pipeline/decompose.mjs';
import { bboxOf, opaqueAt } from './image.mjs';

export const PART_CODES = Object.fromEntries(Object.entries(PARTS).map(([name, p]) => [name, p.code]));
export const PART_OF_CODE = Object.fromEntries(Object.entries(PARTS).map(([name, p]) => [p.code, name]));

/** One tint per part, for the label viewer. */
export const PARTS_TINT = {
  hair: [190, 190, 200],
  skin: [240, 190, 150],
  lenses: [250, 160, 40],
  beard: [150, 150, 160],
  coat: [120, 160, 90],
  sleeves: [90, 130, 70],
  zipper: [120, 200, 220],
  hands: [255, 140, 140],
  legs: [90, 90, 150],
  boots: [60, 60, 110],
  sheath: [170, 120, 70],
  guard: [240, 220, 60],
  wrap: [140, 80, 40],
};

export const GROUPS = {
  hair: ['hair'],
  face: ['skin', 'lenses', 'beard'],
  torso: ['coat', 'sleeves', 'zipper'],
  hands: ['hands'],
  legs: ['legs'],
  boots: ['boots'],
  item: ['sheath', 'guard', 'wrap'],
};
export const GROUP_NAMES = Object.keys(GROUPS);
export const GROUP_OF_PART = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, ps]) => ps.map((p) => [p, g])));

/** Label grid to rows of part codes ('.' for null). */
export function labelRows(labels, w, h) {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (labels[y * w + x] ? PART_CODES[labels[y * w + x]] : '.')).join(''));
}
/** Rows of part codes to a label grid. */
export function rowsToLabels(rows) {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '.') continue;
      const p = PART_OF_CODE[c];
      if (!p) throw new Error(`labels: unknown part code '${c}' at ${x},${y}`);
      out[y * w + x] = p;
    }
  return out;
}
/** A label grid built from the part map object of pipeline/decompose.mjs: { w, h, parts: { name: [cell index] } }. */
export function labelsFromPartMap(pm) {
  const out = new Array(pm.w * pm.h).fill(null);
  for (const [name, cells] of Object.entries(pm.parts)) for (const i of cells) out[i] = name;
  return out;
}
/** Label grid to a group grid. */
export const toGroups = (labels) => labels.map((p) => (p ? (GROUP_OF_PART[p] ?? null) : null));

// ---------------------------------------------------------------- color classes

function hsv(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const mx = Math.max(R, G, B);
  const d = mx - Math.min(R, G, B);
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

/**
 * Color class of one pixel: 'nb' near-black (luminance under 60), 'gray' (steel, hair, beard, zipper), 'olive' (coat),
 * 'skin', 'gold' (orange lens, brass guard) or 'warm' (brown: sheath, wrap, cuff).
 */
export function colorClass(r, g, b) {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  if (l < 60) return 'nb';
  const { h, s, v } = hsv(r, g, b);
  if (s < 0.18) return 'gray';
  if (h >= 55 && h <= 115) return 'olive';
  if (h >= 10 && h <= 37 && v >= 0.7 && s < 0.72) return 'skin';
  if (h >= 28 && h <= 58 && s >= 0.55 && v >= 0.6) return 'gold';
  if (h <= 58 || h >= 340) return 'warm';
  return 'gray';
}

/** Rows in the head: the top 14 rows of the opaque box (the given's head is rows 0 to 13). */
export const HEAD_ROWS = 14;
/** The last 5 rows are legs (2 rows) and boots (3 rows), as in the given. */
const BOOT_ROWS = 3;
const LEG_ROWS = 2;

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Automatic labeler: color class plus position in the opaque box, for a candidate with no template.
 * It is a grader tool with a known error: the tests report how far it is from the hand labels of the references.
 * Returns the label grid.
 */
export function autoLabel(img) {
  const b = bboxOf(img);
  const labels = new Array(img.w * img.h).fill(null);
  if (!b) return labels;
  const cls = new Array(img.w * img.h).fill(null);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!opaqueAt(img, x, y)) continue;
      const i = (y * img.w + x) * 4;
      cls[y * img.w + x] = colorClass(img.data[i], img.data[i + 1], img.data[i + 2]);
    }
  const headEnd = b.y0 + HEAD_ROWS;
  // Head columns: the extent of the gray cells (hair) in rows 2 to 6 of the box. They sit above the face and the hilt.
  let hx0 = img.w;
  let hx1 = -1;
  for (let y = b.y0 + 2; y <= b.y0 + 6; y++)
    for (let x = 0; x < img.w; x++) if (cls[y * img.w + x] === 'gray') {
      hx0 = Math.min(hx0, x);
      hx1 = Math.max(hx1, x);
    }
  if (hx1 < 0) {
    hx0 = b.x0;
    hx1 = b.x1;
  }
  const at = (x, y) => cls[y * img.w + x];
  // Lens extent: gold cells inside the head columns in head rows.
  let lx0 = img.w;
  let lx1 = -1;
  let lyMax = -1;
  for (let y = b.y0 + 3; y < headEnd; y++)
    for (let x = hx0 - 1; x <= hx1 + 1; x++)
      if (x >= hx0 + 2 && (at(x, y) === 'gold' || (at(x, y) === 'warm' && y < b.y0 + 12))) {
        lx0 = Math.min(lx0, x);
        lx1 = Math.max(lx1, x);
        lyMax = Math.max(lyMax, y);
      }
  const set = (x, y, p) => {
    labels[y * img.w + x] = p;
  };
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = 0; x < img.w; x++) {
      const c = at(x, y);
      if (!c) continue;
      if (y > b.y1 - BOOT_ROWS - LEG_ROWS) {
        // Lowest rows: the olive hem is coat, everything else is legs (upper 2 rows) or boots (lower 3).
        if (c === 'olive') set(x, y, 'coat');
        else set(x, y, y > b.y1 - BOOT_ROWS ? 'boots' : 'legs');
        continue;
      }
      if (c === 'nb') continue; // second pass
      const inHeadRows = y < headEnd;
      const inHeadCols = x >= hx0 - 1 && x <= hx1 + 1;
      if (c === 'olive') set(x, y, 'coat');
      else if (c === 'skin') set(x, y, inHeadRows && y < b.y0 + 14 && !(y >= b.y0 + 13 && !inHeadCols) ? 'skin' : 'hands');
      else if (c === 'gray') {
        if (inHeadRows) set(x, y, y >= b.y0 + 11 && lx1 >= 0 && x >= lx0 && x <= lx1 ? 'beard' : 'hair');
        else set(x, y, 'zipper');
      } else if (c === 'gold') set(x, y, inHeadRows && inHeadCols && lx1 >= 0 && x >= hx0 + 2 ? 'lenses' : 'guard');
      else if (c === 'warm') {
        if (inHeadRows && inHeadCols && y < b.y0 + 12 && lx1 >= 0 && x >= Math.max(lx0 - 1, hx0 + 2) && x <= lx1 + 1) set(x, y, 'lenses');
        else if (y >= b.y0 + 19 && y < b.y0 + 26) set(x, y, 'hands');
        else set(x, y, 'sheath');
      }
    }
  // Second pass: near-black cells (outline, dark lines) take the label of the nearest labeled cell (multi-source BFS in raster order).
  const dist = new Int16Array(img.w * img.h).fill(-1);
  const queue = [];
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % img.w;
    const y = Math.floor(i / img.w);
    for (const [dx, dy] of N8) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
      const j = Y * img.w + X;
      if (dist[j] >= 0 || !cls[j]) continue;
      dist[j] = dist[i] + 1;
      labels[j] = labels[i];
      queue.push(j);
    }
  }
  return labels;
}

// ---------------------------------------------------------------- landmarks

/** Names of the head points (checked at 0.05 x height). */
export const HEAD_POINTS = ['crown', 'lens1', 'lens2', 'chin'];

const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function cellsOf(labels, w, h, parts) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (labels[y * w + x] && parts.includes(labels[y * w + x])) out.push([x, y]);
  return out;
}
/** Lens cells to one or two groups: a lens span of 7 or more columns is a goggle pair, split at its middle column. */
function splitLenses(cells) {
  if (!cells.length) return [];
  const xs = cells.map(([x]) => x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi - lo + 1 < 7) return [cells];
  const mid = (lo + hi) / 2;
  return [cells.filter(([x]) => x <= mid), cells.filter(([x]) => x > mid)];
}
const centroid = (cells) => [meanOf(cells.map((c) => c[0])), meanOf(cells.map((c) => c[1]))];

/**
 * Landmarks computed from a label grid. The same function runs on the reference labels and on the candidate labels,
 * so the two sets of points follow one definition. A landmark that does not exist in a view is absent.
 *   crown        top row of the hair, mean x of the hair cells in that row
 *   lens1, lens2 the two lens clusters (left, right) as centroids. A view with one lens cluster has lens1 only
 *   chin         lowest row of the skin and beard cells, mean x in that row
 *   hand1, hand2 centroids of the hand cells left and right of the box center
 *   hem          lowest torso row, mean x in that row
 *   heel1, heel2 the bottom row of the boots, mean x left and right of the box center
 *   itemTop      topmost item cell, mean x in that row
 */
export function landmarksOf(labels, w, h) {
  const out = {};
  let x0 = w;
  let x1 = -1;
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) {
      x0 = Math.min(x0, i % w);
      x1 = Math.max(x1, i % w);
    }
  const cx = (x0 + x1) / 2;
  const hair = cellsOf(labels, w, h, ['hair']);
  if (hair.length) {
    const y = Math.min(...hair.map((c) => c[1]));
    out.crown = [meanOf(hair.filter((c) => c[1] === y).map((c) => c[0])), y];
  }
  const lenses = splitLenses(cellsOf(labels, w, h, ['lenses']));
  if (lenses[0]) out.lens1 = centroid(lenses[0]);
  if (lenses[1]) out.lens2 = centroid(lenses[1]);
  const jaw = cellsOf(labels, w, h, ['skin', 'beard']);
  if (jaw.length) {
    const y = Math.max(...jaw.map((c) => c[1]));
    out.chin = [meanOf(jaw.filter((c) => c[1] === y).map((c) => c[0])), y];
  }
  const hands = cellsOf(labels, w, h, ['hands']);
  const hl = hands.filter(([x]) => x < cx);
  const hr = hands.filter(([x]) => x >= cx);
  if (hl.length) out.hand1 = centroid(hl);
  if (hr.length) out.hand2 = centroid(hr);
  const torso = cellsOf(labels, w, h, ['coat', 'sleeves', 'zipper']);
  if (torso.length) {
    const y = Math.max(...torso.map((c) => c[1]));
    out.hem = [meanOf(torso.filter((c) => c[1] === y).map((c) => c[0])), y];
  }
  const boots = cellsOf(labels, w, h, ['boots']);
  if (boots.length) {
    const y = Math.max(...boots.map((c) => c[1]));
    const row = boots.filter((c) => c[1] === y);
    const bl = row.filter(([x]) => x < cx);
    const br = row.filter(([x]) => x >= cx);
    if (bl.length) out.heel1 = [meanOf(bl.map((c) => c[0])), y];
    if (br.length) out.heel2 = [meanOf(br.map((c) => c[0])), y];
  }
  const item = cellsOf(labels, w, h, ['sheath', 'guard', 'wrap']);
  if (item.length) {
    const y = Math.min(...item.map((c) => c[1]));
    out.itemTop = [meanOf(item.filter((c) => c[1] === y).map((c) => c[0])), y];
  }
  return out;
}
