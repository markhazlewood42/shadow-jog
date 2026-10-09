/**
 * Content that the wider view shows (decision D17 of docs/PIVOT-640.md): things that were off screen
 * at 480x270 and now appear, are cropped, or are seen before their cue. The WP3 walk found four
 * items, P1 to P4. The Record in docs/PIVOT-640.md ("WP3", the pop-in table) lists them with the
 * options and Mark's picks. Mark picked per item at Review 3 (2026-10-08), and the table below holds
 * only the fix that ships. A fix is one of three kinds:
 *
 * - **camera** (option a), limit the camera: a box that the camera's origin must stay in. It can
 *   only keep the view away from a place, so it works when the thing sits near the map's edge. A
 *   camera range may reach beyond the map's own edge, which shows the surround (fieldkit/surround.ts).
 * - **curtain** (option b), fade the beat: a dark curtain over a box of the map, either until the
 *   player gets near (`near`) or for the length of one event, lifted when a script pans the camera
 *   (`event`).
 * - **hold** (option b), a pan that stays on its target for a while before the script goes on.
 *
 * Option c (move the content: story or map data) needs Mark's written yes and is not built.
 *
 * The table is the one place the choices live (the editor rule of docs/IDEAS.md, entry 1): plain
 * values keyed by item id, in code for now because PL6 forbids data edits in this package. It moves
 * into the map data once Mark gives his written yes.
 */
import type { Ctx } from '../../engine/canvas';
import type { Rect } from '../../field/overrects';
import { TS } from '../../field/tiles';
import { voidShade } from './void';

/** Limits on where the camera's origin (the view's top-left corner, in map pixels) may go. A side left out keeps the default (the map's own edge). */
export interface CameraBox { minX?: number; maxX?: number; minY?: number; maxY?: number }

/**
 * A dark curtain over `box`. `near`: it is closed while the leader is farther than `radius` from
 * `focus` and opens over `fade` more pixels as they come closer. `event`: it is closed while one of
 * `events` (event ids of the map) runs, until a script pans the camera, and eases over `fade` frames.
 */
export type Curtain = { box: Rect; fade: number } & (
  | { mode: 'near'; focus: { x: number; y: number }; radius: number }
  | { mode: 'event'; events: string[] }
);

/** The fix that ships for one item. */
export type PopinFix =
  | { kind: 'camera'; box: CameraBox }
  | { kind: 'curtain'; curtain: Curtain }
  | { kind: 'hold'; pan: [number, number]; frames: number };

export interface PopinEntry {
  /** The map the item is on. */
  map: string;
  /** One line: what shows. The Record says more. */
  what: string;
  /** What ships (Mark's pick at Review 3). */
  fix: PopinFix;
}

/** How dark a fully closed curtain is (not fully black: the shape of the place shows through). */
const CURTAIN_STRENGTH = 0.94;
/** The width of the soft edge outside a curtain's box, in pixels. */
const CURTAIN_FEATHER = 24;
/**
 * How far down the Annex the curtains over the east side reach: 17 tiles from the map's top (the
 * map is 34 rows). The cryo wing fills rows 3 to 11 and its south wall is row 12, so this covers the
 * wing and the wall under it with room to spare; below it, at these columns, the map is all wall and
 * holds nothing to hide (checked against `annex.ts`). It is the height of the old 480x270 view
 * rounded up to whole tiles (270 px is 16.9 tiles), which is where the number came from; it is not
 * the 360 px view's height, because the curtain only has to cover content, not the screen.
 */
const ANNEX_EAST_CURTAIN_H = 17 * TS;

export const POPINS: Readonly<Record<string, PopinEntry>> = {
  // P1, picked b (Review 3). The Annex's first screen already shows the cryo wing, where Sable's pod
  // is the story's reveal. Option a was buildable too: `{ minX: -128 }` keeps the pods off the first
  // screens and the leader in view, at the cost of a 128 px strip of the surround left of the Annex.
  P1: {
    map: 'annex',
    what: 'The cryo wing and its pods show on the first screen of the Annex, long before the story walks there.',
    fix: { kind: 'curtain', curtain: { mode: 'near', box: { x: 496, y: 0, w: 208, h: ANNEX_EAST_CURTAIN_H }, focus: { x: 576, y: 88 }, radius: 208, fade: 96 } },
  },
  // P2, picked b. Relays B and C stand within 640 px of the lattice, so cycling them shows the beams
  // change. Option a cannot be built as a static box: the lattice starts at x 480 (annex.ts), so keeping
  // it out of the view at relay B (x 248) needs the camera origin at x -160 or less. The camera rule
  // (camera.ts) floors the origin at 0 unless `minX` names a lower value, so `maxX` alone does nothing:
  // it takes `minX` and `maxX` both at -160 or below. That pins the camera for the whole Annex, and the
  // leader (at screen x = map x + 160) leaves the right edge east of about x 472.
  P2: {
    map: 'annex',
    what: 'From relay B or C the lattice is on screen, so the cycle shows what the relay feeds (Hex says he cannot see it).',
    fix: { kind: 'curtain', curtain: { mode: 'event', events: ['relay_b', 'relay_c'], box: { x: 448, y: 0, w: 256, h: ANNEX_EAST_CURTAIN_H }, fade: 12 } },
  },
  // P3, picked b. The lattice shutdown pans the camera 64 px, because the lattice is already in view.
  // Option a would need the lattice out of view before the pan: the same impossibility as P2.
  P3: {
    map: 'annex',
    what: 'The lattice shutdown pan slides the camera only 64 px, so “the camera finds the lattice” no longer reveals anything.',
    fix: { kind: 'hold', pan: [30, 7], frames: 40 },
  },
  // P4, picked a. From the Rustyard's entrance the camera's top edge cuts through Knuckles' crew. The
  // camera may go 40 px past the yard's south edge (its range is 0 to 88 otherwise), which shows the
  // yard's surround (the fence strips and scrap ground of the b2 theme, fieldkit/surround.ts).
  P4: {
    map: 'rustyard',
    what: 'From the lot’s entrance the top of the screen shows Knuckles’ crew, cropped by the edge, before the story sends the player there.',
    fix: { kind: 'camera', box: { maxY: 128 } },
  },
};

/** The items of a map. */
function itemsOn(map: string, table: Readonly<Record<string, PopinEntry>>): PopinFix[] {
  return Object.values(table).filter((e) => e.map === map).map((e) => e.fix);
}

/** The camera limits in force on a map, merged: the widest range wins on each side. Null when none. */
export function cameraBoxFor(map: string, table: Readonly<Record<string, PopinEntry>> = POPINS): CameraBox | null {
  const boxes = itemsOn(map, table).flatMap((f) => (f.kind === 'camera' ? [f.box] : []));
  if (!boxes.length) return null;
  const merged: CameraBox = {};
  for (const b of boxes) {
    if (b.minX !== undefined) merged.minX = Math.min(merged.minX ?? b.minX, b.minX);
    if (b.maxX !== undefined) merged.maxX = Math.max(merged.maxX ?? b.maxX, b.maxX);
    if (b.minY !== undefined) merged.minY = Math.min(merged.minY ?? b.minY, b.minY);
    if (b.maxY !== undefined) merged.maxY = Math.max(merged.maxY ?? b.maxY, b.maxY);
  }
  return merged;
}

/** The curtains in force on a map. */
export function curtainsFor(map: string, table: Readonly<Record<string, PopinEntry>> = POPINS): Curtain[] {
  return itemsOn(map, table).flatMap((f) => (f.kind === 'curtain' ? [f.curtain] : []));
}

/** Frames to hold after a pan to tile (tx, ty) on a map. 0 when the table names no hold there. */
export function holdFor(map: string, tx: number, ty: number, table: Readonly<Record<string, PopinEntry>> = POPINS): number {
  let frames = 0;
  for (const f of itemsOn(map, table)) if (f.kind === 'hold' && f.pan[0] === tx && f.pan[1] === ty) frames = Math.max(frames, f.frames);
  return frames;
}

/**
 * Draw the curtains of a map over the finished picture: a dark box over a part of the map that the
 * wider view would show too early. A `near` curtain follows the leader's distance, an `event`
 * curtain eases shut over its `fade` frames while its event runs (`ease` keeps each curtain's
 * progress between frames and is updated in place). The edges are feathered.
 */
export function drawCurtains(ctx: Ctx, curtains: readonly Curtain[], ease: number[], cx: number, cy: number, leader: { x: number; y: number }, runningEvent: string | null): void {
  for (const [i, c] of curtains.entries()) {
    const target = curtainClosed(c, leader, runningEvent);
    const prev = ease[i] ?? 0;
    const eased = c.mode === 'event' ? prev + Math.max(-1 / Math.max(1, c.fade), Math.min(1 / Math.max(1, c.fade), target - prev)) : target;
    ease[i] = eased;
    const a = CURTAIN_STRENGTH * eased;
    if (a < 0.01) continue;
    const x = c.box.x - cx, y = c.box.y - cy, w = c.box.w, h = c.box.h;
    ctx.fillStyle = voidShade(a.toFixed(3));
    ctx.fillRect(x, y, w, h);
    // Feathered edges: a gradient from the curtain's strength to nothing, outside each side.
    const strip = (sx: number, sy: number, sw: number, sh: number, gx: number, gy: number, gx2: number, gy2: number): void => {
      const g = ctx.createLinearGradient(gx, gy, gx2, gy2);
      g.addColorStop(0, voidShade(a.toFixed(3)));
      g.addColorStop(1, voidShade(0));
      ctx.fillStyle = g;
      ctx.fillRect(sx, sy, sw, sh);
    };
    strip(x - CURTAIN_FEATHER, y, CURTAIN_FEATHER, h, x, 0, x - CURTAIN_FEATHER, 0);
    strip(x + w, y, CURTAIN_FEATHER, h, x + w, 0, x + w + CURTAIN_FEATHER, 0);
    strip(x, y - CURTAIN_FEATHER, w, CURTAIN_FEATHER, 0, y, 0, y - CURTAIN_FEATHER);
    strip(x, y + h, w, CURTAIN_FEATHER, 0, y + h, 0, y + h + CURTAIN_FEATHER);
  }
}

/**
 * How closed a curtain is, 0 (open) to 1 (closed). `near`: from the leader's distance to the focus.
 * `event`: 1 while a listed event runs (the caller eases it), else 0.
 */
export function curtainClosed(c: Curtain, leader: { x: number; y: number }, runningEvent: string | null): number {
  if (c.mode === 'event') return runningEvent !== null && c.events.includes(runningEvent) ? 1 : 0;
  const d = Math.hypot(leader.x - c.focus.x, leader.y - c.focus.y);
  return Math.max(0, Math.min(1, (d - c.radius) / Math.max(1, c.fade)));
}
