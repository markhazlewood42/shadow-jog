/** How bodies and the frame move: the swing's beats, shake as motion, presses kept through a freeze. */
import { describe, expect, it } from 'vitest';
import { Input } from '../src/engine/input';
import { direction, shakeOffset } from '../src/engine/shake';
import { PARTY_POSE_T, swingBeat } from '../src/scenes/battlekit/motion';

describe('the swing', () => {
  it('gathers (crouching), snaps forward with a smear, then settles back to the line', () => {
    const beats = Array.from({ length: PARTY_POSE_T }, (_, k) => swingBeat(k));
    expect(beats.slice(0, 6).every((b) => b.phase === 'gather' && b.lift <= 0 && b.smear === 0)).toBe(true);
    expect(beats[6]!.phase).toBe('strike');
    expect(beats[6]!.lift).toBeGreaterThanOrEqual(14);
    expect(beats[6]!.smear).toBeGreaterThan(0);
    // The snap is the fastest move of the swing: one frame from crouch to full reach.
    expect(beats[6]!.lift - beats[5]!.lift).toBeGreaterThan(12);
    // It settles monotonically, and is back on the line before the pose ends.
    for (let k = 10; k < PARTY_POSE_T; k++) expect(beats[k]!.lift).toBeLessThanOrEqual(beats[k - 1]!.lift);
    expect(beats[PARTY_POSE_T - 1]!.lift).toBe(0);
  });
});

describe('screen shake', () => {
  it('a blow kicks the frame along its direction first, then springs back past centre', () => {
    const dir = direction({ x: 0, y: 0 }, { x: 10, y: 0 });
    const xs = Array.from({ length: 12 }, (_, t) => shakeOffset({ t, len: 12, mag: 5, dir }).x);
    expect(xs[0]).toBe(5);
    expect(xs.some((x) => x < 0)).toBe(true);
    // Mostly along the blow: the cross-axis stays small.
    for (let t = 0; t < 12; t++) expect(Math.abs(shakeOffset({ t, len: 12, mag: 5, dir }).y)).toBeLessThanOrEqual(1);
  });
  it('fades out and is still at its end', () => {
    const s = { len: 10, mag: 4, dir: null };
    expect(shakeOffset({ ...s, t: 10 })).toEqual({ x: 0, y: 0 });
    const early = Math.max(...[0, 1, 2].map((t) => Math.abs(shakeOffset({ ...s, t }).x) + Math.abs(shakeOffset({ ...s, t }).y)));
    const late = Math.max(...[7, 8, 9].map((t) => Math.abs(shakeOffset({ ...s, t }).x) + Math.abs(shakeOffset({ ...s, t }).y)));
    expect(late).toBeLessThan(early);
  });
  it('a rumble moves smoothly: no frame-to-frame jump beyond its amplitude (plus rounding)', () => {
    let prev = shakeOffset({ t: 0, len: 40, mag: 3, dir: null });
    for (let t = 1; t < 40; t++) {
      const o = shakeOffset({ t, len: 40, mag: 3, dir: null });
      expect(Math.abs(o.x - prev.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(o.y - prev.y)).toBeLessThanOrEqual(4);
      prev = o;
    }
  });
});

describe('input carried through a freeze', () => {
  it('a press held over is seen once more on the next tick, then gone', () => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const win = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] ??= [];
        listeners[type]!.push(fn);
      },
    };
    const input = new Input(win as unknown as Window);
    const key = (type: string) => { for (const fn of listeners[type] ?? []) fn({ code: 'KeyZ', key: 'z', repeat: false, preventDefault: () => undefined }); };
    key('keydown');
    key('keyup');
    input.update();
    expect(input.pressed('confirm')).toBe(true);
    input.carry('confirm');
    input.update();
    expect(input.pressed('confirm')).toBe(true);
    input.update();
    expect(input.pressed('confirm')).toBe(false);
  });
});
