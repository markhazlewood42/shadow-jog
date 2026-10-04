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

export type KataKey = 'draw1' | 'draw2' | 'ready' | 'lift' | 'overhead' | 'swing0' | 'swing1' | 'swing2' | 'contact0' | 'contact' | 'contact0Low' | 'contactLow' | 'zanshin';

/** True for the four frames where the blade is on the target (the overshoot and the settle, for a tall target and for a low one). */
export const isContact = (k: KataKey): boolean => k === 'contact0' || k === 'contact' || k === 'contact0Low' || k === 'contactLow';

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
  /** A smear: the blade angles it has just swept (from, to), painted behind the blade as a fan (the whole wedge between the old blade and the new) or an arc (a crescent along the path of the point, thickest at the new blade). */
  smear?: [number, number] | [number, number, 'fan' | 'arc'];
  /** Drawing or sheathing: one hand on the hilt (`grip` from the far shoulder), the other hanging `off` from the lead shoulder, and only `blade` pixels of steel out of the scabbard. */
  one?: { off: Pt; blade: number };
}

/** How far apart the two fists are on the grip (a fist's width). */
export const GRIP_GAP = 4.4;
/** The katana's pixels along it from the pommel-side fist: the pommel end, the guard and the point (35: round 3 lengthened the blade 8 px so it reads at 1x). */
export const KATA_DIMS = { pommel: -2.4, guard: 9, tip: 35 } as const;
/** Bone lengths of both arms, the same in every frame (shoulder to elbow, elbow to wrist). 10 so the raised fists can clear the top of his hair. */
export const KATA_BONE = 10;

export const KATA_POSES: Record<KataKey, KataPose> = {
  // Draw, 1: the far hand reaches over the shoulder to the hilt on his back and pulls; a hand's length of steel shows.
  draw1: { lean: 1, crouch: 0, rise: 1, twist: 0, grip: [3, -12], deg: -42, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 }, one: { off: [-1, 12], blade: 17 } },
  // Draw, 2: the blade clears the scabbard and sweeps up and forward, the lead hand coming across to meet it.
  draw2: { lean: 0, crouch: 0, rise: 1, twist: 1, grip: [3, -14], deg: -78, front: { lift: 0, dx: -1 }, back: { lift: 0, dx: 1 }, one: { off: [-6, 5], blade: 35 } },
  // Chudan: the sword forward, hands at the belly, the point at the throat.
  ready: { lean: 0, crouch: 1, rise: 0, twist: 2, grip: [-4, 9], deg: -150, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 1 } },
  // The lift: hands rising in front of the face, the point up.
  lift: { lean: 1, crouch: 0, rise: 1, twist: 6, grip: [-8, -5], deg: -100, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 1 } },
  // Furikaburi: the fists clear the top of his head, the blade laid back over it, the body loaded: head and shoulders 3 px back, up on the toes.
  overhead: { lean: 3, crouch: 0, rise: 3, twist: 9, grip: [-2, -19], deg: -55, front: { lift: 0, dx: -2 }, back: { lift: 0, dx: 2 } },
  // The cut, four frames (swing2 held two): the blade falls from behind the head, through the vertical, and out toward level; the front foot leaves the ground, the body comes forward behind it.
  // `smear` is the sweep painted behind the blade (from, to): each cut frame a fan between the last blade angle and this one, the blow itself one big crescent from the overhead to level.
  swing0: { lean: 1, crouch: 0, rise: 2, twist: 8, grip: [-9, -16], deg: -95, front: { lift: 1, dx: -3 }, back: { lift: 0, dx: 2 }, smear: [-68, -95] },
  swing1: { lean: -3, crouch: 1, rise: 0, twist: 8, grip: [-11, -10], deg: -130, front: { lift: 3, dx: -5 }, back: { lift: 0, dx: 3 }, smear: [-72, -130] },
  swing2: { lean: -5, crouch: 2, rise: 0, twist: 8, grip: [-13, -5], deg: -162, front: { lift: 3, dx: -6 }, back: { lift: 1, dx: 3 }, smear: [-80, -164] },
  // Men-uchi, the overshoot: the blade a touch past level, the body at its lowest and furthest forward, the front foot stamped, the back foot dragged flat.
  contact0: { lean: -7, crouch: 4, rise: 0, twist: 6, grip: [-15, -7], deg: 171, front: { lift: 0, dx: -8 }, back: { lift: 0, dx: 5 }, smear: [-100, -189, 'arc'] },
  // Men-uchi, the settle: the arms extended, the blade level at head height, the back heel up.
  contact: { lean: -5, crouch: 3, rise: 0, twist: 6, grip: [-14, -8], deg: 178, front: { lift: 0, dx: -7 }, back: { lift: 2, dx: 4 } },
  // The same for a low target (a Glowrat under 30 px): the hands sink and the blade angles down onto it.
  contact0Low: { lean: -8, crouch: 5, rise: 0, twist: 6, grip: [-15, 3], deg: 156, front: { lift: 0, dx: -8 }, back: { lift: 0, dx: 5 }, smear: [-100, -204, 'arc'] },
  contactLow: { lean: -6, crouch: 4, rise: 0, twist: 6, grip: [-14, 2], deg: 165, front: { lift: 0, dx: -7 }, back: { lift: 2, dx: 4 } },
  // Zanshin: the point stays up and forward, the body upright and settled, the back foot planted, the guard held.
  zanshin: { lean: 1, crouch: 1, rise: 0, twist: 5, grip: [-10, -1], deg: -122, front: { lift: 0, dx: -5 }, back: { lift: 0, dx: 3 } },
};

/** One stretch of the timeline: a key, held for `frames` (pose-clock frames, one per frame of the effect clock). */
export interface KataStep {
  key: KataKey;
  frames: number;
  /** How far along the lunge the body is at the start and the end of the step (0 in its place, 1 at the target). */
  from: number;
  to: number;
}

/** Frames of the blow's follow-through: the contact held through the effect, the hit and the hitstop, then zanshin (held 9, two longer than round 2), then the walk back (a fast slide in the guard, then the sword sheathed at home). */
export const KATA_HOLD = 15;
export const KATA_ZANSHIN = 9;
/** The blade shows on the target this many frames before the move's effect starts, so its tip is seen meeting the target before the flash covers it. */
export const KATA_LEAD = 3;
/** The pre-contact beats at their shortest: draw (2 + 2), lift (2), the four cut frames (1, 1, 2). */
const MIN_READY = 2;
const MIN_OVERHEAD = 3;
const PRE_FIXED = 2 + 2 + 2 + 1 + 1 + 2;

/** The contact frames to use for a target: a low one (`low`) gets the blade angled down onto it. */
const contactKey = (k: 'contact0' | 'contact', low: boolean): KataKey => (low ? (k === 'contact0' ? 'contact0Low' : 'contactLow') : k);

/**
 * The strike's timeline when the effect starts `at` frames in (and the hit follows 4 frames later): draw the
 * sword, ready, lift, overhead (held longer if there is time, as when a timing ring is closing), the four cut
 * frames that carry the dash (the last held two), the contact (an overshoot frame, then the settle; both shown `KATA_LEAD` frames before the effect)
 * held through the hit, zanshin, then the walk back: a fast slide home in the guard (the body is never crossing a crewmate with the
 * blade raised), and only then the draw read backwards, at home. A lunge never jumps between two steps: each
 * starts where the one before ended. The spacing of the dash is 0.2, 0.45, 0.65, 0.8, 0.96 of the way.
 */
export function kataTimeline(at0: number, low = false): KataStep[] {
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
    { key: 'swing2', frames: 2, from: 0.65, to: 0.8 },
    { key: contactKey('contact0', low), frames: 1, from: 0.96, to: 0.96 },
    { key: contactKey('contact', low), frames: KATA_HOLD - 1, from: 1, to: 1 },
    { key: 'zanshin', frames: KATA_ZANSHIN, from: 1, to: 1 },
    { key: 'ready', frames: 3, from: 1, to: 0 },
    { key: 'draw2', frames: 2, from: 0, to: 0 },
    { key: 'draw1', frames: 2, from: 0, to: 0 },
  ];
}

/** The whole pose's length for a blow that lands `at` frames in. */
export const kataLength = (at: number, low = false): number => kataTimeline(at, low).reduce((n, s) => n + s.frames, 0);

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
export function kataBeat(k: number, at: number, low = false): KataBeat {
  const tl = kataTimeline(at, low);
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
/** The same for the low contact frame (a target under `KATA_LOW_BELOW` art px tall). */
export const KATA_MEASURED_LOW = { tipReach: 78, footDx: -30, tipUp: 40 };
/** A target shorter than this (screen/art px) is a low one: the blade comes down onto it. */
export const KATA_LOW_BELOW = 30;
/** How far the blade's point goes in, as a share of the way from the target's centre to its front edge (its weapon can reach further than its body): it meets the body, it doesn't stop in the air. */
export const KATA_BITE_FRAC = 0.4;
/** Frames from the start of the move to the effect when no timing ring is closing (the draw, the lift and the cut need a few more than Kit's 8). */
export const KATA_WINDUP = 18;
/** The effect is anchored this many world px toward Rook from the target's centre, so the blade's point stays in view beside the flash. */
export const KATA_EFFECT_SHIFT = 4;
/** The target's recoil when the cut lands: world px it is pushed back (away from Rook) on each frame, the first two the hardest, then easing home. */
export const KATA_KNOCK: readonly number[] = [4, 4, 3, 2, 1, 1];
/** The slash line through the target is anchored this far above the target's soles at most (art px), and never above the blade (see playback). */
/** A crewmate in the way of the strike's end point steps aside: the most she moves (world px), Rook's body half-width, and the air she leaves between them. */
export const KATA_ROOM_MAX = 12;
export const KATA_BODY_HALF = 7;
export const KATA_ROOM_GAP = 3;
