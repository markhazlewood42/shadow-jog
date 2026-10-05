/** Engine level 0 (src/sje/core): the size module, FixedLoop and EventEmitter. */
import { describe, expect, it, vi } from 'vitest';
import { H as OLD_H, W as OLD_W } from '../src/engine/game';
import { EventEmitter } from '../src/sje/core/eventemitter';
import { FixedLoop, MAX_ELAPSED_MS, MAX_TICKS_PER_FRAME } from '../src/sje/core/fixedloop';
import { FPS, grain, H, TICK_MS, W } from '../src/sje/core/size';

describe('size.ts, the one source of the picture size', () => {
  it('is 480x270 at 60 Hz', () => {
    expect([W, H, FPS]).toEqual([480, 270, 60]);
    expect(TICK_MS).toBeCloseTo(16.6667, 3);
  });
  it('grain() gives the coarse layers', () => {
    expect(grain(1)).toEqual({ w: 480, h: 270 });
    expect(grain(2)).toEqual({ w: 240, h: 135 });
    expect(grain(4)).toEqual({ w: 120, h: 67.5 });
  });
  it('the old engine takes W and H from it (so the two engines cannot disagree)', () => {
    expect([OLD_W, OLD_H]).toEqual([W, H]);
  });
});

/** A loop whose ticks and draws are counted. */
function counted(options = {}) {
  const calls = { ticks: 0, draws: 0, alphas: [] as number[], errors: [] as unknown[] };
  const loop = new FixedLoop(
    {
      tick: () => calls.ticks++,
      draw: (a) => {
        calls.draws++;
        calls.alphas.push(a);
      },
      onError: (e) => calls.errors.push(e),
    },
    options,
  );
  return { loop, calls };
}

describe('FixedLoop', () => {
  it('runs a whole tick only when 1000/60 ms have gathered, and keeps the remainder', () => {
    const { loop, calls } = counted();
    expect(loop.advance(10)).toBe(0); // 10 ms: not yet
    expect(loop.advance(10)).toBe(1); // 20 ms: one tick, 3.33 ms left
    expect(loop.accumulator).toBeCloseTo(20 - TICK_MS, 6);
    expect(loop.advance(10)).toBe(0);
    expect(loop.advance(10)).toBe(1); // 40 ms in all = 2 ticks and 6.67 ms
    expect(calls.ticks).toBe(2);
    expect(calls.draws).toBe(4); // one draw per frame, ticks or not
  });

  it('draws once per frame, with alpha = how far into the next tick the frame is', () => {
    const { loop, calls } = counted();
    loop.advance(TICK_MS / 2);
    expect(calls.alphas[0]).toBeCloseTo(0.5, 6);
  });

  it('clamps one frame to 250 ms and runs at most 5 ticks, then DROPS the backlog', () => {
    expect(MAX_ELAPSED_MS).toBe(250);
    expect(MAX_TICKS_PER_FRAME).toBe(5);
    const { loop, calls } = counted();
    // A tab that was hidden for ten seconds comes back: 5 ticks, not 600.
    expect(loop.advance(10_000)).toBe(5);
    expect(loop.accumulator).toBe(0); // the owed time is dropped, not chased
    expect(loop.advance(0)).toBe(0);
    expect(calls.ticks).toBe(5);
  });

  it('exactly 5 ticks of time is also treated as a full frame (backlog dropped)', () => {
    const { loop } = counted();
    expect(loop.advance(TICK_MS * 5 + 1)).toBe(5);
    expect(loop.accumulator).toBe(0);
  });

  it('ignores a negative elapsed time (a clock that stepped back)', () => {
    const { loop } = counted();
    expect(loop.advance(-50)).toBe(0);
    expect(loop.accumulator).toBe(0);
  });

  it('gives the same tick count at 30, 60 and 144 Hz over the same time (determinism by tick)', () => {
    const totals: number[] = [];
    for (const hz of [30, 60, 144, 240]) {
      const { loop, calls } = counted();
      const frames = hz * 10; // ten seconds
      for (let i = 0; i < frames; i++) loop.advance(1000 / hz);
      totals.push(calls.ticks);
    }
    // 10 s = 600 ticks, give or take the one tick that is still in the accumulator.
    for (const t of totals) expect(Math.abs(t - 600)).toBeLessThanOrEqual(1);
  });

  it('runs `speed` ticks per step', () => {
    const { loop, calls } = counted();
    loop.speed = 3;
    loop.advance(TICK_MS + 0.1);
    expect(calls.ticks).toBe(3);
  });

  it('start() schedules a frame first, so a throwing frame cannot stop the loop; errors are reported', () => {
    let scheduled = 0;
    const frame: { cb: ((now: number) => void) | null } = { cb: null };
    const errors: unknown[] = [];
    const loop = new FixedLoop(
      {
        tick: () => {
          throw new Error('tick broke');
        },
        draw: () => undefined,
        onError: (e) => errors.push(e),
      },
      {
        requestFrame: (f) => {
          frame.cb = f;
          scheduled++;
          return scheduled;
        },
        cancelFrame: () => undefined,
        now: () => 0,
      },
    );
    loop.start();
    expect(loop.running).toBe(true);
    expect(scheduled).toBe(1);
    frame.cb?.(20);
    expect(scheduled).toBe(2); // the next frame was asked for even though this one threw
    expect(errors).toHaveLength(1);
    frame.cb?.(40);
    expect(scheduled).toBe(3);
  });

  it('start twice does nothing the second time; stop cancels', () => {
    const cancel = vi.fn();
    let n = 0;
    const loop = new FixedLoop({ tick: () => undefined, draw: () => undefined }, { requestFrame: () => ++n, cancelFrame: cancel, now: () => 0 });
    loop.start();
    loop.start();
    expect(n).toBe(1);
    loop.stop();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(loop.running).toBe(false);
  });
});

describe('EventEmitter', () => {
  interface Ev {
    hit(n: number): void;
    quit(): void;
  }
  it('calls listeners in the order they were added, with the arguments', () => {
    const e = new EventEmitter<Ev>();
    const got: string[] = [];
    e.on('hit', (n) => got.push(`a${n}`));
    e.on('hit', (n) => got.push(`b${n}`));
    expect(e.emit('hit', 3)).toBe(true);
    expect(got).toEqual(['a3', 'b3']);
    expect(e.emit('quit')).toBe(false);
  });

  it('once fires once, and an emit from inside it cannot fire it again', () => {
    const e = new EventEmitter<Ev>();
    let n = 0;
    e.once('hit', () => {
      n++;
      e.emit('hit', 0);
    });
    e.emit('hit', 1);
    e.emit('hit', 2);
    expect(n).toBe(1);
  });

  it('a listener that removes itself or another during an emit does not skip or repeat anyone', () => {
    const e = new EventEmitter<Ev>();
    const got: string[] = [];
    const b = () => got.push('b');
    const a = () => {
      got.push('a');
      e.off('hit', a);
      e.off('hit', b);
    };
    e.on('hit', a);
    e.on('hit', b);
    e.on('hit', () => got.push('c'));
    e.emit('hit', 0);
    expect(got).toEqual(['a', 'b', 'c']); // b still hears THIS emit: the list was fixed when it began
    got.length = 0;
    e.emit('hit', 0);
    expect(got).toEqual(['c']);
  });

  it('passes the context as `this`, and off() with a context removes only that one', () => {
    const e = new EventEmitter<Ev>();
    const seen: unknown[] = [];
    const fn = function (this: unknown) {
      seen.push(this);
    };
    const c1 = { id: 1 };
    const c2 = { id: 2 };
    e.on('quit', fn, c1);
    e.on('quit', fn, c2);
    e.off('quit', fn, c1);
    e.emit('quit');
    expect(seen).toEqual([c2]);
  });

  it('off() with no function removes every listener of the event; removeAllListeners clears all', () => {
    const e = new EventEmitter<Ev>();
    e.on('hit', () => undefined).on('hit', () => undefined).on('quit', () => undefined);
    expect(e.listenerCount('hit')).toBe(2);
    e.off('hit');
    expect(e.listenerCount('hit')).toBe(0);
    e.removeAllListeners();
    expect(e.listenerCount('quit')).toBe(0);
  });
});
