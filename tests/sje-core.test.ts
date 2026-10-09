/**
 * New engine core (level 0) pieces that M1 touched (docs/engine/m1-brief.md tasks 5 and 11): the moved Rng and the loop's record hook.
 */
import { describe, expect, it } from 'vitest';
import * as oldPath from '../src/engine/rng';
import { FixedLoop } from '../src/sje/core/fixedloop';
import * as moved from '../src/sje/core/rng';
import { TICK_MS } from '../src/sje/core/size';

describe('Rng moved to src/sje/core/rng.ts (task 11)', () => {
  it('the old import path re-exports the very same objects, so no old import changed', () => {
    expect(oldPath.Rng).toBe(moved.Rng);
    expect(oldPath.streams).toBe(moved.streams);
    expect(oldPath.hash2).toBe(moved.hash2);
    expect(oldPath.fbm).toBe(moved.fbm);
    expect(oldPath.valueNoise).toBe(moved.valueNoise);
  });

  it('the numbers did not change in the move: the default seed gives the values the old file gave (recorded before the move)', () => {
    const r = new moved.Rng();
    expect([r.next(), r.next(), r.int(1, 6), moved.hash2(3, 4, 5), moved.fbm(1.5, 2.5, 3, 7)]).toEqual([
      0.7100320369936526, 0.286336648510769, 6, 0.5985523702111095, 0.39714557491242886,
    ]);
  });

  it('control: another seed gives other numbers (the golden values above would notice a changed algorithm)', () => {
    expect(new moved.Rng(1).next()).not.toBe(0.7100320369936526);
  });
});

describe('FixedLoop record hook (the old perf.record)', () => {
  it('is called once per frame with the frame cost and the tick part of it', () => {
    let t = 0;
    const calls: Array<[number, number]> = [];
    const loop = new FixedLoop(
      {
        tick: () => {
          t += 2;
        },
        draw: () => {
          t += 3;
        },
        record: (frameMs, tickMs) => calls.push([frameMs, tickMs]),
      },
      { now: () => t },
    );
    loop.advance(2 * TICK_MS + 0.01);
    // Two ticks of 2 ms, then a draw of 3 ms.
    expect(calls).toEqual([[7, 4]]);
  });

  it('control: without the hook nothing is measured and nothing breaks', () => {
    let ticks = 0;
    const loop = new FixedLoop({ tick: () => ticks++, draw: () => undefined });
    expect(loop.advance(TICK_MS + 0.01)).toBe(1);
    expect(ticks).toBe(1);
  });
});
