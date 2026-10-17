// Grader tool: draw a reference with its part labels, to check and fix the labels by eye.
//   node scripts/art/v2/grade/refs/view-labels.mjs <facing> <out.png> [--auto]
// Left panel: the picture at 16x with a coordinate grid. Right panel: the same cells tinted by part, with the one-letter part code.
// --auto shows the automatic labeler's output instead of the stored labels.
import { drawText, fillRect } from '../../../headtest/lib.mjs';
import { newImage, readPng, writePng } from '../../../pixkit/png.mjs';
import { PARTS_TINT, PART_CODES, autoLabel } from '../parts.mjs';
import { loadRefLabels, refImagePath } from './labels.mjs';

const K = 16;
const M = 18;

export function renderLabels(img, labels) {
  const W = M + img.w * K;
  const H = M + img.h * K;
  const out = newImage(W * 2 + 8, H, [40, 40, 48, 255]);
  const cell = (ox, x, y, rgba) => fillRect(out, ox + M + x * K, M + y * K, K, K, rgba);
  for (const ox of [0, W + 8]) {
    for (let x = 0; x < img.w; x++) if (x % 4 === 0) drawText(out, String(x), ox + M + x * K + 1, 4, [200, 200, 200, 255], 1);
    for (let y = 0; y < img.h; y++) if (y % 4 === 0) drawText(out, String(y), 1, M + y * K + 4, [200, 200, 200, 255], 1);
  }
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      if (img.data[i + 3] === 0) continue;
      cell(0, x, y, [img.data[i], img.data[i + 1], img.data[i + 2], 255]);
      const p = labels[y * img.w + x];
      const tint = p ? PARTS_TINT[p] : [255, 0, 255];
      cell(W + 8, x, y, [...tint, 255]);
      drawText(out, p ? PART_CODES[p] : '?', W + 8 + M + x * K + 4, M + y * K + 4, [0, 0, 0, 255], 2);
    }
  for (const ox of [0, W + 8]) {
    for (let t = 0; t <= img.w; t += 4) fillRect(out, ox + M + t * K, M, 1, img.h * K, [120, 120, 130, 255]);
    for (let t = 0; t <= img.h; t += 4) fillRect(out, ox + M, M + t * K, img.w * K, 1, [120, 120, 130, 255]);
  }
  return out;
}

if (process.argv[1]?.endsWith('view-labels.mjs')) {
  const [facing, outPath, flag] = process.argv.slice(2);
  const img = readPng(refImagePath(facing));
  const labels = flag === '--auto' ? autoLabel(img) : loadRefLabels(facing).labels;
  writePng(renderLabels(img, labels), outPath);
}
