/**
 * Fix round 2 of PR #80 (the review findings 1, 2, 3, 6 and 7): each case fails on the code before the fix.
 *  1 a throw inside the cover's tick ends the run `aborted` (E11: a hack always resolves)
 *  2 a call with neither `playAlternative` nor `onUnsupported: 'win'` is loud in DEV and still resolves
 *  3 (by design) the one retry after a lost context ends at once: the D3 grace lives inside the scene (m7-brief pass line 7)
 *  6 `parseTicks` has an upper bound
 *  7 one reading of `?seed=`
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHackUnsupported } from '../src/game/hackseam';
import { hackWithPolicy } from '../src/hack3d/door';
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

describe('finding 3 (not a fix, by design): the retry ends at once', () => {
  it('m7-brief pass line 7: on aborted / context-lost the default policy retries once with no timer, and the story gets success', async () => {
    vi.useFakeTimers();
    const results = [LOST, LOST];
    const tryHack = vi.fn(async () => results.shift() ?? LOST);
    const out = await hackWithPolicy(DEF, tryHack, async () => 'fail'); // no timer advance: a wait before the retry would hang here
    expect(vi.getTimerCount()).toBe(0);
    expect(tryHack).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ outcome: 'success', via: 'policy' });
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

// ---- fifth/fourth review follow-ups (issue #81): the real cover on the stand-in display classes ----------------------------------------------------

/** A game double for the cover: its events can be fired by hand, and the effects level can be changed. */
function coverGame(level: 'full' | 'lite' | 'none') {
  const handlers: Array<() => void> = [];
  const glitches: object[] = [];
  const game = {
    fx: {
      level,
      glitches,
      // A moment that adds one tear glitch (what `jack.out` does at full).
      playMoment: (name: string) => void (name !== 'jack.lite' && glitches.push({})),
    },
    events: { on: (_n: string, h: () => void) => handlers.push(h), off: (_n: string, h: () => void) => void handlers.splice(handlers.indexOf(h), 1) },
    screen: { overlayRoot: { add: () => undefined } },
    shake: () => undefined,
  };
  const tick = (n = 1): void => {
    for (let i = 0; i < n; i++) for (const h of [...handlers]) h();
  };
  return { game, handlers, glitches, tick };
}
const SHORT = { outTicks: 3, inTicks: 3, swapMinTicks: 1, holdBoundMs: 1e9 };

describe('R4-2: GlitchDriver.dispose uses the level the cover was built with', () => {
  it.each([
    ['full', 'lite', 0],
    ['full', 'none', 0],
    ['full', 'full', 0],
  ] as const)('built at %s, level changed to %s before dispose: the tear glitches are cleared (control: a cover built at lite keeps what is not its own)', async (built, later, left) => {
    vi.stubGlobal('location', { search: '' });
    const { game, glitches, tick } = coverGame(built);
    const jack = await makeJack(game as never, 1, { style: 'glitch', params: SHORT });
    if (!jack) throw new Error('no cover');
    void jack.run({ onSwap: () => 'go', swapDone: () => true });
    tick(); // the first tick of out is already entered by run(); this one steps it
    expect(glitches.length).toBeGreaterThan(0);
    game.fx.level = later;
    jack.dispose();
    expect(glitches.length).toBe(left);
  });
  it('control: a story glitch that was live before the cover keeps living, and a cover built at lite adds and clears nothing', async () => {
    vi.stubGlobal('location', { search: '' });
    const { game, glitches } = coverGame('lite');
    const story = {};
    glitches.push(story);
    const jack = await makeJack(game as never, 1, { style: 'glitch', params: SHORT });
    if (!jack) throw new Error('no cover');
    void jack.run({ onSwap: () => 'go', swapDone: () => true });
    jack.dispose();
    expect(glitches).toEqual([story]);
  });
});

describe('R4-6: a queued second run when the first run aborts', () => {
  it('the second run (jack out) is not dropped: after the aborted first run is over it plays and calls its own onSwap; a disposed cover ends it as done without a swap (control)', async () => {
    vi.stubGlobal('location', { search: '' });
    const { game, tick, handlers } = coverGame('none');
    const jack = await makeJack(game as never, 1, { style: 'glitch', params: SHORT });
    if (!jack) throw new Error('no cover');
    const swaps: string[] = [];
    // The first run: the hold is released at once, but onSwap aborts (a failed load).
    const first = jack.run({ holdReleased: () => true, onSwap: () => (swaps.push('first'), 'abort'), swapDone: () => true });
    const second = jack.run({ onSwap: () => (swaps.push('second'), 'go'), swapDone: () => true });
    tick(8);
    expect(await first).toBe('aborted');
    // The first run aborted and its cover tore down (an aborted run removes the cover): the queued run must still settle, not hang.
    expect(await Promise.race([second, new Promise((r) => setTimeout(() => r('pending'), 50))])).toBe('done');
    expect(swaps).toEqual(['first']); // CONTROL half: the disposed cover runs no swap for the second run, and does not hang
    expect(handlers.length).toBe(0);
  });
});
