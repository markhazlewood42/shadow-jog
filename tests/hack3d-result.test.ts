/**
 * The result policy (src/hack3d/result.ts, door.ts `hackWithPolicy`): what a story does with each way a hack can end (decisions E11, E19 and D4 of
 * docs/engine/m7-brief.md). Pure logic and fakes, so every case runs in Node. The door itself is tests/hack3d-door.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { hackWithPolicy } from '../src/hack3d/door';
import { DEFAULT_POLICY, decideHack, describeResult, type HackDef, type HackPolicy, type HackResult } from '../src/hack3d/result';

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


describe('D4: the outcome the story gets', () => {
  it('every outcome has the three fields of interfaces.md section 12: outcome, via, results', async () => {
    const out = await hackWithPolicy(DEF, async () => SUCCESS, async () => 'fail');
    expect(Object.keys(out).sort()).toEqual(['outcome', 'results', 'via']);
  });

  it('the full policy table: for each result, each policy, the first decision and (for an abort) the second', () => {
    const results: HackResult[] = [
      SUCCESS,
      FAIL,
      { status: 'aborted', reason: 'context-lost' },
      { status: 'aborted', reason: 'user' },
      { status: 'aborted', reason: 'error' },
      { status: 'unsupported', reason: 'no-webgl2' },
      { status: 'unsupported', reason: 'chunk-failed' },
    ];
    const retried: string[] = [];
    for (const r of results) {
      for (const aborted of ['retry-then-succeed', 'succeed', 'fail'] as const) {
        const d = decideHack(r, { aborted, unsupported: 'alternative' }, 0);
        if (d.next === 'retry') retried.push(`${describeResult(r)} / ${aborted}`);
        // Only a lost context under `retry-then-succeed` retries; a user abort always drops.
        if (r.status === 'aborted' && r.reason === 'user') expect(d).toEqual({ next: 'dropped' });
      }
    }
    expect(retried).toEqual(['aborted (context-lost) / retry-then-succeed']);
  });

  it('a retry that is dropped in turn ends the story: the first try lost the context, the retry was dropped', async () => {
    const seq: HackResult[] = [LOST, { status: 'aborted', reason: 'user' }];
    const out = await hackWithPolicy(DEF, async () => seq.shift() ?? SUCCESS, async () => 'success');
    expect(out).toEqual({ outcome: 'fail', via: 'dropped', results: [LOST, { status: 'aborted', reason: 'user' }] });
  });
});
