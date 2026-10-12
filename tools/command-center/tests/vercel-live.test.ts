import { afterEach, describe, expect, it, vi } from 'vitest';
import liveFunction from '../api/live';
import { type LiveFetch, handleLive, OFFLINE_AFTER_SECONDS, reporterOf } from '../src/hosted/live';
import { RO_TOKEN, RW_TOKEN, UPSTASH_URL, expectNoSecrets, jsonOf, request } from './vercel-helpers';

// GET /api/live: the `live` key from Upstash over REST with the read-only token. Upstash is a fake `fetch`. No network.

const NOW = new Date('2026-10-12T12:00:00.000Z');
const env = { KV_REST_API_URL: UPSTASH_URL, KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN };
const ago = (seconds: number): string => new Date(NOW.getTime() - seconds * 1000).toISOString();
const stored = (seconds: number) => ({ writtenAt: ago(seconds), sessions: [{ title: 'Build', state: 'busy' }] });

const upstash = (result: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof result === 'string' && status !== 200 ? result : JSON.stringify(result)) });

function fakeUpstash(answer: () => ReturnType<typeof upstash>) {
  const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetchImpl: LiveFetch = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers });
    return answer();
  };
  return { fetchImpl, seen };
}

/** Upstash answers `{ result: <string> }` for a key that holds a string. The reporter stores JSON text. */
const withValue = (value: unknown) => upstash({ result: JSON.stringify(value) });

const run = (deps: Parameters<typeof handleLive>[1]) => handleLive(request('/api/live'), { now: () => NOW, ...deps });

afterEach(() => vi.restoreAllMocks());

describe('GET /api/live: the key and the state of the reporter', () => {
  it('returns a fresh key as online, with its age, never cached', async () => {
    const { fetchImpl, seen } = fakeUpstash(() => withValue(stored(30)));
    const response = await run({ env, fetchImpl });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const body = await jsonOf(response);
    expect(body.reporter).toEqual({ state: 'online', writtenAt: ago(30), ageSeconds: 30, offlineAfterSeconds: 150 });
    expect(body.live).toEqual(stored(30));
    // One GET of the one key, with the READ-ONLY token.
    expect(seen).toEqual([{ url: `${UPSTASH_URL}/get/live`, method: 'GET', headers: { Authorization: `Bearer ${RO_TOKEN}` } }]);
    await expectNoSecrets(response);
  });

  it('returns an old key as offline (older than 150 seconds)', async () => {
    const { fetchImpl } = fakeUpstash(() => withValue(stored(400)));
    const body = await jsonOf(await run({ env, fetchImpl }));
    expect(body.reporter).toMatchObject({ state: 'offline', ageSeconds: 400 });
    expect(body.live).toEqual(stored(400));
  });

  it('uses 150 seconds as the line: 150 is online, 151 is offline', () => {
    expect(OFFLINE_AFTER_SECONDS).toBe(150);
    expect(reporterOf({ writtenAt: ago(150) }, NOW).state).toBe('online');
    expect(reporterOf({ writtenAt: ago(151) }, NOW).state).toBe('offline');
  });

  it('returns a missing key as not running, with no live data', async () => {
    const { fetchImpl } = fakeUpstash(() => upstash({ result: null }));
    const response = await run({ env, fetchImpl });
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ reporter: { state: 'not-running', writtenAt: null, ageSeconds: null, offlineAfterSeconds: 150 }, live: null });
  });

  it('accepts a result that is already an object', async () => {
    const { fetchImpl } = fakeUpstash(() => upstash({ result: stored(5) }));
    const body = await jsonOf(await run({ env, fetchImpl }));
    expect(body.reporter).toMatchObject({ state: 'online', ageSeconds: 5 });
  });

  it.each([
    ['no writtenAt', { sessions: [] }],
    ['a writtenAt that is not a date', { writtenAt: 'yesterday-ish' }],
    ['a writtenAt that is not text', { writtenAt: 12345 }],
    ['a value that is not an object', [1, 2]],
  ])('treats %s as offline, since freshness cannot be shown', (_name, value) => {
    expect(reporterOf(value, NOW).state).toBe('offline');
    expect(reporterOf(value, NOW).ageSeconds).toBeNull();
  });

  it('shows age 0 for a writtenAt that is ahead of the clock', () => {
    expect(reporterOf({ writtenAt: ago(-20) }, NOW)).toMatchObject({ state: 'online', ageSeconds: 0 });
  });
});

describe('GET /api/live: configuration', () => {
  it('answers 500 {error: "not configured"} without the URL or the read-only token, and calls nothing', async () => {
    const fetchImpl = vi.fn();
    for (const partial of [{}, { KV_REST_API_URL: UPSTASH_URL }, { KV_REST_API_READ_ONLY_TOKEN: RO_TOKEN }]) {
      const response = await run({ env: partial, fetchImpl });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'not configured', kind: 'not-configured' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['KV_REST_API_TOKEN', RW_TOKEN],
    ['KV_REST_API_TOKEN', ''],
    ['UPSTASH_REDIS_REST_TOKEN', RW_TOKEN],
    ['UPSTASH_REDIS_REST_TOKEN', ''],
  ])('answers 500 {error: "misconfigured"} and logs when %s is present (value: %j)', async (name, value) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    const response = await run({ env: { ...env, [name]: value }, fetchImpl });
    expect(response.status).toBe(500);
    expect(await jsonOf(response)).toEqual({ error: 'misconfigured', kind: 'misconfigured' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // Nothing is read from Upstash, with either token.
    expect(fetchImpl).not.toHaveBeenCalled();
    // The log names the variable and never shows its value.
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain(name);
    expect(logged).not.toContain(RW_TOKEN);
    expect(logged).not.toContain(RO_TOKEN);
    await expectNoSecrets(response);
  });

  it('does not trip on the read-only variable: it is the one that is used', async () => {
    const { fetchImpl, seen } = fakeUpstash(() => upstash({ result: null }));
    const response = await run({ env, fetchImpl });
    expect(response.status).toBe(200);
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${RO_TOKEN}`);
  });

  it('sends only the read-only token to Upstash, not the value of an unrelated variable', async () => {
    const { fetchImpl, seen } = fakeUpstash(() => upstash({ result: null }));
    await run({ env: { ...env, SOME_OTHER_TOKEN: RW_TOKEN }, fetchImpl });
    expect(JSON.stringify(seen)).not.toContain(RW_TOKEN);
  });

  it('answers 500 misconfigured for a URL that is not https', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    const response = await run({ env: { ...env, KV_REST_API_URL: 'http://example-store.upstash.io' }, fetchImpl });
    expect(response.status).toBe(500);
    expect((await jsonOf(response)).error).toBe('misconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/live: failures of the store', () => {
  it.each([
    ['a rejected read token (401)', () => upstash('LEAK-MARKER', 401), 502, 'store-error'],
    ['a server error (500)', () => upstash('LEAK-MARKER', 500), 502, 'store-error'],
    ['a body that is not JSON', () => ({ ok: true, status: 200, text: async () => 'LEAK-MARKER <html>' }), 502, 'bad-stored-value'],
    ['a body with no result', () => upstash({ error: 'LEAK-MARKER' }), 502, 'bad-stored-value'],
    ['a value that is not JSON', () => upstash({ result: 'LEAK-MARKER not json' }), 502, 'bad-stored-value'],
    ['a stored string', () => upstash({ result: JSON.stringify('LEAK-MARKER') }), 502, 'bad-stored-value'],
    ['a stored number', () => upstash({ result: '123' }), 502, 'bad-stored-value'],
    ['a stored boolean', () => upstash({ result: 'true' }), 502, 'bad-stored-value'],
    ['a stored array', () => upstash({ result: '[1,2]' }), 502, 'bad-stored-value'],
    ['a result that is a number', () => upstash({ result: 5 }), 502, 'bad-stored-value'],
    ['a result that is an array', () => upstash({ result: [{ writtenAt: 'x' }] }), 502, 'bad-stored-value'],
  ])('maps %s to %i %s, with a fixed sentence', async (_name, answer, status, kind) => {
    const { fetchImpl } = fakeUpstash(answer);
    const response = await run({ env, fetchImpl });
    expect(response.status).toBe(status);
    expect((await jsonOf(response)).kind).toBe(kind);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.clone().text()).not.toContain('LEAK-MARKER');
    await expectNoSecrets(response);
  });

  it('maps a network failure to 504, without the text of the error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl: LiveFetch = async () => {
      throw new Error(`connect ECONNRESET ${RO_TOKEN}`);
    };
    const response = await run({ env, fetchImpl });
    expect(response.status).toBe(504);
    expect((await jsonOf(response)).kind).toBe('store-unreachable');
    await expectNoSecrets(response);
    expect(JSON.stringify(log.mock.calls)).not.toContain(RO_TOKEN);
  });

  it('refuses a method that is not GET or HEAD', async () => {
    const fetchImpl = vi.fn();
    const response = await handleLive(request('/api/live', { method: 'POST', body: 'x' }), { env, fetchImpl });
    expect(response.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is wired as a Web standard handler: the default export has fetch(request)', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_READ_ONLY_TOKEN', '');
    const response = await liveFunction.fetch(request('/api/live'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'not configured', kind: 'not-configured' });
    vi.unstubAllEnvs();
  });
});
