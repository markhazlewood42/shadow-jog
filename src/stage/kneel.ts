/**
 * THE KNEEL (Phaser spike `spike/phaser-stage`): a fallen hero's picture, cut out of the hero's own idle drawing.
 *
 * Round 1 left a defeated hero standing, only dimmed, which reads as "switched off" and not as "knocked out". Mark has
 * drawn no lying-down pictures yet, and the stage must not wait for art, so this makes a stand-in the way a pixel artist
 * makes a quick in-between: take rows OUT of the legs (the figure gets shorter, as if the knees bent), let the upper body
 * settle down by the same amount, and push the head and shoulders a few pixels forward as if the hero is slumping. No
 * scaling and no rotation (either would smear pixel art); every pixel is a pixel of the original, just moved.
 *
 * Pure (arrays in, arrays out): a unit test checks the soles stay put and the figure is shorter. When Mark draws a real
 * down picture, the move file names it instead of `$down`.
 */
import type { Raw } from './pixels';

export interface KneelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The kneeling version of a figure on the same canvas: soles on the same row, the rows between 52% and 76% of the figure's
 * height removed (the thighs and knees), everything above settled down by that many rows, and the part above the waist
 * pushed `lean` pixels forward (`facing` 1 = right, a hero's side).
 */
export function kneelRaw(src: Raw, box: KneelBox, facing: 1 | -1 = 1, lean = 3): Raw {
  const out: Raw = { w: src.w, h: src.h, px: new Uint8ClampedArray(src.w * src.h * 4) };
  const height = box.y1 - box.y0 + 1;
  const cutFrom = box.y0 + Math.round(height * 0.52);
  const cut = Math.max(2, Math.round(height * 0.24));
  const waist = box.y0 + Math.round(height * 0.5);
  for (let y = box.y0; y <= box.y1; y++) {
    // Rows inside the removed band vanish; rows above it land `cut` rows lower; rows below stay.
    if (y >= cutFrom && y < cutFrom + cut) continue;
    const ny = y < cutFrom ? y + cut : y;
    if (ny < 0 || ny >= src.h) continue;
    const shift = y < waist ? facing * lean : 0;
    for (let x = 0; x < src.w; x++) {
      const nx = x + shift;
      if (nx < 0 || nx >= src.w) continue;
      const i = (y * src.w + x) * 4;
      if ((src.px[i + 3] ?? 0) === 0) continue;
      out.px.set(src.px.subarray(i, i + 4), (ny * src.w + nx) * 4);
    }
  }
  return out;
}
