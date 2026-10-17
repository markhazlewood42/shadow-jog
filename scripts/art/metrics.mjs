// Pixel measurements shared by the target measurement (Step 0) and pixlint. All take an image { w, h, data } (RGBA).
import { hex } from './pixkit/png.mjs';

/** Luminance of an RGB triple or "#rrggbb" string, 0..255. */
export function luminance(c) {
  const [r, g, b] = typeof c === 'string' ? [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) : c;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export const NEAR_BLACK_LUMA = 60;

const alphaAt = (img, x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? 0 : img.data[(y * img.w + x) * 4 + 3]);
/** True if the pixel is opaque (alpha 255). Out of bounds is transparent. */
export function isOpaque(img, x, y) {
  return alphaAt(img, x, y) === 255;
}
/** "#rrggbb" of a pixel (ignores alpha). */
export function colorAt(img, x, y) {
  const i = (y * img.w + x) * 4;
  return hex(img.data[i], img.data[i + 1], img.data[i + 2]);
}

/** Count of pixels whose alpha is neither 0 nor 255, with the first few coordinates. */
export function halfAlpha(img) {
  const at = [];
  let n = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const a = alphaAt(img, x, y);
      if (a !== 0 && a !== 255) {
        n++;
        if (at.length < 5) at.push([x, y]);
      }
    }
  }
  return { count: n, at };
}

/** Sorted list of the opaque colors. */
export function colorsOf(img) {
  const s = new Set();
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (isOpaque(img, x, y)) s.add(colorAt(img, x, y));
  return [...s].sort();
}

/** Bounding box of the opaque pixels, or null. */
export function bbox(img) {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Head width: the widest opaque row extent (max x - min x + 1) over the top third of the bounding box
 * (rows y0 .. y0 + floor(h / 3) - 1). This is the pack's PA-07 method.
 */
export function headWidth(img) {
  const b = bbox(img);
  if (!b) return 0;
  const rows = Math.max(1, Math.floor(b.h / 3));
  let best = 0;
  for (let y = b.y0; y < b.y0 + rows; y++) {
    let lo = img.w;
    let hi = -1;
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi >= 0) best = Math.max(best, hi - lo + 1);
  }
  return best;
}

const N4 = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];
const N8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Edge pixels: opaque with a transparent 4-neighbor (out of bounds counts as transparent). Returns [[x, y], ...]. */
export function edgePixels(img) {
  const out = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      if (N4.some(([dx, dy]) => !isOpaque(img, x + dx, y + dy))) out.push([x, y]);
    }
  }
  return out;
}

/** Outline ratio: near-black edge pixels / edge pixels. nearBlack is a list of "#rrggbb"; when null, luminance under 60 decides. */
export function outlineRatio(img, nearBlack = null) {
  const edge = edgePixels(img);
  if (!edge.length) return { ratio: 1, edge: 0, nearBlack: 0, bad: [] };
  const set = nearBlack ? new Set(nearBlack) : null;
  const bad = [];
  let nb = 0;
  for (const [x, y] of edge) {
    const c = colorAt(img, x, y);
    const ok = set ? set.has(c) : luminance(c) < NEAR_BLACK_LUMA;
    if (ok) nb++;
    else bad.push([x, y]);
  }
  return { ratio: nb / edge.length, edge: edge.length, nearBlack: nb, bad };
}

/** Orphans: opaque pixels whose color matches none of the 8 neighbors. Returns [[x, y], ...]. */
export function orphans(img) {
  const out = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!isOpaque(img, x, y)) continue;
      const c = colorAt(img, x, y);
      if (!N8.some(([dx, dy]) => isOpaque(img, x + dx, y + dy) && colorAt(img, x + dx, y + dy) === c)) out.push([x, y]);
    }
  }
  return out;
}

/** 4-connected components of equal color among opaque pixels. Returns [{ color, size, px: [[x, y], ...] }]. */
export function components(img) {
  const seen = new Uint8Array(img.w * img.h);
  const out = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (seen[y * img.w + x] || !isOpaque(img, x, y)) continue;
      const color = colorAt(img, x, y);
      const px = [];
      const stack = [[x, y]];
      seen[y * img.w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        px.push([cx, cy]);
        for (const [dx, dy] of N4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
          if (seen[ny * img.w + nx] || !isOpaque(img, nx, ny) || colorAt(img, nx, ny) !== color) continue;
          seen[ny * img.w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      out.push({ color, size: px.length, px });
    }
  }
  return out;
}

/** Cluster-size spread over all components, and the count of 1-2 px regions. */
export function clusterStats(img) {
  const comps = components(img);
  const sizes = comps.map((c) => c.size).sort((a, b) => a - b);
  const n = sizes.length;
  const median = n === 0 ? 0 : n % 2 ? sizes[(n - 1) / 2] : (sizes[n / 2 - 1] + sizes[n / 2]) / 2;
  return {
    regions: n,
    small: comps.filter((c) => c.size <= 2).length,
    smallAt: comps.filter((c) => c.size <= 2).map((c) => c.px[0]),
    min: sizes[0] ?? 0,
    median,
    max: sizes[n - 1] ?? 0,
  };
}

/**
 * Small regions in the squint view (PA-09): reduce each opaque pixel to 4 value steps (min(3, floor(luminance / 64))),
 * then count the 4-connected components of equal step with size 1 or 2. This is the definition behind the spike doc's
 * "60 to 72 small regions" (the walk frames measure 60, 64, 63, 68, 66, 68, 72, 65 this way).
 */
export function smallRegionsPosterized(img) {
  const step = (x, y) => Math.min(3, Math.floor(luminance(colorAt(img, x, y)) / 64));
  const seen = new Uint8Array(img.w * img.h);
  let small = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (seen[y * img.w + x] || !isOpaque(img, x, y)) continue;
      const k = step(x, y);
      const stack = [[x, y]];
      seen[y * img.w + x] = 1;
      let n = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        n++;
        for (const [dx, dy] of N4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
          if (seen[ny * img.w + nx] || !isOpaque(img, nx, ny) || step(nx, ny) !== k) continue;
          seen[ny * img.w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (n <= 2) small++;
    }
  }
  return small;
}

/**
 * Item side: the column centroid of the opaque pixels in the item colors, relative to the body center
 * (the center column of the bounding box of all opaque pixels). Negative = left of the picture, positive = right.
 * Returns null if the item colors are absent.
 */
export function itemSide(img, itemColors) {
  const set = new Set(itemColors);
  const b = bbox(img);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (isOpaque(img, x, y) && set.has(colorAt(img, x, y))) {
        sum += x;
        n++;
      }
    }
  }
  if (!n || !b) return null;
  const offset = sum / n - (b.x0 + b.x1) / 2;
  return { offset, side: offset < -0.5 ? 'left' : offset > 0.5 ? 'right' : 'center', pixels: n };
}

/** The whole measurement of one frame, as stored in target.json. */
export function measureFrame(img, nearBlack = null) {
  const b = bbox(img);
  const cs = clusterStats(img);
  const oc = outlineRatio(img, nearBlack);
  return {
    colors: colorsOf(img).length,
    bodyHeight: b ? b.h : 0,
    bboxWidth: b ? b.w : 0,
    bottomRow: b ? b.y1 : 0,
    headWidth: headWidth(img),
    outlineRatio: Number(oc.ratio.toFixed(4)),
    edgePixels: oc.edge,
    orphans: orphans(img).length,
    smallRegions: smallRegionsPosterized(img),
    smallRegionsSameColor: cs.small,
    clusterSize: { min: cs.min, median: cs.median, max: cs.max, regions: cs.regions },
  };
}
