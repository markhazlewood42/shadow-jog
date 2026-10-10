import { describe, expect, it } from 'vitest';
import { enemyIdle, idleFrame } from '../src/battlestage/idle';

describe('idleFrame (the heroes’ sheet frame, chosen from the fixed tick)', () => {
  it('plays the sheet at its own fps against the 60 a second tick, and loops', () => {
    // 8 frames at 8 fps: a new frame every 7.5 ticks.
    expect([0, 7, 8, 15, 16, 59, 60].map((t) => idleFrame(t, 8, 8))).toEqual([0, 0, 1, 2, 2, 7, 0]);
    expect(idleFrame(60 * 10, 8, 8)).toBe(0);
  });

  it('is a pure function of the tick, and the phase starts a hero part-way round the loop', () => {
    expect(idleFrame(123, 12, 6, 2)).toBe(idleFrame(123, 12, 6, 2));
    expect(idleFrame(0, 8, 8, 3)).toBe(3);
    expect(idleFrame(0, 8, 8, 11)).toBe(3);
  });

  it('never goes out of range, and the same tick always shows the same frame (so a hit-pause holds every figure still)', () => {
    for (let t = 0; t < 500; t += 7) {
      const f = idleFrame(t, 11, 5, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(5);
    }
    expect(idleFrame(40, 8, 8)).toBe(idleFrame(40, 8, 8));
  });
});

describe('enemyIdle (the enemies’ small sway, in whole screen pixels)', () => {
  it('is a pure function of the tick and always whole numbers', () => {
    for (const kind of ['bob', 'hover', 'sway', 'breathe', 'flicker', 'still'] as const)
      for (let t = 0; t < 300; t += 11) {
        const o = enemyIdle(kind, t, 3);
        expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
        expect(o).toEqual(enemyIdle(kind, t, 3));
      }
    expect(enemyIdle('still', 77, 1)).toEqual({ x: 0, y: 0 });
  });
});
