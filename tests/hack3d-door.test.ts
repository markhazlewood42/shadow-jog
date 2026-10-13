/**
 * The door (src/hack3d/door.ts): one try at a hack, always an answer (decision E11, pass line 2 of docs/engine/m7-brief.md). Fakes for the 3D chunk and the
 * WebGL 2 probe, so every case runs in Node. The chunk and the real scene are e2e/sje-hack-a.spec.ts to -d (shared helpers in e2e/sjehackkit.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DoorEnv, hackDoor, hackWithPolicy } from '../src/hack3d/door';
import type { HackDef, HackPolicy, HackResult } from '../src/hack3d/result';
import { type Game, Scene } from '../src/sje';
import { headlessGame } from './sjekit';

/** A scene that does nothing: what a reset puts on the stack. */
class Idle extends Scene<void> {
  fixedUpdate(): void {}
}

const DEF: HackDef = { id: 'h', seed: 1, ticks: 60, iceCount: 2, traceLimit: 100, hitCost: 10 };
const SUCCESS: HackResult = { status: 'success' };
const FAIL: HackResult = { status: 'fail' };

describe('hackDoor: one try, always an answer (E11)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const game = (contextLost = false) => ({ contextLost }) as unknown as Game;
  const env = (over: Partial<DoorEnv> = {}): DoorEnv & { loaded: { count: number } } => {
    const loaded = { count: 0 };
    return {
      probe: () => true,
      load: async () => {
        loaded.count++;
        return { startHack: async () => SUCCESS };
      },
      ...over,
      loaded,
    };
  };

  it('no WebGL2: unsupported at once, and the 3D chunk is never requested', async () => {
    const e = env({ probe: () => false });
    expect(await hackDoor(game(), DEF, undefined, e)).toEqual({ status: 'unsupported', reason: 'no-webgl2' });
    expect(e.loaded.count).toBe(0);
  });

  it('the chunk will not load: unsupported / chunk-failed, with the error logged', async () => {
    const e = env({
      load: async () => {
        throw new Error('network down');
      },
    });
    expect(await hackDoor(game(), DEF, undefined, e)).toEqual({ status: 'unsupported', reason: 'chunk-failed' });
    expect(console.error).toHaveBeenCalled();
  });

  it('the context is lost right now: aborted / context-lost at once, without loading anything', async () => {
    const e = env();
    expect(await hackDoor(game(true), DEF, undefined, e)).toEqual({ status: 'aborted', reason: 'context-lost' });
    expect(e.loaded.count).toBe(0);
  });

  it('the story is dropped (abandon or reset) while the chunk loads: aborted / user, and no scene is started', async () => {
    const stack = { dropCount: 0 };
    const startHack = vi.fn(async () => SUCCESS);
    const e = env({
      load: async () => {
        stack.dropCount++; // game.abandon() ran while the chunk was on its way
        return { startHack };
      },
    });
    expect(await hackDoor({ contextLost: false, get dropCount() { return stack.dropCount; } } as unknown as Game, DEF, undefined, e)).toEqual({ status: 'aborted', reason: 'user' });
    expect(startHack).not.toHaveBeenCalled();
  });

  it('passes the scene’s own result through, and gives the options on', async () => {
    const startHack = vi.fn(async () => FAIL);
    const e = env({ load: async () => ({ startHack }) });
    expect(await hackDoor(game(), DEF, { frame: 'canvas-copy' as const }, e)).toEqual(FAIL);
    expect(startHack).toHaveBeenCalledWith(expect.anything(), DEF, { frame: 'canvas-copy' as const });
  });

  it('a startHack that throws still gives an answer: aborted / error', async () => {
    const e = env({
      load: async () => ({
        startHack: async () => {
          throw new Error('bug');
        },
      }),
    });
    expect(await hackDoor(game(), DEF, undefined, e)).toEqual({ status: 'aborted', reason: 'error' });
  });
});

describe('the real door joined to the real policy loop, on a real game (C6, E19)', () => {
  // `hackDoor` and `hackWithPolicy` are the real functions and the game is the real `Game` (its scene stack and its drop counter). Only the 3D chunk is a
  // stand-in, because the real one needs Three and WebGL2: the real mid-hack drop (game.abandon() while a HackScene runs) is e2e/sje3d.spec.ts.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const DROPPED: HackResult = { status: 'aborted', reason: 'user' };
  const policies: Array<[string, HackPolicy | undefined]> = [
    ['the default policy (retry once, then count it as won)', undefined],
    ['aborted: succeed, unsupported: alternative', { aborted: 'succeed', unsupported: 'alternative' }],
    ['aborted: fail', { aborted: 'fail', unsupported: 'fail' }],
  ];

  for (const way of ['abandon', 'reset'] as const) {
    for (const [name, policy] of policies) {
      it(`game.${way}() while the chunk loads, ${name}: dropped, one try, no scene started, no retry, no 2D alternative`, async () => {
        const { game } = headlessGame();
        const startHack = vi.fn(async () => SUCCESS);
        const load = vi.fn(async () => {
          // The player drops the story while the chunk is on its way.
          if (way === 'abandon') game.abandon();
          else void game.reset(new Idle());
          return { startHack };
        });
        const env: DoorEnv = { probe: () => true, load };
        const alternative = vi.fn(async () => 'success' as const);
        const out = await hackWithPolicy({ ...DEF, ...(policy ? { policy } : {}) }, (d) => hackDoor(game, d, undefined, env), alternative);
        expect(out).toEqual({ outcome: 'fail', via: 'dropped', results: [DROPPED] });
        expect(load, 'the chunk was asked for once: no retry').toHaveBeenCalledTimes(1);
        expect(startHack, 'no hack scene was started').not.toHaveBeenCalled();
        expect(alternative, 'the 2D alternative did not play').not.toHaveBeenCalled();
        expect(game.dropCount).toBe(1);
        // The stack is what the drop left: nothing after an abandon, only the reset scene after a reset.
        expect(game.scene.scenes.map((s) => s.constructor.name)).toEqual(way === 'abandon' ? [] : ['Idle']);
      });
    }
  }

  it('a game that was NOT dropped plays on: the same joined pieces give the hack’s own result', async () => {
    const { game } = headlessGame();
    const startHack = vi.fn(async () => SUCCESS);
    const env: DoorEnv = { probe: () => true, load: async () => ({ startHack }) };
    const out = await hackWithPolicy(DEF, (d) => hackDoor(game, d, undefined, env), vi.fn(async () => 'fail' as const));
    expect(out).toEqual({ outcome: 'success', via: 'played', results: [SUCCESS] });
    expect(startHack).toHaveBeenCalledTimes(1);
    expect(game.dropCount).toBe(0);
  });
});

// ---- pass line 2, more cases and the control ------------------------------------------------------------------------------------------------------

type Door = (game: Game, def: HackDef, options: undefined, env: DoorEnv) => Promise<HackResult>;

/**
 * The door contract as a list of broken promises. The real door must give an empty list, and the mutant below must not, or this checker could not fail.
 * Each case is one way a hack can end; the door has to resolve (never reject) with the right value, and must not touch the chunk when it should not.
 */
async function doorProblems(door: Door): Promise<string[]> {
  const problems: string[] = [];
  const game = (over: Record<string, unknown> = {}) => ({ contextLost: false, dropCount: 0, ...over }) as unknown as Game;
  const env = (over: Partial<DoorEnv>): DoorEnv => ({ probe: () => true, load: async () => ({ startHack: async () => SUCCESS }), ...over });
  const attempt = async (name: string, g: Game, e: DoorEnv, want: HackResult): Promise<void> => {
    try {
      const got = await door(g, DEF, undefined, e);
      if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    } catch (e2) {
      problems.push(`${name}: the door rejected (${(e2 as Error).message})`);
    }
  };
  await attempt('chunk-failed', game(), env({ load: async () => { throw new Error('offline'); } }), { status: 'unsupported', reason: 'chunk-failed' });
  await attempt('chunk-failed (a throw before the promise)', game(), env({ load: () => { throw new Error('sync'); } }), { status: 'unsupported', reason: 'chunk-failed' });
  await attempt('no-webgl2', game(), env({ probe: () => false }), { status: 'unsupported', reason: 'no-webgl2' });
  await attempt('context already lost', game({ contextLost: true }), env({}), { status: 'aborted', reason: 'context-lost' });
  await attempt('startHack throws', game(), env({ load: async () => ({ startHack: async () => { throw new Error('bug'); } }) }), { status: 'aborted', reason: 'error' });
  await attempt('success passes through', game(), env({}), SUCCESS);
  return problems;
}

describe('the door contract (pass line 2)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('the real door keeps every promise: no case rejects, each gives its value', async () => {
    expect(await doorProblems(hackDoor)).toEqual([]);
  });

  it('a chunk loader that throws before it returns a promise is a chunk-failed, not a rejection', async () => {
    const e: DoorEnv = { probe: () => true, load: () => { throw new Error('sync'); } };
    expect(await hackDoor({ contextLost: false, dropCount: 0 } as unknown as Game, DEF, undefined, e)).toEqual({ status: 'unsupported', reason: 'chunk-failed' });
  });

  it('control: a mutant door that rethrows a chunk error fails the contract', async () => {
    const mutant: Door = async (game, def, options, env) => {
      if (!env.probe()) return { status: 'unsupported', reason: 'no-webgl2' };
      if (game.contextLost) return { status: 'aborted', reason: 'context-lost' };
      const chunk = await env.load(); // no try/catch: the error reaches the story
      try {
        return await chunk.startHack(game, def, options);
      } catch {
        return { status: 'aborted', reason: 'error' };
      }
    };
    const problems = await doorProblems(mutant);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith('chunk-failed') && p.includes('rejected'))).toBe(true);
  });
});
