/** score (scripts/art/score.mjs): IoU and copy match of a candidate against the given frame, over shifts -6..6. */
import { describe, expect, it } from 'vitest';
import { frames, newImage, readPng } from '../scripts/art/pixkit/index.mjs';
import type { Img } from '../scripts/art/pixkit/index.mjs';
import { scoreCandidate, shiftScores } from '../scripts/art/score.mjs';
import { walkSheet } from './helpers/rookwalk';

const key = frames(readPng(walkSheet()), 32, 32)[4] as Img;

/** The image moved by (dx, dy). */
function moved(img: Img, dx: number, dy: number): Img {
  const out = newImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
      out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (ny * img.w + nx) * 4);
    }
  return out;
}

describe('score', () => {
  it('the given frame against itself gives IoU 1 and copy match 1 at shift 0,0', () => {
    const s = shiftScores(key, key);
    expect(s.iou).toEqual({ value: 1, dx: 0, dy: 0 });
    expect(s.copy).toEqual({ value: 1, dx: 0, dy: 0 });
  });

  it('a copy shifted by 2 px gives IoU 1 and copy match 1 at shift (2, 0) or (-2, 0)', () => {
    const s = shiftScores(moved(key, 2, 0), key);
    expect(s.iou.value).toBe(1);
    expect(s.copy.value).toBe(1);
    expect(Math.abs(s.iou.dx)).toBe(2);
    expect(s.iou.dy).toBe(0);
    expect(s.copy.dx).toBe(s.iou.dx);
  });

  it('an empty image gives 0', () => {
    const s = shiftScores(newImage(32, 32), key);
    expect(s.iou.value).toBe(0);
    expect(s.copy.value).toBe(0);
    expect(scoreCandidate(newImage(32, 32), key).colors).toBe(0);
  });

  it('a half-transparent candidate does not count as opaque', () => {
    const half = newImage(32, 32);
    half.data.set(key.data);
    for (let i = 3; i < half.data.length; i += 4) if (half.data[i] === 255) half.data[i] = 128;
    expect(shiftScores(half, key).iou.value).toBe(0);
  });
});
