/**
 * Rig v2: characters drawn in code from traced standing frames (Mark, 2026-09-30: code-drawn art
 * that looks better than the old rig but keeps its consistency, its animation and room to improve).
 *
 * A character is its standing frame per facing (`traced.ts`: palette-indexed pixels, no outline,
 * traced from the PixelLab picks Mark liked). Everything after that is code and the same every
 * time: the body is split at the hip, legs step or swing (pixel-art rotation by RotSprite), the
 * body bobs, and the whole pose is outlined afterwards, so moving parts never tear the outline.
 *
 * Why not PixelLab's own walk cycles: they redrew the whole character every frame, and it
 * drifted (clothes changing colour, a backpack vanishing, a front view mid-cycle). Here the
 * character can't change between frames; only the parts the code moves do.
 */
import type { CharSprite, Dir } from '../chars';

/** A traced standing frame: palette index per pixel ("." empty), and the rows the rig works from. */
export interface Traced {
  w: number;
  h: number;
  /** The lowest row with pixels (the soles). */
  feet: number;
  /** The first row of the legs (facing us or away, the row below the crotch). */
  hip: number;
  pal: string[];
  rows: string[];
}

const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const OUTLINE = '#120e1d';
/** Every frame's canvas (room for swung legs and tall hair), and where the feet go in it. */
const OUT_W = 34;
const OUT_H = 36;
const FEET_Y = OUT_H - 3;

/** Pixels as palette indexes (-1: empty), with an origin so parts keep their place when moved. */
export interface Layer {
  w: number;
  h: number;
  /** Where this layer's (0, 0) sits in the standing frame's coordinates. */
  ox: number;
  oy: number;
  px: Int16Array;
}

export function decode(t: Traced): Layer {
  const px = new Int16Array(t.w * t.h).fill(-1);
  for (let y = 0; y < t.h; y++) {
    const row = t.rows[y] ?? '';
    for (let x = 0; x < t.w; x++) {
      const ch = row[x] ?? '.';
      if (ch !== '.') px[y * t.w + x] = CH.indexOf(ch);
    }
  }
  return { w: t.w, h: t.h, ox: 0, oy: 0, px };
}

/** The part of a layer inside a rectangle (standing-frame coordinates). */
export function cut(l: Layer, x0: number, y0: number, x1: number, y1: number): Layer {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const px = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x0 + x - l.ox;
      const sy = y0 + y - l.oy;
      if (sx >= 0 && sy >= 0 && sx < l.w && sy < l.h) px[y * w + x] = l.px[sy * l.w + sx] ?? -1;
    }
  return { w, h, ox: x0, oy: y0, px };
}

/** The pixels of a layer whose colour is (`keep` true) or isn't (false) in a set. */
export function byColour(l: Layer, colours: Set<number>, keep: boolean): Layer {
  return { ...l, px: l.px.map((p) => (p >= 0 && colours.has(p) === keep ? p : -1)) };
}

/**
 * The colours of the legs (trousers, boots): those in the front view's legs, between the hip and
 * the soles, within the boots' width. Hair, a coat or a staff hanging past the hip isn't leg, and
 * stays with the body while the legs move.
 */
export function legColours(front: Traced): Set<number> {
  const l = decode(front);
  const sole = cut(l, 0, front.feet, front.w, front.feet + 1);
  const [a, b] = span(sole) ?? [0, front.w - 1];
  const out = new Set<number>();
  for (let y = front.hip; y <= front.feet; y++)
    for (let x = Math.max(0, a - 1); x <= Math.min(front.w - 1, b + 1); x++) {
      const p = l.px[y * l.w + x] ?? -1;
      if (p >= 0) out.add(p);
    }
  return out;
}

/** Columns with any pixel in a layer: [first, last], or null. */
export function span(l: Layer): [number, number] | null {
  let a = Infinity;
  let b = -Infinity;
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++)
      if ((l.px[y * l.w + x] ?? -1) >= 0) {
        a = Math.min(a, x);
        b = Math.max(b, x);
      }
  return a > b ? null : [a + l.ox, b + l.ox];
}

/** Scale2x (EPX) on palette indexes: doubles pixel art while keeping its diagonals clean. */
function scale2x(l: Layer): Layer {
  const w = l.w * 2;
  const h = l.h * 2;
  const px = new Int16Array(w * h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? -1 : (l.px[y * l.w + x] ?? -1));
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const e0 = c === a && c !== d && a !== b ? a : p;
      const e1 = a === b && a !== c && b !== d ? b : p;
      const e2 = d === c && d !== b && c !== a ? c : p;
      const e3 = b === d && b !== a && d !== c ? d : p;
      px[2 * y * w + 2 * x] = e0;
      px[2 * y * w + 2 * x + 1] = e1;
      px[(2 * y + 1) * w + 2 * x] = e2;
      px[(2 * y + 1) * w + 2 * x + 1] = e3;
    }
  return { w, h, ox: l.ox * 2, oy: l.oy * 2, px };
}

/**
 * RotSprite: rotate pixel art without it turning to noise. Scale up 8x with Scale2x (which keeps
 * edges clean), rotate that by nearest pixel, and sample it back down. `deg` > 0 swings the part's
 * lower end toward +x, about the pivot (standing-frame coordinates).
 */
export function rotSprite(l: Layer, deg: number, pivotX: number, pivotY: number): Layer {
  if (!deg) return l;
  const big = scale2x(scale2x(scale2x(l)));
  const k = 8;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The output: the part's box grown enough to hold it at any angle.
  const r = Math.ceil(Math.hypot(l.w, l.h)) + 1;
  const x0 = Math.floor(pivotX - r);
  const y0 = Math.floor(pivotY - r);
  const w = 2 * r + 1;
  const h = 2 * r + 1;
  const px = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // This output pixel's centre, relative to the pivot, rotated back into the source.
      const dx = x0 + x + 0.5 - pivotX;
      const dy = y0 + y + 0.5 - pivotY;
      const sx = pivotX + dx * cos + dy * sin;
      const sy = pivotY - dx * sin + dy * cos;
      const bx = Math.floor((sx - l.ox) * k);
      const by = Math.floor((sy - l.oy) * k);
      if (bx < 0 || by < 0 || bx >= big.w || by >= big.h) continue;
      px[y * w + x] = big.px[by * big.w + bx] ?? -1;
    }
  return { w, h, ox: x0, oy: y0, px };
}

/** A copy with each colour swapped for a darker one from the palette (the far leg, the back arm). */
export function darker(l: Layer, pal: string[]): Layer {
  const lum = pal.map((c) => {
    const n = Number.parseInt(c.slice(1), 16);
    return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
  });
  // The palette is sorted darkest first: the next darker colour of a similar hue is usually one or
  // two places down. Take the nearest darker by luminance, at least 18 steps darker.
  const map = lum.map((v, i) => {
    let best = i;
    let bd = Infinity;
    for (let j = 0; j < lum.length; j++) {
      const d = v - (lum[j] ?? 0);
      if (d >= 18 && d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  });
  return { ...l, px: l.px.map((p) => (p >= 0 ? (map[p] ?? p) : p)) };
}

/** Draw layers (in order) onto a field frame, shifted by (dx, dy), then outline the result. */
function render(layers: Layer[], pal: string[], dx: number, dy: number): HTMLCanvasElement {
  return renderLayers(layers, pal, OUT_W, OUT_H, dx, dy);
}

/** Draw layers (in order) onto a w x h canvas, shifted by (dx, dy), then outline the result. */
export function renderLayers(layers: Layer[], pal: string[], OUT_W: number, OUT_H: number, dx = 0, dy = 0): HTMLCanvasElement {
  const px = new Int16Array(OUT_W * OUT_H).fill(-1);
  for (const l of layers)
    for (let y = 0; y < l.h; y++)
      for (let x = 0; x < l.w; x++) {
        const p = l.px[y * l.w + x] ?? -1;
        if (p < 0) continue;
        const tx = l.ox + x + dx;
        const ty = l.oy + y + dy;
        if (tx >= 0 && ty >= 0 && tx < OUT_W && ty < OUT_H) px[ty * OUT_W + tx] = p;
      }
  const c = document.createElement('canvas');
  c.width = OUT_W;
  c.height = OUT_H;
  const g = c.getContext('2d');
  if (!g) return c;
  const img = g.createImageData(OUT_W, OUT_H);
  const rgb = pal.map((h) => Number.parseInt(h.slice(1), 16));
  const outline = Number.parseInt(OUTLINE.slice(1), 16);
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < OUT_W && y < OUT_H && (px[y * OUT_W + x] ?? -1) >= 0;
  for (let y = 0; y < OUT_H; y++)
    for (let x = 0; x < OUT_W; x++) {
      const p = px[y * OUT_W + x] ?? -1;
      let n: number | null = null;
      if (p >= 0) n = rgb[p] ?? 0;
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) n = outline;
      if (n == null) continue;
      const i = (y * OUT_W + x) * 4;
      img.data[i] = (n >> 16) & 255;
      img.data[i + 1] = (n >> 8) & 255;
      img.data[i + 2] = n & 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** How far the body rises on the passing steps of a walk. */
const BOB = 1;
/** How far the legs swing from the hip in the side views, in degrees. */
const STRIDE = 34;

/**
 * One facing's frames: standing, and a four-step walk (step, pass, other step, pass).
 * Facing us or away, a step lifts one foot a pixel; from the side, the legs swing apart about the
 * hip (the far leg a shade darker), and the body rises on the passing steps.
 */
function facingFrames(t: Traced, facing: Dir, legCols: Set<number>): { stand: HTMLCanvasElement; walk: HTMLCanvasElement[] } {
  const base = decode(t);
  // Below the hip, only trouser and boot colours move; the rest (hair, coat hem, a staff) stays
  // with the body.
  const below = cut(base, 0, t.hip, t.w, t.h);
  const legs = byColour(below, legCols, true);
  const upper = cut(base, 0, 0, t.w, t.h);
  for (let y = t.hip; y < t.h; y++)
    for (let x = 0; x < t.w; x++) if (legCols.has(upper.px[y * t.w + x] ?? -1)) upper.px[y * t.w + x] = -1;
  const cols = span(legs) ?? [0, t.w - 1];
  const legMid = Math.round((cols[0] + cols[1]) / 2);
  // Place the feet on the frame's ground row, centred on the legs.
  const dx = Math.round(OUT_W / 2 - (legMid + 0.5));
  const dy = FEET_Y - t.feet;
  const stand = render([upper, legs], t.pal, dx, dy);
  const walk: HTMLCanvasElement[] = [];
  if (facing === 'down' || facing === 'up') {
    const left = cut(legs, 0, t.hip, legMid, t.h);
    const right = cut(legs, legMid, t.hip, t.w, t.h);
    // A lifted foot: the leg drawn a pixel higher, minus its top row (the knee bends).
    const lift = (l: Layer) => ({ ...cut(l, l.ox, l.oy + 1, l.ox + l.w, l.oy + l.h), oy: l.oy });
    walk.push(render([upper, lift(left), right], t.pal, dx, dy));
    walk.push(render([upper, left, right], t.pal, dx, dy - BOB));
    walk.push(render([upper, left, lift(right)], t.pal, dx, dy));
    walk.push(render([upper, left, right], t.pal, dx, dy - BOB));
  } else {
    // Side on: forward is the way they face.
    const fwd = facing === 'right' ? 1 : -1;
    const hipX = legMid + 0.5;
    const hipY = t.hip;
    // The two legs part: each swung about the hip and shifted a pixel its way, the far one darker
    // and behind the body.
    const shift = (l: Layer, by: number): Layer => ({ ...l, ox: l.ox + by });
    const near = (deg: number) => shift(rotSprite(legs, deg, hipX, hipY), Math.sign(deg));
    const far = (deg: number) => shift(darker(rotSprite(legs, deg, hipX, hipY), t.pal), Math.sign(deg));
    walk.push(render([far(-STRIDE * fwd), upper, near(STRIDE * fwd)], t.pal, dx, dy));
    walk.push(render([upper, legs], t.pal, dx, dy - BOB));
    walk.push(render([far(STRIDE * fwd), upper, near(-STRIDE * fwd)], t.pal, dx, dy));
    walk.push(render([upper, legs], t.pal, dx, dy - BOB));
  }
  return { stand, walk };
}

/** A field sprite from a traced character: the standing frame and walk per facing. */
export function rigSprite(traced: Record<Dir, Traced>, bounce = false): CharSprite {
  const frames = {} as Record<Dir, HTMLCanvasElement[]>;
  const walk = {} as Record<Dir, HTMLCanvasElement[]>;
  const legCols = legColours(traced.down);
  for (const d of ['down', 'right', 'up', 'left'] as Dir[]) {
    const f = facingFrames(traced[d], d, legCols);
    frames[d] = [f.stand, f.stand, f.stand];
    walk[d] = f.walk;
  }
  return { frames, w: OUT_W, h: OUT_H, ax: Math.floor(OUT_W / 2), ay: FEET_Y, walk, bounce };
}
