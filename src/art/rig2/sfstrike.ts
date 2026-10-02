/**
 * Rook's two-handed strike from Mark's own Sprite Fusion frames (spike `spike/side-battle`, item G-sf-rook-strike). DOM-free: this file holds the data
 * (anchors, timeline, measured reach), the pixel work on plain RGBA arrays (the smear crescents, taking a blade out of a frame, laying frames of
 * different canvases onto one) and `buildSfStrike`; `sfcrew.ts` turns the result into canvases. A pose is a row of data, never a repaint.
 *
 * The frames (all face right, none is mirrored):
 *   - ready:   his battle idle (`rook-battle-idle`, 79x68), the sword drawn in a ready stance.
 *   - windup:  `rook-battle-strike1` (69x110), the sword raised overhead, blade laid back.
 *   - swingA:  the wind-up body with its blade taken out and a code-drawn blade at -50 degrees, a crescent trailing it from where the blade was.
 *   - swingB:  `rook-battle-strike2` (101x66), the low follow-through with the coat flared, and a crescent trailing its blade up from -45 degrees.
 *   - followFade, follow: the same frame, the crescent thinning and then gone, held through the hit.
 * Mark has no in-between frames (no blade-vertical, no blade-level), so the dash between the two poses is two frames of body plus a code-drawn
 * blade and arc; his "edit" tool would make the real ones (see the missing-frames list in the spike notes).
 *
 * ANCHORS. The four canvases (68, 79, 69 and 101 wide, 53 to 110 tall) are not the same size and the body is not in the same place in each, so a
 * frame is placed by its FRONT BOOT (the foot he stamps in men-uchi: the heavier of the two boot-sized groups in the lowest eight rows, ignoring the
 * long thin blade-tip run of the follow-through) and its SOLES row (the lowest opaque row). The front boot is put at the same x as the idle's, so the
 * stamping foot never slides; the rear boot and the head do move (the rear leg reaches back, the head comes forward over the front foot), which is the lunge.
 */
import { boxOf, type Raw } from './sfgeom';

export type SfKey = 'ready' | 'windup' | 'swingA' | 'swingB' | 'followFade' | 'follow';
export const SF_KEYS: readonly SfKey[] = ['ready', 'windup', 'swingA', 'swingB', 'followFade', 'follow'];

/**
 * What was measured on Mark's PNGs, recorded as data (`tests/sfstrike.test.ts` re-measures them and fails if he regenerates a frame):
 * the front boot's centre column (a pixel's left edge is its index), the soles' row, and the pivot the swing turns about (between the two hands,
 * in the source frame's pixels). `blade` is the sword's root and tip in the wind-up frame (for taking it out); `tip` the follow-through's
 * blade point (its rightmost pixel).
 */
export const SF_ANCHORS = {
  idle: { frontBoot: 53.5, soles: 67 },
  windup: { src: 'rook-battle-strike1', w: 69, h: 110, frontBoot: 60, soles: 109, pivot: [51, 25], bladeRoot: [49, 20], bladeTip: [0, 2] },
  follow: { src: 'rook-battle-strike2', w: 101, h: 66, frontBoot: 62, soles: 65, pivot: [55, 45], tip: [100, 63] },
} as const;

/** Blade and smear colours: Mark's steel (a white edge, two steels, his near-black outline). */
const WHITE = [244, 247, 251] as const;
const STEEL_LIGHT = [208, 216, 228] as const;
const STEEL = [147, 153, 168] as const;
const OUTLINE = [6, 6, 10] as const;

// ------------------------------------------------------------------------------------------------ pixel helpers

export const blank = (w: number, h: number): Raw => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
const put = (r: Raw, x: number, y: number, c: readonly number[]): void => {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = (y * r.w + x) * 4;
  r.px[i] = c[0] ?? 0;
  r.px[i + 1] = c[1] ?? 0;
  r.px[i + 2] = c[2] ?? 0;
  r.px[i + 3] = 255;
};
const alphaAt = (r: Raw, x: number, y: number): number => (x < 0 || y < 0 || x >= r.w || y >= r.h ? 0 : (r.px[(y * r.w + x) * 4 + 3] ?? 0));
/** Copy the opaque pixels of `src` onto `dst` at (dx, dy). */
export function blit(dst: Raw, src: Raw, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if ((src.px[i + 3] ?? 0) === 0) continue;
      put(dst, x + dx, y + dy, [src.px[i] ?? 0, src.px[i + 1] ?? 0, src.px[i + 2] ?? 0]);
    }
}

/** The distance from a point to a segment. */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};

// ------------------------------------------------------------------------------------------------ measuring

/**
 * The boot-sized groups of columns in a frame's lowest eight rows (gaps of up to three columns join). The follow-through's blade tip also reaches the
 * lowest rows, but as a long thin run (over fifteen columns), so a group wider than that is not a boot.
 */
function bootGroups(r: Raw): { x0: number; x1: number; mass: number }[] {
  const b = boxOf(r);
  const cols = new Map<number, number>();
  for (let y = Math.max(0, b.y1 - 7); y <= b.y1; y++) for (let x = 0; x < r.w; x++) if (alphaAt(r, x, y) > 0) cols.set(x, (cols.get(x) ?? 0) + 1);
  const gs: { x0: number; x1: number; mass: number }[] = [];
  for (const x of [...cols.keys()].sort((p, q) => p - q)) {
    const g = gs[gs.length - 1];
    if (g && x - g.x1 <= 3) {
      g.x1 = x;
      g.mass += cols.get(x) ?? 0;
    } else gs.push({ x0: x, x1: x, mass: cols.get(x) ?? 0 });
  }
  return gs.filter((g) => g.x1 - g.x0 < 15).sort((p, q) => q.mass - p.mass);
}

/** The front (rightmost) boot's centre column: the heavier two boot groups, the right one. */
export function frontBoot(r: Raw): number {
  const two = bootGroups(r).slice(0, 2).sort((p, q) => p.x0 - q.x0);
  const g = two[two.length - 1];
  return g ? (g.x0 + g.x1 + 1) / 2 : boxOf(r).feet;
}
/** The soles' row: the lowest opaque row. */
export const soles = (r: Raw): number => boxOf(r).y1;
/** The rightmost opaque pixel (the blade point of the follow-through). */
export function rightmost(r: Raw): [number, number] {
  for (let x = r.w - 1; x >= 0; x--) for (let y = 0; y < r.h; y++) if (alphaAt(r, x, y) > 0) return [x, y];
  return [0, 0];
}

// ------------------------------------------------------------------------------------------------ the smear

/** The sword taken out of the wind-up frame, so a swing frame can draw its own: everything within `reach` px of the blade's line, above the hands. */
export function withoutBlade(r: Raw): Raw {
  const out: Raw = { w: r.w, h: r.h, px: new Uint8ClampedArray(r.px) };
  const [rx, ry] = SF_ANCHORS.windup.bladeRoot;
  const [tx, ty] = SF_ANCHORS.windup.bladeTip;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (alphaAt(r, x, y) === 0) continue;
      if (y <= ry - 1 && x <= rx + 2 && segDist(x + 0.5, y + 0.5, rx, ry, tx, ty) < 6) out.px[(y * r.w + x) * 4 + 3] = 0;
    }
  return out;
}

export interface Arc {
  /** The pivot, in the frame's pixels (between the hands). */
  cx: number;
  cy: number;
  /** The outer radius (the blade's reach) and the angles the point swept (degrees, 0 right, 90 down, -90 up), start then end. */
  r: number;
  a0: number;
  a1: number;
  /** The crescent's thickness at its leading edge. */
  width: number;
}

/**
 * A crescent: the band between radius `r - w` and `r`, where w grows from 1 px at the start angle to `width` at the end angle (the leading edge, where
 * the blade is). Three solid bands across it: white on the outer edge, pale steel, then steel. A pixel-art smear: no soft alpha, no loose dots.
 */
export function drawArc(dst: Raw, a: Arc): void {
  const x0 = Math.floor(a.cx - a.r - 1), x1 = Math.ceil(a.cx + a.r + 1), y0 = Math.floor(a.cy - a.r - 1), y1 = Math.ceil(a.cy + a.r + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - a.cx, dy = y + 0.5 - a.cy;
      const rad = Math.hypot(dx, dy);
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const u = (deg - a.a0) / (a.a1 - a.a0);
      if (u < 0 || u > 1) continue;
      const w = 1 + (a.width - 1) * u ** 1.5;
      if (rad > a.r || rad < a.r - w) continue;
      const q = (rad - (a.r - w)) / w;
      put(dst, x, y, q > 0.62 ? WHITE : q > 0.28 ? STEEL_LIGHT : STEEL);
    }
}

/** A code-drawn blade: from `r0` to `r1` px out from the pivot along `deg`, three px across (white edge on the leading side, steel, a darker spine) with an outline. */
export function drawBlade(dst: Raw, cx: number, cy: number, deg: number, r0: number, r1: number): void {
  const rad = (deg * Math.PI) / 180;
  const ax = cx + Math.cos(rad) * r0, ay = cy + Math.sin(rad) * r0;
  const bx = cx + Math.cos(rad) * r1, by = cy + Math.sin(rad) * r1;
  // The edge is the side the blade is moving toward: the clockwise side on screen (increasing angle), the spine the other.
  const nx = -Math.sin(rad), ny = Math.cos(rad);
  const x0 = Math.floor(Math.min(ax, bx)) - 4, x1 = Math.ceil(Math.max(ax, bx)) + 4, y0 = Math.floor(Math.min(ay, by)) - 4, y1 = Math.ceil(Math.max(ay, by)) + 4;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = segDist(x + 0.5, y + 0.5, ax, ay, bx, by);
      if (d > 2.6) continue;
      const side = (x + 0.5 - ax) * nx + (y + 0.5 - ay) * ny;
      if (d <= 1.5) put(dst, x, y, side > 0.4 ? WHITE : side < -0.6 ? STEEL : STEEL_LIGHT);
      else if (alphaAt(dst, x, y) === 0) put(dst, x, y, OUTLINE);
    }
}

// ------------------------------------------------------------------------------------------------ the timeline

/** Frames the blow holds on the target (through the cut line, the damage and the hitstop), and the slide back to the line. */
export const SF_HOLD = 13;
export const SF_RETURN = 9;
/** The two swing frames each last this many frames; swing A starts `SF_LEAD_A` frames before the effect, swing B one before it. */
export const SF_SWING = 2;
export const SF_LEAD_A = 3;
/** The smear arc fades over this many frames after the blade lands. */
export const SF_FADE = 2;
/** How far the blade's point goes in: a share of the way from the target's centre to its front edge. */
export const SF_BITE = 0.15;
/** The most the body travels (battle-world pixels) and how far a crewmate in the lane steps back to make room. */
export const SF_ROOM_MAX = 30;

export interface SfStep {
  key: SfKey;
  frames: number;
  /** How far along the lunge the body is at the start and end of the step (0 in its place, 1 at the target; a little negative is drawn back). */
  from: number;
  to: number;
}

/**
 * The strike's timeline when the effect starts `at` frames in: the ready stance, the wind-up held (longer if there is time, as when a timing ring is
 * closing), the two swing frames, the blow (the fade, then the held follow-through) and the slide back to ready. The dash is carried by the swing frames:
 * 0.3 to 0.45, then 0.7 to 0.95 of the way.
 */
export function sfTimeline(at0: number): SfStep[] {
  const at = Math.round(at0);
  const pre = Math.max(9, at - SF_LEAD_A);
  const ready = 3 + Math.floor((pre - 9) / 3);
  return [
    { key: 'ready', frames: ready, from: 0, to: 0 },
    { key: 'windup', frames: pre - ready, from: 0, to: -0.05 },
    { key: 'swingA', frames: SF_SWING, from: 0.3, to: 0.45 },
    { key: 'swingB', frames: SF_SWING, from: 0.7, to: 0.95 },
    { key: 'followFade', frames: SF_FADE, from: 1, to: 1 },
    { key: 'follow', frames: SF_HOLD, from: 1, to: 1 },
    { key: 'ready', frames: SF_RETURN, from: 1, to: 0 },
  ];
}
export const sfLength = (at: number): number => sfTimeline(at).reduce((n, s) => n + s.frames, 0);

export interface SfBeat {
  key: SfKey;
  step: number;
  lunge: number;
  /** Frames into the step. */
  t: number;
  /** The two swing frames: a body in motion (speed ghosts trail it). */
  dash: boolean;
  /** The blade is on the target. */
  contact: boolean;
}

/** The beat `k` frames into the pose (past the end: the last frame). */
export function sfBeat(k: number, at: number): SfBeat {
  const tl = sfTimeline(at);
  let t = k;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i] as SfStep;
    if (t < s.frames || i === tl.length - 1) {
      const u = s.frames > 1 ? Math.max(0, Math.min(1, t / (s.frames - 1))) : 1;
      return { key: s.key, step: i, lunge: s.from + (s.to - s.from) * u, t: Math.min(t, s.frames - 1), dash: s.key === 'swingA' || s.key === 'swingB', contact: s.key === 'swingB' || s.key === 'followFade' || s.key === 'follow' };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, t: 0, dash: false, contact: false };
}

/**
 * What the built frames measured (filled in by `buildSfStrike`, so a retuned anchor retunes the stop): at the follow-through, in art pixels (one per
 * screen pixel, two per battle-world pixel), how far the blade's point is in front of the member's axis (the idle's feet midpoint, the slot's x) and
 * above the soles, and how far the front boot is in front of that axis.
 */
export const SF_MEASURED = { tipDx: 60, tipUp: 2, footDx: 21 };

// ------------------------------------------------------------------------------------------------ building

export interface SfBuild {
  frames: Record<SfKey, Raw>;
  /** The canvas's centre column is the axis; its bottom row the soles. */
  axis: number;
  measured: { tipDx: number; tipUp: number; footDx: number };
}

/**
 * Lay every frame on one canvas size, axis at the centre column and soles on the bottom row. `idle` is the colour-cleaned idle loop (its feet midpoint
 * defines the axis, as `anchored` in sfcrew.ts does), `s1` and `s2` the strike frames.
 */
export function buildSfStrike(idle: Raw[], s1: Raw, s2: Raw): SfBuild {
  const boxes = idle.map(boxOf);
  const ax = Math.round(boxes.reduce((n, b) => n + b.feet, 0) / boxes.length);
  const idleFront = idle.reduce((n, r) => n + frontBoot(r), 0) / idle.length;
  const off = idleFront - ax;
  // A scratch canvas generous on every side; the real size is cropped from the extents of everything drawn.
  const HALF = 150, H0 = 240;
  const layers = {} as Record<SfKey, Raw>;
  const mk = (): Raw => blank(HALF * 2, H0);
  /** Where a source frame's origin lands on the scratch canvas. */
  const place = (fb: number, sl: number): { dx: number; dy: number } => ({ dx: Math.round(HALF + off - fb), dy: H0 - 1 - sl });
  const A = SF_ANCHORS;
  const pw = place(A.windup.frontBoot, A.windup.soles);
  const pf = place(A.follow.frontBoot, A.follow.soles);
  const pi = place(A.idle.frontBoot, A.idle.soles);

  layers.ready = mk();
  blit(layers.ready, idle[0] as Raw, pi.dx, pi.dy);
  layers.windup = mk();
  blit(layers.windup, s1, pw.dx, pw.dy);
  // Swing A: the wind-up body without its sword, a blade at -50 degrees and the crescent it swept from the overhead.
  const [wcx, wcy] = A.windup.pivot;
  layers.swingA = mk();
  blit(layers.swingA, withoutBlade(s1), pw.dx, pw.dy);
  drawArc(layers.swingA, { cx: wcx + pw.dx, cy: wcy + pw.dy, r: 54, a0: -158, a1: -50, width: 9 });
  drawBlade(layers.swingA, wcx + pw.dx, wcy + pw.dy, -50, 9, 52);
  // Swing B: the follow-through with its own blade, a crescent trailing it from near vertical.
  const [fcx, fcy] = A.follow.pivot;
  const tipDist = Math.hypot(A.follow.tip[0] + 1 - fcx, A.follow.tip[1] - fcy);
  const tipDeg = (Math.atan2(A.follow.tip[1] - fcy, A.follow.tip[0] + 1 - fcx) * 180) / Math.PI;
  layers.swingB = mk();
  drawArc(layers.swingB, { cx: fcx + pf.dx, cy: fcy + pf.dy, r: tipDist, a0: -46, a1: tipDeg, width: 8 });
  blit(layers.swingB, s2, pf.dx, pf.dy);
  layers.followFade = mk();
  drawArc(layers.followFade, { cx: fcx + pf.dx, cy: fcy + pf.dy, r: tipDist - 1, a0: -20, a1: tipDeg - 1, width: 4 });
  blit(layers.followFade, s2, pf.dx, pf.dy);
  layers.follow = mk();
  blit(layers.follow, s2, pf.dx, pf.dy);

  // Crop to a common size: symmetric about the axis (the engine centres a canvas on the slot), top at the highest pixel, bottom on the soles.
  let left = HALF, right = HALF, top = H0;
  for (const k of SF_KEYS) {
    const b = boxOf(layers[k]);
    left = Math.min(left, b.x0);
    right = Math.max(right, b.x1 + 1);
    top = Math.min(top, b.y0);
  }
  const half = Math.max(HALF - left, right - HALF);
  const frames = {} as Record<SfKey, Raw>;
  for (const k of SF_KEYS) {
    const out = blank(half * 2, H0 - top);
    const l = layers[k];
    for (let y = top; y < H0; y++) out.px.set(l.px.subarray((y * l.w + (HALF - half)) * 4, (y * l.w + (HALF + half)) * 4), (y - top) * out.w * 4);
    frames[k] = out;
  }
  const tipX = A.follow.tip[0] + 1 + pf.dx - HALF;
  return { frames, axis: half, measured: { tipDx: tipX, tipUp: A.follow.soles - A.follow.tip[1], footDx: Math.round(off) } };
}
