/**
 * Rook's two-handed strike from Mark's own Sprite Fusion frames (spike `spike/side-battle`, item G-sf-rook-strike). DOM-free: this file holds the data
 * (anchors, squash poses, swipes, timeline, measured reach), the pixel work on plain RGBA arrays (the swipe, the blade, splitting the sword from the wind-up frame,
 * squashing a frame by rows, laying frames of different canvases onto one) and `buildSfStrike`; `sfcrew.ts` turns the result into canvases. A pose is a row of data.
 *
 * The frames (all face right, none is mirrored):
 *   - ready:    his battle idle (`rook-battle-idle`, 79x68), the sword drawn in a ready stance.
 *   - dip:      `rook-battle-crouched` (105x53) as Mark drew it, the katana trailing low behind him: the coil before the lift (round 4: it replaces the row-squashed idle).
 *   - riseA, rise: `rook-battle-strike1` with 8 and then 4 rows out of the thighs: the body standing up out of the crouch, arms already overhead (the charge).
 *   - windup:   `rook-battle-strike1` (69x110), the sword raised overhead, blade laid back. Held 3 frames.
 *   - smearA:   the wind-up body (6 rows out of the legs: the blow has started down) WITHOUT its sword, and a code-drawn blade from the grip with a solid crescent trailing it.
 *   - mid:      the in-between body Mark has not drawn: the wind-up body with 16 rows out of the legs and the head carried 6 px forward, a code blade from the grip.
 *   - smearB:   `rook-battle-strike2` (101x66) as drawn, a crescent trailing the blade he drew. swingB: the same, a shorter crescent. followFade, follow: no crescent, held through the hit.
 *   - recover:  the idle frame rising out of the lunge.
 * Every body frame of Mark's is drawn as he drew it, except the sword cut out of strike1 for the two swing frames and the stand-in bodies (riseA, rise, smearA, mid
 * are rows removed from his strike1 legs, nothing resampled). His 'edit' tool would make the real in-betweens.
 *
 * ANCHORS. The canvases (68, 79, 69, 101 and 105 wide, 53 to 110 tall) are not the same size and the body is not in the same place in each, so a
 * frame is placed by its FRONT BOOT (the foot he stamps in men-uchi: the heavier of the two boot-sized groups in the lowest eight rows, ignoring the
 * long thin blade-tip run of the follow-through) and its SOLES row (the lowest opaque row). The front boot is put at the same x as the idle's, so the
 * stamping foot never slides; the rear boot and the head do move (the rear leg reaches back, the head comes forward over the front foot), which is the lunge.
 * The squash poses only move rows above the shins, so their boots stay where the source frame's are.
 */
import { boxOf, type Raw } from './sfgeom';

export type SfKey = 'ready' | 'dip' | 'riseA' | 'rise' | 'windup' | 'smearA' | 'mid' | 'smearB' | 'swingB' | 'followFade' | 'follow' | 'recover';
export const SF_KEYS: readonly SfKey[] = ['ready', 'dip', 'riseA', 'rise', 'windup', 'smearA', 'mid', 'smearB', 'swingB', 'followFade', 'follow', 'recover'];

/**
 * What was measured on Mark's PNGs, recorded as data (`tests/sfstrike.test.ts` re-measures them and fails if he regenerates a frame):
 * the front boot's centre column (a pixel's left edge is its index), the soles' row, and the hands (the pivot the swipe turns about, between the two hands,
 * in the source frame's pixels). `bladeRoot` and `bladeTip` are the sword's root and tip in the wind-up frame (for cutting it out); `tip` the
 * follow-through's blade point (its rightmost pixel).
 */
export const SF_ANCHORS = {
  idle: { frontBoot: 53.5, soles: 67 },
  crouch: { src: 'rook-battle-crouched', w: 105, h: 53, frontBoot: 97.5, soles: 52 },
  windup: { src: 'rook-battle-strike1', w: 69, h: 110, frontBoot: 60, soles: 109, pivot: [51, 25], bladeRoot: [49, 20], bladeTip: [0, 2] },
  follow: { src: 'rook-battle-strike2', w: 101, h: 66, frontBoot: 62, soles: 65, pivot: [55, 45], tip: [100, 63] },
} as const;

/**
 * The squashed poses as data. `del` are source rows removed (everything above drops one row for each, so the knees bend and the soles stay on the street);
 * `lean` is how far (px) the head is carried sideways: each row above `leanRow` shifts in proportion to its height over it (0: a pure squash, nothing sheared).
 * Add a pose by adding a row here.
 */
export interface SfPose {
  del: readonly number[];
  lean: number;
  leanRow: number;
}
export const SF_POSES: Record<'riseA' | 'rise' | 'lowA' | 'mid' | 'recover', SfPose> = {
  // The two steps of standing up out of the crouch (the charge): the wind-up frame with eight, then four rows out of the thighs and shins above the boots. Arms overhead already.
  riseA: { del: [70, 74, 78, 82, 86, 90, 94, 98], lean: 0, leanRow: 0 },
  rise: { del: [84, 89, 94, 99], lean: 0, leanRow: 0 },
  // Smear A's body: the wind-up body six rows lower (the blow has started down), nothing sheared.
  lowA: { del: [74, 80, 86, 92, 98, 103], lean: 0, leanRow: 0 },
  // The in-between Mark has not drawn: sixteen rows out of the legs (a deep squat) and the head 6 px forward over the front foot.
  mid: { del: [70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100], lean: 6, leanRow: 84 },
  // Recover: rising out of the lunge, still leaning to the target.
  recover: { del: [51, 55], lean: 3, leanRow: 58 },
};

/**
 * The swipes (round 4): the sweep of the blade, drawn about the hands as a thin crescent in three solid bands (no dither), tapering to a point at its trailing end,
 * plus (for the two frames whose sword is cut out of strike1) a blade drawn from the grip at the leading angle. Angles are of the BLADE about the hands (0 right,
 * 90 down, -90 up), `a0` the trailing edge and `a1` the leading one; `rx` and `ry` the reach sideways and up or down (an ellipse: the blade swings in a plane tipped toward
 * the viewer, so its reach straight up is shorter and no frame rises over the name plate); `edge` the crescent's thickness at its widest; `blade` the drawn blade's length
 * (0: the frame has its own blade, Mark's). `hand` says which frame's hands it turns about.
 */
export interface SfSwipe {
  hand: 'lowA' | 'mid' | 'follow';
  a0: number;
  a1: number;
  rx: number;
  ry: number;
  edge: number;
  blade: number;
}
export const SF_SWIPES: Record<'smearA' | 'mid' | 'smearB' | 'swingB' | 'followFade', SfSwipe> = {
  smearA: { hand: 'lowA', a0: -150, a1: -62, rx: 40, ry: 33, edge: 5, blade: 36 },
  mid: { hand: 'mid', a0: -100, a1: -26, rx: 46, ry: 42, edge: 5, blade: 44 },
  smearB: { hand: 'follow', a0: -76, a1: 16, rx: 44, ry: 44, edge: 4, blade: 0 },
  swingB: { hand: 'follow', a0: -22, a1: 18, rx: 40, ry: 40, edge: 3, blade: 0 },
  followFade: { hand: 'follow', a0: 0, a1: 20, rx: 38, ry: 38, edge: 2, blade: 0 },
};
/** How many rows of lean count at most (a row this far over the lean row moves the full `lean` px). */
const LEAN_SPAN = 60;

/** Swipe colours: sampled from the follow-through's own blade by `sampleSteel` (these are what it falls back to). Three tones: the bright rim, the light body, the steel fill. */
/** A swipe's palette: the bright rim, the light body, the fill, the outline and the guard's gold (Rook's is sampled from his sword; Kit's punch builds one from her jacket, `sfpunch.ts`). */
export interface Ramp {
  white: number[];
  light: number[];
  steel: number[];
  outline: number[];
  gold: number[];
}
const RAMP: Ramp = { white: [244, 247, 251], light: [208, 216, 228], steel: [150, 166, 190], outline: [24, 22, 32], gold: [226, 170, 48] };

// ------------------------------------------------------------------------------------------------ pixel helpers

export const blank = (w: number, h: number): Raw => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
export const put = (r: Raw, x: number, y: number, c: readonly number[]): void => {
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
 * the lighter body tone. Sets the swipe's bands and the drawn blade, so they are the same steel as the sword they trail. The gold of the guard is sampled from
 * the wind-up frame, the outline from its darkest pixel.
 */
export function sampleSteel(s2: Raw, s1?: Raw): void {
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
  if (lum.length >= 6) {
    lum.sort((a, b) => a.l - b.l);
    RAMP.white = (lum[Math.floor(lum.length * 0.93)] as { c: number[] }).c;
    RAMP.light = (lum[Math.floor(lum.length * 0.5)] as { c: number[] }).c;
    RAMP.steel = (lum[Math.floor(lum.length * 0.15)] as { c: number[] }).c;
  }
  if (s1) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = 0; y < s1.h; y++)
      for (let x = 0; x < s1.w; x++)
        if (alphaAt(s1, x, y) > 0 && isGold(s1, x, y)) {
          const i = (y * s1.w + x) * 4;
          r += s1.px[i] ?? 0;
          g += s1.px[i + 1] ?? 0;
          b += s1.px[i + 2] ?? 0;
          n++;
        }
    if (n >= 3) RAMP.gold = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
}

// ------------------------------------------------------------------------------------------------ bending

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

// ------------------------------------------------------------------------------------------------ the swipe and the blade

/**
 * A blade drawn from the grip at (hx, hy) out `len` px at `deg` degrees: a dark outline all round, a bright edge down one side, the light steel tone down the other,
 * a thin point at the end and a gold guard just past the hands. Built from the sampled steel and the guard's gold, so it is Mark's sword in colour; drawn behind the fists.
 */
export function drawBlade(dst: Raw, hx: number, hy: number, deg: number, len: number): void {
  const th = (deg * Math.PI) / 180;
  const ca = Math.cos(th), sa = Math.sin(th);
  const x0 = Math.floor(hx - len - 4), x1 = Math.ceil(hx + len + 4), y0 = Math.floor(hy - len - 4), y1 = Math.ceil(hy + len + 4);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
      const t = dx * ca + dy * sa;
      const n = -dx * sa + dy * ca;
      if (t < 1 || t > len + 1) continue;
      const taper = t > len * 0.8 ? 1 - ((t - len * 0.8) / (len * 0.2 + 1)) * 0.85 : 1;
      const hw = 1.5 * taper;
      const guard = t > 6 && t < 8.5;
      if (guard && Math.abs(n) <= 3) put(dst, x, y, Math.abs(n) > 2.2 ? RAMP.outline : RAMP.gold);
      else if (Math.abs(n) <= hw - 0.5) put(dst, x, y, n < 0 ? RAMP.white : RAMP.light);
      else if (Math.abs(n) <= hw + 0.7) put(dst, x, y, RAMP.outline);
    }
}

/**
 * A swipe (see `SfSwipe`) drawn about the hands at (hx, hy): a crescent along the elliptical reach between the blade's trailing and leading angles, in three solid
 * bands (the blade's bright edge outside, its lighter tone, then the steel inside), thin at the trailing end and thickest at the leading one. No fill, no dither,
 * no soft alpha, no loose dots. The drawn blade (if the swipe has one) goes on the leading edge.
 */
export function drawSwipe(dst: Raw, hx: number, hy: number, sw: SfSwipe, ramp: Ramp = RAMP): void {
  const reach = Math.max(sw.rx, sw.ry);
  const x0 = Math.floor(hx - reach - 1), x1 = Math.ceil(hx + reach + 1), y0 = Math.floor(hy - reach - 1), y1 = Math.ceil(hy + reach + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const u = (deg - sw.a0) / (sw.a1 - sw.a0);
      if (u < 0 || u > 1) continue;
      const th = Math.atan2(dy, dx);
      const R = (sw.rx * sw.ry) / Math.hypot(sw.ry * Math.cos(th), sw.rx * Math.sin(th));
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      const w = sw.edge * (0.2 + 0.8 * u ** 1.3);
      if (r <= R - w) continue;
      const depth = (R - r) / w;
      put(dst, x, y, depth < 0.4 ? ramp.white : depth < 0.75 ? ramp.light : ramp.steel);
    }
  if (sw.blade > 0) drawBlade(dst, hx, hy, sw.a1, sw.blade);
}

// ------------------------------------------------------------------------------------------------ the timeline

/** Frames the blow holds on the target (through the cut line, the damage and the hitstop), and the way home (a rising frame, then the stance). */
export const SF_HOLD = 13;
export const SF_RECOVER = 4;
export const SF_RETURN = 11;
/** The last frames of the way home, in which a crewmate who stepped back comes down into her row (after he has passed her). */
export const SF_COME_DOWN = 3;
/**
 * Round 4's lead is 17 pose frames from the order to the effect (round 3: 24). A pose frame is 1 / FX_PACE ticks = 25.6 ms, not 16.7 ms: 17 frames is 435 ms.
 * The dip (his crouch frame, 3), the stand-up in two steps (1 + 2, the charge), the overhead held 3, and the swing: smear A 2, mid 2, smear B 1, swing B 2 (its second frame is the effect's).
 */
export const SF_DIP = 3;
export const SF_RISEA = 1;
export const SF_RISE = 2;
export const SF_UP = 3;
export const SF_SMEAR = 2;
export const SF_MID = 2;
export const SF_SMEARB = 1;
export const SF_SWING = 2;
export const SF_LEAD = SF_SMEAR + SF_MID + SF_SMEARB + 1;
/** Frames of animation from the start of the pose to the effect when nothing (a timing ring) stretches it: a short ready stance, the lift, the swipes. */
export const SF_WINDUP = SF_DIP + SF_RISEA + SF_RISE + SF_UP + 2 + SF_LEAD;
/** Pose-frame length in ms: the effect clock runs 0.65 frames per 60 Hz tick (`FX_PACE` in scenes/battle.ts). */
export const SF_FRAME_MS = 1000 / 60 / 0.65;
/** The swipe's thin tail fades over this many frames after the blade lands. */
export const SF_FADE = 2;
/**
 * How far past the target's body front (battle-world px, two art px each) the blade's point goes: the point is inside the body, so the cut reads as a cut
 * through it, not a touch in front of it. (The enemy's box includes a club or a tail; the body front is measured from its columns.)
 * Round 4: 4 to 7, so the point is clearly inside the silhouette.
 */
export const SF_PIERCE = 7;
/**
 * Rook's row at the strike (round 3): he stands on the target's floor, not on a ledge above it. His soles are `SF_SOLES_ABOVE` world px above the target's soles at most (the point
 * is then a hand's width up its leg, the cut line carries the rest), and his row moves from his own place by at most `SF_LANE_UP` up or `SF_LANE_DOWN` down.
 */
export const SF_SOLES_ABOVE = 6;
export const SF_LANE_UP = 6;
export const SF_LANE_DOWN = 9;
/** A short target (a Glowrat): his soles stand at most this share of its height above its soles. */
export const SF_LANE_SHARE = 0.3;
/**
 * Where on the target the cut line and the spark land, as a share of its height above its soles (round 4: the middle of the body, 0.5; round 3: 0.3, at the thigh): the
 * line crosses the torso and the blade point stays low. The spark ring's radius is `SF_SPARK_BODY` of the target's body width at most (a Glowrat is smaller than a Punk).
 */
export const SF_HIT_HEIGHT = 0.5;
export const SF_SPARK_BODY = 0.35;
/** The target's recoil from the blow, in world px per tick from the hit (round 4: 13 ticks, 4 px through the hitstop and easing off; round 3: 6 ticks). */
export const SF_KNOCK: readonly number[] = [4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1];
/**
 * A crewmate in his way (round 4) steps back into the second row: up the street `up` world px (a half step into the second row) and a little left (`left` px), so his low dash passes in front of her
 * and her head and torso stay clear above his coat. Round 3 had her walk back through his empty place and cross him for 4 to 8 frames, hidden behind his body: the crew's staircase leaves no room
 * beside him (Hex is 31 world px to his left), so she goes up, not sideways. Her progress is each step's `room` range (0 at her place, 1 in the second row), eased by the renderer, and it is a
 * function of the beat, not of his lunge: she is up before the dash starts and comes down as he is nearly home.
 */
export const SF_ROOM = { left: 4, up: 18 };

export interface SfStep {
  key: SfKey;
  frames: number;
  /** How far along the lunge the body is at the start and end of the step (0 in its place, 1 at the target; a little negative is drawn back). */
  from: number;
  to: number;
  /** A crewmate's progress into his place at the start and end of the step (see `SF_ROOM`). */
  room: [number, number];
}

/**
 * The strike's timeline when the effect starts `at` frames in: the ready stance (longer if there is time, as when a timing ring is closing), the dip (3), the stand-up (1 + 2), the overhead held
 * 3 frames, then the swing: smear A (2), mid (2), smear B (1), swing B (2: the blade lands on its first, the effect starts on its second), the blow (the fade, then the held follow-through)
 * and the way home. The dash runs at about one seventh of the way per frame from smear A to the contact (0.10, 0.24, 0.38, 0.52, 0.66, 0.82, 1.0).
 */
export function sfTimeline(at0: number): SfStep[] {
  const at = Math.round(at0);
  const lift = SF_DIP + SF_RISEA + SF_RISE + SF_UP;
  const pre = Math.max(lift, at - SF_LEAD);
  // Any extra time (a timing ring closing) is spent in the READY stance, whose idle loop keeps breathing, not in a frozen overhead.
  const ready = pre - lift;
  return [
    { key: 'ready', frames: ready, from: 0, to: 0, room: [0, 0] },
    { key: 'dip', frames: SF_DIP, from: 0, to: -0.03, room: [0.1, 0.45] },
    { key: 'riseA', frames: SF_RISEA, from: -0.035, to: -0.035, room: [0.6, 0.6] },
    { key: 'rise', frames: SF_RISE, from: -0.04, to: -0.045, room: [0.75, 0.9] },
    { key: 'windup', frames: SF_UP, from: -0.05, to: -0.05, room: [1, 1] },
    { key: 'smearA', frames: SF_SMEAR, from: 0.1, to: 0.24, room: [1, 1] },
    { key: 'mid', frames: SF_MID, from: 0.38, to: 0.52, room: [1, 1] },
    { key: 'smearB', frames: SF_SMEARB, from: 0.66, to: 0.66, room: [1, 1] },
    { key: 'swingB', frames: SF_SWING, from: 0.82, to: 1, room: [1, 1] },
    { key: 'followFade', frames: SF_FADE, from: 1, to: 1, room: [1, 1] },
    { key: 'follow', frames: SF_HOLD, from: 1, to: 1, room: [1, 1] },
    { key: 'recover', frames: SF_RECOVER, from: 1, to: 0.65, room: [1, 1] },
    { key: 'ready', frames: SF_RETURN - SF_RECOVER - SF_COME_DOWN, from: 0.6, to: 0.2, room: [1, 1] },
    { key: 'ready', frames: SF_COME_DOWN, from: 0.15, to: 0, room: [1, 0] },
  ];
}
export const sfLength = (at: number): number => sfTimeline(at).reduce((n, s) => n + s.frames, 0);

export interface SfBeat {
  key: SfKey;
  step: number;
  lunge: number;
  /** A crewmate's progress into his place (0 to 1; see `SF_ROOM`). */
  room: number;
  /** Frames into the step. */
  t: number;
  /** The swipe frames: a body in motion (a ghost trails it). */
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
      const lunge = s.from + (s.to - s.from) * u;
      const room = s.room[0] + (s.room[1] - s.room[0]) * u;
      const swing = s.key === 'smearA' || s.key === 'mid' || s.key === 'smearB' || s.key === 'swingB';
      return { key: s.key, step: i, lunge, room, t: Math.min(t, s.frames - 1), dash: swing, contact: s.key === 'swingB' || s.key === 'followFade' || s.key === 'follow' };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, room: 0, t: 0, dash: false, contact: false };
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
  /** Where the hands are in each frame that has a swipe, on the finished canvas, for the notes and the tests. */
  pivots: Partial<Record<SfKey, [number, number]>>;
  /** The rows above the soles the tallest frame reaches (the name plate's clearance is checked against it). */
  topRows: number;
}

/**
 * Lay every frame on one canvas size, axis at the centre column and soles on the bottom row. `idle` is the colour-cleaned idle loop (its feet midpoint
 * defines the axis, as `anchored` in sfcrew.ts does), `s1`, `s2` and `crouch` the strike frames and his low crouch.
 */
export function buildSfStrike(idle: Raw[], s1: Raw, s2: Raw, crouch: Raw): SfBuild {
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
  sampleSteel(s2, s1);
  const pw = place(A.windup.frontBoot, A.windup.soles);
  const pf = place(A.follow.frontBoot, A.follow.soles);
  const pi = place(A.idle.frontBoot, A.idle.soles);
  const pc = place(A.crouch.frontBoot, A.crouch.soles);
  const pivots: Partial<Record<SfKey, [number, number]>> = {};

  const i0 = idle[0] as Raw;
  layers.ready = mk();
  blit(layers.ready, i0, pi.dx, pi.dy);
  layers.recover = mk();
  blit(layers.recover, bend(i0, SF_POSES.recover).raw, pi.dx - BEND_PAD, pi.dy);
  layers.dip = mk();
  blit(layers.dip, crouch, pc.dx, pc.dy);
  for (const k of ['riseA', 'rise'] as const) {
    layers[k] = mk();
    blit(layers[k], bend(s1, SF_POSES[k]).raw, pw.dx - BEND_PAD, pw.dy);
  }
  layers.windup = mk();
  blit(layers.windup, s1, pw.dx, pw.dy);

  // The swipes: behind the body, about the hands where each frame has them. The two swing frames of the wind-up body have their sword cut out (the drawn blade is the sword).
  const { body } = splitSword(s1);
  const lowA = bend(body, SF_POSES.lowA);
  const mid = bend(body, SF_POSES.mid);
  const handOf = (b: { at: (x: number, y: number) => [number, number] }, d: { dx: number; dy: number }): [number, number] => {
    const [x, y] = b.at(A.windup.pivot[0], A.windup.pivot[1]);
    return [x + d.dx - BEND_PAD, y + d.dy];
  };
  const hands = {
    lowA: handOf(lowA, pw),
    mid: handOf(mid, pw),
    follow: [A.follow.pivot[0] + pf.dx, A.follow.pivot[1] + pf.dy] as [number, number],
  };
  for (const k of ['smearA', 'mid', 'smearB', 'swingB', 'followFade', 'follow'] as const) layers[k] = mk();
  for (const k of ['smearA', 'mid', 'smearB', 'swingB', 'followFade'] as const) {
    const sw = SF_SWIPES[k];
    const [hx, hy] = hands[sw.hand];
    drawSwipe(layers[k], hx, hy, sw);
    pivots[k] = [hx - HALF, hy - H0];
  }
  blit(layers.smearA, lowA.raw, pw.dx - BEND_PAD, pw.dy);
  blit(layers.mid, mid.raw, pw.dx - BEND_PAD, pw.dy);
  for (const k of ['smearB', 'swingB', 'followFade', 'follow'] as const) blit(layers[k], s2, pf.dx, pf.dy);

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
  return { frames, axis: half, measured: { tipDx: tipX, tipUp: A.follow.soles - A.follow.tip[1], footDx: Math.round(off) }, pivots, topRows: H0 - top };
}
