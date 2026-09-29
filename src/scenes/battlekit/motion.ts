/**
 * How the crew's bodies move through an action, frame by frame. Pure: the renderer asks what beat
 * a pose is on and draws it.
 */

/** Frames a party action pose lasts (the playback sets it; the swing's beats are keyed to it). */
export const PARTY_POSE_T = 34;

export interface SwingBeat {
  /** gather: drawn in, crouching; strike: the snap forward; settle: easing back to the line. */
  phase: 'gather' | 'strike' | 'settle';
  /** Battle pixels up the screen, toward the enemy (negative: a crouch). */
  lift: number;
  /** Speed-smear copies to trail behind the body (0: none). */
  smear: number;
}

/**
 * A melee swing in three beats, `k` frames into the pose: six frames gathering (the brace frame,
 * sinking a little), a snap forward on the strike frame with a smear behind it, then a settle
 * back down to the line. The hit's effects start at frame 8, just after the snap lands.
 */
export function swingBeat(k: number): SwingBeat {
  if (k < 6) return { phase: 'gather', lift: -Math.min(3, Math.floor(k / 2)), smear: 0 };
  if (k < 9) return { phase: 'strike', lift: 16 - (k - 6), smear: 9 - k };
  return { phase: 'settle', lift: Math.max(0, Math.round(14 - (k - 9) * 0.7)), smear: 0 };
}
