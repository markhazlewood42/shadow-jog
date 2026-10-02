/**
 * Rook's kendo strike as DATA (spike `spike/side-battle`, item B-rook-strike): the key poses, how long each
 * is held, and where the body is along its lunge. Nothing here draws a pixel; `sidecrew.ts` turns a key into a
 * frame (two arms by IK onto a two-handed grip, the katana, the legs, the smear) and `render.ts` plays the
 * timeline. Form follows Kendo-Guide's men strike (chudan guard, furikaburi lift overhead, men-uchi with the arms
 * extended and the front foot stamping, zanshin, back to chudan) and Slynyrd Pixelblog 9's key frames
 * (anticipation, smear, held impact, overshoot, recovery).
 *
 * Angles: 0 is right, -90 up, 180 left (the enemy is on the left). A hand place is in pixels from the lead
 * shoulder (x toward the enemy is negative).
 */
import type { Pt } from './sideops';

export type KataKey = 'ready' | 'lift' | 'overhead' | 'swing1' | 'swing2' | 'contact' | 'zanshin';

export interface KataPose {
  /** The upper body leaned at the top (negative: toward the enemy), the rows crouched or risen, and how far the torso turns the near shoulder toward the enemy. */
  lean: number;
  crouch: number;
  rise: number;
  twist: number;
  /** The forward hand (the chrome arm's) from the lead shoulder; the other hand sits `GRIP_GAP` behind it on the grip. */
  grip: Pt;
  /** The blade's angle. */
  deg: number;
  /** The front leg (toward the enemy) and the back one: the shin and foot lifted `lift` rows and moved `dx` columns. */
  front: { lift: number; dx: number };
  back: { lift: number; dx: number };
  /** A smear arc: the blade angles it has just swept (from, to). */
  smear?: [number, number];
}

/** How far apart the two fists are on the grip (a fist's width). */
export const GRIP_GAP = 4.4;
/** The katana's pixels along it from the pommel-side fist: the pommel end, the guard and the point. */
export const KATA_DIMS = { pommel: -2.4, guard: 9, tip: 27 } as const;
/** Bone lengths of both arms, the same in every frame (shoulder to elbow, elbow to wrist). */
export const KATA_BONE = 8;

export const KATA_POSES: Record<KataKey, KataPose> = {
  // Chudan: the sword forward, hands at the belly, the point at the throat.
  ready: { lean: 0, crouch: 1, rise: 0, twist: 2, grip: [-4, 9], deg: -150, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 } },
  // The lift: hands rising in front of the face, the point up.
  lift: { lean: 1, crouch: 0, rise: 0, twist: 3, grip: [-7, -1], deg: -108, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 } },
  // Furikaburi: the sword raised overhead, the blade tilted back, the body loaded behind it.
  overhead: { lean: 2, crouch: 0, rise: 3, twist: 3, grip: [-11, -12], deg: -64, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 2 } },
  // The cut, two frames: the hands drop forward, the blade comes through the vertical, the front foot leaves the ground.
  swing1: { lean: -1, crouch: 1, rise: 0, twist: 4, grip: [-9, -5], deg: -118, front: { lift: 2, dx: -3 }, back: { lift: 0, dx: 2 }, smear: [-52, -118] },
  swing2: { lean: -3, crouch: 1, rise: 0, twist: 5, grip: [-12, -2], deg: -160, front: { lift: 2, dx: -4 }, back: { lift: 1, dx: 2 }, smear: [-118, -160] },
  // Men-uchi: the arms extended, the blade at head height, the front foot down hard and the back heel up.
  contact: { lean: -4, crouch: 2, rise: 0, twist: 6, grip: [-14, -8], deg: 178, front: { lift: 0, dx: -4 }, back: { lift: 2, dx: 3 } },
  // Zanshin: the point comes back up, the body rebounds, the guard stays up.
  zanshin: { lean: 0, crouch: 0, rise: 0, twist: 3, grip: [-8, -1], deg: -128, front: { lift: 0, dx: -3 }, back: { lift: 1, dx: 2 } },
};

/** One stretch of the timeline: a key, held for `frames` (pose-clock frames, one per frame of the effect clock). */
export interface KataStep {
  key: KataKey;
  frames: number;
  /** How far along the lunge the body is at the start and the end of the step (0 in its place, 1 at the target). */
  from: number;
  to: number;
}

/** Frames of the blow's follow-through: the contact held through the hit, zanshin, then the walk back. */
export const KATA_HOLD = 12;
export const KATA_ZANSHIN = 7;
export const KATA_RETURN = 9;
/** The pre-contact beats at their shortest, in order: ready, lift, overhead, the two cut frames. */
const MIN_READY = 2;
const MIN_LIFT = 3;
const MIN_OVERHEAD = 3;
const CUT = 2;

/**
 * The strike's timeline when the blow lands `at` frames in (the frame the move's effect starts on, and the
 * hit follows 4 frames later): ready, lift, overhead (held longer if there is time, as when a timing ring is
 * closing), the two cut frames that carry the dash, the contact held through the hit, zanshin, then ready again
 * while the body slides back to its place.
 */
export function kataTimeline(at0: number): KataStep[] {
  const at = Math.round(at0);
  const spare = Math.max(0, at - (MIN_READY + MIN_LIFT + MIN_OVERHEAD + CUT * 2));
  const ready = MIN_READY + Math.floor(spare / 2);
  const overhead = MIN_OVERHEAD + Math.ceil(spare / 2);
  return [
    { key: 'ready', frames: ready, from: 0, to: 0 },
    { key: 'lift', frames: MIN_LIFT, from: 0, to: -0.03 },
    { key: 'overhead', frames: overhead, from: -0.03, to: 0.12 },
    { key: 'swing1', frames: CUT, from: 0.3, to: 0.55 },
    { key: 'swing2', frames: CUT, from: 0.8, to: 0.95 },
    { key: 'contact', frames: KATA_HOLD, from: 1, to: 1 },
    { key: 'zanshin', frames: KATA_ZANSHIN, from: 1, to: 1 },
    { key: 'ready', frames: KATA_RETURN, from: 1, to: 0 },
  ];
}

/** The whole pose's length for a blow that lands `at` frames in. */
export const kataLength = (at: number): number => kataTimeline(at).reduce((n, s) => n + s.frames, 0);

export interface KataBeat {
  key: KataKey;
  /** The step's index in the timeline, and the frame within it. */
  step: number;
  /** How far along the lunge (0 to 1) the body is. */
  lunge: number;
  /** Frames into the step. */
  t: number;
  /** True on the cut frames, which carry the dash. */
  dash: boolean;
}

/** The beat `k` frames into the pose (past the end: the last frame). */
export function kataBeat(k: number, at: number): KataBeat {
  const tl = kataTimeline(at);
  let t = k;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i] as KataStep;
    if (t < s.frames || i === tl.length - 1) {
      const u = s.frames > 1 ? Math.max(0, Math.min(1, t / (s.frames - 1))) : 1;
      return { key: s.key, step: i, lunge: s.from + (s.to - s.from) * u, t: Math.min(t, s.frames - 1), dash: s.key === 'swing1' || s.key === 'swing2' };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, t: 0, dash: false };
}

/** Rook's blow lands this far (world px) in front of the target's centre: his blade is long, so he stops further off than Kit. */
export const KATA_STOP = 22;
/** Frames from the start of the move to the effect when no timing ring is closing (Kit's strike takes 8; the kendo lift and cut need a few more). */
export const KATA_WINDUP = 12;
