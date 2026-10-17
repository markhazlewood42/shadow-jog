// Step 0 of the grade (plan v2 section 4, R3 section 2): one shared transform for every measure.
// The candidate stays as it is. The reference (target) is resized by nearest neighbor so that its opaque box is 31, 32 or 33 px tall,
// placed on the candidate's bottom row and center column, and shifted by up to 2 px in each direction. The best transform by BF1 wins.
// Every later measure then runs on the union of the opaque cells of the candidate and the aligned reference.
import { N, bboxOf, edgeMask, opaqueAt, opaqueMask, placeScaled } from './image.mjs';

export const SCALES = [31, 32, 33];
export const SHIFT = 2;
export const BF_TOL = 1; // pixels, Chebyshev

/** Boundary F at tolerance tol over two edge masks of the same size. Returns { f, p, r, nA, nB }. */
export function boundaryF(edgeA, edgeB, w, h, tol = BF_TOL) {
  const near = (mask, x, y) => {
    for (let j = -tol; j <= tol; j++)
      for (let i = -tol; i <= tol; i++) {
        const X = x + i;
        const Y = y + j;
        if (X >= 0 && Y >= 0 && X < w && Y < h && mask[Y * w + X]) return true;
      }
    return false;
  };
  let nA = 0;
  let nB = 0;
  let hitA = 0;
  let hitB = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (edgeA[y * w + x]) {
        nA++;
        if (near(edgeB, x, y)) hitA++;
      }
      if (edgeB[y * w + x]) {
        nB++;
        if (near(edgeA, x, y)) hitB++;
      }
    }
  if (!nA || !nB) return { f: 0, p: 0, r: 0, nA, nB };
  const p = hitA / nA;
  const r = hitB / nB;
  return { f: p + r === 0 ? 0 : (2 * p * r) / (p + r), p, r, nA, nB };
}

const EPS = 1e-12;
const cmpKey = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > EPS) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
};
function maskIou(a, b) {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni ? inter / uni : 0;
}
/**
 * Find the best transform of a reference onto a candidate.
 * ref: { img, labels } (labels may be null). cand: image. opts.anchor 'bbox' (default) or 'none'.
 * Returns { s, dx, dy, bf1, ref: { img, labels, box } } where ref is the aligned reference on the N x N canvas.
 */
export function align(cand, ref, { anchor = 'bbox', scales = SCALES, shift = SHIFT } = {}) {
  const cb = bboxOf(cand);
  const refBox = bboxOf(ref.img);
  if (!cb || !refBox) throw new Error('align: empty candidate or reference');
  const candEdge = edgeMask(cand);
  const candMask = opaqueMask(cand);
  let best = null;
  for (const s of scales)
    for (let dy = -shift; dy <= shift; dy++)
      for (let dx = -shift; dx <= shift; dx++) {
        const placed = placeScaled(ref.img, ref.labels, { s, dx, dy, anchor, target: cb });
        const bf = boundaryF(candEdge, edgeMask(placed.img), N, N);
        // BF1 at 1 px often ties, so ties go to the exact silhouette overlap (IoU), then the smaller move, then the scale closest to the reference's own height.
        const iou = maskIou(candMask, opaqueMask(placed.img));
        const move = -(Math.abs(dx) + Math.abs(dy));
        const near = -Math.abs(s - refBox.h);
        const key = [bf.f, iou, move, near];
        const better = !best || cmpKey(key, best.key) > 0;
        if (better) best = { s, dx, dy, bf1: bf.f, key, placed };
      }
  return { s: best.s, dx: best.dx, dy: best.dy, bf1: best.bf1, ref: { img: best.placed.img, labels: best.placed.labels, box: best.placed.box } };
}

/** The union of the opaque cells of two canvases as a Uint8Array. */
export function unionMask(a, b) {
  const m = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (opaqueAt(a, x, y) || opaqueAt(b, x, y)) m[y * N + x] = 1;
  return m;
}
