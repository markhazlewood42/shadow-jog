// Grader tool: build the reference label files from the automatic labeler and the hand edits.
//   node scripts/art/v2/grade/refs/label-refs.mjs [facing ...] [--refresh-base]
// First run for a facing: autoRows = the automatic labeler on the reference picture. Later runs reuse the frozen autoRows in the file
// (so the record stays true even if the labeler changes), unless --refresh-base is given. Then the edits of label-edits.json are applied.
// Needs the Sprite Fusion reference pictures (grader-only data).
import { existsSync, readFileSync } from 'node:fs';
import { readPng } from '../../../pixkit/png.mjs';
import { autoLabel, labelRows, landmarksOf, rowsToLabels } from '../parts.mjs';
import { REF_FACINGS, applyEdits, editsPath, labelsPath, refImagePath, writeRefLabels } from './labels.mjs';

const args = process.argv.slice(2);
const refresh = args.includes('--refresh-base');
const which = args.filter((a) => !a.startsWith('--'));
const edits = JSON.parse(readFileSync(editsPath, 'utf8'));
for (const f of which.length ? which : REF_FACINGS) {
  const img = readPng(refImagePath(f));
  const old = existsSync(labelsPath(f)) && !refresh ? JSON.parse(readFileSync(labelsPath(f), 'utf8')) : null;
  const autoRows = old?.autoRows ?? labelRows(autoLabel(img), img.w, img.h);
  const e = edits.facings[f] ?? { edits: [], landmarkEdits: {} };
  const labels = applyEdits(rowsToLabels(autoRows), img.w, img.h, e.edits, img);
  const rows = labelRows(labels, img.w, img.h);
  const lm = landmarksOf(labels, img.w, img.h);
  for (const [k, v] of Object.entries(e.landmarkEdits ?? {})) {
    if (v === null) delete lm[k];
    else lm[k] = v;
  }
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] !== 0 && !labels[y * img.w + x]) throw new Error(`${f}: opaque cell ${x},${y} has no part`);
  writeRefLabels(f, {
    facing: f,
    source: `spritefusion-tests/rook-8d-ref/${f}.png`,
    size: [img.w, img.h],
    method: [
      'First pass: parts.mjs autoLabel (color class plus position in the opaque box), frozen in autoRows.',
      'Hand edits from label-edits.json, applied in order (listed in edits). Made by reading the 16x label viewer and the ASCII class map.',
      'Landmarks computed by parts.mjs landmarksOf from rows, then landmarkEdits.',
      'Sleeves are not separated from the coat here: the auto pass labels both as coat, and the mIoU groups merge them anyway.',
    ],
    autoRows,
    edits: e.edits,
    landmarkEdits: e.landmarkEdits ?? {},
    rows,
    landmarks: Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, v.map((n) => Math.round(n * 100) / 100)])),
  });
  console.log(`${f}: ${rows.flatMap((r) => [...r]).filter((c) => c !== '.').length} labeled cells, ${Object.keys(lm).length} landmarks, ${e.edits.length} edits`);
}
