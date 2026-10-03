import { describe, expect, it } from 'vitest';
import { boxOf } from '../src/art/rig2/sfgeom';
import { kneelRaw } from '../src/stage/kneel';
import type { Raw } from '../src/stage/pixels';

/** A 20x40 canvas with a 10-wide, 30-tall figure in it: head (rows 5-9), body, legs to row 34. */
function figure(): Raw {
  const r: Raw = { w: 20, h: 40, px: new Uint8ClampedArray(20 * 40 * 4) };
  for (let y = 5; y <= 34; y++) for (let x = 5; x < 15; x++) r.px.set([200, 100 + y, 50, 255], (y * 20 + x) * 4);
  return r;
}

describe('the kneel (a fallen hero made from the hero’s own idle)', () => {
  const src = figure();
  const box = boxOf(src);
  const k = kneelRaw(src, box, 1, 3);
  const kb = boxOf(k);

  it('keeps the soles on the same row and is shorter than the standing figure', () => {
    expect(kb.y1).toBe(box.y1);
    expect(kb.y1 - kb.y0).toBeLessThan(box.y1 - box.y0);
  });

  it('is made only of the original’s pixels, moved (no new colours, no blur)', () => {
    const colours = new Set<string>();
    for (let i = 0; i < src.px.length; i += 4) if (src.px[i + 3]) colours.add(`${src.px[i]},${src.px[i + 1]},${src.px[i + 2]}`);
    for (let i = 0; i < k.px.length; i += 4) if (k.px[i + 3]) expect(colours.has(`${k.px[i]},${k.px[i + 1]},${k.px[i + 2]}`)).toBe(true);
  });

  it('pushes the upper body forward by the lean and leaves the legs where they were', () => {
    expect(kb.x1).toBe(box.x1 + 3);
    // The bottom row (the soles) is not shifted.
    let minX = 99;
    for (let x = 0; x < 20; x++) if (k.px[(kb.y1 * 20 + x) * 4 + 3]) minX = Math.min(minX, x);
    expect(minX).toBe(5);
  });

  it('mirrors for a figure that faces left', () => {
    const l = boxOf(kneelRaw(src, box, -1, 3));
    expect(l.x0).toBe(box.x0 - 3);
  });
});
