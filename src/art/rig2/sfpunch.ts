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
 * Every body frame is drawn as Mark drew it; the only edits are one stray magenta pixel dropped from the kick and the smears drawn over or behind the frames (data below).
 *
 * ANCHORS. Same idea as Rook's strike. Every frame is laid on one canvas size with the slot's axis (the idle's feet midpoint) at the centre column and the soles on the bottom row.
 * A punch is placed by its FRONT BOOT (the foot that stays planted through the combo: the heavier of the two boot-sized groups in the lowest eight rows, the right one), put at the
 * idle's front boot x, so the planted foot never slides and the rear foot and the shoulders move (the load coils, the cross lunges). The kick has no front boot (one foot is
 * off the ground): it is placed so its TOE ends on the same column as the jab's and the cross's fist (`tipDx`), because all three blows have to land on the same spot of the target.
 * Mark drew the jab and the cross with the fist 18.5 px past the front boot, so by construction they land at one distance.
 */
import { boxOf, type Raw } from './sfgeom';
import { blank, blit, drawSwipe, frontBoot, put, rightmost, soles, type Ramp, type SfSwipe } from './sfstrike';

export type PunchKey = 'ready' | 'run' | 'load' | 'jabS' | 'jab' | 'crossS' | 'cross' | 'kickS' | 'kick';
export const PUNCH_KEYS: readonly PunchKey[] = ['ready', 'run', 'load', 'jabS', 'jab', 'crossS', 'cross', 'kickS', 'kick'];

/**
 * What was measured on Mark's PNGs (tests/sfpunch.test.ts re-measures them and fails if he regenerates a frame): the front boot's centre column (a pixel's left edge is its index),
 * the soles' row, and the blow's tip: the rightmost opaque pixel's column and the row of the fist (the mean row of the pixels within two columns of the tip).
 * The kick's `plant` is its standing foot's centre column (it has no front boot).
 */
export const PUNCH_ANCHORS = {
  idle: { frontBoot: 42, soles: 62 },
  load: { src: 'kit-battle-punch1', frontBoot: 44, soles: 62 },
  jab: { src: 'kit-battle-punch2', frontBoot: 38.5, soles: 62, tip: [56, 22] },
  cross: { src: 'kit-battle-punch3', frontBoot: 39.5, soles: 61, tip: [57, 23] },
  kick: { src: 'kit-battle-kick', plant: 26, soles: 63, tip: [61, 17] },
  run: { src: 'kit-battle-running', soles: 60 },
} as const;

// ------------------------------------------------------------------------------------------------ smears

/**
 * A streak on a punch: the arm drawn as a motion blur from `x0` (trailing, a point) to `x1` (leading, `w` rows thick), in three solid bands (hot core, gold, orange rim), at row `y`.
 * Coordinates are in the source frame's pixels. `over` draws it over the body (the arm vanishes into it) instead of behind.
 */
export interface PunchStreak {
  kind: 'streak';
  src: 'jab' | 'cross';
  x0: number;
  x1: number;
  y: number;
  w: number;
  over: boolean;
}
/** A kick's arc: the foot's path about the hip, a crescent in the same three bands (the swipe code Rook's blade uses), behind the body. */
export interface PunchArc {
  kind: 'arc';
  src: 'kick';
  hip: [number, number];
  swipe: SfSwipe;
}
export const PUNCH_SMEARS: Record<'jabS' | 'crossS' | 'kickS', PunchStreak | PunchArc> = {
  // The arm runs from the shoulder (x 36) to the wraps (x 47 to 52) and the fist (52 to 56), rows 19 to 25.
  jabS: { kind: 'streak', src: 'jab', x0: 29, x1: 51, y: 21.5, w: 7, over: true },
  // The cross is square-on: the sleeve is wider (rows 19 to 26) and the arm runs from x 41.
  crossS: { kind: 'streak', src: 'cross', x0: 27, x1: 52, y: 22.5, w: 8, over: true },
  // The hip is at about (30, 30); the foot swings up from below the knee line to the toe at (61, 17).
  kickS: { kind: 'arc', src: 'kick', hip: [30, 30], swipe: { hand: 'follow', a0: 32, a1: -20, rx: 33, ry: 31, edge: 5, blade: 0 } },
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

/** A streak (see `PunchStreak`) drawn onto `dst`, the frame at offset (dx, dy), in three solid bands, no dither and no soft alpha. */
export function drawStreak(dst: Raw, sm: PunchStreak, dx: number, dy: number, ramp: Ramp): void {
  for (let x = sm.x0; x <= sm.x1; x++) {
    const u = (x - sm.x0) / (sm.x1 - sm.x0);
    const hw = (sm.w / 2) * Math.max(0.12, u ** 1.15);
    for (let y = Math.ceil(sm.y - hw - 0.5); y <= Math.floor(sm.y + hw - 0.5); y++) {
      const d = Math.abs(y + 0.5 - sm.y) / hw;
      put(dst, x + dx, y + dy, d < 0.42 ? ramp.white : d < 0.75 ? ramp.light : ramp.steel);
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

// ------------------------------------------------------------------------------------------------ the timeline

/** Pose-frame length in ms: the effect clock runs 0.65 frames per 60 Hz tick (`FX_PACE` in scenes/battle.ts). */
export const PUNCH_FRAME_MS = 1000 / 60 / 0.65;
/** Frames each step holds. The combo's blows land `PUNCH_HITS` frames after the first. */
export const PUNCH = { load: 3, jabS: 1, jab: 3, crossS: 1, cross: 3, kickS: 1, hold: 13, guard: 3, back: 8 } as const;
/** Whether the kick follows the cross as a third blow (it does when `PUNCH_FINISHER`: see the pose log). */
export const PUNCH_FINISHER = true;
/** A reach (world px) over this needs a run in; under it she steps in during the load. */
export const PUNCH_RUN_MIN = 14;
/** The blow's own effect lasts this many frames to its flash (`punch_r` in battle/fx.ts): what the script waits after playing it. */
export const PUNCH_IMPACT = 2;
/** The blows, in order, and the pose frames after the first blow each lands on. */
export function punchHits(finisher = PUNCH_FINISHER): { key: 'jab' | 'cross' | 'kick'; at: number }[] {
  const jab = 0;
  const cross = jab + PUNCH.jab + PUNCH.crossS;
  const kick = cross + PUNCH.cross + PUNCH.kickS;
  return finisher ? [{ key: 'jab', at: jab }, { key: 'cross', at: cross }, { key: 'kick', at: kick }] : [{ key: 'jab', at: jab }, { key: 'cross', at: cross }];
}
/** Frames of the run in for a reach (world px): none for a short one, up to eight for the far enemy (about 10 world px a frame, 1.5 times the walk-in's run). */
export const runFrames = (reach: number): number => (reach > PUNCH_RUN_MIN ? Math.min(8, Math.max(3, Math.round(reach / 10))) : 0);
/** Frames from the order to the first blow when nothing (a timing ring) stretches it: the run, the load and the jab's smear. */
export const punchLead = (reach: number): number => runFrames(reach) + PUNCH.load + PUNCH.jabS;
/** What `playback.ts` asks for as the pose's lead: a short guard stance, then the combo. */
export const punchWindup = (reach: number): number => punchLead(reach) + 2;

export interface PunchStep {
  key: PunchKey;
  frames: number;
  /** How far along the lunge the body is at the start and end of the step (0 in its place, 1 at the target). */
  from: number;
  to: number;
}

/**
 * The combo's timeline when the first blow lands `at` frames in (and the target is `reach` world px away): the guard (longer if there is time, as when a timing ring is closing), the run (a
 * far target only), the load, the jab's smear, the jab held (its first frame is the first blow), the cross's smear and hold, the kick's smear and hold (the last blow is held 13 frames
 * through the damage and the hitstop), the guard again, and the slide home. The lunge: she steps (or runs) in over the load, the jab lands at .94, the cross at .98 and the kick at 1.
 */
export function punchTimeline(at0: number, reach: number): PunchStep[] {
  const at = Math.round(at0);
  const run = runFrames(reach);
  const lead = punchLead(reach);
  const steps: PunchStep[] = [{ key: 'ready', frames: Math.max(0, at - lead), from: 0, to: 0 }];
  if (run > 0) steps.push({ key: 'run', frames: run, from: 0, to: 0.86 });
  steps.push({ key: 'load', frames: PUNCH.load, from: run > 0 ? 0.86 : 0.1, to: 0.92 });
  steps.push({ key: 'jabS', frames: PUNCH.jabS, from: 0.94, to: 0.94 });
  steps.push({ key: 'jab', frames: PUNCH.jab, from: 0.94, to: 0.96 });
  steps.push({ key: 'crossS', frames: PUNCH.crossS, from: 0.97, to: 0.97 });
  const last = PUNCH_FINISHER ? 'kick' : 'cross';
  steps.push({ key: 'cross', frames: last === 'cross' ? PUNCH.hold : PUNCH.cross, from: 0.98, to: 1 });
  if (PUNCH_FINISHER) {
    steps.push({ key: 'kickS', frames: PUNCH.kickS, from: 1, to: 1 });
    steps.push({ key: 'kick', frames: PUNCH.hold, from: 1, to: 1 });
  }
  steps.push({ key: 'load', frames: PUNCH.guard, from: 1, to: 0.8 });
  steps.push({ key: 'ready', frames: PUNCH.back, from: 0.8, to: 0 });
  return steps;
}
export const punchLength = (at: number, reach: number): number => punchTimeline(at, reach).reduce((n, s) => n + s.frames, 0);

export interface PunchBeat {
  key: PunchKey;
  step: number;
  lunge: number;
  /** Frames into the step. */
  t: number;
  /** A body in motion (a run, a smear): a ghost trails it. */
  dash: boolean;
  /** A blow is on the target (a held jab, cross or kick). */
  contact: boolean;
  /** The blow (an index of `punchHits`) that lands on exactly this frame, else -1. */
  hit: number;
}

/** The beat `k` frames into the pose (past the end: the last frame). */
export function punchBeat(k: number, at: number, reach: number): PunchBeat {
  const tl = punchTimeline(at, reach);
  const hits = punchHits();
  let t = k;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i] as PunchStep;
    if (t < s.frames || i === tl.length - 1) {
      const u = s.frames > 1 ? Math.max(0, Math.min(1, t / (s.frames - 1))) : 1;
      const lunge = s.from + (s.to - s.from) * u;
      const held = s.key === 'jab' || s.key === 'cross' || s.key === 'kick';
      const dash = s.key === 'run' || s.key === 'jabS' || s.key === 'crossS' || s.key === 'kickS';
      // A blow lands on the first frame of its held step (`t` under one: a fractional clock stays on that frame until the next).
      const hit = held && t < 1 ? hits.findIndex((h) => h.key === s.key) : -1;
      return { key: s.key, step: i, lunge, t: Math.min(t, s.frames - 1), dash, contact: held, hit };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, t: 0, dash: false, contact: false, hit: -1 };
}

/**
 * What the built frames measured (filled in by `buildSfPunch`, so a retuned anchor retunes the stop): in art pixels (one per screen pixel, two per battle-world pixel) how far the tip of
 * every blow is in front of the member's axis (the same for the jab, the cross and the kick), and how high above the soles each is, and how far the planted front boot is.
 */
export const PUNCH_MEASURED = { tipDx: 30, up: { jab: 40, cross: 38, kick: 46 }, footDx: 11 };
/** How far (world px) the blow's tip goes past the target's body front: the fist presses into the body, so it reads as a hit, not a touch in front of it. */
export const PUNCH_PIERCE = 2;
/** The target's recoil from a blow that is not the last (a short gentle shove), and the extra frames of recoil the last one leaves (`SF_KNOCK`). */
export const PUNCH_KNOCK = 6;
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
 * sfcrew.ts does); `run`, `load`, `jab`, `cross` and `kick` are Mark's frames, colour-cleaned with it.
 */
export function buildSfPunch(idle: Raw[], run: Raw, load: Raw, jab: Raw, cross: Raw, kick: Raw): PunchBuild {
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
  // The jab's and the cross's fists are 18.5 px past their front boots, so they land at the same column; the kick's toe is laid on that column too.
  const tipCol = A.jab.tip[0] + 1 + pj.dx;
  const pk = { dx: tipCol - (A.kick.tip[0] + 1), dy: H0 - 1 - A.kick.soles };
  const pr = { dx: Math.round(HALF - boxOf(run).feet), dy: H0 - 1 - soles(run) };
  blit(layers.run, run, pr.dx, pr.dy);
  const ramp = jacketRamp(jab);
  blit(layers.jab, jab, pj.dx, pj.dy);
  blit(layers.cross, cross, pc.dx, pc.dy);
  blit(layers.kick, kick, pk.dx, pk.dy);
  // The smears: a streak over the arm (the body is drawn first, then the streak over it) or the kick's arc behind the leg.
  const bodies = { jab: [jab, pj], cross: [cross, pc], kick: [kick, pk] } as const;
  for (const k of ['jabS', 'crossS', 'kickS'] as const) {
    const sm = PUNCH_SMEARS[k];
    const [src, p] = bodies[sm.src];
    if (sm.kind === 'streak') {
      blit(layers[k], src, p.dx, p.dy);
      drawStreak(layers[k], sm, p.dx, p.dy, ramp);
    } else {
      drawSwipe(layers[k], sm.hip[0] + p.dx, sm.hip[1] + p.dy, sm.swipe, ramp);
      blit(layers[k], src, p.dx, p.dy);
    }
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
    up: { jab: up(A.jab.soles, A.jab.tip[1]), cross: up(A.cross.soles, A.cross.tip[1]), kick: up(A.kick.soles, A.kick.tip[1]) },
    footDx: Math.round(off),
  };
  return { frames, axis: half, measured, topRows: H0 - top };
}
