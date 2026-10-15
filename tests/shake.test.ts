/**
 * The screen shake keeps its size on the player's screen across the 640x360 move (docs/PIVOT-640.md,
 * D10). Callers still pass the strengths they were tuned with (1 to 5 game pixels, tuned when a game
 * pixel was 4/3 as wide on screen), and the shake of the game (`GameFx.shake`, which `Game.shake` calls) multiplies them by `SHAKE_PIXEL_GAIN` (4/3).
 * The offset a scene applies stays a whole number of game pixels.
 */
import { describe, expect, it, vi } from 'vitest';
import { shakeOffset } from '../src/engine/shake';
import { GameFx, SHAKE_PIXEL_GAIN } from '../src/sje/runtime/screenfx';

vi.spyOn(console, 'error').mockImplementation(() => undefined);

/** The shake state of a game, made the way `src/sje/boot.ts` makes it: the engine's shake motion and the gain. */
const newFx = () => new GameFx({ shakeOffset, shakeGain: SHAKE_PIXEL_GAIN });

/** A shake running, with a draw's `prepare` run once so `shakeX` and `shakeY` hold frame 0's offset (the setting is `scale`). */
function shaken(mag: number, scale = 1) {
  const g = newFx();
  // A blow straight along +x: at frame 0 the kick is the full amplitude, with no cross-wobble.
  g.shake(12, mag, { x: 1, y: 0 });
  g.prepare(scale);
  return g;
}

describe('the shake gain', () => {
  it('is 4/3, the ratio of the old pixel size to the new on the player screen', () => {
    expect(SHAKE_PIXEL_GAIN).toBe(4 / 3);
  });

  it('scales every authored strength, and the frame-0 kick is that strength in whole pixels', () => {
    // Authored strength -> the scaled amplitude -> the whole-pixel kick (rounded by shakeOffset):
    // 1 -> 1.33 -> 1, 2 -> 2.67 -> 3, 3 -> 4 -> 4, 4 -> 5.33 -> 5, 5 -> 6.67 -> 7.
    const expected: Record<number, number> = { 1: 1, 2: 3, 3: 4, 4: 5, 5: 7 };
    for (const [mag, kick] of Object.entries(expected)) {
      const g = shaken(Number(mag));
      expect(g.shakeMag).toBeCloseTo(Number(mag) * SHAKE_PIXEL_GAIN, 10);
      expect(g.shakeX).toBe(kick);
      expect(g.shakeY).toBe(0);
    }
  });

  it('keeps the default strength (3) at 4 pixels', () => {
    const g = newFx();
    g.shake(12, undefined, { x: 0, y: 1 });
    g.prepare(1);
    expect(g.shakeY).toBe(4);
    expect(g.shakeX).toBe(0);
  });

  it('still honors the player setting: the setting multiplies the scaled strength', () => {
    expect(shaken(3, 0).shakeX).toBe(0); // shake switched off
    expect(shaken(3, 0.5).shakeX).toBe(2); // half of the scaled 4
  });

  it('compares strengths after scaling: a stronger shake takes over, a weaker one only extends', () => {
    const g = newFx();
    g.shake(12, 3);
    g.shake(30, 1); // weaker: extends the running shake, keeps its strength
    expect(g.shakeMag).toBeCloseTo(3 * SHAKE_PIXEL_GAIN, 10);
    g.shake(10, 5); // stronger: takes over
    expect(g.shakeMag).toBeCloseTo(5 * SHAKE_PIXEL_GAIN, 10);
  });
});
