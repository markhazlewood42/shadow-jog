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
 * panel) is the lowest and nearest the enemies; each next slot is further back (higher up the street) and to the left, so the line climbs toward the
 * top-left, over the command menu, which fills the bottom-left (its top is screen row 131). Spaced by the widest idle frames (Rook's drawn blade
 * reaches 44 art pixels in front of his feet, Kit's back arm 20 behind hers) plus a 4 px margin, and the back two stand above the menu column.
 */
export const SF_SLOTS: readonly { x: number; feet: number }[] = [
  { x: 111, feet: 78 },
  { x: 77, feet: 69 },
  { x: 45, feet: 60 },
  { x: 15, feet: 58 },
];

/** Keep-out rectangles in screen (art) pixels: the command menu column (5 rows), the ability list and the target box under it. */
export const SF_KEEP_OUT: readonly { name: string; x0: number; y0: number; x1: number; y1: number }[] = [
  { name: 'command menu', x0: 4, y0: 131, x1: 88, y1: 203 },
  { name: 'ability list and target box', x0: 4, y0: 172, x1: 212, y1: 205 },
];
/** The least clear space (art pixels) between a party member's art and a menu, and between the front of the party and the nearest enemy. */
export const SF_MENU_MARGIN = 8;
export const SF_ENEMY_LANE = 24;
