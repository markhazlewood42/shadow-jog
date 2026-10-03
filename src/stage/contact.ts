/**
 * WHERE A BLOW REALLY MEETS A BODY (Phaser spike `spike/phaser-stage`).
 *
 * Round 1 of the Battle Test sent a lunging fighter to the edge of the target's BOUNDING BOX. A bounding box is the
 * smallest rectangle that holds every drawn pixel, so for a tall boss with wide shoulder pods the "edge" is the
 * tip of a pod up at chest height, and a sword swung at the floor stopped 20 pixels short of the legs it was meant to
 * cut. The judges saw a blade slicing air.
 *
 * The fix is to look at the target's actual PIXELS, on the row where the weapon is. This file is the pure part of
 * that (arrays in, numbers out; no Phaser), so a unit test can check it on a hand-made figure:
 *
 *   - `nearEdge`     the x of the target's silhouette on a given row, on the side the attacker comes from;
 *   - `contactY`     keeps the spark inside the target even when the fist is higher than a short target (a Glowrat's back);
 *   - `clearLane`    how far down the stage a fighter must go to run in FRONT of its side-mates instead of through them.
 *
 * Everything is in screen pixels (a figure's art is already at screen scale; see `FigureArt`), and `y` points down.
 */
import type { Raw } from './pixels';

/** A figure as far as this file cares: its pixels, the drawn bounds and the point the feet stand on. */
export interface Silhouette {
  raw: Raw;
  box: { x0: number; y0: number; x1: number; y1: number };
  foot: { x: number; y: number };
}

/** A pixel counts as part of the body when it is at least this opaque (faint glow edges are not a body). */
const SOLID = 64;

/**
 * The silhouette's edge nearest the attacker, as a distance from the target's FEET column: negative for the left side.
 *
 * `dy` is the weapon's height above the attacker's feet (negative = up, like everywhere in the moves); because the
 * attacker ends up on the target's row, the same number is the height above the TARGET's feet. The rows from there to
 * `band` pixels below are searched and the one that sticks out toward the attacker wins, so a one-pixel gap in the art
 * does not matter. A weapon higher than the target's head lands on the top rows of the drawing (the fist meets the
 * top of a short target's back), and one lower than its soles on the bottom rows.
 *
 * `facing` is the ATTACKER's: 1 for a hero (the target is to the right, so we want the target's left edge), -1 for an enemy.
 * Returns null for a picture with no solid pixels.
 */
export function nearEdge(s: Silhouette, dy: number, facing: 1 | -1, band = 4): number | null {
  const { raw, box, foot } = s;
  const want = Math.round(foot.y + dy);
  // Clamp to the drawn rows so a weapon above the head or below the soles still finds the body.
  const top = Math.max(box.y0, Math.min(box.y1 - band, want));
  let edge: number | null = null;
  for (let y = top; y <= Math.min(box.y1, top + band); y++) {
    if (y < 0 || y >= raw.h) continue;
    if (facing > 0) {
      for (let x = Math.max(0, box.x0); x <= Math.min(raw.w - 1, box.x1); x++) {
        if ((raw.px[(y * raw.w + x) * 4 + 3] ?? 0) >= SOLID) {
          if (edge === null || x - foot.x < edge) edge = x - foot.x;
          break;
        }
      }
    } else {
      for (let x = Math.min(raw.w - 1, box.x1); x >= Math.max(0, box.x0); x--) {
        if ((raw.px[(y * raw.w + x) * 4 + 3] ?? 0) >= SOLID) {
          if (edge === null || x + 1 - foot.x > edge) edge = x + 1 - foot.x;
          break;
        }
      }
    }
  }
  return edge;
}

/**
 * The y (screen) of a blow's spark: where the weapon is (`weaponY`), pulled inside the target's drawn height so a fist
 * swung higher than a rat is a hit on the rat's back and not a spark in mid-air. `targetY` is the target's feet row.
 */
export function contactY(weaponY: number, targetY: number, box: { y0: number; y1: number }, foot: { y: number }): number {
  const top = targetY - (foot.y - box.y0) + 3;
  const bottom = targetY - 2;
  return Math.max(top, Math.min(bottom, Math.round(weaponY)));
}

/**
 * How far DOWN the stage (toward the camera) a fighter has to step to run in front of everyone on its own side: the
 * nearest mate's row plus a margin, minus its own row, never below 0 and never more than `cap`. A hero already standing
 * in the front row has nothing to swerve around (0).
 */
export function clearLane(homeY: number, mates: readonly number[], margin = 4, cap = 28): number {
  if (mates.length === 0) return 0;
  const front = Math.max(...mates);
  return Math.max(0, Math.min(cap, front + margin - homeY));
}
