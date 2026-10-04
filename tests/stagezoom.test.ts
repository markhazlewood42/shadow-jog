import { describe, expect, it } from 'vitest';
import { cssZoom, devicePixelsPerGamePixel } from '../src/stage/zoom';

describe('whole-number zoom in device pixels (so a 125% Windows display stays crisp)', () => {
  it('at 100% it is the biggest whole number that fits both ways', () => {
    expect(devicePixelsPerGamePixel(960, 540, 480, 270, 1)).toBe(2);
    expect(devicePixelsPerGamePixel(1500, 900, 480, 270, 1)).toBe(3);
    expect(devicePixelsPerGamePixel(1919, 1079, 480, 270, 1)).toBe(3);
    expect(devicePixelsPerGamePixel(1920, 1080, 480, 270, 1)).toBe(4);
    // Tall and narrow: the width limits it.
    expect(devicePixelsPerGamePixel(700, 2000, 480, 270, 1)).toBe(1);
  });

  it('at 125% a 960x540 CSS window is 1200x675 device pixels: 2 device pixels per game pixel, which is 1.6 CSS pixels', () => {
    const k = devicePixelsPerGamePixel(960, 540, 480, 270, 1.25);
    expect(k).toBe(2);
    expect(cssZoom(k, 1.25)).toBeCloseTo(1.6, 10);
    // A plain CSS zoom of 2 would have been 2.5 device pixels per game pixel: uneven columns.
    expect(2 * 1.25).toBe(2.5);
  });

  it('at 150% and 200%', () => {
    expect(devicePixelsPerGamePixel(1280, 720, 480, 270, 1.5)).toBe(4); // 1920x1080 device pixels
    expect(cssZoom(4, 1.5)).toBeCloseTo(8 / 3, 10);
    expect(devicePixelsPerGamePixel(960, 540, 480, 270, 2)).toBe(4);
    expect(cssZoom(4, 2)).toBe(2);
  });

  it('an exact fit never loses a step to float error, and it is never less than 1', () => {
    expect(devicePixelsPerGamePixel(1152, 648, 480, 270, 1.25)).toBe(3);
    expect(devicePixelsPerGamePixel(10, 10, 480, 270, 1)).toBe(1);
    expect(devicePixelsPerGamePixel(0, 0, 480, 270, 1)).toBe(1);
  });

  it('the canvas the zoom makes is a whole number of device pixels wide', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5]) {
      for (const w of [800, 1000, 1366, 1500, 1920]) {
        const k = devicePixelsPerGamePixel(w, (w * 9) / 16, 480, 270, dpr);
        expect(480 * cssZoom(k, dpr) * dpr).toBeCloseTo(480 * k, 6);
      }
    }
  });
});
