/**
 * Plain geometry for the Sprite Fusion side view (spike `spike/side-battle`): where the party stands, how wide each member's loop is, and the keep-out
 * rectangles of the menus. No DOM and no flags, so a test can run it on Mark's PNGs (tests/sflayout.test.ts) and the layout can be checked against
 * the real sprite bounds, not by eye.
 */

/** A decoded sprite: RGBA bytes. */
export interface Raw {
  w: number;
  h: number;
  px: Uint8ClampedArray;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The midpoint of the lowest rows' span: where the feet are. */
  feet: number;
}

/** The opaque bounds of a frame, and the feet midpoint (the span of the lowest six rows). */
export function boxOf(r: Raw): Box {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  let fx0 = r.w, fx1 = -1;
  for (let y = Math.max(0, y1 - 5); y <= y1; y++)
    for (let x = 0; x < r.w; x++)
      if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) {
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
      }
  return { x0, y0, x1, y1, feet: (fx0 + fx1 + 1) / 2 };
}

/** How far a loop reaches either side of the feet axis (the mean feet midpoint over the loop) and how tall it is, in art pixels: what `anchored` draws. */
export function loopExtent(group: Raw[]): { left: number; right: number; height: number } {
  const boxes = group.map(boxOf);
  const ax = Math.round(boxes.reduce((n, b) => n + b.feet, 0) / boxes.length);
  return { left: ax - Math.min(...boxes.map((b) => b.x0)), right: Math.max(...boxes.map((b) => b.x1 + 1)) - ax, height: Math.max(...boxes.map((b) => b.y1 + 1 - b.y0)) };
}

/**
 * The party's places, in battle-world pixels (240x135, drawn at 2x onto the 480x270 screen, so a world pixel is two art pixels). Slot 0 (Kit, the first
 * panel) is the lowest and nearest the enemies; each next slot is a little further back (higher up the street) and to the left, over the command menu.
 * Round 3: the line is shallower (feet 78, 73, 68, 60 instead of 78, 69, 60, 58) and sits further right. The gaps come from the sprites' real PIXELS
 * (every idle frame of a member against every idle frame of the one in front, three pixels of clearance, solved on Mark's PNGs), not from their boxes:
 * Rook's raised blade passes over Kit's head, so the boxes may overlap and the pixels may not. Hex is placed so her widest reach stays 8 art pixels
 * right of the command menu's edge (so she can stand low); only Sable, whose reach crosses the menu column, is held up (feet 60) above its title tab.
 */
export const SF_SLOTS: readonly { x: number; feet: number }[] = [
  { x: 122, feet: 78 },
  { x: 92, feet: 73 },
  { x: 61, feet: 68 },
  { x: 32, feet: 60 },
];

/**
 * The walk-in, per slot (round 3). Nobody has a walk cycle in side view (Mark's `*-overworld-walk` sheets are front-facing 32 px field art, a different
 * view and half the size), so the entrance is built from what exists and kept short enough that no loop has to pass for a walk:
 *   - `run`: Kit and Rook DASH in from the left edge on one run or dash pose (Kit `kit-battle-running`, Rook `rook-battle-crouched`, the low lunge with the
 *     blade trailing), with speed ghosts and a bounce, then skid into the stance. A dash this quick (3.8 world px a frame) reads as speed, not as sliding.
 *   - otherwise (Hex, Sable, no run frame): a short step of `from` px, fading in over `fade` frames, on the normal idle loop at its own speed.
 * The runners go first and pass the back two, who step in once the runners are by (Sable at frame 32, Hex at 40), so the four land within about ten frames of each other, one after another, rather than as one gliding block.
 */
export interface SfWalk {
  run: boolean;
  /** Start offset from the slot (battle-world pixels, negative = left of it); ignored for a runner, which starts off the left edge. */
  from: number;
  /** Frames (60 a second) before this member starts. */
  delay: number;
  /** World pixels a frame while it moves. */
  speed: number;
  /** Frames over which it fades in (0: visible from the start). */
  fade: number;
}
export const SF_WALK_START_X = -30;
export const SF_WALK: readonly SfWalk[] = [
  { run: true, from: 0, delay: 0, speed: 3.8, fade: 0 },
  { run: true, from: 0, delay: 14, speed: 3.8, fade: 0 },
  { run: false, from: -14, delay: 40, speed: 1.2, fade: 10 },
  { run: false, from: -14, delay: 32, speed: 1.2, fade: 10 },
];

/** Keep-out rectangles in screen (art) pixels: the command menu column (5 rows), the ability list and the target box under it. */
export const SF_KEEP_OUT: readonly { name: string; x0: number; y0: number; x1: number; y1: number }[] = [
  { name: 'command menu', x0: 4, y0: 131, x1: 88, y1: 203 },
  { name: 'ability list and target box', x0: 4, y0: 172, x1: 212, y1: 205 },
];
/** The least clear space (art pixels) between a party member's art and a menu, and between the front of the party and the nearest enemy. */
export const SF_MENU_MARGIN = 8;
export const SF_ENEMY_LANE = 24;
