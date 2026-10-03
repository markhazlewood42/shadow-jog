/**
 * Small pixel operations the side-on crew are built from (spike `spike/side-battle`). Every function
 * takes a `Layer` and returns a new one of the SAME size and origin (a fixed frame with room round the
 * sprite), so poses stack: a crouch, then a lean, then a lifted leg. Nothing here knows a character;
 * a pose is a handful of numbers passed in (rows, columns, pixels).
 */
import type { Layer } from './rig';

export type Pt = readonly [number, number];

/** An empty layer of the given size at the frame origin. */
export const blankLayer = (w: number, h: number): Layer => ({ w, h, ox: 0, oy: 0, px: new Int16Array(w * h).fill(-1) });

/** `l` placed on a bigger frame, its (0, 0) at (`dx`, `dy`). */
export function embed(l: Layer, w: number, h: number, dx: number, dy: number): Layer {
  const out = blankLayer(w, h);
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      const p = l.px[y * l.w + x] ?? -1;
      if (p >= 0 && x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out.px[(y + dy) * w + x + dx] = p;
    }
  return out;
}

export const at = (l: Layer, x: number, y: number): number => (x < 0 || y < 0 || x >= l.w || y >= l.h ? -1 : (l.px[y * l.w + x] ?? -1));

/** The first row with any pixel (-1 if empty). */
export function topRow(l: Layer): number {
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) if (at(l, x, y) >= 0) return y;
  return -1;
}

/** New row `y` is source row `src(y)` (a negative or out-of-range answer leaves the row empty). */
export function mapRows(l: Layer, src: (y: number) => number): Layer {
  const out = blankLayer(l.w, l.h);
  for (let y = 0; y < l.h; y++) {
    const s = src(y);
    if (s < 0 || s >= l.h) continue;
    for (let x = 0; x < l.w; x++) out.px[y * l.w + x] = l.px[s * l.w + x] ?? -1;
  }
  return out;
}

/** Take `n` rows out at row `y0`: everything above sinks by `n`, the feet stay (a crouch). */
export const crouch = (l: Layer, y0: number, n: number): Layer => (n <= 0 ? l : mapRows(l, (y) => (y >= y0 + n ? y : y - n)));
/** Draw `n` rows twice at row `y0`: everything above rises by `n`, the feet stay (a breath, a stretch up). */
export const rise = (l: Layer, y0: number, n: number): Layer => (n <= 0 ? l : mapRows(l, (y) => (y >= y0 ? y : y + n)));

/**
 * How far row `y` moves when the part above `hip` leans by `dx` at its very top: nothing at the hip,
 * the whole `dx` at the top of the sprite (`top`), in between by a smooth ramp.
 */
export function leanAt(y: number, hip: number, top: number, dx: number): number {
  if (y >= hip) return 0;
  const t = Math.max(0, Math.min(1, (hip - y) / Math.max(1, hip - top)));
  return Math.round(dx * t * t * (3 - 2 * t));
}

/** The upper body leaned by `dx` at the top (negative: toward the enemy on the left), the part below `hip` still. */
export function lean(l: Layer, hip: number, dx: number): Layer {
  if (!dx) return l;
  const top = topRow(l);
  const out = blankLayer(l.w, l.h);
  for (let y = 0; y < l.h; y++) {
    const d = leanAt(y, hip, top, dx);
    for (let x = 0; x < l.w; x++) {
      const p = l.px[y * l.w + x] ?? -1;
      if (p >= 0 && x + d >= 0 && x + d < l.w) out.px[y * l.w + x + d] = p;
    }
  }
  return out;
}

/** A layer with its pixels in a box cleared. */
export function clearBox(l: Layer, x0: number, y0: number, x1: number, y1: number, keep?: (p: number) => boolean): Layer {
  const out: Layer = { ...l, px: l.px.slice() };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x >= 0 && y >= 0 && x < l.w && y < l.h && !keep?.(out.px[y * l.w + x] ?? -1)) out.px[y * l.w + x] = -1;
  return out;
}

/** Where a leg sits, on the frame: the columns it spans, and the rows its thigh and shin begin. */
export interface LegBox {
  x0: number;
  x1: number;
  hip: number;
  knee: number;
}

/**
 * One leg stepping: the shin and foot (rows from `knee` down, inside the leg's columns) come up by
 * `lift` rows (the rows between are taken out, so the leg shortens, solid, with no ghost) and move
 * `dx` columns sideways (toward the enemy is negative).
 */
export function bendLeg(l: Layer, leg: LegBox, lift: number, dx: number): Layer {
  const out: Layer = { ...l, px: l.px.slice() };
  for (let y = leg.knee; y < l.h; y++) for (let x = leg.x0; x <= leg.x1; x++) out.px[y * l.w + x] = -1;
  for (let y = leg.knee + lift; y < l.h; y++)
    for (let x = leg.x0; x <= leg.x1; x++) {
      const p = l.px[y * l.w + x] ?? -1;
      const nx = x + dx;
      if (p >= 0 && nx >= 0 && nx < l.w && y - lift >= 0) out.px[(y - lift) * l.w + nx] = p;
    }
  return out;
}

/** `a` with `b` drawn over it. */
export function over(a: Layer, b: Layer): Layer {
  const out: Layer = { ...a, px: a.px.slice() };
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const p = b.px[y * b.w + x] ?? -1;
      const tx = b.ox + x;
      const ty = b.oy + y;
      if (p >= 0 && tx >= 0 && ty >= 0 && tx < a.w && ty < a.h) out.px[ty * a.w + tx] = p;
    }
  return out;
}

/** A layer with its pixels remapped by a palette-index function. */
export const recolour = (l: Layer, f: (p: number) => number): Layer => ({ ...l, px: l.px.map((p) => (p >= 0 ? f(p) : p)) });

/** A layer without specks: connected groups (corner contact counts) of fewer than `min` pixels. */
export function dropSpecks(l: Layer, min = 4): Layer {
  const px = l.px.slice();
  const seen = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) {
    if ((px[i] ?? -1) < 0 || seen[i]) continue;
    const group: number[] = [i];
    seen[i] = 1;
    for (let k = 0; k < group.length; k++) {
      const a = group[k] ?? 0;
      const x = a % l.w;
      const y = Math.floor(a / l.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h) continue;
          const j = ny * l.w + nx;
          if ((px[j] ?? -1) >= 0 && !seen[j]) {
            seen[j] = 1;
            group.push(j);
          }
        }
    }
    if (group.length < min) for (const j of group) px[j] = -1;
  }
  return { ...l, px };
}
