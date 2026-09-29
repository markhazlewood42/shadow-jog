/**
 * How the crew's bodies move through an action, frame by frame. Pure: the renderer asks what beat
 * a pose is on and draws it.
 */

/** Frames a party action pose lasts (the playback sets it; the swing's beats are keyed to it). */
export const PARTY_POSE_T = 34;

export interface SwingBeat {
  /**
   * gather: drawn in, crouching (the brace frame); raise: the snap forward, weapon up (the attack
   * frame); cut: the weapon swept through, its trail lit (the strike frame); settle: the follow-
   * through held while easing back to the line.
   */
  phase: 'gather' | 'raise' | 'cut' | 'settle';
  /** Battle pixels up the screen, toward the enemy (negative: a crouch). */
  lift: number;
  /** Speed-smear copies to trail behind the body (0: none). */
  smear: number;
}

/**
 * A melee swing in four beats, `k` frames into the pose: six frames gathering (sinking a little),
 * two raising the weapon on the snap forward with a smear behind, four for the cut itself (the
 * follow-through frame, its trail lit), then a settle back down to the line holding the follow-
 * through. The weapon changes angle three times; the hit's effects start at frame 8, on the cut.
 */
export function swingBeat(k: number): SwingBeat {
  if (k < 6) return { phase: 'gather', lift: -Math.min(3, Math.floor(k / 2)), smear: 0 };
  if (k < 8) return { phase: 'raise', lift: 16 - (k - 6), smear: 8 - k + 1 };
  if (k < 12) return { phase: 'cut', lift: 14 - (k - 8) * 0.5, smear: 0 };
  return { phase: 'settle', lift: Math.max(0, Math.round(12 - (k - 12) * 0.6)), smear: 0 };
}
