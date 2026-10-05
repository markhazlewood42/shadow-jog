/**
 * The result policy and the door (src/hack3d/result.ts, door.ts): what a story does with each way a
 * hack can end (decisions E11 and E19). Pure logic and fakes, so every case runs in Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DoorEnv, hackDoor, hackWithPolicy } from '../src/hack3d/door';
import { DEFAULT_POLICY, decideHack, describeResult, type HackDef, type HackPolicy, type HackResult } from '../src/hack3d/result';
import type { Game } from '../src/sje';

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

  it('every abort reason is treated alike (context lost, the player quit, an error)', () => {
    for (const reason of ['context-lost', 'user', 'error'] as const) {
      expect(decideHack({ status: 'aborted', reason }, policy({ aborted: 'retry-then-succeed' }), 0)).toEqual({ next: 'retry' });
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
