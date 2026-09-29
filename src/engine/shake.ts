/**
 * Screen shake as motion, not noise. A blow with a direction kicks the frame that way and springs
 * back past centre a few times, fading; a rumble with no direction (a quake, a lift shuddering)
 * wanders smoothly on both axes. Both are functions of the frame, so the same shake plays the
 * same way every time.
 */

export interface ShakeState {
  /** Frames since this shake began, and its total length. */
  t: number;
  len: number;
  /** Peak amplitude, screen pixels (already scaled by the player's setting). */
  mag: number;
  /** Unit direction of the kick, or null for a rumble. */
  dir: { x: number; y: number } | null;
}

/** This frame's offset, whole pixels. */
export function shakeOffset(s: ShakeState): { x: number; y: number } {
  if (s.t >= s.len || s.mag <= 0) return { x: 0, y: 0 };
  // Falls away quadratically: most of the energy is in the first few frames.
  const a = s.mag * (1 - s.t / s.len) ** 2;
  if (s.dir) {
    // Snap along the blow (cos: full kick on frame 0), spring back, with a little cross-wobble.
    const along = a * Math.cos(s.t * 1.25);
    const across = a * 0.2 * Math.sin(s.t * 2.1);
    return { x: Math.round(s.dir.x * along - s.dir.y * across), y: Math.round(s.dir.y * along + s.dir.x * across) };
  }
  // Slow enough to read as the ground moving (about 8 Hz), never a per-frame buzz.
  return {
    x: Math.round(a * (0.65 * Math.sin(s.t * 0.8) + 0.35 * Math.sin(s.t * 1.3 + 1.3))),
    y: Math.round(a * (0.65 * Math.sin(s.t * 0.95 + 2.1) + 0.35 * Math.sin(s.t * 1.45 + 0.4))),
  };
}

/** A unit vector from `from` toward `to` (straight down if they coincide). */
export function direction(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  return d < 0.01 ? { x: 0, y: 1 } : { x: dx / d, y: dy / d };
}
