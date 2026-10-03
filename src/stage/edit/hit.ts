/**
 * Working out what the pointer is over in the Battle Stage Editor: pure geometry on game pixels (the 480x270
 * screen), so it can be unit-tested and the page only has to turn mouse positions into game pixels.
 *
 * What can be picked besides the fighters themselves (the scene finds those by their drawn pixels,
 * `StageScene.pick`):
 *  - the **horizon** line, the **floor bottom** line and the **depth row** lines (thin lines: they are caught within
 *    a few screen pixels, however small they are on the game's own pixel grid);
 *  - a **HUD box** (inside its rectangle; where boxes overlap, the smallest wins, so a small box on top of a big
 *    one can still be reached) and its **corner grips**;
 *  - a fighter's **foot crosshair**.
 */
import { SCREEN_W, type StageBody, type StageConfig } from '../config';
import type { HudRegionKey } from '../hudpresets';
import { HUD_REGIONS } from '../hudpresets';
import type { Item } from './session';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Which layers the user has locked (L): a locked layer cannot be picked, so it cannot be grabbed by accident. */
export type Layer = 'fighters' | 'hud' | 'ground';

/** The line handle near this point, if any: horizon, then floor bottom, then rows (the front row first, since the floor is seen from above). `tol` is the pick distance in game pixels. */
export function hitLine(stage: StageBody, x: number, y: number, tol: number): Item | null {
  if (x < -tol || x > SCREEN_W + tol) return null;
  const near = (line: number): boolean => Math.abs(y - (line + 0.5)) <= tol;
  if (near(stage.backdrop.horizonY)) return { kind: 'horizon' };
  if (near(stage.floor.y1 - 1)) return { kind: 'floor' };
  for (let i = stage.rows.length - 1; i >= 0; i--) {
    const row = stage.rows[i];
    if (row && near(row.y)) return { kind: 'row', index: i };
  }
  return null;
}

const inside = (b: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

/** The HUD box under this point; the smallest when several overlap. */
export function hitHud(stage: StageConfig, x: number, y: number): HudRegionKey | null {
  let best: HudRegionKey | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const name of HUD_REGIONS) {
    const r = stage.hud[name];
    if (!inside(r, x, y)) continue;
    const area = r.w * r.h;
    if (area < bestArea) {
      best = name;
      bestArea = area;
    }
  }
  return best;
}

/** The corner grip of a HUD box near this point, if any. */
export function hitGrip(stage: StageConfig, region: HudRegionKey, x: number, y: number, tol: number): Corner | null {
  const r = stage.hud[region];
  const corners: Array<[Corner, number, number]> = [
    ['nw', r.x, r.y],
    ['ne', r.x + r.w, r.y],
    ['sw', r.x, r.y + r.h],
    ['se', r.x + r.w, r.y + r.h],
  ];
  for (const [c, cx, cy] of corners) if (Math.abs(x - cx) <= tol && Math.abs(y - cy) <= tol) return c;
  return null;
}

/** The smallest a HUD box can be dragged to. */
export const MIN_BOX = { w: 16, h: 8 };

/** A HUD box after dragging one of its corners by (dx, dy): the opposite corner stays put, and the box never shrinks below `MIN_BOX`. */
export function resizeBox(b: { x: number; y: number; w: number; h: number }, corner: Corner, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const w = Math.max(MIN_BOX.w, west ? b.w - dx : b.w + dx);
  const h = Math.max(MIN_BOX.h, north ? b.h - dy : b.h + dy);
  return { x: west ? b.x + b.w - w : b.x, y: north ? b.y + b.h - h : b.y, w, h };
}
