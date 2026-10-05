/**
 * Where a sprite's feet are inside its picture (Phaser spike, `spike/phaser-stage`).
 *
 * Mark's Sprite Fusion sheets are drawn on cells of different sizes (Kit, Hex and Sable 64x64, Rook
 * 79x68) and each figure fills its cell differently, so "put the cell's bottom-centre on the slot" would
 * leave Rook standing in a different place than the others. Instead we look at the pixels: the feet are
 * the boots on the lowest rows of the figure, and a Phaser sprite can take a custom **origin** (the point
 * of the picture that sits at the sprite's position). Set the origin to the feet and the sprite's x,y IS
 * where it stands, whatever the cell size.
 *
 * Pure maths on pixel arrays (no DOM, no Phaser), reusing the Sprite Fusion geometry helpers the
 * side-view spike already had, so a test can run it on made-up frames.
 */
import { boxOf, type Raw } from '../art/rig2/sfgeom';

export interface FootAnchor {
  /** Column of the feet's middle in the cell (whole pixels, the mean over the loop, rounded down). */
  x: number;
  /** Row just under the lowest sole in the loop. A figure that bobs up a frame floats above this row, which is the bounce. */
  y: number;
}

/**
 * The foot anchor for one animation loop: the middle of the span the lowest six rows cover (averaged over the
 * frames so the soles do not slide, and rounded down) and the row under the lowest sole. Frames with nothing
 * drawn are skipped.
 *
 * "The span of the lowest six rows", not "the heaviest group of boots": for a stance that leans (Kit's trailing
 * ponytail and kick-back foot) the span's middle is the figure's centre of balance, where the design's mockups
 * put it, while the heaviest-boot rule stands her a dozen pixels off her slot. (The side-view spike's dash
 * frames needed the boots rule because a blade tip trails 50 px behind; an idle loop has no such thing.)
 */
export function footAnchor(frames: readonly Raw[]): FootAnchor {
  const drawn = frames.filter((f) => boxOf(f).y1 >= 0);
  if (!drawn.length) throw new Error('footAnchor: every frame is empty');
  const x = Math.floor(drawn.reduce((n, f) => n + boxOf(f).feet, 0) / drawn.length);
  const y = Math.max(...drawn.map((f) => boxOf(f).y1)) + 1;
  return { x, y };
}

/** Cut a one-row sprite sheet's pixels into its frames (`frameW` wide each). */
export function cutSheet(sheet: Raw, frameW: number, count: number): Raw[] {
  const out: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const px = new Uint8ClampedArray(frameW * sheet.h * 4);
    for (let y = 0; y < sheet.h; y++) px.set(sheet.px.subarray((y * sheet.w + i * frameW) * 4, (y * sheet.w + (i + 1) * frameW) * 4), y * frameW * 4);
    out.push({ w: frameW, h: sheet.h, px });
  }
  return out;
}
