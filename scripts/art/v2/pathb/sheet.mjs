// Path B construction sheet: a 2D sheet per facing, drawn by code from the facing data (rook-pathb.json), no 3D model.
// A sheet = guide rows + anchors (head center, face axis, body center) + part boxes in paint order. Rasterizing the boxes gives the part map.
// Coordinates are cell indexes. A cell is in a box when its center (x, y) lies inside, so 10.5 as a left edge starts at cell 11 and 17.5 is the line between cells 17 and 18.
// Box shapes: rect (optional taper to xb at the last row), ell, dome (top half of an ellipse), band (a thick diagonal segment).
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_PATH = `${here}/rook-pathb.json`;
export const loadData = (path = DATA_PATH) => JSON.parse(readFileSync(path, 'utf8'));
export const SIZE = 32;
const EPS = 1e-9;

/** "head+7", "shoulder-1", "face" or a number, resolved against the anchor table. */
export function resolve(expr, anchors) {
  if (typeof expr === 'number') return expr;
  const m = /^([A-Za-z]+)([+-][0-9.]+)?$/.exec(expr);
  if (!m) throw new Error(`bad expression ${expr}`);
  const base = anchors[m[1]];
  if (base === undefined) throw new Error(`unknown anchor ${m[1]} in ${expr}`);
  return base + (m[2] ? Number(m[2]) : 0);
}

/** Anchors of one facing: the character rows plus this facing's columns. */
export function anchorsOf(data, facing) {
  const f = data.facings[facing];
  if (!f) throw new Error(`unknown facing ${facing}`);
  return { ...data.character.rows, head: f.headCenter, face: f.faceAxis, body: f.bodyCenter };
}

const lerp = (a, b, t) => a + (b - a) * t;
const seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** The cells of one box, as a list of [x, y]. */
export function boxCells(box, anchors) {
  const out = [];
  const shape = box.shape ?? 'rect';
  if (shape === 'band') {
    const [ax, ay] = box.from.map((e) => resolve(e, anchors));
    const [bx, by] = box.to.map((e) => resolve(e, anchors));
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (seg(x, y, ax, ay, bx, by) <= box.t + EPS) out.push([x, y]);
    return out;
  }
  const [y0, y1] = box.y.map((e) => resolve(e, anchors));
  const [xa, xb] = box.x.map((e) => resolve(e, anchors));
  if (shape === 'rect') {
    const [ea, eb] = box.xe ? box.xe.map((e) => resolve(e, anchors)) : [xa, xb];
    for (let y = y0; y <= y1; y++) {
      const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      const a = lerp(xa, ea, t);
      const b = lerp(xb, eb, t);
      for (let x = Math.max(0, Math.ceil(a - EPS)); x <= Math.min(SIZE - 1, Math.floor(b + EPS)); x++) out.push([x, y]);
    }
    return out;
  }
  const cx = (xa + xb) / 2;
  const rx = (xb - xa) / 2 + 0.5;
  if (shape === 'ell') {
    const cy = (y0 + y1) / 2;
    const ry = (y1 - y0) / 2 + 0.5;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < SIZE; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + EPS) out.push([x, y]);
    return out;
  }
  if (shape === 'dome') {
    const ry = y1 - y0 + 0.5;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < SIZE; x++) if (((x - cx) / rx) ** 2 + ((y - y1) / ry) ** 2 <= 1 + EPS) out.push([x, y]);
    return out;
  }
  throw new Error(`unknown shape ${shape}`);
}

/** Mirror one box about x' = axis - x. Only numeric x values can mirror (an anchor is facing data, not a place). */
function mirrorBox(b, axis) {
  const num = (v) => {
    if (typeof v !== 'number') throw new Error('a mirrored block holds numbers only');
    return axis - v;
  };
  if (b.shape === 'band') return { ...b, from: [num(b.from[0]), b.from[1]], to: [num(b.to[0]), b.to[1]] };
  const out = { ...b, x: [num(b.x[1]), num(b.x[0])] };
  if (b.xe) out.xe = [num(b.xe[1]), num(b.xe[0])];
  return out;
}

/** Replace each { use: "block", mirror?: axis } entry with the boxes of data.blocks.block (blocks share boxes between facings). */
export function expandBoxes(data, list) {
  return list.flatMap((b) => {
    if (!b.use) return [b];
    const block = data.blocks?.[b.use];
    if (!block) throw new Error(`unknown block ${b.use}`);
    const boxes = expandBoxes(data, block);
    return b.mirror === undefined ? boxes : boxes.map((x) => mirrorBox(x, b.mirror));
  });
}

/**
 * Build the sheet of one facing. Returns
 *   { facing, w, h, anchors, rows, labels: Array(w*h) of part name or null, parts: { name: [cell index] }, boxes: [{ part, cells }] }.
 * Boxes paint in list order; a later box overwrites an earlier one (the z order of the facing data).
 */
export function buildSheet(data, facing) {
  const anchors = anchorsOf(data, facing);
  const f = data.facings[facing];
  const labels = Array(SIZE * SIZE).fill(null);
  const boxes = [];
  for (const b of expandBoxes(data, f.boxes)) {
    const cells = boxCells(b, anchors);
    boxes.push({ part: b.part, shape: b.shape ?? 'rect', cells });
    for (const [x, y] of cells) labels[y * SIZE + x] = b.part;
  }
  const parts = Object.fromEntries(data.character.parts.map((p) => [p, []]));
  labels.forEach((p, i) => {
    if (p) {
      if (!parts[p]) throw new Error(`facing ${facing}: box part ${p} is not in character.parts`);
      parts[p].push(i);
    }
  });
  return { facing, w: SIZE, h: SIZE, anchors, rows: { ...data.character.rows }, labels, parts, boxes };
}

/** The part map in the pipeline format: { w, h, parts }. */
export const toPartMap = (sheet) => ({ w: sheet.w, h: sheet.h, parts: sheet.parts });

/** Mirror a sheet about a vertical line: x' = axis2 - x (axis2 = 35 mirrors about the line between cells 17 and 18). The item needs a redraw: see the card. */
export function mirrorSheet(sheet, facing, axis2 = 35) {
  const labels = Array(SIZE * SIZE).fill(null);
  sheet.labels.forEach((p, i) => {
    if (!p) return;
    const x = axis2 - (i % SIZE);
    if (x >= 0 && x < SIZE) labels[Math.floor(i / SIZE) * SIZE + x] = p;
  });
  const parts = Object.fromEntries(Object.keys(sheet.parts).map((p) => [p, []]));
  labels.forEach((p, i) => {
    if (p) parts[p].push(i);
  });
  const a = sheet.anchors;
  return {
    ...sheet,
    facing,
    labels,
    parts,
    boxes: sheet.boxes.map((b) => ({ ...b, cells: b.cells.map(([x, y]) => [axis2 - x, y]).filter(([x]) => x >= 0 && x < SIZE) })),
    anchors: { ...a, head: axis2 - a.head, face: axis2 - a.face, body: axis2 - a.body },
    mirroredFrom: sheet.facing,
  };
}

export const cellOf = (i) => [i % SIZE, Math.floor(i / SIZE)];
export const opaqueCells = (sheet) => sheet.labels.flatMap((p, i) => (p ? [i] : []));
