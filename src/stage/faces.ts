/**
 * Face crops for the HUD (Phaser spike `spike/phaser-stage`): the little portraits on the turn timeline, in the
 * party table and in the enemy box are cut from the same sprites that stand on the stage, so there is no second
 * set of portrait art to keep in step. Pure pixel maths, no Phaser, no browser.
 *
 * Each sprite has a **face point** (the middle of its face, found by eye on a gridded zoom of its art) and a
 * **grain**: how many screen pixels one art pixel covers. The heroes are drawn at grain 1. The shipped enemy
 * art is painted at twice the screen resolution, then drawn 1:1, so its art pixels are small and a face must
 * be cut at TWICE the chip size and then shrunk by exactly 2 (never by a fraction, which would smear pixels):
 * each 2x2 block becomes one pixel, the commonest colour in the block (the darker one on a tie), or empty if
 * under half the block is drawn. That keeps a 10 px chip crisp instead of a muddy resample.
 */
import { lum, newRaw, type Raw, type RGB } from './pixels';

/** A point inside a sprite picture. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Where each crew member's face is in frame 0 of their idle sheet (cell pixels: the sheet's cell, not the
 * trimmed figure). Measured on Mark's Sprite Fusion sheets.
 */
export const CREW_FACES: Readonly<Record<string, Pt>> = {
  kit: { x: 34, y: 17 },
  rook: { x: 41, y: 12 },
  hex: { x: 30, y: 18 },
  sable: { x: 25, y: 14 },
};

/**
 * Where each enemy's face is in its art, by art key, measured from the top-left of the art's drawn pixels
 * (its trimmed bounds), not from the canvas corner (the canvases carry empty margins that differ per enemy).
 */
export const ENEMY_FACES: Readonly<Record<string, Pt>> = {
  punk: { x: 38, y: 26 },
  medic: { x: 24, y: 18 },
  slinger: { x: 26, y: 18 },
  rat: { x: 11, y: 14 },
  hound: { x: 12, y: 16 },
  ghoul: { x: 34, y: 20 },
  warden: { x: 73, y: 52 },
  eel: { x: 24, y: 30 },
  shade: { x: 12, y: 22 },
  lurker: { x: 66, y: 42 },
};

/** The grain of the shipped enemy art (see the header): every enemy today. */
export const ENEMY_GRAIN = 2;

/** Shrink a picture by a whole `factor`: each block becomes its commonest opaque colour, or nothing when under half the block is drawn. */
export function modeDown(src: Raw, factor: number): Raw {
  const w = Math.floor(src.w / factor);
  const h = Math.floor(src.h / factor);
  const out = newRaw(w, h);
  for (let by = 0; by < h; by++)
    for (let bx = 0; bx < w; bx++) {
      const counts = new Map<number, number>();
      let opaque = 0;
      for (let j = 0; j < factor; j++)
        for (let i = 0; i < factor; i++) {
          const k = ((by * factor + j) * src.w + bx * factor + i) * 4;
          if ((src.px[k + 3] ?? 0) <= 128) continue;
          opaque++;
          const key = ((src.px[k] ?? 0) << 16) | ((src.px[k + 1] ?? 0) << 8) | (src.px[k + 2] ?? 0);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      if (opaque * 2 < factor * factor) continue;
      // The commonest colour; on a tie the darker, so an outline survives.
      let best = 0;
      let bestN = -1;
      for (const [key, n] of counts) {
        const c: RGB = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
        const bc: RGB = [(best >> 16) & 255, (best >> 8) & 255, best & 255];
        if (n > bestN || (n === bestN && lum(c) < lum(bc))) {
          best = key;
          bestN = n;
        }
      }
      out.px.set([(best >> 16) & 255, (best >> 8) & 255, best & 255, 255], (by * w + bx) * 4);
    }
  return out;
}

/**
 * A `size` x `size` face cut from `src` around `face` (given in the picture's own pixels). Grain 1 art is cut
 * as it is; grain 2 art is cut at twice the size, snapped to the 2-pixel grid, and shrunk by exactly 2.
 */
export function cutFace(src: Raw, face: Pt, size: number, grain: number): Raw {
  const s2 = size * grain;
  let left = face.x - Math.floor(s2 / 2);
  let top = face.y - Math.floor(s2 / 2);
  if (grain > 1) {
    left -= ((left % grain) + grain) % grain;
    top -= ((top % grain) + grain) % grain;
  }
  const cut = newRaw(s2, s2);
  for (let y = 0; y < s2; y++)
    for (let x = 0; x < s2; x++) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const k = (sy * src.w + sx) * 4;
      cut.px.set(src.px.subarray(k, k + 4), (y * s2 + x) * 4);
    }
  return grain > 1 ? modeDown(cut, grain) : cut;
}
