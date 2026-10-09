/**
 * Where an overhead layer holds anything.
 *
 * A map's overhead layer (the lantern strings of Lantern Row) is as big as the map, but almost all of
 * it is clear. Lighting it takes four canvas operations over every pixel of the screen, and clear
 * pixels light to clear pixels, so the work is wasted on them. This module finds the parts that hold
 * something once, when the map is baked, as a short list of rectangles. The scene then lights and
 * draws only those rectangles. Every pixel outside them is clear, so the picture does not change: the
 * result is pixel for pixel the same as lighting the whole layer.
 *
 * Pure (it reads plain pixel arrays), so a test can run it without a canvas.
 */

/** A rectangle in map pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Side of the grid cells the layer is divided into, in pixels. A bigger cell gives fewer rectangles
 * (less per-call work) and a looser fit (more clear pixels inside them). 32 px is two tiles.
 */
export const OVER_CELL = 32;

/**
 * The cells of a w by h picture that hold a pixel with any alpha, in any of the layers, as rectangles.
 * Each layer is the RGBA bytes of a picture of that size (4 bytes per pixel, row by row). A run of
 * occupied cells in a row is one rectangle, and a run with the same ends as the one above it is
 * joined to it, so a vertical bar is one rectangle, not one per row.
 */
export function occupiedRects(layers: ArrayLike<number>[], w: number, h: number, cell: number = OVER_CELL): Rect[] {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const occupied = new Uint8Array(cols * rows);
  for (const data of layers) {
    for (let y = 0; y < h; y++) {
      const row = (y / cell | 0) * cols;
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] !== 0) occupied[row + (x / cell | 0)] = 1;
      }
    }
  }
  const out: Rect[] = [];
  /** The open rectangle (still growing downward) that starts at each column, from the row above. */
  let open = new Map<number, Rect>();
  for (let r = 0; r < rows; r++) {
    const next = new Map<number, Rect>();
    let c = 0;
    while (c < cols) {
      if (!occupied[r * cols + c]) {
        c++;
        continue;
      }
      let end = c;
      while (end < cols && occupied[r * cols + end]) end++;
      const x = c * cell, y = r * cell;
      const wide = Math.min(w, end * cell) - x, tall = Math.min(h, (r + 1) * cell) - y;
      const above = open.get(c);
      if (above && above.w === wide) {
        above.h += tall;
        next.set(c, above);
      } else {
        const rect = { x, y, w: wide, h: tall };
        out.push(rect);
        next.set(c, rect);
      }
      c = end;
    }
    open = next;
  }
  return out;
}

/**
 * The part of a rectangle that falls on the screen, written into `out` (in map pixels), or false if
 * none of it does. `cx` and `cy` are the map pixel at the screen's top-left corner (the camera origin:
 * below zero for a map smaller than the screen). It writes into an object the caller keeps, so a
 * frame that visits a dozen rectangles allocates nothing.
 */
export function clipToScreen(r: Rect, cx: number, cy: number, screenW: number, screenH: number, out: Rect): boolean {
  const x0 = Math.max(r.x, cx), y0 = Math.max(r.y, cy);
  const x1 = Math.min(r.x + r.w, cx + screenW), y1 = Math.min(r.y + r.h, cy + screenH);
  if (x1 <= x0 || y1 <= y0) return false;
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return true;
}
