// Pictures of a template: the part map and the light map side by side, at k pixels per cell (32 = the "32x" views).
// Part map: one color and one code letter per cell; a dark corner mark on outline cells.
// Light map: 3 gray steps (shadow, base, lit); outline cells near-black; transparent cells checker.
import { PARTS } from '../../pipeline/decompose.mjs';
import { drawLower, drawText, fillRect, lumRgb, newImage, rgbOfLetter, setPx, writePng, zoomGrid } from '../../headtest/lib.mjs';

export const PART_COLORS = {
  hair: [150, 160, 170], skin: [240, 170, 130], lenses: [235, 150, 30], beard: [120, 120, 130], coat: [110, 140, 60], sleeves: [70, 110, 50],
  zipper: [90, 130, 200], hands: [230, 110, 110], legs: [120, 90, 170], boots: [80, 60, 120], sheath: [170, 120, 60], guard: [240, 210, 70], wrap: [150, 70, 40],
};
export const LEVEL_GRAY = [70, 140, 215];

/** Draw one panel. cellFn(x, y) -> { rgba, text? , mark? } | null */
function panel(w, h, k, cellFn) {
  const img = newImage(w * k, h * k, [28, 28, 34, 255]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = cellFn(x, y);
      const base = c?.rgba ?? ((x + y) % 2 ? [205, 205, 205, 255] : [235, 235, 235, 255]);
      fillRect(img, x * k, y * k, k, k, base);
      if (c?.mark) fillRect(img, x * k, y * k, Math.max(2, k >> 2), Math.max(2, k >> 2), [10, 10, 14, 255]);
      if (c?.text && k >= 16) drawText(img, c.text, x * k + (k >> 1) - 3, y * k + (k >> 1) - 4, c.textRgba ?? [20, 20, 26, 255], Math.max(1, k >> 4));
    }
  const line = [90, 90, 105, 255];
  if (k >= 8) {
    for (let i = 0; i <= w; i++) fillRect(img, Math.min(i * k, w * k - 1), 0, 1, h * k, line);
    for (let j = 0; j <= h; j++) fillRect(img, 0, Math.min(j * k, h * k - 1), w * k, 1, line);
  }
  return img;
}

export function partPanel(t, k = 32) {
  return panel(t.w, t.h, k, (x, y) => {
    const l = t.label[y * t.w + x];
    if (!l) return null;
    return { rgba: [...PART_COLORS[l], 255], text: PARTS[l].code, mark: t.outline[y * t.w + x] > 0 };
  });
}
export function lightPanel(t, k = 32) {
  return panel(t.w, t.h, k, (x, y) => {
    const i = y * t.w + x;
    if (!t.label[i]) return null;
    if (t.outline[i] > 0) return { rgba: [8, 8, 12, 255], text: '', mark: false };
    const g = LEVEL_GRAY[t.level[i]] ?? 128;
    return { rgba: [g, g, g, 255], text: ['-', '=', '+'][t.level[i]] ?? '?', textRgba: [255, 80, 80, 255] };
  });
}
/** Part map and light map side by side with an 8 px gap. */
export function previewImage(t, k = 32) {
  const a = partPanel(t, k);
  const b = lightPanel(t, k);
  const gap = 8;
  const out = newImage(a.w + gap + b.w, a.h, [28, 28, 34, 255]);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      setPx(out, x, y, a.data.subarray((y * a.w + x) * 4, (y * a.w + x) * 4 + 4));
      setPx(out, a.w + gap + x, y, b.data.subarray((y * b.w + x) * 4, (y * b.w + x) * 4 + 4));
    }
  return out;
}
export const writePreview = (t, path, k = 32) => writePng(previewImage(t, k), path);

// ---- writer kit pictures ----
/**
 * The template at 32 px per cell with a grid and frame coordinates (writer kit). Each cell shows its part code and light level (+ lit, = base, - shadow).
 * A thick black frame marks an outline cell. A locked copy cell shows its color and its letter. A soft transform cell shows its color and a small t.
 */
export function templateKitImage(td, k = 32) {
  const N = td.size;
  const labelAt = (i) => (td.idx[i] >= 0 ? td.labels[td.ids[td.idx[i]]] : null);
  return zoomGrid(newImage(N, N), {
    k, originX: 0, originY: 0,
    flat: (x, y) => {
      const i = y * N + x;
      const l = labelAt(i);
      if (!l) return null;
      const L = td.locked[i] ?? td.soft[i];
      const base = L ? rgbOfLetter(L) : PART_COLORS[l];
      return [...base, 255];
    },
    after: (out, ml, mt, kk) => {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const l = labelAt(i);
          if (!l) continue;
          const px = ml + x * kk, py = mt + y * kk;
          const L = td.locked[i] ?? td.soft[i];
          const dark = L ? lumRgb(rgbOfLetter(L)) < 110 : false;
          const ink = dark ? [240, 240, 245, 255] : [20, 20, 26, 255];
          if (td.outline[i] > 0) {
            const c = td.outline[i] === 1 ? [0, 0, 0, 255] : [90, 0, 90, 255];
            for (let t = 0; t < 3; t++) { fillRect(out, px + t, py + t, kk - 2 * t, 1, c); fillRect(out, px + t, py + kk - 1 - t, kk - 2 * t, 1, c); fillRect(out, px + t, py + t, 1, kk - 2 * t, c); fillRect(out, px + kk - 1 - t, py + t, 1, kk - 2 * t, c); }
          }
          drawText(out, `${PARTS[l].code}${['-', '=', '+'][td.level[i]] ?? '?'}`, px + 5, py + 7, ink, 2);
          if (td.locked[i]) drawLower(out, td.locked[i], px + (kk >> 1) - 3, py + kk - 14, ink, 2);
          else if (td.soft[i]) { drawLower(out, td.soft[i], px + (kk >> 1) - 3, py + kk - 14, ink, 2); fillRect(out, px + kk - 8, py + kk - 8, 5, 5, [255, 210, 0, 255]); }
        }
    },
  });
}

/** Overlay of the S3 classes: copy green, transform yellow, invent red, with a letter C, T or I. */
export function classImage(t, cls, k = 32) {
  const COL = { copy: [60, 160, 90, 255], transform: [230, 190, 50, 255], invent: [210, 60, 60, 255] };
  return zoomGrid(newImage(t.w, t.h), {
    k, originX: 0, originY: 0,
    flat: (x, y) => { const c = cls.cells[y * t.w + x]; return c ? COL[c.cls] : null; },
    after: (out, ml, mt, kk) => {
      for (let y = 0; y < t.h; y++)
        for (let x = 0; x < t.w; x++) {
          const c = cls.cells[y * t.w + x];
          if (c) drawText(out, c.cls === 'copy' ? 'C' : c.cls === 'transform' ? 'T' : 'I', ml + x * kk + 11, mt + y * kk + 13, [15, 15, 20, 255], 2);
        }
    },
  });
}
