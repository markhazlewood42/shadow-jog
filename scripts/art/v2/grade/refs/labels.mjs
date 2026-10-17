// Reference labels (grader-only data). One file per reference facing: refs/<facing>.labels.json.
// Each file holds the final part map (rows of part codes), the landmarks, and how they were made:
//   autoRows  the first pass: the automatic labeler (parts.mjs autoLabel) on the reference picture, frozen at the time of labeling
//   edits     the hand edits applied to autoRows, in order. A box edit sets `part` on the cells of the box (only cells whose current part is
//             in `from`, when `from` is given; only opaque cells). A cells edit sets `part` on single cells.
//   rows      autoRows with every edit applied. This is the truth that the grader reads.
//   landmarks the landmarks computed from rows (parts.mjs landmarksOf), then the `landmarkEdits` (a point, or null to drop a point)
// The tests check that rows equals autoRows with the edits applied, so the record is true.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from '../../../pixkit/png.mjs';
import { REPO } from '../../../pipeline/given.mjs';
import { landmarksOf, labelRows, PART_CODES, rowsToLabels } from '../parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REF_FACINGS = ['s', 'n', 'ne', 'nw', 'sw'];
export const refImagePath = (facing) => `${REPO}/spritefusion-tests/rook-8d-ref/${facing}.png`;
export const labelsPath = (facing) => `${here}/${facing}.labels.json`;
export const editsPath = `${here}/label-edits.json`;

/** Apply the edits to a label grid (Array(w * h)). Returns a new grid. */
export function applyEdits(labels, w, h, edits, img = null) {
  const out = [...labels];
  for (const e of edits) {
    if (!(e.part in PART_CODES)) throw new Error(`label edit: unknown part '${e.part}'`);
    const set = (x, y) => {
      const i = y * w + x;
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (img && img.data[i * 4 + 3] === 0) return;
      if (!out[i] && !img) return;
      if (e.from && !e.from.includes(out[i])) return;
      out[i] = e.part;
    };
    if (e.box) for (let y = e.box[1]; y <= e.box[3]; y++) for (let x = e.box[0]; x <= e.box[2]; x++) set(x, y);
    if (e.cells) for (const [x, y] of e.cells) set(x, y);
  }
  return out;
}

/** Read one reference label file. Returns { ...json, labels, w, h }. */
export function loadRefLabels(facing) {
  const j = JSON.parse(readFileSync(labelsPath(facing), 'utf8'));
  return { ...j, labels: rowsToLabels(j.rows), w: j.rows[0].length, h: j.rows.length };
}

/** Load the reference picture and its labels. */
export function loadReference(facing) {
  const img = readPng(refImagePath(facing));
  const lab = loadRefLabels(facing);
  if (lab.w !== img.w || lab.h !== img.h) throw new Error(`labels of ${facing} are ${lab.w}x${lab.h}, picture is ${img.w}x${img.h}`);
  return { img, labels: lab.labels, landmarks: lab.landmarks, file: lab };
}

export function writeRefLabels(facing, json) {
  writeFileSync(labelsPath(facing), `${JSON.stringify(json, null, 1)}\n`);
}
export const hasRefLabels = (facing) => existsSync(labelsPath(facing));

export { labelRows, landmarksOf };
