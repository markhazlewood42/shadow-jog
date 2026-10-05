/**
 * Small pixel-painting helpers shared by the stage's painters (Phaser spike, `spike/phaser-stage`): the floor,
 * the sewer wall, the shadows and the effects are all drawn one pixel at a time into a plain array of colour
 * bytes (`Raw`, the same shape the Sprite Fusion helpers use), and only then handed to Phaser as a texture.
 *
 * Why pixel by pixel instead of canvas shapes? A canvas shape is anti-aliased (its edges are blurred to
 * look smooth), and pixel art must never be: every pixel is one exact colour. Painting into an array also
 * means no browser is needed, so a unit test can paint a floor and look at the pixels.
 *
 * **Ordered dithering** is used everywhere a smooth fade is wanted (haze, glow, seams). Instead of
 * blending colours smoothly, a pixel is either changed or not, decided by comparing a fade strength (0 to 1)
 * with a fixed pattern, the 4x4 Bayer matrix: a strength of 0.5 changes half the pixels in a chequer-like
 * pattern, 0.25 a quarter. The eye blends the pattern back into a gradient, and it looks like old
 * hardware. The game's own backdrops (`src/art/battlebg.ts`) use the same matrix, so new and old match.
 */
import type { Raw } from '../art/rig2/sfgeom';

export type { Raw };
export type RGB = readonly [number, number, number];

/** The 4x4 Bayer matrix: 16 thresholds spread so that any strength turns on an evenly scattered share of pixels. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** The dither threshold (0 to 1) at pixel (x, y): paint when the fade strength is above it. */
export function th(x: number, y: number): number {
  const row = BAYER[y & 3] as readonly number[];
  return ((row[x & 3] ?? 0) + 0.5) / 16;
}

/** `#rrggbb` to three bytes. */
export function hexRgb(s: string): RGB {
  const h = s.replace('#', '');
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

/** Three bytes to `#rrggbb`. */
export function rgbHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Blend `a` toward `b` by `t` (0 = a, 1 = b), rounded to whole bytes. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** Brightness (0 to 255) by the usual weights. */
export function lum(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

/** A new picture, every pixel `fill` (opaque) or fully transparent when no colour is given. */
export function newRaw(w: number, h: number, fill?: RGB): Raw {
  const px = new Uint8ClampedArray(w * h * 4);
  if (fill) for (let i = 0; i < w * h; i++) px.set([fill[0], fill[1], fill[2], 255], i * 4);
  return { w, h, px };
}

/** A copy that shares nothing with the original. */
export function cloneRaw(r: Raw): Raw {
  return { w: r.w, h: r.h, px: new Uint8ClampedArray(r.px) };
}

/** The colour at (x, y), or black off the picture. */
export function getRgb(r: Raw, x: number, y: number): RGB {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return [0, 0, 0];
  const i = (y * r.w + x) * 4;
  return [r.px[i] ?? 0, r.px[i + 1] ?? 0, r.px[i + 2] ?? 0];
}

/** Paint one opaque pixel (off the picture is ignored, so painters never need to bounds-check). */
export function setRgb(r: Raw, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  r.px.set([c[0], c[1], c[2], 255], (y * r.w + x) * 4);
}

/** Blend a colour over the pixel at (x, y) by `a` (0 to 1). */
export function blendRgb(r: Raw, x: number, y: number, c: RGB, a: number): void {
  setRgb(r, x, y, mix(getRgb(r, x, y), c, a));
}

/** A pseudo-random number generator that always gives the same run for the same seed (mulberry32), so a stage with seed 7 looks identical every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
