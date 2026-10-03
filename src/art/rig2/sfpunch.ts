/**
 * Kit's punch combo from Mark's own Sprite Fusion frames (spike `spike/side-battle`, item H-sf-kit-punch). DOM-free, like `sfstrike.ts`, whose pixel helpers it shares: the data
 * (anchors, smears, timeline, measured reach), the pixel work on plain RGBA arrays and `buildSfPunch`; `sfcrew.ts` turns the result into canvases. A pose is a row of data.
 *
 * Mark's frames (64x64 each, all facing right, none mirrored) and what each one IS, worked out from the images, not from his names (he numbers them):
 *   - ready:  her battle idle loop (`kit-battle-idle`, 8 frames), the guard: fists up, lead hand forward.
 *   - load:   `kit-battle-punch1`. Both fists up by the face, the body turned in and coiled, the rear shoulder drawn back: the LOAD (the chamber of the jab).
 *   - jab:    `kit-battle-punch2`. The lead arm out at head height (a long thin line), the other fist guarding the chest, a wide stance: the JAB.
 *   - cross:  `kit-battle-punch3`. The arm fully out, the shoulders square to us (the other arm hidden behind the body), the hips turned, the ponytail trailing: the CROSS.
 *   - kick:   `kit-battle-kick`. A side kick at head height off the rear leg, body leaning back: the finisher.
 *   - run:    `kit-battle-running`, for a long way to the target (a far enemy): a short run in, then the load.
 * Round 2 adds: `crouched` for a short target (two low blows), `kickC`/`kickD` (the kick's shin bent about the knee in code: the chamber and the foot coming back down), the load frame reused as the coil
 * between blows, and smears drawn BEHIND the arm. Every body frame is Mark's pixels; the only edits are one stray magenta pixel dropped from the kick, the bent shin of `kickC`/`kickD` and the smears (data below).
 *
 * ANCHORS. Every frame is laid on one canvas size with the slot's axis (the idle's feet midpoint) at the centre column and the soles on the bottom row. The load, jab and cross are placed by their
 * FRONT BOOT (the foot that stays planted through the combo), put at the idle's front boot x. The kick stands on the load's BACK foot (the back leg stays down while the front one comes up), so the chamber
 * flows into it; its toe is then `toeShort` world px short of the fists' column, which the kick's push makes up. The crouch is placed by its fist. Mark drew the jab and the cross with the fist 18.5 px
 * past the front boot, so by construction they land at one distance.
 */
import { boxOf, type Raw } from './sfgeom';
import { blank, blit, drawSwipe, frontBoot, put, rightmost, soles, type Ramp, type SfSwipe } from './sfstrike';

export type PunchKey = 'ready' | 'run' | 'load' | 'jabS' | 'jabT' | 'jab' | 'crossS' | 'crossT' | 'cross' | 'kickC' | 'kickD' | 'kickS' | 'kickT' | 'kick' | 'lowS' | 'lowT' | 'low';
export const PUNCH_KEYS: readonly PunchKey[] = ['ready', 'run', 'load', 'jabS', 'jabT', 'jab', 'crossS', 'crossT', 'cross', 'kickC', 'kickD', 'kickS', 'kickT', 'kick', 'lowS', 'lowT', 'low'];

/**
 * What was measured on Mark's PNGs (tests/sfpunch.test.ts re-measures them and fails if he regenerates a frame): the front boot's centre column (a pixel's left edge is its index),
 * the soles' row, and the blow's tip: the rightmost opaque pixel's column and the row of the fist (the mean row of the pixels within two columns of the tip).
 * The kick's `plant` is its standing foot's centre column (it has no front boot); `load.rearBoot` is the load's back foot, the one the kick stands on. `low` is the crouch, placed by its fist (the reaching hand; its front boot is a column further right).
 */
export const PUNCH_ANCHORS = {
  idle: { frontBoot: 42, soles: 62 },
  load: { src: 'kit-battle-punch1', frontBoot: 44, rearBoot: 18.5, soles: 62 },
  jab: { src: 'kit-battle-punch2', frontBoot: 38.5, soles: 62, tip: [56, 22] },
  cross: { src: 'kit-battle-punch3', frontBoot: 39.5, soles: 61, tip: [57, 23] },
  kick: { src: 'kit-battle-kick', plant: 26, soles: 63, tip: [61, 17], knee: [46.5, 20.5], cut: 47, hairTop: 13 },
  low: { src: 'kit-battle-crouched', soles: 57, tip: [53, 31] },
  run: { src: 'kit-battle-running', soles: 60 },
} as const;

// ------------------------------------------------------------------------------------------------ smears

/**
 * A streak on a punch: the arm drawn as a motion blur from `x0` (trailing, a point) to `x1` (leading, `w` rows thick), in three solid bands (a 1-2 row hot core, gold, an orange rim), at row `y`.
 * Coordinates are in the source frame's pixels. It is drawn BEHIND the body, so the arm and the wrapped fist stay on top of it (round 1 drew it over the arm and the arm vanished for a frame).
 */
export interface PunchStreak {
  kind: 'streak';
  src: 'jab' | 'cross' | 'low';
  x0: number;
  x1: number;
  y: number;
  w: number;
}
/** A kick's arc: the foot's path about the hip, a crescent in the same three bands (the swipe code Rook's blade uses), behind the body. */
export interface PunchArc {
  kind: 'arc';
  src: 'kick';
  hip: [number, number];
  swipe: SfSwipe;
}
export const PUNCH_SMEARS: Record<'jabS' | 'jabT' | 'crossS' | 'crossT' | 'kickS' | 'kickT' | 'lowS' | 'lowT', PunchStreak | PunchArc> = {
  // The jab's arm is thin (rows 20 to 24) from the shoulder (x 36); the streak starts at the elbow (x 41) and fans out to the wraps (x 51 to 52), so it shows as a halo above and below the arm.
  jabS: { kind: 'streak', src: 'jab', x0: 37, x1: 55, y: 22, w: 15 },
  jabT: { kind: 'streak', src: 'jab', x0: 43, x1: 56, y: 22, w: 10 },
  // The cross is square-on: the sleeve is wider (rows 19 to 26) and the arm runs from x 41.
  crossS: { kind: 'streak', src: 'cross', x0: 36, x1: 56, y: 23, w: 17 },
  crossT: { kind: 'streak', src: 'cross', x0: 44, x1: 57, y: 23, w: 11 },
  // The hip is at about (24, 31) and the toe at (61, 17), 40 px along the leg at -21 degrees; the foot swings up from below, and the crescent is the toe's path, hugging the leg's underside.
  kickS: { kind: 'arc', src: 'kick', hip: [24, 31], swipe: { hand: 'follow', a0: 34, a1: -18, rx: 38, ry: 36, edge: 16, blade: 0 } },
  kickT: { kind: 'arc', src: 'kick', hip: [24, 31], swipe: { hand: 'follow', a0: 10, a1: -18, rx: 38, ry: 36, edge: 10, blade: 0 } },
  // The crouch's reaching arm is at rows 28 to 34, from the shoulder (x 42) to the fist (x 52 to 53).
  lowS: { kind: 'streak', src: 'low', x0: 33, x1: 53, y: 31, w: 14 },
  lowT: { kind: 'streak', src: 'low', x0: 41, x1: 54, y: 31, w: 9 },
};

/** Kit's smear palette, built from her own jacket (its gold trim and orange body): core near white, a gold body, an orange rim. */
export function jacketRamp(r: Raw): Ramp {
  const trim: { l: number; c: number[] }[] = [];
  const body: { l: number; c: number[] }[] = [];
  for (let i = 0; i < r.px.length; i += 4) {
    if ((r.px[i + 3] ?? 0) === 0) continue;
    const c = [r.px[i] ?? 0, r.px[i + 1] ?? 0, r.px[i + 2] ?? 0];
    const l = 0.3 * (c[0] ?? 0) + 0.59 * (c[1] ?? 0) + 0.11 * (c[2] ?? 0);
    if ((c[0] ?? 0) > 215 && (c[1] ?? 0) > 150 && (c[2] ?? 0) < 110) trim.push({ l, c });
    else if ((c[0] ?? 0) > 190 && (c[1] ?? 0) > 60 && (c[1] ?? 0) < 130 && (c[2] ?? 0) < 90) body.push({ l, c });
  }
  const pick = (a: { l: number; c: number[] }[], q: number, d: number[]): number[] => (a.length >= 4 ? (a.sort((p, s) => p.l - s.l)[Math.floor(a.length * q)] as { c: number[] }).c : d);
  const gold = pick(trim, 0.6, [255, 196, 64]);
  const orange = pick(body, 0.5, [226, 98, 40]);
  const mixW = (c: number[], t: number): number[] => c.map((v) => Math.round(v + (255 - v) * t));
  return { white: mixW(gold, 0.75), light: gold, steel: orange, outline: [40, 14, 22], gold };
}

/** A streak (see `PunchStreak`) drawn onto `dst`, the frame at offset (dx, dy), in three solid bands (a core about 2 rows thick at most), no dither and no soft alpha. */
export function drawStreak(dst: Raw, sm: PunchStreak, dx: number, dy: number, ramp: Ramp): void {
  for (let x = sm.x0; x <= sm.x1; x++) {
    const u = (x - sm.x0) / (sm.x1 - sm.x0);
    const hw = (sm.w / 2) * Math.max(0.12, u ** 0.9);
    for (let y = Math.ceil(sm.y - hw - 0.5); y <= Math.floor(sm.y + hw - 0.5); y++) {
      const d = Math.abs(y + 0.5 - sm.y);
      put(dst, x + dx, y + dy, d < 1 ? ramp.white : d / hw < 0.7 ? ramp.light : ramp.steel);
    }
  }
}

// ------------------------------------------------------------------------------------------------ measuring

/** The fist's (or toe's) row: the mean row of the opaque pixels within two columns of the rightmost one. */
export function tipOf(r: Raw): [number, number] {
  const [tx] = rightmost(r);
  let n = 0, sum = 0;
  for (let y = 0; y < r.h; y++) for (let x = tx - 2; x <= tx; x++) if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) { n++; sum += y; }
  return [tx, Math.round(sum / Math.max(1, n))];
}
/** The standing foot of a frame with one foot down: the centre column of the lowest eight rows. */
export function plantOf(r: Raw): number {
  const b = boxOf(r);
  let x0 = r.w, x1 = -1;
  for (let y = Math.max(0, b.y1 - 7); y <= b.y1; y++) for (let x = 0; x < r.w; x++) if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  return (x0 + x1 + 1) / 2;
}

/** A stray pixel of the background removal (Mark's kick has one magenta pixel at the hair's edge): fully saturated purple no part of the crew is. Applied when the PNGs load (`sfcrew.ts`), before the colour clean-up would fold it into a hair shade. */
export function dropStrays(r: Raw): Raw {
  const px = new Uint8ClampedArray(r.px);
  for (let i = 0; i < px.length; i += 4)
    if ((px[i + 3] ?? 0) > 0 && (px[i] ?? 0) > 100 && (px[i + 2] ?? 0) > 100 && (px[i + 1] ?? 0) < 20) px[i + 3] = 0;
  return { w: r.w, h: r.h, px };
}

/**
 * A kick frame with its shin bent about the knee: every pixel of `src` from column `cut` on (and below row `top`, so the hair that trails past the knee stays) is turned `deg` degrees clockwise
 * (the foot swings down) about `knee`, sampled nearest-neighbour from the original, so no new colour appears; the thigh, the body and the standing leg are Mark's pixels untouched. The chamber
 * (the shin hanging, `kickC`) and the foot dropping or rising (`kickD`) are this at two angles: the in-between frames his Sprite Fusion edit would draw (see the shopping list).
 */
export function bendLeg(src: Raw, knee: readonly [number, number], cut: number, deg: number, top: number): Raw {
  const out = blank(src.w + 14, src.h + 14);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= src.w || y >= src.h ? 0 : (src.px[(y * src.w + x) * 4 + 3] ?? 0));
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++)
      if (at(x, y) > 0 && (x < cut || y < top)) put(out, x, y, [src.px[(y * src.w + x) * 4] ?? 0, src.px[(y * src.w + x) * 4 + 1] ?? 0, src.px[(y * src.w + x) * 4 + 2] ?? 0]);
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const dx = x + 0.5 - knee[0], dy = y + 0.5 - knee[1];
      const ix = Math.floor(dx * c + dy * s + knee[0]), iy = Math.floor(-dx * s + dy * c + knee[1]);
      if (ix >= cut && iy >= top && at(ix, iy) > 0) put(out, x, y, [src.px[(iy * src.w + ix) * 4] ?? 0, src.px[(iy * src.w + ix) * 4 + 1] ?? 0, src.px[(iy * src.w + ix) * 4 + 2] ?? 0]);
    }
  return out;
}

// ------------------------------------------------------------------------------------------------ the timeline

/** Pose-frame length in ms: the effect clock runs 0.65 frames per 60 Hz tick (`FX_PACE` in scenes/battle.ts). */
export const PUNCH_FRAME_MS = 1000 / 60 / 0.65;
/**
 * Frames each step holds (round 2). `smear` is the streak frame before a blow, `trail` the first frame of the blow (a short streak lingers on it), `coil` the load frame between the jab and the cross
 * (the arm comes back), `chamber` the load frame between the cross and the kick (the arm comes back, the weight goes onto the back foot), `lift` the kick frame with the shin hanging (the knee comes up),
 * `drop` the foot coming back down after the kick and `settle` the load frame after the last blow.
 */
export const PUNCH = { load: 2, smear: 2, trail: 1, jab: 2, coil: 2, cross: 2, chamber: 1, lift: 2, hold: 10, low: 2, drop: 1, settle: 1, back: 8 } as const;
/** Whether the kick follows the cross as a third blow (it does when `PUNCH_FINISHER`: see the pose log). */
export const PUNCH_FINISHER = true;
/** A reach (world px) over this needs a run in; under it she steps in during the load. */
export const PUNCH_RUN_MIN = 14;
/** The blow's own effect lasts this many frames to its flash (`punch_r` in battle/fx.ts): what the script waits after playing it. */
export const PUNCH_IMPACT = 2;
/** A target under this many world px tall is hit low (the crouch): the standing frames' fists pass over its back. */
export const PUNCH_LOW_BELOW = 22;

/** One blow of the combo: which it is (for its spark size and height). */
export type PunchBlow = 'jab' | 'cross' | 'kick' | 'low' | 'low2';
export interface PunchHit {
  key: PunchBlow;
  /** The pose frames after the first blow that it lands on. */
  at: number;
}

/** What a step is, before the lead is added: the frame, its length, the lunge and the forward shove (world px) at its start and end, and whether it carries a blow. */
interface Tpl {
  key: PunchKey;
  frames: number;
  from: number;
  to: number;
  push: [number, number];
  blow?: PunchBlow;
  contact?: boolean;
  dash?: boolean;
}
/**
 * How far (world px) her sprite goes on forward of the lunge as each blow lands, a shove that grows with the combo (jab light, cross medium, kick heavy). The planted foot stays planted in
 * the frames themselves; these are small enough to read as weight behind the blow, not as a slide.
 */
export const PUNCH_PUSH = { jab: 0.5, cross: 1.2 } as const;
/** The shin's angle (degrees) in the kick's chamber (`lift`: the knee up, the shin hanging) and as the foot drops back or rises (`drop`). */
export const PUNCH_BEND = { lift: 45, drop: 22 } as const;
/** The kick's toe stops this many world px short of where the fists end (the stand-off: her body is further from the target for the kick than for the blows). */
export const PUNCH_KICK_SHORT = 1;

function combo(low: boolean, finisher: boolean): Tpl[] {
  const P = PUNCH, S = PUNCH_PUSH;
  if (low) {
    // The crouch for a short target: a dive onto one knee with the reaching hand, twice. The frame is placed by its fist, so the dive covers a few px (the ghost hides it).
    return [
      { key: 'load', frames: P.load, from: 0.1, to: 0.9, push: [-3, -3] },
      { key: 'lowS', frames: P.smear, from: 0.94, to: 0.94, push: [-3, -1], dash: true },
      { key: 'lowT', frames: P.trail, from: 0.94, to: 0.94, push: [-1, S.jab], blow: 'low', contact: true },
      { key: 'low', frames: P.low, from: 0.94, to: 0.96, push: [S.jab, S.jab], contact: true },
      { key: 'lowT', frames: P.trail, from: 0.96, to: 0.97, push: [S.jab, S.cross], blow: 'low2', contact: true },
      { key: 'low', frames: P.hold, from: 0.97, to: 0.98, push: [S.cross, S.cross], contact: true },
      { key: 'load', frames: P.settle, from: 0.95, to: 0.9, push: [0, 0] },
      { key: 'ready', frames: P.back, from: 0.8, to: 0, push: [0, 0] },
    ];
  }
  const kickPush = PUNCH_MEASURED.toeShort - PUNCH_KICK_SHORT;
  const mid = S.cross + (kickPush - S.cross) * 0.5;
  const mid2 = S.cross + (kickPush - S.cross) * 0.8;
  const steps: Tpl[] = [
    { key: 'load', frames: P.load, from: 0.1, to: 0.92, push: [0, 0] },
    { key: 'jabS', frames: P.smear, from: 0.94, to: 0.94, push: [0, S.jab], dash: true },
    { key: 'jabT', frames: P.trail, from: 0.94, to: 0.94, push: [S.jab, S.jab], blow: 'jab', contact: true },
    { key: 'jab', frames: P.jab, from: 0.94, to: 0.96, push: [S.jab, S.jab], contact: true },
    { key: 'load', frames: P.coil, from: 0.95, to: 0.95, push: [S.jab, 0] },
    { key: 'crossS', frames: P.smear, from: 0.97, to: 0.97, push: [0, S.cross * 0.7], dash: true },
    { key: 'crossT', frames: P.trail, from: 0.98, to: 0.98, push: [S.cross * 0.7, S.cross], blow: 'cross', contact: true },
    { key: 'cross', frames: finisher ? P.cross : P.hold, from: 0.98, to: 1, push: [S.cross, S.cross], contact: true },
  ];
  if (finisher) {
    steps.push(
      { key: 'load', frames: P.chamber, from: 1, to: 1, push: [S.cross, mid] },
      { key: 'kickC', frames: P.lift, from: 1, to: 1, push: [mid, mid2] },
      { key: 'kickS', frames: P.smear, from: 1, to: 1, push: [mid2, kickPush], dash: true },
      { key: 'kickT', frames: P.trail, from: 1, to: 1, push: [kickPush, kickPush], blow: 'kick', contact: true },
      { key: 'kick', frames: P.hold, from: 1, to: 1, push: [kickPush, kickPush], contact: true },
      { key: 'kickD', frames: P.drop, from: 1, to: 1, push: [kickPush, mid2] },
      { key: 'kickC', frames: P.drop, from: 1, to: 1, push: [mid2, mid] },
      { key: 'load', frames: P.settle, from: 1, to: 0.9, push: [mid, 1] },
    );
  } else steps.push({ key: 'load', frames: P.settle, from: 1, to: 0.9, push: [S.cross, 1] });
  steps.push({ key: 'ready', frames: P.back, from: 0.8, to: 0, push: [1, 0] });
  return steps;
}

/** The blows, in order, and the pose frames after the first blow each lands on. */
export function punchHits(finisher = PUNCH_FINISHER, low = false): PunchHit[] {
  const out: PunchHit[] = [];
  let t = 0;
  let first = -1;
  for (const s of combo(low, finisher)) {
    if (s.blow) {
      if (first < 0) first = t;
      out.push({ key: s.blow, at: t - first });
    }
    t += s.frames;
  }
  return out;
}
/** Frames of the run in for a reach (world px): none for a short one, up to eight for the far enemy (about 10 world px a frame, 1.5 times the walk-in's run). */
export const runFrames = (reach: number): number => (reach > PUNCH_RUN_MIN ? Math.min(8, Math.max(3, Math.round(reach / 10))) : 0);
/** Pose frames inside the combo before the first blow: the load and the first smear. */
function before(low: boolean): number {
  let t = 0;
  for (const s of combo(low, PUNCH_FINISHER)) {
    if (s.blow) return t;
    t += s.frames;
  }
  return t;
}
/** Frames from the order to the first blow when nothing (a timing ring) stretches it: the run, the load and the first smear. */
export const punchLead = (reach: number, low = false): number => runFrames(reach) + before(low);
/** What `playback.ts` asks for as the pose's lead: a short guard stance, then the combo. */
export const punchWindup = (reach: number, low = false): number => punchLead(reach, low) + 2;

export interface PunchStep {
  key: PunchKey;
  frames: number;
  /** How far along the lunge the body is at the start and end of the step (0 in its place, 1 at the target). */
  from: number;
  to: number;
  /** The forward shove (world px, on top of the lunge) at the start and end of the step. */
  push: [number, number];
  /** The blow this step carries on its first frame (an index of `punchHits`), if any. */
  blow?: number;
  contact: boolean;
  dash: boolean;
}

/**
 * The combo's timeline when the first blow lands `at` frames in (and the target is `reach` world px away): the guard (longer if there is time, as when a timing ring is closing), the run (a
 * far target only), then the combo (`combo()`: load, the jab's smear and the jab, the load again as the arm comes back, the cross's smear and the cross, the load as the chamber, the kick's
 * smear and the kick held through the damage and the hitstop, the load as the settle) and the slide home. `low` is the crouch for a short target (two low blows, no kick).
 */
export function punchTimeline(at0: number, reach: number, low = false, finisher = PUNCH_FINISHER): PunchStep[] {
  const at = Math.round(at0);
  const run = runFrames(reach);
  const lead = punchLead(reach, low);
  const steps: PunchStep[] = [{ key: 'ready', frames: Math.max(0, at - lead), from: 0, to: 0, push: [0, 0], contact: false, dash: false }];
  if (run > 0) steps.push({ key: 'run', frames: run, from: 0, to: 0.86, push: [0, 0], contact: false, dash: true });
  let blows = 0;
  for (const [i, c] of combo(low, finisher).entries()) {
    const st: PunchStep = { key: c.key, frames: c.frames, from: i === 0 && run > 0 ? 0.86 : c.from, to: c.to, push: c.push, contact: !!c.contact, dash: !!c.dash };
    if (c.blow) st.blow = blows++;
    steps.push(st);
  }
  return steps;
}
export const punchLength = (at: number, reach: number, low = false): number => punchTimeline(at, reach, low).reduce((n, s) => n + s.frames, 0);

export interface PunchBeat {
  key: PunchKey;
  step: number;
  lunge: number;
  /** The forward shove (world px) on top of the lunge. */
  push: number;
  /** Frames into the step. */
  t: number;
  /** A body in motion (a run, a smear): a ghost trails it. */
  dash: boolean;
  /** A blow is on the target (a held jab, cross or kick). */
  contact: boolean;
  /** The blow (an index of `punchHits`) that lands on exactly this frame, else -1. */
  hit: number;
}

/**
 * The beat `k` frames into the pose (past the end: the last frame). `stop` is a combo called off at pose frame `stop` (a miss: the first blow was thrown and nothing more): from there the
 * body takes the settle (the load) and goes home, with no more blows.
 */
export function punchBeat(k: number, at: number, reach: number, low = false, stop?: number): PunchBeat {
  if (stop !== undefined && k > stop) {
    const b = punchBeat(stop, at, reach, low);
    const j = k - stop;
    if (j < PUNCH.settle) return { key: 'load', step: b.step, lunge: b.lunge, push: b.push * (1 - j / PUNCH.settle), t: j, dash: false, contact: false, hit: -1 };
    const u = Math.min(1, (j - PUNCH.settle) / PUNCH.back);
    return { key: 'ready', step: b.step, lunge: Math.min(b.lunge, 0.9) * (1 - u), push: 0, t: j, dash: false, contact: false, hit: -1 };
  }
  const tl = punchTimeline(at, reach, low);
  let t = k;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i] as PunchStep;
    if (t < s.frames || i === tl.length - 1) {
      const u = s.frames > 1 ? Math.max(0, Math.min(1, t / (s.frames - 1))) : 1;
      const lunge = s.from + (s.to - s.from) * u;
      const push = s.push[0] + (s.push[1] - s.push[0]) * u;
      // A blow lands on the first frame of its step (`t` under one: a fractional clock stays on that frame until the next).
      const hit = s.blow !== undefined && t < 1 ? s.blow : -1;
      return { key: s.key, step: i, lunge, push, t: Math.min(t, s.frames - 1), dash: s.dash, contact: s.contact, hit };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, push: 0, t: 0, dash: false, contact: false, hit: -1 };
}

/**
 * What the built frames measured (filled in by `buildSfPunch`, so a retuned anchor retunes the stop): in art pixels (one per screen pixel, two per battle-world pixel) how far the tip of
 * every blow is in front of the member's axis (the same for the jab, the cross, the kick and the low blow), and how high above the soles each is, and how far the planted front boot is.
 * `toeShort` is how many world px the kick's toe is short of the fists' column when the kick stands on the load's back foot (the kick's push makes most of it up).
 */
export const PUNCH_MEASURED = { tipDx: 30, up: { jab: 40, cross: 38, kick: 46, low: 25 }, footDx: 11, toeShort: 4 };
/** How far (world px) the blow's tip goes past the target's body front: the fist presses into the body, so it reads as a hit, not a touch in front of it. */
export const PUNCH_PIERCE = 1;
/** How far past the fist (world px, into the body) the spark and the GPU hit are drawn, so the fist stays visible at contact. */
export const PUNCH_SPARK_PAST = 2;
/** Frames of `SF_KNOCK` the target's recoil plays after a blow that is not the last (a later slice of the table is a gentler shove): the jab a light push, the cross a firmer one. */
export const PUNCH_KNOCK = { jab: 6, cross: 9 } as const;
/** The row of the blow on a target, as a share of its height above its soles, at most (a short target is hit over its head otherwise). */
export const PUNCH_HIT_MAX = 0.88;

// ------------------------------------------------------------------------------------------------ building

export interface PunchBuild {
  frames: Record<PunchKey, Raw>;
  /** The canvas's centre column is the axis; its bottom row the soles. */
  axis: number;
  measured: typeof PUNCH_MEASURED;
  /** The rows above the soles the tallest frame reaches. */
  topRows: number;
}

/**
 * Lay every frame on one canvas size, axis at the centre column and soles on the bottom row. `idle` is the colour-cleaned idle loop (its feet midpoint defines the axis, as `anchored` in
 * sfcrew.ts does); `run`, `load`, `jab`, `cross`, `kick` and `low` (the crouch) are Mark's frames, colour-cleaned with it.
 *
 * Anchors: the load, the jab and the cross are placed by their FRONT boot (planted through the combo). The kick stands on the load's BACK foot (it is the back leg that stays down while the
 * front one comes up), so the chamber (the load) flows into it with no pop; that leaves its toe about 4 world px short of the fists' column, which the kick's push mostly makes up. The crouch
 * has no boot to plant (it is a dive), so it is placed by its fist, on the fists' column.
 */
export function buildSfPunch(idle: Raw[], run: Raw, load: Raw, jab: Raw, cross: Raw, kick: Raw, low: Raw): PunchBuild {
  const boxes = idle.map(boxOf);
  const ax = Math.round(boxes.reduce((n, b) => n + b.feet, 0) / boxes.length);
  const idleFront = idle.reduce((n, r) => n + frontBoot(r), 0) / idle.length;
  const off = idleFront - ax;
  const HALF = 150, H0 = 160;
  const mk = (): Raw => blank(HALF * 2, H0);
  const A = PUNCH_ANCHORS;
  /** Where a source frame's origin lands on the scratch canvas, from its anchor column and its soles row. */
  const place = (col: number, sl: number): { dx: number; dy: number } => ({ dx: Math.round(HALF + off - col), dy: H0 - 1 - sl });
  const layers = {} as Record<PunchKey, Raw>;
  for (const k of PUNCH_KEYS) layers[k] = mk();
  const pi = place(A.idle.frontBoot, A.idle.soles);
  blit(layers.ready, idle[0] as Raw, pi.dx, pi.dy);
  const pl = place(A.load.frontBoot, A.load.soles);
  blit(layers.load, load, pl.dx, pl.dy);
  const pj = place(A.jab.frontBoot, A.jab.soles);
  const pc = place(A.cross.frontBoot, A.cross.soles);
  // The jab's and the cross's fists are 18.5 px past their front boots, so they land at the same column.
  const tipCol = A.jab.tip[0] + 1 + pj.dx;
  // The kick stands on the load's back foot.
  const pk = { dx: Math.round(pl.dx + A.load.rearBoot - A.kick.plant), dy: H0 - 1 - A.kick.soles };
  const toeCol = A.kick.tip[0] + 1 + pk.dx;
  // The crouch is placed by its fist.
  const pw = { dx: tipCol - (A.low.tip[0] + 1), dy: H0 - 1 - A.low.soles };
  const pr = { dx: Math.round(HALF - boxOf(run).feet), dy: H0 - 1 - soles(run) };
  blit(layers.run, run, pr.dx, pr.dy);
  const ramp = jacketRamp(jab);
  blit(layers.jab, jab, pj.dx, pj.dy);
  blit(layers.cross, cross, pc.dx, pc.dy);
  blit(layers.kick, kick, pk.dx, pk.dy);
  blit(layers.kickC, bendLeg(kick, A.kick.knee, A.kick.cut, PUNCH_BEND.lift, A.kick.hairTop), pk.dx, pk.dy);
  blit(layers.kickD, bendLeg(kick, A.kick.knee, A.kick.cut, PUNCH_BEND.drop, A.kick.hairTop), pk.dx, pk.dy);
  blit(layers.low, low, pw.dx, pw.dy);
  // The smears: a streak BEHIND the arm (drawn first, the body over it, so the wrapped fist stays on top) or the kick's arc behind the leg. S is the full smear, T the short trail that
  // lingers on the first frame of the blow.
  const bodies = { jab: [jab, pj], cross: [cross, pc], kick: [kick, pk], low: [low, pw] } as const;
  for (const k of ['jabS', 'jabT', 'crossS', 'crossT', 'kickS', 'kickT', 'lowS', 'lowT'] as const) {
    const sm = PUNCH_SMEARS[k];
    const [src, p] = bodies[sm.src];
    if (sm.kind === 'streak') drawStreak(layers[k], sm, p.dx, p.dy, ramp);
    else drawSwipe(layers[k], sm.hip[0] + p.dx, sm.hip[1] + p.dy, sm.swipe, ramp);
    blit(layers[k], src, p.dx, p.dy);
  }
  // Crop to a common size: symmetric about the axis (the engine centres a canvas on the slot), top at the highest pixel, bottom on the soles.
  let left = HALF, right = HALF, top = H0;
  for (const k of PUNCH_KEYS) {
    const b = boxOf(layers[k]);
    left = Math.min(left, b.x0);
    right = Math.max(right, b.x1 + 1);
    top = Math.min(top, b.y0);
  }
  const half = Math.max(HALF - left, right - HALF);
  const frames = {} as Record<PunchKey, Raw>;
  for (const k of PUNCH_KEYS) {
    const out = blank(half * 2, H0 - top);
    const l = layers[k];
    for (let y = top; y < H0; y++) out.px.set(l.px.subarray((y * l.w + (HALF - half)) * 4, (y * l.w + (HALF + half)) * 4), (y - top) * out.w * 4);
    frames[k] = out;
  }
  const up = (sl: number, tipRow: number): number => sl - tipRow;
  const measured = {
    tipDx: tipCol - HALF,
    up: { jab: up(A.jab.soles, A.jab.tip[1]), cross: up(A.cross.soles, A.cross.tip[1]), kick: up(A.kick.soles, A.kick.tip[1]), low: up(A.low.soles, A.low.tip[1]) },
    footDx: Math.round(off),
    toeShort: (tipCol - toeCol) / 2,
  };
  return { frames, axis: half, measured, topRows: H0 - top };
}
