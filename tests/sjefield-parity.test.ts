/**
 * The field parity harness's pure parts, tested on made-up pictures (M5 task 8): `e2e/sjefieldparity.ts`. The e2e spec (`e2e/sje-field-parity.spec.ts`) runs the same code on the
 * real frames and has its own controls in the real scene (a 2/255 step, an actor one pixel off, a wrong light radius). Here the gates are shown to fail what they must fail:
 *  - the STRICT gate passes an exact copy and 1/255 noise inside the renderer mask, and fails 1/255 outside it and 2/255 inside it;
 *  - the renderer mask is the union of the pixels where the gpu and the soft reference differ;
 *  - the MEASURED BOUNDS pass a frame inside them and fail a 2/255 step, a pixel moved, and a missing bound.
 */
import { describe, expect, it } from 'vitest';
import { BOUNDS, H, measure, outsideBounds, type Picture, rendererMask, strictCompare, unevenBlocks, W, withStep } from '../e2e/sjefieldparity';

const SW = W * 2;
const SH = H * 2;

/** A made-up lit floor: a smooth ramp with a lighter patch (so a step is a small change on a changing background). */
function frame(): Picture {
  const data = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      data[i] = 30 + (y >> 3);
      data[i + 1] = 28 + (x >> 4);
      data[i + 2] = 60;
      data[i + 3] = 255;
    }
  return { w: SW, h: SH, data };
}

const copy = (p: Picture): Picture => ({ w: p.w, h: p.h, data: new Uint8Array(p.data) });
const bump = (p: Picture, x: number, y: number, by: number): void => {
  p.data[(y * p.w + x) * 4] = (p.data[(y * p.w + x) * 4] ?? 0) + by;
};
const noMask = (): Uint8Array => new Uint8Array(SW * SH);
const fullMask = (): Uint8Array => new Uint8Array(SW * SH).fill(1);

describe('the strict gate', () => {
  it('passes an exact copy', () => {
    const r = strictCompare(frame(), frame(), noMask());
    expect(r).toMatchObject({ outside: 0, insideOver1: 0, insideNoise: 0, max: 0, ok: true });
  });

  it('passes 1/255 noise inside the mask and counts it', () => {
    const now = copy(frame());
    for (let x = 0; x < 100; x++) bump(now, x, 10, 1);
    const mask = noMask();
    for (let x = 0; x < 100; x++) mask[10 * SW + x] = 1;
    const r = strictCompare(now, frame(), mask);
    expect(r.ok).toBe(true);
    expect(r.insideNoise).toBe(100);
  });

  it('fails 1/255 outside the mask, and 2/255 inside it', () => {
    const one = copy(frame());
    bump(one, 5, 5, 1);
    const outside = strictCompare(one, frame(), noMask());
    expect(outside.ok).toBe(false);
    expect(outside.outside).toBe(1);
    expect(outside.samples[0]).toMatchObject({ x: 5, y: 5 });
    const two = copy(frame());
    bump(two, 5, 5, 2);
    const inside = strictCompare(two, frame(), fullMask());
    expect(inside.ok).toBe(false);
    expect(inside.insideOver1).toBe(1);
  });

  it('refuses pictures of different sizes', () => {
    expect(() => strictCompare({ w: 2, h: 2, data: new Uint8Array(16) }, frame(), noMask())).toThrow(/differ in size/);
  });
});

describe('the renderer mask', () => {
  it('is where the gpu and the soft picture differ, over every pair', () => {
    const a = frame();
    const b = copy(a);
    bump(b, 3, 4, 1);
    const c = copy(a);
    bump(c, 9, 9, 3);
    const mask = rendererMask([{ gpu: a, soft: b }, { gpu: a, soft: c }]);
    expect(mask[4 * SW + 3]).toBe(1);
    expect(mask[9 * SW + 9]).toBe(1);
    expect(mask.reduce((n, v) => n + v, 0)).toBe(2);
  });

  it('refuses pairs of different sizes and an empty list', () => {
    expect(() => rendererMask([{ gpu: frame(), soft: { w: 1, h: 1, data: new Uint8Array(4) } }])).toThrow(/differ in size/);
    expect(() => rendererMask([])).toThrow(/no reference pairs/);
  });
});

describe('withStep and unevenBlocks', () => {
  it('raises the red channel by the step, and takes it from the other side at 255', () => {
    const p = frame();
    p.data[0] = 255;
    const s = withStep(p, 2);
    expect(s.data[0]).toBe(253);
    expect(s.data[4]).toBe((p.data[4] ?? 0) + 2);
    expect(p.data[4]).toBe(frame().data[4]); // the input is untouched
  });

  it('counts the 2x2 blocks that are not flat', () => {
    const p = frame();
    // The ramp changes every 8 rows and 16 columns, so the made-up picture is flat in whole blocks except where a ramp step falls inside one: 0 for k = 1.
    expect(unevenBlocks(p, 1)).toBe(0);
    const q = copy(p);
    bump(q, 1, 1, 5);
    expect(unevenBlocks(q, 2)).toBe(1);
  });
});

describe('the measured bounds', () => {
  it('pass an exact copy and a frame at 1/255, in every kind and level that has bounds', () => {
    const near = copy(frame());
    for (let x = 0; x < 1000; x++) bump(near, x, 20, 1);
    for (const kind of ['soft', 'gpu'] as const)
      for (const fx of ['none', 'full'] as const) {
        if (!BOUNDS[kind][fx]) continue;
        expect(outsideBounds(kind, fx, measure(frame(), frame())), `${kind} ${fx}`).toEqual([]);
        expect(outsideBounds(kind, fx, measure(near, frame())), `${kind} ${fx}`).toEqual([]);
      }
  });

  it('fail a 2/255 step over the whole picture (the control), at every level that has bounds for none', () => {
    const stepped = withStep(frame(), 2);
    expect(outsideBounds('gpu', 'none', measure(stepped, frame())).length).toBeGreaterThan(0);
    expect(outsideBounds('soft', 'none', measure(stepped, frame())).length).toBeGreaterThan(0);
  });

  it('fail a pixel that moved (a large step in a few pixels) and say which bound', () => {
    const moved = copy(frame());
    bump(moved, 7, 7, 40);
    const problems = outsideBounds('gpu', 'none', measure(moved, frame()));
    expect(problems.join(' ')).toMatch(/largest step is 40/);
    // The same frame is inside a bound that allows it: the check looks at the number, not at the kind.
    expect(outsideBounds('gpu', 'full', measure(moved, frame()))).toEqual(['the largest step is 40/255, the bound is 16']);
  });

  it('say so when a kind has no bounds (software GL cannot run the full stack on the old path)', () => {
    expect(outsideBounds('soft', 'full', measure(frame(), frame()))).toEqual(['no bounds for soft at fx full']);
  });
});
