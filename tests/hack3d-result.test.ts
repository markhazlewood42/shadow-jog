/**
 * The result policy and the door (src/hack3d/result.ts, door.ts): what a story does with each way a
 * hack can end (decisions E11 and E19). Pure logic and fakes, so every case runs in Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DoorEnv, hackDoor, hackWithPolicy } from '../src/hack3d/door';
import { DEFAULT_POLICY, decideHack, describeResult, type HackDef, type HackPolicy, type HackResult } from '../src/hack3d/result';
import { type Game, Scene } from '../src/sje';
import { headlessGame } from './sjekit';

/** A scene that does nothing: what a reset puts on the stack. */
class Idle extends Scene<void> {
  fixedUpdate(): void {}
}

const DEF: HackDef = { id: 'h', seed: 1, ticks: 60, iceCount: 2, traceLimit: 100, hitCost: 10 };
const SUCCESS: HackResult = { status: 'success' };
const FAIL: HackResult = { status: 'fail' };
const LOST: HackResult = { status: 'aborted', reason: 'context-lost' };
const NO_GL: HackResult = { status: 'unsupported', reason: 'no-webgl2' };

describe('decideHack: the author’s policy applied to one result (E19)', () => {
  const policy = (p: Partial<HackPolicy>): HackPolicy => ({ ...DEFAULT_POLICY, ...p });

  it('success and fail are the player’s own result, whatever the policy says', () => {
    for (const aborted of ['retry-then-succeed', 'succeed', 'fail'] as const) {
      expect(decideHack(SUCCESS, policy({ aborted }), 0)).toEqual({ next: 'done', outcome: 'success', via: 'played' });
      expect(decideHack(FAIL, policy({ aborted }), 0)).toEqual({ next: 'done', outcome: 'fail', via: 'played' });
    }
  });

  it('aborted, retry-then-succeed: retry once, then count it as won', () => {
    const p = policy({ aborted: 'retry-then-succeed' });
    expect(decideHack(LOST, p, 0)).toEqual({ next: 'retry' });
    expect(decideHack(LOST, p, 1)).toEqual({ next: 'done', outcome: 'success', via: 'policy' });
  });

  it('aborted, succeed or fail: no retry', () => {
    expect(decideHack(LOST, policy({ aborted: 'succeed' }), 0)).toEqual({ next: 'done', outcome: 'success', via: 'policy' });
    expect(decideHack(LOST, policy({ aborted: 'fail' }), 0)).toEqual({ next: 'done', outcome: 'fail', via: 'policy' });
  });

  it('E19: only a lost context retries. A player abort is dropped, and an error goes to the policy without a retry', () => {
    const p = policy({ aborted: 'retry-then-succeed' });
    expect(decideHack({ status: 'aborted', reason: 'context-lost' }, p, 0)).toEqual({ next: 'retry' });
    expect(decideHack({ status: 'aborted', reason: 'user' }, p, 0)).toEqual({ next: 'dropped' });
    expect(decideHack({ status: 'aborted', reason: 'error' }, p, 0)).toEqual({ next: 'done', outcome: 'success', via: 'policy' });
  });

  it('a player abort is dropped under EVERY policy and at every retry count', () => {
    for (const aborted of ['retry-then-succeed', 'succeed', 'fail'] as const) {
      for (const retries of [0, 1]) {
        expect(decideHack({ status: 'aborted', reason: 'user' }, policy({ aborted }), retries)).toEqual({ next: 'dropped' });
      }
    }
  });

  it('unsupported: the authored 2D alternative, or the policy decides', () => {
    expect(decideHack(NO_GL, policy({ unsupported: 'alternative' }), 0)).toEqual({ next: 'alternative' });
    expect(decideHack(NO_GL, policy({ unsupported: 'succeed' }), 0)).toEqual({ next: 'done', outcome: 'success', via: 'policy' });
    expect(decideHack({ status: 'unsupported', reason: 'chunk-failed' }, policy({ unsupported: 'fail' }), 0)).toEqual({ next: 'done', outcome: 'fail', via: 'policy' });
  });

  it('describeResult gives one short line, with the reason when there is one', () => {
    expect(describeResult(SUCCESS)).toBe('success');
    expect(describeResult(LOST)).toBe('aborted (context-lost)');
    expect(describeResult(NO_GL)).toBe('unsupported (no-webgl2)');
  });
});

describe('hackWithPolicy: the story’s loop around the door', () => {
  const alt = (answer: 'success' | 'fail' = 'success') => vi.fn(async () => answer);

  it('a played result passes straight through (one try)', async () => {
    const tryHack = vi.fn(async () => FAIL);
    const out = await hackWithPolicy(DEF, tryHack, alt());
    expect(out).toEqual({ outcome: 'fail', via: 'played', results: [FAIL] });
    expect(tryHack).toHaveBeenCalledTimes(1);
  });

  it('aborted then success: the retry plays, and its result stands', async () => {
    const results = [LOST, SUCCESS];
    const tryHack = vi.fn(async () => results.shift() ?? SUCCESS);
    const out = await hackWithPolicy(DEF, tryHack, alt());
    expect(out).toEqual({ outcome: 'success', via: 'played', results: [LOST, SUCCESS] });
    expect(tryHack).toHaveBeenCalledTimes(2);
  });

  it('aborted twice: it retries ONCE and then counts the hack as won (never a third try)', async () => {
    const tryHack = vi.fn(async () => LOST);
    const out = await hackWithPolicy(DEF, tryHack, alt());
    expect(out).toEqual({ outcome: 'success', via: 'policy', results: [LOST, LOST] });
    expect(tryHack).toHaveBeenCalledTimes(2);
  });

  it('E19: a hack dropped by the player (aborted / user) never retries and never plays the alternative', async () => {
    const USER: HackResult = { status: 'aborted', reason: 'user' };
    const tryHack = vi.fn(async () => USER);
    const alternative = alt();
    const out = await hackWithPolicy(DEF, tryHack, alternative);
    expect(out).toEqual({ outcome: 'fail', via: 'dropped', results: [USER] });
    expect(tryHack).toHaveBeenCalledTimes(1);
    expect(alternative).not.toHaveBeenCalled();
  });

  it('a context loss on the retry is not retried again, and an error never retries', async () => {
    const ERR: HackResult = { status: 'aborted', reason: 'error' };
    const tryHack = vi.fn(async () => ERR);
    const out = await hackWithPolicy(DEF, tryHack, alt());
    expect(out).toEqual({ outcome: 'success', via: 'policy', results: [ERR] });
    expect(tryHack).toHaveBeenCalledTimes(1);
  });

  it('unsupported: plays the authored 2D alternative, and its answer stands', async () => {
    const tryHack = vi.fn(async () => NO_GL);
    const alternative = alt('fail');
    const out = await hackWithPolicy(DEF, tryHack, alternative);
    expect(out).toEqual({ outcome: 'fail', via: 'alternative', results: [NO_GL] });
    expect(alternative).toHaveBeenCalledTimes(1);
    expect(tryHack).toHaveBeenCalledTimes(1);
  });

  it('a hack with its own policy uses it', async () => {
    const tryHack = vi.fn(async () => LOST);
    const out = await hackWithPolicy({ ...DEF, policy: { aborted: 'fail', unsupported: 'alternative' } }, tryHack, alt());
    expect(out).toEqual({ outcome: 'fail', via: 'policy', results: [LOST] });
    expect(tryHack).toHaveBeenCalledTimes(1);
  });
});

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
    expect(await hackDoor(game(), DEF, { frameMode: 'canvas-copy' }, e)).toEqual(FAIL);
    expect(startHack).toHaveBeenCalledWith(expect.anything(), DEF, { frameMode: 'canvas-copy' });
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
