/**
 * The overhead layer's clear parts (src/field/overrects.ts). The scene lights and draws only the
 * rectangles that hold something; these tests pin that the rectangles cover every pixel with any
 * alpha (or a pixel would vanish) and that they stay a short list (or the saving is lost).
 */
import { describe, expect, it } from 'vitest';
import { clipToScreen, occupiedRects, type Rect } from '../src/field/overrects';

/** A w by h RGBA picture, clear except for the pixels listed (x, y) which get alpha 255. */
function picture(w: number, h: number, dots: [number, number][]): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (const [x, y] of dots) data[(y * w + x) * 4 + 3] = 255;
  return data;
}

const covers = (rects: Rect[], x: number, y: number) => rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

describe('occupiedRects', () => {
  it('a clear picture needs no rectangles', () => {
    expect(occupiedRects([picture(100, 80, [])], 100, 80, 32)).toEqual([]);
  });

  it('covers every pixel that has any alpha, in any layer, and no two rectangles overlap', () => {
    const w = 200, h = 150;
    const a: [number, number][] = [[0, 0], [199, 149], [64, 33], [31, 31], [32, 32], [150, 10]];
    const b: [number, number][] = [[100, 100], [101, 101]];
    const rects = occupiedRects([picture(w, h, a), picture(w, h, b)], w, h, 32);
    for (const [x, y] of [...a, ...b]) expect(covers(rects, x, y), `pixel ${x},${y}`).toBe(true);
    // The rectangles stay on the picture (the last cell column and row are cut at its edge).
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
    }
    let area = 0;
    for (const r of rects) area += r.w * r.h;
    const union = new Set<number>();
    for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) union.add(y * w + x);
    expect(union.size).toBe(area);
  });

  it('leaves clear cells out: a dot covers one cell, not the picture', () => {
    const rects = occupiedRects([picture(256, 256, [[100, 100]])], 256, 256, 32);
    expect(rects).toEqual([{ x: 96, y: 96, w: 32, h: 32 }]);
  });

  it('joins a vertical bar into one rectangle and a horizontal one too', () => {
    const bar: [number, number][] = [];
    for (let y = 0; y < 120; y += 7) bar.push([40, y]);
    expect(occupiedRects([picture(128, 128, bar)], 128, 128, 32)).toEqual([{ x: 32, y: 0, w: 32, h: 128 }]);
    const row: [number, number][] = [];
    for (let x = 0; x < 128; x += 7) row.push([x, 50]);
    expect(occupiedRects([picture(128, 128, row)], 128, 128, 32)).toEqual([{ x: 0, y: 32, w: 128, h: 32 }]);
  });

  it('a pixel whose alpha is 1 still counts (it is not clear)', () => {
    const data = new Uint8Array(64 * 64 * 4);
    data[(10 * 64 + 10) * 4 + 3] = 1;
    expect(occupiedRects([data], 64, 64, 32)).toEqual([{ x: 0, y: 0, w: 32, h: 32 }]);
  });
});

describe('clipToScreen', () => {
  const out: Rect = { x: 0, y: 0, w: 0, h: 0 };

  it('keeps the part of a rectangle that is on the screen, in map pixels', () => {
    expect(clipToScreen({ x: 90, y: 40, w: 100, h: 50 }, 100, 50, 80, 30, out)).toBe(true);
    expect(out).toEqual({ x: 100, y: 50, w: 80, h: 30 });
  });

  it('drops a rectangle that is off the screen, and one that only touches its edge', () => {
    expect(clipToScreen({ x: 0, y: 0, w: 10, h: 10 }, 100, 100, 50, 50, out)).toBe(false);
    expect(clipToScreen({ x: 150, y: 100, w: 10, h: 10 }, 100, 100, 50, 50, out)).toBe(false);
  });

  it('works for a map smaller than the screen (the camera origin is below zero)', () => {
    expect(clipToScreen({ x: 0, y: 0, w: 224, h: 160 }, -208, -100, 640, 360, out)).toBe(true);
    expect(out).toEqual({ x: 0, y: 0, w: 224, h: 160 });
  });
});
