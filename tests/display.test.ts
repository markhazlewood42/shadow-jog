/**
 * The scale rule of the display (`cssScaleFor` in src/engine/display.ts), pinned as a table of
 * window sizes: docs/PIVOT-640.md, D14 and PL7. The screen is W by H game pixels (640 by 360), so
 * a window of 1280x720 is exactly 2x, 1920x1080 is 3x, 2560x1440 is 4x and 3840x2160 is 6x.
 *
 * The rule has two modes. Fill ('fit') snaps to a whole multiple when that multiple fills at least
 * 90% of the largest scale that fits, and resamples slightly otherwise. Pixel-perfect ('integer')
 * always snaps. The table below is written as window sizes divided by W and H, so it states what
 * the rule gives at the real screen size, and the 90% line is where each row falls on it.
 */
import { describe, expect, it } from 'vitest';
import { H, W } from '../src/sje/core/size';
import { cssScaleFor } from '../src/engine/display';

/** The scale the display uses for a window, in CSS pixels per game pixel. */
const fill = (vw: number, vh: number, dpr = 1) => cssScaleFor(vw, vh, dpr, 'fit');
const perfect = (vw: number, vh: number, dpr = 1) => cssScaleFor(vw, vh, dpr, 'integer');

describe('the screen is 640 by 360 (the table below is written for it)', () => {
  it('has the size the table assumes', () => {
    expect([W, H]).toEqual([640, 360]);
  });
});

describe('Fill mode: the common windows are exact multiples', () => {
  it.each([
    ['720p', 1280, 720, 2],
    ['the Steam Deck window', 1280, 800, 2],
    ['1080p', 1920, 1080, 3],
    ['1440p', 2560, 1440, 4],
    ['4K', 3840, 2160, 6],
  ])('%s (%ix%i) gives %ix', (_name, vw, vh, k) => {
    expect(fill(vw, vh)).toBe(k);
  });

  it('snaps a window a little off a whole multiple (the 90% rule)', () => {
    // 1366x768 fits at 2.13x: 2x is 94% of it, so it snaps to 2x.
    expect(fill(1366, 768)).toBe(2);
    // 1280x768 fits at 2x exactly (the height gives 2.13).
    expect(fill(1280, 768)).toBe(2);
    // 1920x1000 fits at 2.78x: 2x is only 72% of it, so it does not snap.
    expect(fill(1920, 1000)).toBeCloseTo(1000 / H, 10);
  });
});

describe('Fill mode: an awkward window is resampled slightly, not shown with thick bars', () => {
  // Each row is the window of inventory row 223: the largest fit is more than 1/0.9 times the
  // whole multiple below it, so the rule keeps the fractional fit.
  it.each([
    ['1536x864 (2.4x)', 1536, 864, 2.4],
    ['1600x900 (2.5x)', 1600, 900, 2.5],
    ['1440x900 (2.25x)', 1440, 900, 2.25],
    ['a maximized 1920x947 (2.63x)', 1920, 947, 947 / H],
  ])('%s keeps its fractional fit', (_name, vw, vh, scale) => {
    expect(fill(vw, vh)).toBeCloseTo(scale, 10);
  });

  it('is decided at the 90% line, a hair either side of it', () => {
    // A fit of 2 / 0.9 = 2.222x is where 2x is exactly 90% of it. The windows are wide and short of
    // height limits, so the width decides. A hair above the line, 2x is under 90%: no snap.
    const tall = H * 10;
    const above = Math.round((W * 2) / 0.9) + 1;
    expect(fill(above, tall)).toBeCloseTo(above / W, 10);
    // A hair below the line, 2x is above 90%: it snaps.
    expect(fill(Math.floor((W * 2) / 0.9), tall)).toBe(2);
  });

  it('never snaps a window smaller than the screen', () => {
    // 600x340 fits at 0.94x (the width limits): below 1x, so the frame is shrunk to fit, not snapped to 0.
    expect(fill(600, 340)).toBeCloseTo(600 / W, 10);
    expect(perfect(600, 340)).toBeCloseTo(600 / W, 10);
  });
});

describe('Pixel-perfect mode always snaps to a whole multiple', () => {
  it.each([
    ['720p', 1280, 720, 2],
    ['the Steam Deck window', 1280, 800, 2],
    ['1080p', 1920, 1080, 3],
    ['1440p', 2560, 1440, 4],
    ['4K', 3840, 2160, 6],
    ['1536x864', 1536, 864, 2],
    ['1600x900', 1600, 900, 2],
    ['a maximized 1920x947', 1920, 947, 2],
  ])('%s (%ix%i) gives %ix', (_name, vw, vh, k) => {
    expect(perfect(vw, vh)).toBe(k);
  });
});

describe('a display with more than one device pixel per CSS pixel', () => {
  it('snaps to a whole number of DEVICE pixels per game pixel', () => {
    // A 1280x720 CSS window on a dpr-2 screen is 2560x1440 device pixels: 4 device pixels per
    // game pixel, which is 2 CSS pixels.
    expect(fill(1280, 720, 2)).toBe(2);
    // 1100x640 CSS at dpr 1.25 fits at 1.72x CSS (2.15 device px per game pixel). The whole device
    // multiple is 2, which is 1.6 CSS px: 93% of the fit, so it snaps.
    expect(fill(1100, 640, 1.25)).toBeCloseTo(1.6, 10);
    // 1000x600 CSS at dpr 1.25 fits at 1.56x (1.95 device px): the whole multiple is 1 (0.8 CSS
    // px), only 51% of the fit, so the fit is kept.
    expect(fill(1000, 600, 1.25)).toBeCloseTo(1000 / W, 10);
  });
});
