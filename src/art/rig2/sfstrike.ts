/**
 * Rook's two-handed strike from Mark's own Sprite Fusion frames (spike `spike/side-battle`, item G-sf-rook-strike). DOM-free: this file holds the data
 * (anchors, bent poses, timeline, measured reach), the pixel work on plain RGBA arrays (the smear crescents, splitting the sword from the wind-up frame,
 * bending a frame by rows, turning the sword, laying frames of different canvases onto one) and `buildSfStrike`; `sfcrew.ts` turns the result into
 * canvases. A pose is a row of data, never a repaint.
 *
 * The frames (all face right, none is mirrored):
 *   - ready:    his battle idle (`rook-battle-idle`, 79x68), the sword drawn in a ready stance.
 *   - dip:      the idle frame coiled (knees bent by deleting leg rows, torso tipped back): the anticipation before the lift.
 *   - windup:   `rook-battle-strike1` (69x110), the sword raised overhead, blade laid back.
 *   - swingA, swingM: the wind-up body bent forward and down by rows, with HIS sword (cut out of that frame, guard and all) turned about the hands to
 *     vertical and then half way down, and a thin crescent trailing it.
 *   - swingB:   `rook-battle-strike2` (101x66), the low follow-through with the coat flared, a streak from head height to the blade point.
 *   - followFade, follow: the same frame, the streak thinning and then gone, held through the hit.
 *   - recover:  the idle frame rising out of the lunge.
 * Mark still has no true in-between frames (his "edit" tool would make the real ones; see the missing-frames list in the spike notes), so the three
 * bent poses are stand-ins, one or two render frames each, covered at game speed by the streaks and ghosts.
 *
 * ANCHORS. The canvases (68, 79, 69 and 101 wide, 53 to 110 tall) are not the same size and the body is not in the same place in each, so a
 * frame is placed by its FRONT BOOT (the foot he stamps in men-uchi: the heavier of the two boot-sized groups in the lowest eight rows, ignoring the
 * long thin blade-tip run of the follow-through) and its SOLES row (the lowest opaque row). The front boot is put at the same x as the idle's, so the
 * stamping foot never slides; the rear boot and the head do move (the rear leg reaches back, the head comes forward over the front foot), which is the lunge.
 * The bent poses only move rows above the shins, so their boots stay where the source frame's are.
 */
import { boxOf, type Raw } from './sfgeom';

export type SfKey = 'ready' | 'dip' | 'windup' | 'swingA' | 'swingM' | 'swingB' | 'followFade' | 'follow' | 'recover';
export const SF_KEYS: readonly SfKey[] = ['ready', 'dip', 'windup', 'swingA', 'swingM', 'swingB', 'followFade', 'follow', 'recover'];

/**
 * What was measured on Mark's PNGs, recorded as data (`tests/sfstrike.test.ts` re-measures them and fails if he regenerates a frame):
 * the front boot's centre column (a pixel's left edge is its index), the soles' row, and the pivot the swing turns about (between the two hands,
 * in the source frame's pixels). `bladeRoot` and `bladeTip` are the sword's root and tip in the wind-up frame (for cutting it out); `tip` the
 * follow-through's blade point (its rightmost pixel).
 */
export const SF_ANCHORS = {
  idle: { frontBoot: 53.5, soles: 67 },
  windup: { src: 'rook-battle-strike1', w: 69, h: 110, frontBoot: 60, soles: 109, pivot: [51, 25], bladeRoot: [49, 20], bladeTip: [0, 2] },
  follow: { src: 'rook-battle-strike2', w: 101, h: 66, frontBoot: 62, soles: 65, pivot: [55, 45], tip: [100, 63] },
} as const;

/**
 * The in-between poses as data (round 2). `del` are source rows removed (everything above drops one row for each, so the knees bend and the soles stay on the
 * street); `lean` is how far (px) the head is carried forward: each row above `leanRow` shifts sideways in proportion to its height over it (the torso tips over
 * the front foot, the hands come with it); `rot` turns his own sword about the hands, clockwise in degrees (0 = as drawn, overhead and laid back); `arc` is the
 * smear trailing the blade tip: start and end angle (0 right, 90 down, -90 up) and its widest point. Add a pose by adding a row here.
 */
export interface SfPose {
  del: readonly number[];
  lean: number;
  leanRow: number;
  rot?: number;
  arc?: { a0: number; a1: number; width: number };
}
export const SF_POSES: Record<'dip' | 'swingA' | 'swingM' | 'recover', SfPose> = {
  // Coil: the idle frame with the knees bent and the weight back over the rear foot.
  dip: { del: [47, 51, 55], lean: -3, leanRow: 58 },
  // Swing A: the blade past vertical, the body already tipping over the front foot.
  swingA: { del: [78, 88, 98], lean: 3, leanRow: 100, rot: 58, arc: { a0: -138, a1: -100, width: 3 } },
  // Swing M: the blade half way down, rising ahead of him, the body low.
  swingM: { del: [74, 79, 84, 89, 94, 98, 101], lean: 7, leanRow: 100, rot: 136, arc: { a0: -78, a1: -14, width: 4 } },
  // Recover: rising out of the lunge, still leaning to the target.
  recover: { del: [51, 55], lean: 3, leanRow: 58 },
};
/** Swing B's streak starts at head height, as the blade is thrown down, and ends on the blade point; `fade` is the thin one that follows. */
export const SF_STREAK = { a0: -52, width: 5, fadeA0: -8, fadeWidth: 3 };
/** The smear's radius about the hands: just inside the wind-up blade's own reach (56 px from the grip to the point). */
export const SF_SWORD_REACH = 54;
/** How many rows of lean count at most (a row this far over the lean row moves the full `lean` px). */
const LEAN_SPAN = 60;

/** Smear colours: sampled from the follow-through's own blade by `buildSfStrike` (these are what it falls back to). Two bands, never more. */
const RAMP = { white: [244, 247, 251] as number[], light: [208, 216, 228] as number[] };

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

/**
 * The follow-through's blade steel, sampled (not typed in): the pixels along its blade line that are not outline, split by brightness into the bright edge and
 * the lighter body tone. Sets the smear's two bands, so the streak is the same steel as the sword it trails.
 */
export function sampleSteel(s2: Raw): void {
  const [tx, ty] = SF_ANCHORS.follow.tip;
  const [px, py] = SF_ANCHORS.follow.pivot;
  const lum: { l: number; c: number[] }[] = [];
  for (let y = 0; y < s2.h; y++)
    for (let x = px + 12; x < s2.w; x++) {
      if (alphaAt(s2, x, y) === 0 || segDist(x + 0.5, y + 0.5, px + 8, py + 4, tx, ty) > 3) continue;
      const c = [s2.px[(y * s2.w + x) * 4] ?? 0, s2.px[(y * s2.w + x) * 4 + 1] ?? 0, s2.px[(y * s2.w + x) * 4 + 2] ?? 0];
      const l = 0.3 * (c[0] ?? 0) + 0.59 * (c[1] ?? 0) + 0.11 * (c[2] ?? 0);
      if (l > 90) lum.push({ l, c });
    }
  if (lum.length < 6) return;
  lum.sort((a, b) => a.l - b.l);
  RAMP.white = (lum[Math.floor(lum.length * 0.93)] as { c: number[] }).c;
  RAMP.light = (lum[Math.floor(lum.length * 0.5)] as { c: number[] }).c;
}

// ------------------------------------------------------------------------------------------------ bending and turning

const isGold = (r: Raw, x: number, y: number): boolean => {
  const i = (y * r.w + x) * 4;
  return (r.px[i] ?? 0) > 200 && (r.px[i + 1] ?? 0) > 140 && (r.px[i + 2] ?? 0) < 110;
};

/**
 * The wind-up frame split in two: the sword (everything within 6 px of the blade's line above the hands, and the gold of the guard at its root) and the
 * body without it. The sword keeps its own pixels, so a swing frame can turn it about the hands and the guard stays on the blade.
 */
export function splitSword(r: Raw): { body: Raw; sword: Raw } {
  const body: Raw = { w: r.w, h: r.h, px: new Uint8ClampedArray(r.px) };
  const sword = blank(r.w, r.h);
  const [rx, ry] = SF_ANCHORS.windup.bladeRoot;
  const [tx, ty] = SF_ANCHORS.windup.bladeTip;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (alphaAt(r, x, y) === 0) continue;
      const blade = y <= ry - 1 && x <= rx + 2 && segDist(x + 0.5, y + 0.5, rx, ry, tx, ty) < 6;
      const guard = x <= rx + 2 && y >= ry - 4 && y <= ry + 2 && isGold(r, x, y);
      if (!blade && !guard) continue;
      const i = (y * r.w + x) * 4;
      sword.px.set(r.px.subarray(i, i + 4), i);
      body.px[i + 3] = 0;
    }
  return { body, sword };
}

/** Columns of room a bent frame gets on each side (the lean moves rows sideways). */
const BEND_PAD = 12;

/**
 * A frame bent by rows (see `SfPose`): the rows in `pose.del` are dropped, everything above shifts down by one for each, and each row above `leanRow`
 * shifts sideways in proportion to its height. Pixels move whole rows, so a pixel is never resampled. `at(x, y)` gives where a source point went (in the
 * returned canvas, whose column 0 is `BEND_PAD` left of the source's).
 */
export function bend(r: Raw, pose: SfPose): { raw: Raw; at: (x: number, y: number) => [number, number] } {
  const del = new Set(pose.del);
  const dropBelow = (y: number): number => pose.del.filter((d) => d > y).length;
  const shift = (y: number): number => (y >= pose.leanRow ? 0 : Math.round(pose.lean * Math.min(1.2, (pose.leanRow - y) / LEAN_SPAN)));
  const out = blank(r.w + BEND_PAD * 2, r.h);
  for (let y = 0; y < r.h; y++) {
    if (del.has(y)) continue;
    const dy = y + dropBelow(y), dx = BEND_PAD + shift(y);
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      if ((r.px[i + 3] ?? 0) === 0) continue;
      put(out, x + dx, dy, [r.px[i] ?? 0, r.px[i + 1] ?? 0, r.px[i + 2] ?? 0]);
    }
  }
  return { raw: out, at: (x, y) => [x + BEND_PAD + shift(y), y + dropBelow(y)] };
}

/** Extra room round a turned layer (the sword swings out of its source canvas). */
const TURN_PAD = 70;

/** A layer turned `deg` degrees clockwise about (cx, cy) by inverse mapping (nearest pixel: no blur, no new colours). Origin is `TURN_PAD` up and left of the source's. */
export function turned(src: Raw, cx: number, cy: number, deg: number): Raw {
  const out = blank(src.w + TURN_PAD * 2, src.h + TURN_PAD * 2);
  const a = (-deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const ox = x - TURN_PAD + 0.5 - cx, oy = y - TURN_PAD + 0.5 - cy;
      const sx = Math.floor(cx + ox * co - oy * si), sy = Math.floor(cy + ox * si + oy * co);
      if (alphaAt(src, sx, sy) === 0) continue;
      const i = (sy * src.w + sx) * 4;
      put(out, x, y, [src.px[i] ?? 0, src.px[i + 1] ?? 0, src.px[i + 2] ?? 0]);
    }
  return out;
}

// ------------------------------------------------------------------------------------------------ the smear

export interface Arc {
  /** The pivot, in the frame's pixels (between the hands). */
  cx: number;
  cy: number;
  /** The outer radius (the blade's reach) and the angles the point swept (degrees, 0 right, 90 down, -90 up), start then end. */
  r: number;
  a0: number;
  a1: number;
  /** The crescent's thickness at its widest point (80 percent of the way along; it tapers to a point at both ends). */
  width: number;
}

/**
 * A crescent: the band between radius `r - w` and `r`, where w grows from 1 px at the start angle to `width` at 80 percent of the way and narrows again to
 * the leading end, so it tapers to a point at both ends. Two solid bands across it: the blade's bright edge on the outside, its lighter tone inside. A
 * pixel-art smear: no soft alpha, no loose dots.
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
      const k = u < 0.8 ? (u / 0.8) ** 1.5 : 1 - ((u - 0.8) / 0.2) * 0.55;
      const w = 1 + (a.width - 1) * k;
      if (rad > a.r || rad < a.r - w) continue;
      put(dst, x, y, (rad - (a.r - w)) / w > 0.45 ? RAMP.white : RAMP.light);
    }
}

// ------------------------------------------------------------------------------------------------ the timeline

/** Frames the blow holds on the target (through the cut line, the damage and the hitstop), and the way home (a rising frame, then the stance). */
export const SF_HOLD = 13;
export const SF_RECOVER = 4;
export const SF_RETURN = 11;
/** Frames of animation from the start of the pose to the effect when nothing (a timing ring) stretches it: the ready stance, the dip, a short overhead hold, three swing frames. */
export const SF_WINDUP = 13;
/** The overhead is held this many frames before the swing, however long the ready stance before it runs. */
export const SF_UP = 4;
/** The dip before the overhead lift. */
export const SF_DIP = 2;
/** Swing B's two frames: the blade lands on its first frame, the effect starts on its second. Swing A and M are one frame each, so three frames lead the effect. */
export const SF_SWING = 2;
export const SF_LEAD = 3;
/** The streak fades over this many frames after the blade lands. */
export const SF_FADE = 2;
/**
 * How far past the target's body front (battle-world px, two art px each) the blade's point goes: the point is inside the body, so the cut reads as a cut
 * through it, not a touch in front of it. (The enemy's box includes a club or a tail; the body front is measured from its columns.)
 */
export const SF_PIERCE = 5;
/** Where on the target the point lands, as a share of its height above its soles (hip height), and how far Rook's row may differ from his own place (world px). */
export const SF_HIT_HEIGHT = 0.4;
export const SF_LANE_UP = 10;
export const SF_LANE_DOWN = 0;
/** A crewmate in the way steps this far (battle-world px, x then y; y is toward the camera) so Rook's row is clear for the whole strike. */
export const SF_ROOM = { dx: -6, dy: 14 };

export interface SfStep {
  key: SfKey;
  frames: number;
  /** How far along the lunge the body is at the start and end of the step (0 in its place, 1 at the target; a little negative is drawn back). */
  from: number;
  to: number;
}

/**
 * The strike's timeline when the effect starts `at` frames in: the ready stance (longer if there is time, as when a timing ring
 * is closing), the dip, the overhead held 4 frames, swing A and M (one frame each), swing B (two), the blow (the fade, then the held follow-through) and the way home. The dash is carried by the
 * swing frames: 0.2, 0.45, then 0.75 to 0.95 of the way.
 */
export function sfTimeline(at0: number): SfStep[] {
  const at = Math.round(at0);
  const pre = Math.max(SF_DIP + SF_UP + 3, at - SF_LEAD);
  // Any extra time (a timing ring closing) is spent in the READY stance, whose idle loop keeps breathing, not in a frozen overhead: the overhead is held SF_UP frames, always.
  const ready = pre - SF_DIP - SF_UP;
  return [
    { key: 'ready', frames: ready, from: 0, to: 0 },
    { key: 'dip', frames: SF_DIP, from: 0, to: -0.02 },
    { key: 'windup', frames: SF_UP, from: -0.02, to: -0.04 },
    { key: 'swingA', frames: 1, from: 0.2, to: 0.2 },
    { key: 'swingM', frames: 1, from: 0.45, to: 0.45 },
    { key: 'swingB', frames: SF_SWING, from: 0.75, to: 0.95 },
    { key: 'followFade', frames: SF_FADE, from: 1, to: 1 },
    { key: 'follow', frames: SF_HOLD, from: 1, to: 1 },
    { key: 'recover', frames: SF_RECOVER, from: 1, to: 0.65 },
    { key: 'ready', frames: SF_RETURN - SF_RECOVER, from: 0.6, to: 0 },
  ];
}
export const sfLength = (at: number): number => sfTimeline(at).reduce((n, s) => n + s.frames, 0);

export interface SfBeat {
  key: SfKey;
  step: number;
  lunge: number;
  /** Frames into the step. */
  t: number;
  /** The swing frames: a body in motion (speed ghosts trail it). */
  dash: boolean;
  /** The blade is on the target. */
  contact: boolean;
  /** How far a crewmate has stepped out of his row (0 to 1): in over the dip and the wind-up, out over the way home. */
  room: number;
}

const smooth = (u: number): number => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

/** The beat `k` frames into the pose (past the end: the last frame). */
export function sfBeat(k: number, at: number): SfBeat {
  const tl = sfTimeline(at);
  let t = k;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i] as SfStep;
    if (t < s.frames || i === tl.length - 1) {
      const u = s.frames > 1 ? Math.max(0, Math.min(1, t / (s.frames - 1))) : 1;
      const lunge = s.from + (s.to - s.from) * u;
      const swing = s.key === 'swingA' || s.key === 'swingM' || s.key === 'swingB';
      // The room: nothing while he stands ready; from the dip it eases in over the dip and the first frames of the wind-up, and goes home as the lunge unwinds.
      const roomIn = i === 0 ? 0 : smooth((k - (tl[0]?.frames ?? 0)) / (SF_DIP + 4));
      const room = i >= tl.length - 2 ? Math.min(roomIn, smooth(lunge / 0.3)) : roomIn;
      return { key: s.key, step: i, lunge, t: Math.min(t, s.frames - 1), dash: swing, contact: s.key === 'swingB' || s.key === 'followFade' || s.key === 'follow', room };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, t: 0, dash: false, contact: false, room: 0 };
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
  /** Where the hands are in each swing frame (the pivot after bending), on the finished canvas, for the notes and the tests. */
  pivots: Partial<Record<SfKey, [number, number]>>;
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
  sampleSteel(s2);
  const pw = place(A.windup.frontBoot, A.windup.soles);
  const pf = place(A.follow.frontBoot, A.follow.soles);
  const pi = place(A.idle.frontBoot, A.idle.soles);
  const pivots: Partial<Record<SfKey, [number, number]>> = {};

  const i0 = idle[0] as Raw;
  layers.ready = mk();
  blit(layers.ready, i0, pi.dx, pi.dy);
  for (const k of ['dip', 'recover'] as const) {
    layers[k] = mk();
    blit(layers[k], bend(i0, SF_POSES[k]).raw, pi.dx - BEND_PAD, pi.dy);
  }
  layers.windup = mk();
  blit(layers.windup, s1, pw.dx, pw.dy);

  // Swing A and M: the wind-up body bent forward and down, his sword turned about the hands, a crescent trailing the point (behind the sword, behind the body).
  const [wcx, wcy] = A.windup.pivot;
  const { body, sword } = splitSword(s1);
  for (const k of ['swingA', 'swingM'] as const) {
    const pose = SF_POSES[k];
    const bent = bend(body, pose);
    const [qx, qy] = bent.at(wcx, wcy);
    const l = mk();
    if (pose.arc) drawArc(l, { cx: qx - BEND_PAD + pw.dx, cy: qy + pw.dy, r: SF_SWORD_REACH, ...pose.arc });
    // The sword turns about the hands where they were, then goes with them to where the bend put them.
    blit(l, turned(sword, wcx, wcy, pose.rot ?? 0), pw.dx + (qx - BEND_PAD - wcx) - TURN_PAD, pw.dy + (qy - wcy) - TURN_PAD);
    blit(l, bent.raw, pw.dx - BEND_PAD, pw.dy);
    layers[k] = l;
    pivots[k] = [qx - BEND_PAD + pw.dx - HALF, qy + pw.dy - H0];
  }

  // Swing B: the follow-through with its own blade, a streak from head height to the point.
  const [fcx, fcy] = A.follow.pivot;
  const tipDist = Math.hypot(A.follow.tip[0] + 1 - fcx, A.follow.tip[1] - fcy);
  const tipDeg = (Math.atan2(A.follow.tip[1] - fcy, A.follow.tip[0] + 1 - fcx) * 180) / Math.PI;
  layers.swingB = mk();
  drawArc(layers.swingB, { cx: fcx + pf.dx, cy: fcy + pf.dy, r: tipDist, a0: SF_STREAK.a0, a1: tipDeg, width: SF_STREAK.width });
  blit(layers.swingB, s2, pf.dx, pf.dy);
  layers.followFade = mk();
  drawArc(layers.followFade, { cx: fcx + pf.dx, cy: fcy + pf.dy, r: tipDist - 1, a0: SF_STREAK.fadeA0, a1: tipDeg - 1, width: SF_STREAK.fadeWidth });
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
  for (const k of Object.keys(pivots) as SfKey[]) {
    const p = pivots[k] as [number, number];
    pivots[k] = [p[0] + half, p[1] + H0 - top];
  }
  const tipX = A.follow.tip[0] + 1 + pf.dx - HALF;
  return { frames, axis: half, measured: { tipDx: tipX, tipUp: A.follow.soles - A.follow.tip[1], footDx: Math.round(off) }, pivots };
}
