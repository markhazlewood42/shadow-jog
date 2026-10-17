import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FetchLike, fetchSnapshot } from '../src/github-api';
import { mapAdapterError } from '../src/hosted/errors';
import { handleSnapshot } from '../src/hosted/snapshot';
import { PACKAGE_DIR } from './helpers';
import { TOKEN, jsonOf, request } from './vercel-helpers';

// A partial GitHub answer (`errors` plus `data` with a null field) must be tried once more, and must not look like an unknown shape. No network.

type Json = Record<string, unknown>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'github-api', name), 'utf8')) as Json;
const FILES = fixture('files.json') as Record<string, string | null>;
const seenQueries: string[] = [];
const NOW = new Date('2026-10-12T12:00:00Z');

const reply = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });

/** The reply of call 1 as GitHub sends it after a timeout: the `refs` field is null and `errors` says why. */
function partialCall1(): Json {
  const whole = structuredClone(fixture('call1.json')) as { data: { repository: Json } };
  whole.data.repository.refs = null;
  return { ...whole, errors: [{ type: 'SERVICE_UNAVAILABLE', path: ['repository', 'refs'], message: 'Something went wrong' }] };
}

/** A fake GitHub. `call1` gives the reply of each try of call 1, in order (the last one repeats). `calls` counts the tries. */
function github(call1: (Json | number | 'throw')[], afterCall1: () => void = () => undefined): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Json };
    if (query.includes('query Snapshot')) {
      n += 1;
      const next = call1[Math.min(n, call1.length) - 1];
      afterCall1();
      if (next === 'throw') throw new Error('timed out');
      return typeof next === 'number' ? { ok: false, status: next, headers: new Headers(), text: async () => 'Bad Gateway' } : reply(next);
    }
    seenQueries.push(query.slice(0, 40));
    if (query.includes('query MoreComments')) return reply(fixture('comments-35-page2.json'));
    if (query.includes('query Files')) {
      const repository: Json = {};
      for (const [, alias, variable] of query.matchAll(/(\w+): object\(expression: \$(\w+)\)/g)) {
        const text = FILES[String(variables[variable as string])] ?? null;
        repository[alias as string] = text === null ? null : { text, byteSize: text.length, isBinary: false, isTruncated: false };
      }
      return reply({ data: { rateLimit: { cost: 1, remaining: 3990 }, repository } });
    }
    throw new Error('unknown query');
  };
  return { fetchImpl, calls: () => n };
}

/** A wait that does not wait. */
const noSleep = async (): Promise<void> => undefined;

/**
 * The clocks that a test moves by hand. `now` is the calendar clock (it starts at NOW, so the dates of the fixtures stay right) and `clock` is the monotonic clock of the deadline.
 * `jump` moves both. `jumpClock` moves only the deadline clock, so a test can show that the deadline does not follow the calendar clock.
 */
function fakeClock(): { now: () => Date; clock: () => number; jump: (ms: number) => void; jumpClock: (ms: number) => void } {
  let at = NOW.getTime();
  let ticks = 0;
  return {
    now: () => new Date(at),
    clock: () => ticks,
    jump: (ms) => {
      at += ms;
      ticks += ms;
    },
    jumpClock: (ms) => (ticks += ms),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  seenQueries.length = 0;
});

describe('fetchSnapshot with a partial answer of GitHub', () => {
  it('tries call 1 again, and returns the snapshot when the second try is whole', async () => {
    const gh = github([partialCall1(), fixture('call1.json')]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(gh.calls()).toBe(2);
    // The problems of the failed try are not kept: only the whole answer counts.
    if (result.ok) expect(result.data.problems.some((problem) => problem.code === 'graphql-incomplete')).toBe(false);
  });

  it('gives a retryable error that is not bad-response when both tries are partial', async () => {
    const gh = github([partialCall1()]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(2);
    expect(result).toMatchObject({ ok: false, error: { code: 'graphql-incomplete', message: expect.stringContaining('refs') } });
    const response = await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(response.status).toBe(503);
    expect(await jsonOf(response)).toMatchObject({ kind: 'graphql-incomplete' });
  });

  it('puts the label of the wrong field on the error as `field`, so no message is parsed', async () => {
    const gh = github([partialCall1()]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(result).toMatchObject({ ok: false, error: { code: 'graphql-incomplete', field: 'refs' } });
    const broken = structuredClone(fixture('call1.json')) as { data: { repository: Json } };
    broken.data.repository.refs = null;
    const bad = await fetchSnapshot({ token: TOKEN, fetchImpl: github([broken as unknown as Json]).fetchImpl, now: () => NOW, sleep: noSleep });
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad-response', field: 'refs' } });
  });

  it('keeps a shape error with no errors list as bad-response, with one try only', async () => {
    const broken = structuredClone(fixture('call1.json')) as { data: { repository: Json } };
    broken.data.repository.refs = null;
    const gh = github([broken as unknown as Json]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-response' } });
  });
});

describe('fetchSnapshot with a gateway error of GitHub', () => {
  it('tries call 1 again after a 502 and returns the snapshot', async () => {
    const gh = github([502, fixture('call1.json')]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(gh.calls()).toBe(2);
  });

  it('gives http-error after two 504 answers, and does not try a third time', async () => {
    const gh = github([504]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(2);
    expect(result).toMatchObject({ ok: false, error: { code: 'http-error', status: 504 } });
  });

  it('does not try again after a 401', async () => {
    const gh = github([401]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });
});

describe('the log line of GET /api/snapshot on a failure', () => {
  it('holds the code and the field, and never the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gh = github([partialCall1()]);
    await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('graphql-incomplete');
    expect(line).toContain('refs');
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('Something went wrong');
    expect(line).not.toContain('Bearer');
  });
});

describe('the deadline and the retry rules', () => {
  it('does not retry when less than 8 seconds of the deadline is left', async () => {
    const clock = fakeClock();
    const gh = github([partialCall1(), fixture('call1.json')], () => clock.jump(20_000));
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: clock.now, clock: clock.clock, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'graphql-incomplete' } });
  });

  it('returns the snapshot of call 1, with problems, when call 1 used the whole deadline (a partial snapshot, no error)', async () => {
    const clock = fakeClock();
    const gh = github([fixture('call1.json')], () => clock.jump(24_800));
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: clock.now, clock: clock.clock, sleep: noSleep });
    if (!result.ok) throw new Error(`expected a partial snapshot, got ${result.error.code}`);
    expect(seenQueries).toEqual([]);
    expect(result.data.branches.length).toBeGreaterThan(0);
    const codes = result.data.problems.map((problem) => problem.code);
    expect(codes).toContain('decision-comments-truncated');
    expect(codes).toContain('workstreams-failed');
  });

  it('keeps the branches of call 1 when the deadline ends the pages of branches', async () => {
    const clock = fakeClock();
    const more = structuredClone(fixture('call1.json')) as { data: { repository: { refs: { pageInfo: { hasNextPage: boolean; endCursor: string } } } } };
    more.data.repository.refs.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
    const gh = github([more as unknown as Json], () => clock.jump(24_800));
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: clock.now, clock: clock.clock, sleep: noSleep });
    if (!result.ok) throw new Error(`expected a partial snapshot, got ${result.error.code}`);
    expect(result.data.problems.map((problem) => problem.code)).toContain('branches-truncated');
  });

  it('follows its own monotonic clock, not the calendar clock: a fixed `now` does not switch the deadline off', async () => {
    const clock = fakeClock();
    // The calendar time stands still, as in a caller that passes a fixed `now`; only the deadline clock moves.
    const gh = github([partialCall1(), fixture('call1.json')], () => clock.jumpClock(20_000));
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, clock: clock.clock, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'graphql-incomplete' } });
  });

  it('cuts the limit of each later call to what is left of the deadline', async () => {
    const clock = fakeClock();
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const gh = github([fixture('call1.json')], () => clock.jump(15_000));
    await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: clock.now, clock: clock.clock, sleep: noSleep });
    const used = timeouts.mock.calls.map((args) => Number(args[0]));
    expect(used[0]).toBe(20_000);
    expect(used.length).toBeGreaterThan(1);
    for (const ms of used.slice(1)) expect(ms).toBeLessThanOrEqual(10_000);
  });

  it('waits about a second before the retry, and does not retry when the wait does not fit', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const gh = github([502, fixture('call1.json')]);
    expect((await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep })).ok).toBe(true);
    expect(waits).toEqual([1000]);
    // 8.5 s are left after the first try: enough for 8 s, not for 8 s and the wait.
    const clock = fakeClock();
    const late = github([502, fixture('call1.json')], () => clock.jump(16_500));
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: late.fetchImpl, now: clock.now, clock: clock.clock, sleep });
    expect(late.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'http-error', status: 502 } });
    expect(waits).toEqual([1000]);
  });

  it('keeps the cost of the failed partial try', async () => {
    const gh = github([partialCall1(), fixture('call1.json')]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    if (!result.ok) throw new Error('expected a snapshot');
    expect(result.data.cost.filter((entry) => entry.call.startsWith('call 1')).length).toBe(2);
  });

  it('maps the deadline error to 504 with a true message', () => {
    // A deadline no longer fails a snapshot once call 1 has worked, so the mapping is tested on its own.
    expect(mapAdapterError({ code: 'deadline' })).toMatchObject({ status: 504, kind: 'deadline', error: expect.stringContaining('ran out of time') });
  });

  it('logs only the field label, not other words of the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gh = github([partialCall1()]);
    await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(String(spy.mock.calls[0]?.[0])).toBe('snapshot failed: graphql-incomplete (field: refs)');
  });

  it('tries again after a 503', async () => {
    const gh = github([503, fixture('call1.json')]);
    expect((await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep })).ok).toBe(true);
    expect(gh.calls()).toBe(2);
  });

  it.each([404, 403])('does not try again after a %i', async (status) => {
    const gh = github([status]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'http-error' } });
  });

  it('does not try again after a timeout of the network', async () => {
    const gh = github(['throw']);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('keeps a missing repository with errors as bad-response, with one try', async () => {
    const gh = github([{ data: { repository: null }, errors: [{ type: 'SERVICE_UNAVAILABLE', path: ['repository'], message: 'x' }] }]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-response' } });
  });

  it('sends Retry-After: 5 with the partial error', async () => {
    const gh = github([partialCall1()]);
    const response = await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW, sleep: noSleep });
    expect(response.headers.get('Retry-After')).toBe('5');
  });
});
