import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Raw } from '../src/art/rig2/sfgeom';
import { cutSheet, footAnchor } from '../src/stage/feet';
import { enemyIdle } from '../src/stage/idle';
import { FrameStats, percentile } from '../src/stage/metrics';
import { sheetFrames } from './png';

/** A w x h frame with an opaque rectangle (x0..x1, y0..y1 inclusive). */
function frame(w: number, h: number, boxes: [number, number, number, number][]): Raw {
  const px = new Uint8ClampedArray(w * h * 4);
  for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px[(y * w + x) * 4 + 3] = 255;
  return { w, h, px };
}

describe('footAnchor (where a sprite stands inside its picture)', () => {
  it('is the middle of the boots and the row under the lowest sole', () => {
    // A body 10 wide on top, legs 4 wide (columns 6..9) down to the last row (15).
    const f = frame(20, 16, [[4, 2, 13, 7], [6, 8, 9, 15]]);
    expect(footAnchor([f])).toEqual({ x: 8, y: 16 });
  });

  it('averages the boots over the loop and takes the lowest sole, so a bounce does not move the anchor', () => {
    const down = frame(20, 16, [[4, 2, 13, 7], [6, 8, 9, 15]]);
    const up = frame(20, 16, [[4, 1, 13, 6], [6, 7, 9, 14]]);
    expect(footAnchor([down, up])).toEqual({ x: 8, y: 16 });
  });

  it('uses the span of the lowest six rows: a stance’s centre of balance is where it stands (a trailing blade pulls it, which an idle loop does not have)', () => {
    // Legs at columns 6..9 and a trailing tip on the very last row, 20 columns away: the span is 6..38, its middle 22.
    const f = frame(40, 20, [[2, 2, 9, 9], [6, 10, 9, 19], [30, 19, 38, 19]]);
    expect(footAnchor([f])).toEqual({ x: 22, y: 20 });
    // A leaning stance (boots to one side of the body, like Kit's trailing foot): the middle of the boots' span, not of the heavier boot.
    const lean = frame(40, 20, [[4, 2, 13, 9], [4, 10, 7, 19], [14, 17, 21, 19]]);
    expect(footAnchor([lean])).toEqual({ x: 13, y: 20 });
  });

  it('skips empty frames and refuses a loop with nothing in it', () => {
    const f = frame(20, 16, [[6, 8, 9, 15]]);
    expect(footAnchor([frame(20, 16, []), f])).toEqual({ x: 8, y: 16 });
    expect(() => footAnchor([frame(4, 4, [])])).toThrow(/empty/);
  });

  it('cutSheet splits a sheet into equal frames', () => {
    const sheet = frame(12, 3, [[4, 0, 7, 2]]);
    const [a, b, c] = cutSheet(sheet, 4, 3);
    expect([a?.w, b?.w, c?.w, b?.h]).toEqual([4, 4, 4, 3]);
    expect(a?.px.some((v) => v)).toBe(false);
    expect(b?.px.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
  });

  // Mark's real sheets (git-ignored): where they exist, the four heroes' anchors sit on their cells' bottom third.
  const DIR = 'spritefusion-tests';
  it.runIf(existsSync(`${DIR}/extracted/rook-battle-idle/metadata.json`))('finds sensible feet on Mark’s four idle sheets, Rook’s 79x68 included', () => {
    for (const [name, w, h] of [['kit', 64, 64], ['rook', 79, 68], ['hex', 64, 64], ['sable', 64, 64]] as const) {
      const a = footAnchor(sheetFrames(DIR, `${name}-battle-idle`));
      expect(a.y, name).toBeGreaterThan(h * 0.85);
      expect(a.y, name).toBeLessThanOrEqual(h);
      expect(a.x, name).toBeGreaterThan(w * 0.2);
      expect(a.x, name).toBeLessThan(w * 0.8);
    }
  });
});

describe('enemyIdle', () => {
  it('is still for a still enemy and moves in whole screen pixels, doubled from the game’s world pixels', () => {
    expect(enemyIdle('still', 100, 3)).toEqual({ x: 0, y: 0 });
    for (let f = 0; f < 240; f++) {
      for (const kind of ['bob', 'hover', 'sway', 'breathe', 'flicker'] as const) {
        const o = enemyIdle(kind, f, 1);
        expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
        expect(o.x % 2 === 0 && o.y % 2 === 0).toBe(true);
        expect(Math.abs(o.y)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('breathes up and down once a second (30 frames each) and keeps two of a kind out of step', () => {
    expect(enemyIdle('breathe', 0, 0).y).toBe(0);
    expect(enemyIdle('breathe', 30, 0).y).toBe(2);
    expect(enemyIdle('breathe', 60, 0).y).toBe(0);
    expect(enemyIdle('breathe', 0, 1).y).toBe(enemyIdle('breathe', 13, 0).y);
    expect(enemyIdle('hover', 40, 0)).not.toEqual(enemyIdle('hover', 40, 1));
  });
});

describe('frame statistics', () => {
  it('percentile by nearest rank', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile([9, 1, 5], 100)).toBe(9);
  });

  it('records intervals between frames and the work inside them, and keeps only the last frames', () => {
    const s = new FrameStats(3);
    for (let i = 0; i < 6; i++) {
      s.begin(i * 16);
      s.end();
    }
    const sum = s.summary();
    expect(sum.frames).toBe(3);
    expect(sum.intervalP50).toBe(16);
    s.reset();
    expect(s.summary().frames).toBe(0);
  });
});
