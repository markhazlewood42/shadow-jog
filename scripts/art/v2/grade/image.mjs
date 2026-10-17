// Image helpers for the grade kit. An image is { w, h, data } RGBA (pixkit/png.mjs). A label grid is an Array(w * h) of part names or null.
import { crop, hex, newImage, unhex } from '../../pixkit/png.mjs';
import { labOfPacked, lumaOf, pack } from './color.mjs';

/** The scoring canvas: every aligned image is N x N. */
export const N = 32;
export const NEAR_BLACK_LUMA = 60;

export const opaqueAt = (img, x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[(y * img.w + x) * 4 + 3] === 255;
export const packedAt = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return pack(img.data[i], img.data[i + 1], img.data[i + 2]);
};
export const lumaAt = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return lumaOf(img.data[i], img.data[i + 1], img.data[i + 2]);
};
export const hexAt = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return hex(img.data[i], img.data[i + 1], img.data[i + 2]);
};
export const setPixel = (img, x, y, packed) => {
  const i = (y * img.w + x) * 4;
  img.data[i] = (packed >> 16) & 255;
  img.data[i + 1] = (packed >> 8) & 255;
  img.data[i + 2] = packed & 255;
  img.data[i + 3] = 255;
};
export const clearPixel = (img, x, y) => {
  img.data.fill(0, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
};
export const cloneImg = (img) => ({ w: img.w, h: img.h, data: new Uint8Array(img.data) });

/** Bounding box of the opaque cells, or null. */
export function bboxOf(img) {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (opaqueAt(img, x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
/** Mask (Uint8Array) of edge cells: opaque with a transparent 4-neighbor (out of bounds counts as transparent). */
export function edgeMask(img) {
  const m = new Uint8Array(img.w * img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (opaqueAt(img, x, y) && N4.some(([dx, dy]) => !opaqueAt(img, x + dx, y + dy))) m[y * img.w + x] = 1;
  return m;
}
/** Interior cells: opaque with all 4 neighbors opaque. */
export function interiorMask(img) {
  const m = new Uint8Array(img.w * img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (opaqueAt(img, x, y) && N4.every(([dx, dy]) => opaqueAt(img, x + dx, y + dy))) m[y * img.w + x] = 1;
  return m;
}
export const opaqueMask = (img) => {
  const m = new Uint8Array(img.w * img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (opaqueAt(img, x, y)) m[y * img.w + x] = 1;
  return m;
};
export const countOpaque = (img) => opaqueMask(img).reduce((s, v) => s + v, 0);

/** Distinct opaque colors as packed ints with their counts: Map(packed -> count). */
export function colorCounts(img) {
  const m = new Map();
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (opaqueAt(img, x, y)) {
        const p = packedAt(img, x, y);
        m.set(p, (m.get(p) ?? 0) + 1);
      }
  return m;
}

/** Nearest palette color in Lab (dE76). palette: array of packed ints. */
export function nearestPacked(p, palette) {
  const [L, a, b] = labOfPacked(p);
  let best = palette[0];
  let bd = Number.POSITIVE_INFINITY;
  for (const q of palette) {
    const [l2, a2, b2] = labOfPacked(q);
    const d = (L - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Hex list ("#rrggbb") to packed ints. */
export const packedList = (hexes) =>
  hexes.map((h) => {
    const [r, g, b] = unhex(h);
    return pack(r, g, b);
  });

/** Map every opaque cell to its nearest palette color. Returns a new image. */
export function quantizeTo(img, paletteHex) {
  const pal = packedList(paletteHex);
  const out = cloneImg(img);
  const cache = new Map();
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!opaqueAt(img, x, y)) continue;
      const p = packedAt(img, x, y);
      let q = cache.get(p);
      if (q === undefined) {
        q = nearestPacked(p, pal);
        cache.set(p, q);
      }
      setPixel(out, x, y, q);
    }
  return out;
}

/**
 * Recolor the outline to the near-black rule (plan v2 section 4): every edge cell whose luminance is 60 or more
 * becomes the nearest (Lab) near-black color of the list. Edge cells that are already near-black stay.
 */
export function recolorOutline(img, nearBlackHex) {
  const nb = packedList(nearBlackHex);
  const edge = edgeMask(img);
  const out = cloneImg(img);
  let changed = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!edge[y * img.w + x]) continue;
      if (lumaAt(img, x, y) < NEAR_BLACK_LUMA) continue;
      setPixel(out, x, y, nearestPacked(packedAt(img, x, y), nb));
      changed++;
    }
  return { img: out, changed };
}

/** Mirror left to right inside the image. */
export function flipH(img) {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (y * img.w + (img.w - 1 - x)) * 4);
  return out;
}

/** Mirror a label grid left to right. */
export function flipLabels(labels, w, h) {
  const out = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + (w - 1 - x)] = labels[y * w + x] ?? null;
  return out;
}

/** Move every cell by (dx, dy). Cells that leave the canvas are dropped. */
export function shiftImg(img, dx, dy) {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
      out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (Y * img.w + X) * 4);
    }
  return out;
}

/**
 * Resize the opaque box of an image (and its label grid) by nearest neighbor to height s and place it on a size x size canvas.
 * anchor 'bbox': the resized box bottom lands on the bottom row of `target` (a bbox) and its center column on the center of `target`.
 * anchor 'none': the resized box top-left lands on the source box top-left.
 * Then the shift (dx, dy) is added. Returns { img, labels, box }; labels is null when none were given.
 */
export function placeScaled(src, labels, { s, dx = 0, dy = 0, anchor = 'bbox', target = null, size = N }) {
  const b = bboxOf(src);
  const out = { w: size, h: size, data: new Uint8Array(size * size * 4) };
  const lab = labels ? new Array(size * size).fill(null) : null;
  if (!b) return { img: out, labels: lab, box: null };
  const f = s / b.h;
  const nw = Math.max(1, Math.round(b.w * f));
  let x0;
  let y0;
  if (anchor === 'none' || !target) {
    x0 = b.x0 + dx;
    y0 = b.y0 + dy;
  } else {
    x0 = Math.round((target.x0 + target.x1) / 2 - (nw - 1) / 2) + dx;
    y0 = target.y1 - s + 1 + dy;
  }
  for (let v = 0; v < s; v++)
    for (let u = 0; u < nw; u++) {
      const sx = Math.min(b.x1, b.x0 + Math.floor(((u + 0.5) * b.w) / nw));
      const sy = Math.min(b.y1, b.y0 + Math.floor(((v + 0.5) * b.h) / s));
      if (!opaqueAt(src, sx, sy)) continue;
      const X = x0 + u;
      const Y = y0 + v;
      if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
      out.data.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (Y * size + X) * 4);
      if (lab) lab[Y * size + X] = labels[sy * src.w + sx] ?? null;
    }
  return { img: out, labels: lab, box: { x0, y0, x1: x0 + nw - 1, y1: y0 + s - 1 } };
}

/** Copy an image onto a size x size canvas (top-left at 0,0), cropping what falls outside. */
export const toCanvas = (img, size = N) => crop(img, 0, 0, size, size);
