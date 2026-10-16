import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FetchLike, fetchSnapshot } from '../src/github-api';
import { handleSnapshot } from '../src/hosted/snapshot';
import { PACKAGE_DIR } from './helpers';
import { TOKEN, jsonOf, request } from './vercel-helpers';

// A partial GitHub answer (`errors` plus `data` with a null field) must be tried once more, and must not look like an unknown shape. No network.

type Json = Record<string, unknown>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'github-api', name), 'utf8')) as Json;
const FILES = fixture('files.json') as Record<string, string | null>;
const NOW = new Date('2026-10-12T12:00:00Z');

const reply = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });

/** The reply of call 1 as GitHub sends it after a timeout: the `refs` field is null and `errors` says why. */
function partialCall1(): Json {
  const whole = structuredClone(fixture('call1.json')) as { data: { repository: Json } };
  whole.data.repository.refs = null;
  return { ...whole, errors: [{ type: 'SERVICE_UNAVAILABLE', path: ['repository', 'refs'], message: 'Something went wrong' }] };
}

/** A fake GitHub. `call1` gives the reply of each try of call 1, in order (the last one repeats). `calls` counts the tries. */
function github(call1: (Json | number)[]): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Json };
    if (query.includes('query Snapshot')) {
      n += 1;
      const next = call1[Math.min(n, call1.length) - 1];
      return typeof next === 'number' ? { ok: false, status: next, headers: new Headers(), text: async () => 'Bad Gateway' } : reply(next);
    }
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

afterEach(() => vi.restoreAllMocks());

describe('fetchSnapshot with a partial answer of GitHub', () => {
  it('tries call 1 again, and returns the snapshot when the second try is whole', async () => {
    const gh = github([partialCall1(), fixture('call1.json')]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(result.ok).toBe(true);
    expect(gh.calls()).toBe(2);
    // The problems of the failed try are not kept: only the whole answer counts.
    if (result.ok) expect(result.data.problems.some((problem) => problem.code === 'graphql-partial')).toBe(false);
  });

  it('gives a retryable error that is not bad-response when both tries are partial', async () => {
    const gh = github([partialCall1()]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(gh.calls()).toBe(2);
    expect(result).toMatchObject({ ok: false, error: { code: 'graphql-partial', message: expect.stringContaining('refs') } });
    const response = await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(response.status).toBe(503);
    expect(await jsonOf(response)).toMatchObject({ kind: 'graphql-partial' });
  });

  it('keeps a shape error with no errors list as bad-response, with one try only', async () => {
    const broken = structuredClone(fixture('call1.json')) as { data: { repository: Json } };
    broken.data.repository.refs = null;
    const gh = github([broken as unknown as Json]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-response' } });
  });
});

describe('fetchSnapshot with a gateway error of GitHub', () => {
  it('tries call 1 again after a 502 and returns the snapshot', async () => {
    const gh = github([502, fixture('call1.json')]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(result.ok).toBe(true);
    expect(gh.calls()).toBe(2);
  });

  it('gives http-error after two 504 answers, and does not try a third time', async () => {
    const gh = github([504]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(gh.calls()).toBe(2);
    expect(result).toMatchObject({ ok: false, error: { code: 'http-error', status: 504 } });
  });

  it('does not try again after a 401', async () => {
    const gh = github([401]);
    const result = await fetchSnapshot({ token: TOKEN, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(gh.calls()).toBe(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });
});

describe('the log line of GET /api/snapshot on a failure', () => {
  it('holds the code and the field, and never the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gh = github([partialCall1()]);
    await handleSnapshot(request('/api/snapshot'), { env: { GITHUB_TOKEN: TOKEN }, fetchImpl: gh.fetchImpl, now: () => NOW });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('graphql-partial');
    expect(line).toContain('refs');
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('Something went wrong');
    expect(line).not.toContain('Bearer');
  });
});
