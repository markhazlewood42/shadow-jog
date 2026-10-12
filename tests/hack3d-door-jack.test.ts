/**
 * The door with a cover (M7 task 7; docs/engine/m7-brief.md pass lines 19 to 22). A FAKE cover (`env.jack`) that records the order of the calls, and a fake chunk, so the order
 * of the jump runs in Node: the chunk load starts at the first tick, the scene starts in the swap and draws its first frame BEFORE the reveal, the sim's end closes the cover before
 * the scene goes, and every way out of the door takes the cover away. The real cover and its pictures are e2e/sje-hack.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DoorEnv, hackDoor } from '../src/hack3d/door';
import type { HackOptions } from '../src/hack3d/hackscene';
import type { Jack, JackRun } from '../src/hack3d/jack';
import type { HackDef, HackResult } from '../src/hack3d/result';
import type { Game } from '../src/sje';

const DEF: HackDef = { id: 'h', seed: 1, ticks: 60, iceCount: 2, traceLimit: 100, hitCost: 10 };
const SUCCESS: HackResult = { status: 'success' };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A cover with no drawing: a loop of ticks that follows the same rules as `JackCover` (it polls `holdReleased`, calls `onSwap` once with the cover solid, waits for `swapDone`,
 * then reveals). `impatient` is the MUTANT: it reveals without waiting for the scene's first frame.
 */
class FakeJack implements Jack {
  log: string[];
  disposed = 0;
  started: Promise<void>;
  holdTicks = 0;
  constructor(
    log: string[],
    private readonly o: { impatient?: boolean; holdBoundTicks?: number } = {},
  ) {
    this.log = log;
    this.started = tick().then(() => void this.log.push('first-tick'));
  }
  async run(r: JackRun): Promise<'done' | 'aborted'> {
    this.log.push('out');
    await this.started;
    if (r.holdReleased) {
      this.log.push('hold');
      while (!r.holdReleased()) {
        this.holdTicks++;
        if (this.o.holdBoundTicks !== undefined && this.holdTicks > this.o.holdBoundTicks) {
          this.log.push('hold-timeout');
          return 'aborted';
        }
        await tick();
      }
    }
    this.log.push('swap');
    if (r.onSwap() === 'abort') {
      this.log.push('abort');
      return 'aborted';
    }
    if (!this.o.impatient) while (!r.swapDone()) await tick();
    this.log.push('in');
    await tick();
    this.log.push('revealed');
    return 'done';
  }
  dispose(): void {
    this.disposed++;
    this.log.push('dispose');
  }
}

/** A chunk whose scene reports its first frame after `renderAfter` ticks and ends after `endAfter` ticks (through the gate when the door gave one). */
function chunk(log: string[], o: { renderAfter?: number; endAfter?: number; result?: HackResult } = {}) {
  return async () => ({
    startHack: async (_g: Game, _d: HackDef, options?: HackOptions): Promise<HackResult> => {
      log.push('startHack');
      for (let i = 0; i < (o.renderAfter ?? 2); i++) await tick();
      log.push('first-render');
      options?.onFirstRender?.();
      for (let i = 0; i < (o.endAfter ?? 4); i++) await tick();
      const result = o.result ?? SUCCESS;
      log.push('sim-ended');
      if (options?.gate) await options.gate(result);
      log.push('scene-closed');
      return result;
    },
  });
}

const game = (drops = { count: 0 }) => ({ contextLost: false, get dropCount() { return drops.count; } }) as unknown as Game;

describe('hackDoor with a cover: the order of the jump', () => {
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  const env = (jack: FakeJack | null, load: DoorEnv['load']): DoorEnv => ({ probe: () => true, load, ...(jack ? { jack: async () => jack } : {}) });

  it('jack in and jack out: the chunk loads at the first tick, the scene starts in the swap, draws its first frame BEFORE the reveal, and closes only after the cover closes over it', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log);
    const load = vi.fn(async () => {
      log.push('load');
      return chunk(log)();
    });
    const result = await hackDoor(game(), DEF, undefined, env(jack, load));
    expect(result).toEqual(SUCCESS);
    // Jack in: out, the load only after the first tick, hold, swap, the scene starts, draws, THEN the reveal (`in`).
    const at = (m: string) => log.indexOf(m);
    expect(at('out')).toBeLessThan(at('first-tick'));
    expect(at('load')).toBeGreaterThan(at('first-tick'));
    expect(at('swap')).toBeGreaterThan(at('load'));
    expect(at('startHack')).toBeGreaterThan(at('swap'));
    expect(at('first-render'), 'the first frame is drawn before the first revealed frame (pass line 22)').toBeLessThan(at('in'));
    // Jack out: after the sim ended, the cover plays out and swaps (the second `swap`), and only then does the scene close.
    const swaps = log.flatMap((m, i) => (m === 'swap' ? [i] : []));
    expect(swaps).toHaveLength(2);
    expect(at('sim-ended')).toBeLessThan(swaps[1] ?? -1);
    expect(at('scene-closed')).toBeGreaterThan(swaps[1] ?? 99);
    // The cover is taken away at the end, once, and the story gets the result after the reveal.
    expect(log.at(-1)).toBe('dispose');
    expect(jack.disposed).toBe(1);
    expect(log.lastIndexOf('revealed')).toBeLessThan(log.indexOf('dispose'));
  });

  it('CONTROL (the mutant): a cover that reveals without waiting for the first frame shows the reveal BEFORE the first render, and the same check fails', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log, { impatient: true });
    await hackDoor(game(), DEF, undefined, env(jack, chunk(log, { renderAfter: 6 })));
    const at = (m: string) => log.indexOf(m);
    // The order check of the case above, run on the mutant: it does NOT hold.
    expect(at('first-render') < at('in')).toBe(false);
  });

  it('the chunk will not load: the cover goes back (aborted), the answer is unsupported / chunk-failed, the error is logged once, and the cover is disposed', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log);
    const result = await hackDoor(game(), DEF, undefined, env(jack, async () => Promise.reject(new Error('offline'))));
    expect(result).toEqual({ status: 'unsupported', reason: 'chunk-failed' });
    expect(log).toContain('abort');
    expect(log).not.toContain('startHack');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(jack.disposed).toBe(1);
  });

  it('the hold takes too long: unsupported / chunk-failed, a logged reason, the scene is never started, the cover is disposed', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log, { holdBoundTicks: 5 });
    const never = () => new Promise<never>(() => undefined);
    const result = await hackDoor(game(), DEF, undefined, env(jack, never));
    expect(result).toEqual({ status: 'unsupported', reason: 'chunk-failed' });
    expect(log).toContain('hold-timeout');
    expect(log).not.toContain('startHack');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(jack.disposed).toBe(1);
  });

  it('the story is dropped during the hold: aborted / user, no scene started, the cover disposed (a drop ends the wait at once)', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log);
    const drops = { count: 0 };
    const never = () => new Promise<never>(() => undefined);
    const pending = hackDoor(game(drops), DEF, undefined, env(jack, never));
    await tick();
    await tick();
    drops.count++;
    expect(await pending).toEqual({ status: 'aborted', reason: 'user' });
    expect(log).not.toContain('startHack');
    expect(jack.disposed).toBe(1);
  });

  it('a scene that ends by itself (an abort) gets no cover: the result comes at once, and the cover is disposed', async () => {
    const log: string[] = [];
    const jack = new FakeJack(log);
    const result = await hackDoor(game(), DEF, undefined, env(jack, async () => ({ startHack: async () => ({ status: 'aborted', reason: 'context-lost' }) as HackResult })));
    expect(result).toEqual({ status: 'aborted', reason: 'context-lost' });
    expect(jack.disposed).toBe(1);
  });

  it('a scene that throws: aborted / error, and the cover is disposed', async () => {
    const jack = new FakeJack([]);
    const result = await hackDoor(
      game(),
      DEF,
      undefined,
      env(jack, async () => ({
        startHack: async () => {
          throw new Error('boom');
        },
      })),
    );
    expect(result).toEqual({ status: 'aborted', reason: 'error' });
    expect(jack.disposed).toBe(1);
  });

  it('a cover that cannot be made does not stop the hack: it is a cut, and the error is logged', async () => {
    const log: string[] = [];
    const result = await hackDoor(game(), DEF, undefined, {
      probe: () => true,
      load: chunk(log, { endAfter: 0 }),
      jack: async () => {
        throw new Error('no cover');
      },
    });
    expect(result).toEqual(SUCCESS);
    expect(log).toContain('startHack');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('a style of null (a cut) runs the Phase 0 way: no cover, no gate', async () => {
    let seen: HackOptions | undefined;
    const result = await hackDoor(game(), DEF, { hud: false }, {
      probe: () => true,
      load: async () => ({
        startHack: async (_g, _d, options) => {
          seen = options;
          return SUCCESS;
        },
      }),
      jack: async () => null,
    });
    expect(result).toEqual(SUCCESS);
    expect(seen).toEqual({ hud: false });
  });
});
