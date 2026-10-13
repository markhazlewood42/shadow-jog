/**
 * Fix round 2 of PR #80 (the review findings 1, 2, 3, 6 and 7): each case fails on the code before the fix.
 *  1 a throw inside the cover's tick ends the run `aborted` (E11: a hack always resolves)
 *  2 a call with neither `playAlternative` nor `onUnsupported: 'win'` is loud in DEV and still resolves
 *  3 the one retry after a lost context waits for the context (D3 grace) before it tries again
 *  6 `parseTicks` has an upper bound
 *  7 one reading of `?seed=`
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHackUnsupported } from '../src/game/hackseam';
import { hackWithPolicy, RETRY_WAIT_MS, waitForContext } from '../src/hack3d/door';
import { MAX_ROUTE_TICKS, parseTicks } from '../src/hack3d/data';
import { makeHackDef } from '../src/hack3d/data';
import type { HackResult } from '../src/hack3d/result';
import { parseSeed } from '../src/sje/runtime/devseed';

// A stand-in for the engine's display classes: the cover builds objects, and the test only needs them to exist.
vi.mock('../src/sje', () => {
  class Obj {
    x = 0;
    y = 0;
    ctx = {};
    add(): this {
      return this;
    }
    setDepth(): this {
      return this;
    }
    setVisible(): this {
      return this;
    }
    setAlpha(): this {
      return this;
    }
    setPosition(): this {
      return this;
    }
    fillStyle(): this {
      return this;
    }
    fillRect(): this {
      return this;
    }
    refresh(): void {}
    destroy(): void {}
  }
  return { Container: Obj, Graphics: Obj, CanvasImage: Obj, drawText: () => undefined, measure: () => 10, W: 320, H: 180 };
});
const { makeJack } = await import('../src/hack3d/jack');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DEF = makeHackDef();
const LOST: HackResult = { status: 'aborted', reason: 'context-lost' };

describe('finding 1: a throw in the cover tick settles the run', () => {
  it('run() resolves aborted, the tick listener is removed, and the error is logged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal("location", { search: "" });
    const handlers: Array<() => void> = [];
    const game = {
      fx: { level: 'none', glitches: [] as object[], playMoment: () => undefined },
      events: { on: (_n: string, h: () => void) => handlers.push(h), off: (_n: string, h: () => void) => void handlers.splice(handlers.indexOf(h), 1) },
      screen: { overlayRoot: { add: () => undefined } },
      shake: () => undefined,
    };
    const jack = await makeJack(game as never, 1, { style: 'glitch' });
    if (!jack) throw new Error('no cover');
    const run = jack.run({
      holdReleased: () => {
        throw new Error('boom');
      },
      onSwap: () => 'go',
      swapDone: () => true,
    });
    for (const h of [...handlers]) h(); // one tick
    expect(await Promise.race([run, new Promise((r) => setTimeout(() => r('pending'), 50))])).toBe('aborted');
    expect(handlers.length).toBe(0);
  });
});

describe('finding 2: no silent default for the author', () => {
  it('neither field: console.error in DEV, and the hack still resolves (the shipped game would resolve too)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await runHackUnsupported(DEF, {} as never);
    expect(out.outcome).toBe('success');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/E19/);
  });
  it('the explicit win is not logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runHackUnsupported(DEF, { onUnsupported: 'win' });
    expect(err).not.toHaveBeenCalled();
  });
});

describe('finding 3: the retry waits for the context', () => {
  it('by default the retry does not run before the grace has passed', async () => {
    vi.useFakeTimers();
    const results = [LOST, { status: 'success' } as HackResult];
    const tryHack = vi.fn(async () => results.shift() ?? LOST);
    const p = hackWithPolicy(DEF, tryHack, async () => 'fail');
    await vi.advanceTimersByTimeAsync(RETRY_WAIT_MS - 10);
    expect(tryHack).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(tryHack).toHaveBeenCalledTimes(2);
    expect(await p).toMatchObject({ outcome: 'success', via: 'played' });
  });

  it('waitForContext ends when the context is restored, before the timeout', async () => {
    vi.useFakeTimers();
    let restore: () => void = () => undefined;
    const game = {
      contextLost: true,
      events: { on: (_n: string, h: () => void) => {
          restore = h;
        }, off: () => undefined },
    };
    let done = false;
    void waitForContext(game as never, 1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('waitForContext gives up after the grace if the context never returns, and is at once when nothing is lost', async () => {
    vi.useFakeTimers();
    const lost = { contextLost: true, events: { on: () => undefined, off: () => undefined } };
    let done = false;
    void waitForContext(lost as never, 1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    await expect(waitForContext({ contextLost: false } as never)).resolves.toBeUndefined();
  });
});

describe('finding 6: parseTicks has an upper bound', () => {
  it('takes the cap, refuses one more, and refuses 1e15', () => {
    expect(parseTicks(String(MAX_ROUTE_TICKS))).toBe(MAX_ROUTE_TICKS);
    expect(parseTicks(String(MAX_ROUTE_TICKS + 1))).toBeNull();
    expect(parseTicks('1e15')).toBeNull();
    expect(parseTicks('900')).toBe(900);
  });
});

describe('finding 7: one reading of ?seed=', () => {
  it('a missing, empty, blank or non-numeric value is no seed (never 0)', () => {
    for (const v of [null, '', '  ', 'abc', 'Infinity']) expect(parseSeed(v), String(v)).toBeUndefined();
  });
  it('a finite number is the seed, 0 included', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('-7')).toBe(-7);
  });
});
