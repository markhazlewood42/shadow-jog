import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshotFunction from '../functions/snapshot';
import { handleSnapshot } from '../src/hosted/snapshot';
import type { FetchLike } from '../src/github-api';
import { PACKAGE_DIR } from './helpers';
import { TOKEN, expectNoSecrets, jsonOf, request } from './vercel-helpers';

// GET /api/snapshot: the handler around the GitHub API adapter. GitHub is a fake `fetch` (the fixtures are the ones of tests/github-api.test.ts). No network.

type Json = Record<string, unknown>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'github-api', name), 'utf8')) as Json;
const FILES = fixture('files.json') as Record<string, string | null>;
const NOW = new Date('2026-10-12T12:00:00Z');

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** A fake GitHub that answers the four queries of the adapter from the fixtures. `seen` holds every request. */
function goodGithub(): { fetchImpl: FetchLike; seen: { headers: Record<string, string>; query: string }[] } {
  const seen: { headers: Record<string, string>; query: string }[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Json };
    seen.push({ headers: init.headers, query });
    if (query.includes('query Snapshot')) return reply(fixture('call1.json'));
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
  return { fetchImpl, seen };
}

const env = { GITHUB_TOKEN: TOKEN };
const get = () => request('/api/snapshot');

afterEach(() => vi.restoreAllMocks());

describe('GET /api/snapshot', () => {
  it('returns the snapshot as JSON with the 15 second CDN cache', async () => {
    const { fetchImpl, seen } = goodGithub();
    const response = await handleSnapshot(get(), { env, fetchImpl, now: () => NOW });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('s-maxage=15, stale-while-revalidate');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = await jsonOf(response);
    expect(body.at).toBe(NOW.toISOString());
    expect(Array.isArray(body.branches) && body.branches.length > 0).toBe(true);
    expect(Array.isArray(body.workstreams)).toBe(true);
    // The token went to GitHub in the Authorization header, and only there.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const call of seen) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    await expectNoSecrets(response);
  });

  it('answers 500 {error: "not configured"} when GITHUB_TOKEN is missing, and calls nothing', async () => {
    const fetchImpl = vi.fn();
    for (const empty of [{}, { GITHUB_TOKEN: '' }, { GITHUB_TOKEN: '   ' }]) {
      const response = await handleSnapshot(get(), { env: empty, fetchImpl });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'not configured', kind: 'not-configured' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // GitHub's text is hostile here: it carries the token and a marker. Neither may reach the answer.
  const LEAK = `LEAK-MARKER ${TOKEN}`;
  it.each([
    ['a bad token (401)', reply({ message: LEAK }, 401), 502, 'unauthorized', null],
    ['a rate limit with Retry-After (403)', reply({ message: `API rate limit exceeded ${LEAK}` }, 403, { 'retry-after': '42' }), 503, 'rate-limited', '42'],
    ['a secondary rate limit without Retry-After (429)', reply({ message: `You have exceeded a secondary rate limit ${LEAK}` }, 429), 503, 'rate-limited', '60'],
    ['a rate limit by the remaining header (403)', reply({ message: LEAK }, 403, { 'x-ratelimit-remaining': '0' }), 503, 'rate-limited', '60'],
    ['a GraphQL RATE_LIMITED error', reply({ errors: [{ type: 'RATE_LIMITED', message: LEAK }] }), 503, 'rate-limited', '60'],
    ['a refusal that is not a rate limit (403)', reply({ message: LEAK }, 403), 502, 'http-error', null],
    ['a server error (500)', reply({ message: LEAK }, 500), 502, 'http-error', null],
    ['a body that is not JSON', reply(`<html>${LEAK}</html>`), 502, 'bad-response', null],
    ['a GraphQL error and no data', reply({ errors: [{ type: 'NOT_FOUND', message: LEAK }] }), 502, 'graphql-error', null],
  ])('maps %s to %i %s', async (_name, githubReply, status, kind, retryAfter) => {
    const response = await handleSnapshot(get(), { env, fetchImpl: async () => githubReply, now: () => NOW });
    expect(response.status).toBe(status);
    expect(response.headers.get('Retry-After')).toBe(retryAfter);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await jsonOf(response);
    expect(body.kind).toBe(kind);
    expect(Object.keys(body).sort()).toEqual(['error', 'kind']);
    expect(await response.clone().text()).not.toContain('LEAK-MARKER');
    await expectNoSecrets(response);
  });

  it('maps a network failure to 504, without the text of the error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error(`connect ECONNRESET with ${TOKEN}`);
    };
    const response = await handleSnapshot(get(), { env, fetchImpl, now: () => NOW });
    expect(response.status).toBe(504);
    expect((await jsonOf(response)).kind).toBe('network');
    await expectNoSecrets(response);
  });

  it('answers 500 and logs only the name of an unexpected error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleSnapshot(get(), {
      env,
      fetchImpl: async () => reply({}),
      now: () => {
        throw new Error(`boom ${TOKEN}`);
      },
    });
    expect(response.status).toBe(500);
    expect((await jsonOf(response)).kind).toBe('internal');
    await expectNoSecrets(response);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(log).toHaveBeenCalled();
  });

  it('refuses a method that is not GET or HEAD', async () => {
    const fetchImpl = vi.fn();
    const response = await handleSnapshot(request('/api/snapshot', { method: 'POST', body: '{}' }), { env, fetchImpl });
    expect(response.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is wired as a Web standard handler: the default export has fetch(request)', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const response = await snapshotFunction.fetch(get());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'not configured', kind: 'not-configured' });
    vi.unstubAllEnvs();
  });
});
