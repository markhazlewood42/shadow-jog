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

export type KataKey = 'draw1' | 'draw2' | 'ready' | 'lift' | 'overhead' | 'swing0' | 'swing1' | 'swing2' | 'contact' | 'zanshin';

export interface KataPose {
  /** The upper body leaned at the top (negative: toward the enemy), the rows crouched or risen, and how far the torso turns the near shoulder toward the enemy. */
  lean: number;
  crouch: number;
  rise: number;
  twist: number;
  /** The forward hand (the chrome arm's) from the lead shoulder; the other hand sits `GRIP_GAP` behind it on the grip. With `one`, the back hand's place from the far shoulder instead. */
  grip: Pt;
  /** The blade's angle. */
  deg: number;
  /** The front leg (toward the enemy) and the back one: the shin and foot lifted `lift` rows and moved `dx` columns. */
  front: { lift: number; dx: number };
  back: { lift: number; dx: number };
  /** A smear: the blade angles it has just swept (from, to), painted as a wedge behind the blade. */
  smear?: [number, number];
  /** Drawing or sheathing: one hand on the hilt (`grip` from the far shoulder), the other hanging `off` from the lead shoulder, and only `blade` pixels of steel out of the scabbard. */
  one?: { off: Pt; blade: number };
}

/** How far apart the two fists are on the grip (a fist's width). */
export const GRIP_GAP = 4.4;
/** The katana's pixels along it from the pommel-side fist: the pommel end, the guard and the point. */
export const KATA_DIMS = { pommel: -2.4, guard: 9, tip: 27 } as const;
/** Bone lengths of both arms, the same in every frame (shoulder to elbow, elbow to wrist). 10 so the raised fists can clear the top of his hair. */
export const KATA_BONE = 10;

export const KATA_POSES: Record<KataKey, KataPose> = {
  // Draw, 1: the far hand reaches over the shoulder to the hilt on his back and pulls; a hand's length of steel shows.
  draw1: { lean: 1, crouch: 0, rise: 1, twist: 0, grip: [3, -12], deg: -42, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 }, one: { off: [-1, 12], blade: 17 } },
  // Draw, 2: the blade clears the scabbard and sweeps up and forward, the lead hand coming across to meet it.
  draw2: { lean: 0, crouch: 0, rise: 1, twist: 1, grip: [3, -14], deg: -78, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 }, one: { off: [-6, 5], blade: 27 } },
  // Chudan: the sword forward, hands at the belly, the point at the throat.
  ready: { lean: 0, crouch: 1, rise: 0, twist: 2, grip: [-4, 9], deg: -150, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 1 } },
  // The lift: hands rising in front of the face, the point up.
  lift: { lean: 1, crouch: 0, rise: 1, twist: 6, grip: [-8, -5], deg: -100, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 1 } },
  // Furikaburi: the fists clear the top of his head, the blade laid back over it, the body loaded behind.
  overhead: { lean: 2, crouch: 0, rise: 3, twist: 9, grip: [-2, -19], deg: -55, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 2 } },
  // The cut, three frames: the blade falls from behind the head, through the vertical, and out to level; the front foot leaves the ground.
  swing0: { lean: 0, crouch: 0, rise: 2, twist: 8, grip: [-9, -16], deg: -95, front: { lift: 1, dx: -3 }, back: { lift: 0, dx: 2 }, smear: [-55, -95] },
  swing1: { lean: -2, crouch: 1, rise: 0, twist: 8, grip: [-11, -10], deg: -130, front: { lift: 3, dx: -5 }, back: { lift: 0, dx: 3 }, smear: [-95, -130] },
  swing2: { lean: -3, crouch: 1, rise: 0, twist: 8, grip: [-13, -5], deg: -162, front: { lift: 3, dx: -6 }, back: { lift: 1, dx: 3 }, smear: [-130, -162] },
  // Men-uchi: the arms extended, the blade level at head height, the front foot down hard in a long stride, the back heel up, the body dropped.
  contact: { lean: -4, crouch: 3, rise: 0, twist: 6, grip: [-14, -8], deg: 178, front: { lift: 0, dx: -7 }, back: { lift: 2, dx: 4 } },
  // Zanshin: the point stays up and forward at chest height, the body rebounds, the guard held.
  zanshin: { lean: 0, crouch: 0, rise: 1, twist: 6, grip: [-11, -1], deg: -172, front: { lift: 0, dx: -5 }, back: { lift: 1, dx: 3 } },
};

/** One stretch of the timeline: a key, held for `frames` (pose-clock frames, one per frame of the effect clock). */
export interface KataStep {
  key: KataKey;
  frames: number;
  /** How far along the lunge the body is at the start and the end of the step (0 in its place, 1 at the target). */
  from: number;
  to: number;
}

/** Frames of the blow's follow-through: the contact held through the effect, the hit and the hitstop, then zanshin, then the walk back (a slide with the sword going away: ready, then the draw read backwards). */
export const KATA_HOLD = 15;
export const KATA_ZANSHIN = 7;
/** The blade shows on the target this many frames before the move's effect starts, so its tip is seen meeting the target before the flash covers it. */
export const KATA_LEAD = 3;
/** The pre-contact beats at their shortest: draw (2 + 2), ready, lift (2), overhead, the three cut frames (1 each). */
const MIN_READY = 2;
const MIN_OVERHEAD = 3;
const PRE_FIXED = 2 + 2 + 2 + 1 + 1 + 1;

/**
 * The strike's timeline when the effect starts `at` frames in (and the hit follows 4 frames later): draw the
 * sword, ready, lift, overhead (held longer if there is time, as when a timing ring is closing), the three cut
 * frames that carry the dash, the contact (shown `KATA_LEAD` frames before the effect) held through the hit,
 * zanshin, then the walk back as ready and the draw read backwards. A lunge never jumps between two steps: each
 * starts where the one before ended.
 */
export function kataTimeline(at0: number): KataStep[] {
  const at = Math.round(at0);
  const spare = Math.max(0, at - KATA_LEAD - (PRE_FIXED + MIN_READY + MIN_OVERHEAD));
  const ready = MIN_READY + Math.floor(spare / 2);
  const overhead = MIN_OVERHEAD + Math.ceil(spare / 2);
  return [
    { key: 'draw1', frames: 2, from: 0, to: 0 },
    { key: 'draw2', frames: 2, from: 0, to: 0 },
    { key: 'ready', frames: ready, from: 0, to: 0 },
    { key: 'lift', frames: 2, from: 0, to: -0.03 },
    { key: 'overhead', frames: overhead, from: -0.03, to: 0.06 },
    { key: 'swing0', frames: 1, from: 0.2, to: 0.2 },
    { key: 'swing1', frames: 1, from: 0.45, to: 0.45 },
    { key: 'swing2', frames: 1, from: 0.75, to: 0.75 },
    { key: 'contact', frames: KATA_HOLD, from: 0.96, to: 1 },
    { key: 'zanshin', frames: KATA_ZANSHIN, from: 1, to: 1 },
    { key: 'ready', frames: 4, from: 1, to: 0.5 },
    { key: 'draw2', frames: 3, from: 0.5, to: 0.1 },
    { key: 'draw1', frames: 3, from: 0.1, to: 0 },
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
      return { key: s.key, step: i, lunge: s.from + (s.to - s.from) * u, t: Math.min(t, s.frames - 1), dash: s.key === 'swing0' || s.key === 'swing1' || s.key === 'swing2' };
    }
    t -= s.frames;
  }
  return { key: 'ready', step: 0, lunge: 0, t: 0, dash: false };
}

/**
 * What the drawn frames measured (filled in by `buildKata`, so retuning a pose retunes the stop): at the contact frame, how far
 * the blade's point is in front of the frame's centre and above its bottom edge, and how far the front foot is in front of the centre, in art pixels (one per screen pixel, so two per world pixel).
 */
export const KATA_MEASURED = { tipReach: 78, footDx: -30, tipUp: 60 };
/** How far the blade's point goes in, as a share of the way from the target's centre to its front edge (its weapon can reach further than its body): it meets the body, it doesn't stop in the air. */
export const KATA_BITE_FRAC = 0.4;
/** Frames from the start of the move to the effect when no timing ring is closing (the draw, the lift and the cut need a few more than Kit's 8). */
export const KATA_WINDUP = 18;
/** The effect is anchored this many world px toward Rook from the target's centre, so the blade's point stays in view beside the flash. */
export const KATA_EFFECT_SHIFT = 4;
