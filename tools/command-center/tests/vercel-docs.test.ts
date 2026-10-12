import { afterEach, describe, expect, it, vi } from 'vitest';
import docsFunction from '../api/docs/[...path]';
import { type DocFetch, contentsUrl, handleDocs } from '../src/hosted/docs';
import { TOKEN, expectNoSecrets, jsonOf, request } from './vercel-helpers';

// GET /api/docs/<repo path>: one doc from `main` through the GitHub contents API. GitHub is a fake `fetch`. No network.

const env = { GITHUB_TOKEN: TOKEN };
const BASE = 'https://api.github.com/repos/markhazlewood42/shadow-jog/contents';

const reply = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => {
  const response = new Response(body, { status, headers });
  return { ok: response.ok, status, headers: response.headers, arrayBuffer: () => response.arrayBuffer(), body: response.body };
};

/** A fake GitHub contents API. `seen` holds every URL and the headers sent. */
function fakeGithub(answer: () => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: DocFetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return answer();
  };
  return { fetchImpl, seen };
}

afterEach(() => vi.restoreAllMocks());

describe('GET /api/docs/<path>: good paths', () => {
  it('returns a markdown doc from main, cached 60 seconds', async () => {
    const { fetchImpl, seen } = fakeGithub(() => reply('# GDD\n\ntext', 200, { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }));
    const response = await handleDocs(request('/api/docs/docs/GDD.md'), { env, fetchImpl });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# GDD\n\ntext');
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('s-maxage=60, stale-while-revalidate');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // One request, to the one repo, at the ref main, with the token in the header.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${BASE}/docs/GDD.md?ref=main`);
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.headers.Accept).toBe('application/vnd.github.raw+json');
  });

  it('returns a root file (status.md)', async () => {
    const { fetchImpl, seen } = fakeGithub(() => reply('status'));
    const response = await handleDocs(request('/api/docs/status.md'), { env, fetchImpl });
    expect(response.status).toBe(200);
    expect(seen[0]?.url).toBe(`${BASE}/status.md?ref=main`);
  });

  it('returns a diagram PNG as the bytes it got', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128]);
    const { fetchImpl } = fakeGithub(() => reply(png, 200, { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }));
    const response = await handleDocs(request('/api/docs/docs/engine/diagrams/engine-frame.png'), { env, fetchImpl });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it('ignores the query string: no request can pick another ref, repo or path', async () => {
    const { fetchImpl, seen } = fakeGithub(() => reply('x'));
    await handleDocs(request('/api/docs/docs/GDD.md?ref=other&repo=someone/else&path=../CLAUDE.md'), { env, fetchImpl });
    expect(seen.map((call) => call.url)).toEqual([`${BASE}/docs/GDD.md?ref=main`]);
  });

  it('builds the URL for the one repo and the ref main only', () => {
    expect(contentsUrl('docs/x.md')).toBe(`${BASE}/docs/x.md?ref=main`);
  });
});

describe('GET /api/docs/<path>: hostile paths never reach GitHub', () => {
  // The URL parser removes literal dot segments before the handler sees them, so some of these arrive as a different (still refused) path.
  const HOSTILE = [
    '/api/docs/../CLAUDE.md',
    '/api/docs/docs/../../CLAUDE.md',
    '/api/docs/%2e%2e/CLAUDE.md',
    '/api/docs/%2E%2E/%2E%2E/CLAUDE.md',
    '/api/docs/docs%2fGDD.md',
    '/api/docs/docs%2F..%2F..%2FCLAUDE.md',
    '/api/docs/docs%5cGDD.md',
    '/api/docs/docs/GDD.md%00.png',
    '/api/docs/docs/GDD.md%00',
    '/api/docs/%252e%252e/CLAUDE.md',
    '/api/docs//etc/passwd',
    '/api/docs/C:/Windows/win.ini',
    '/api/docs/.env',
    '/api/docs/docs/.git/config',
    '/api/docs/package.json',
    '/api/docs/src/engine/game.ts',
    '/api/docs/tools/command-center/README.md',
    '/api/docs/.github/workflows/ci.yml',
    '/api/docs/docs/photo.jpg',
    '/api/docs/docs/GDD.md/',
    '/api/docs/',
    '/api/docs',
    '/api/docs/public/art/crew/a.png',
  ];

  it.each(HOSTILE)('refuses %s with 400 or 404 and makes no GitHub request', async (path) => {
    const { fetchImpl, seen } = fakeGithub(() => reply('SECRET FILE'));
    const response = await handleDocs(request(path), { env, fetchImpl });
    expect([400, 404]).toContain(response.status);
    expect(seen).toEqual([]);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.clone().text()).not.toContain('SECRET FILE');
    await expectNoSecrets(response);
  });

  it('reads a path that the URL parser has already cleaned only if the cleaned path is in the list (a backslash becomes a slash)', async () => {
    // new URL turns `\` into `/` and removes `..`, so this arrives as /api/docs/CLAUDE.md, a root doc that is allowed. Nothing outside the list is read.
    const { fetchImpl, seen } = fakeGithub(() => reply('x'));
    const response = await handleDocs(request('/api/docs/docs\\..\\CLAUDE.md'), { env, fetchImpl });
    expect(response.status).toBe(200);
    expect(seen.map((call) => call.url)).toEqual([`${BASE}/CLAUDE.md?ref=main`]);
  });

  it('checks the path before the configuration: a hostile path gets 400 even when the token is missing', async () => {
    const response = await handleDocs(request('/api/docs/%2e%2e/CLAUDE.md'), { env: {}, fetchImpl: vi.fn() });
    expect(response.status).toBe(400);
  });

  it('answers 404 {error, kind} for a plain path outside the list', async () => {
    const response = await handleDocs(request('/api/docs/package.json'), { env, fetchImpl: vi.fn() });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found', kind: 'not-found' });
  });
});

describe('GET /api/docs/<path>: configuration and GitHub failures', () => {
  const path = '/api/docs/docs/GDD.md';
  const LEAK = `LEAK-MARKER ${TOKEN}`;

  it('answers 500 {error: "not configured"} without the token, and calls nothing', async () => {
    const fetchImpl = vi.fn();
    const response = await handleDocs(request(path), { env: {}, fetchImpl });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'not configured', kind: 'not-configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a file that GitHub does not have', () => reply(JSON.stringify({ message: LEAK }), 404), 404, 'not-found', null],
    ['a bad token', () => reply(JSON.stringify({ message: LEAK }), 401), 502, 'unauthorized', null],
    ['a rate limit with Retry-After', () => reply(LEAK, 403, { 'retry-after': '30' }), 503, 'rate-limited', '30'],
    ['a rate limit by the remaining header', () => reply(LEAK, 403, { 'x-ratelimit-remaining': '0' }), 503, 'rate-limited', '60'],
    ['a 429', () => reply(LEAK, 429), 503, 'rate-limited', '60'],
    ['a refusal that is not a rate limit', () => reply(LEAK, 403), 502, 'http-error', null],
    ['a server error', () => reply(LEAK, 500), 502, 'http-error', null],
    ['a JSON reply (a folder listing)', () => reply(JSON.stringify([{ name: LEAK }]), 200, { 'content-type': 'application/json; charset=utf-8' }), 502, 'bad-response', null],
  ])('maps %s to %i %s', async (_name, answer, status, kind, retryAfter) => {
    const { fetchImpl } = fakeGithub(answer);
    const response = await handleDocs(request(path), { env, fetchImpl });
    expect(response.status).toBe(status);
    expect(response.headers.get('Retry-After')).toBe(retryAfter);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await jsonOf(response)).kind).toBe(kind);
    expect(await response.clone().text()).not.toContain('LEAK-MARKER');
    await expectNoSecrets(response);
  });

  it('refuses a file over the size limit', async () => {
    const { fetchImpl } = fakeGithub(() => reply(new Uint8Array(4_000_001)));
    const response = await handleDocs(request('/api/docs/docs/engine/diagrams/big.png'), { env, fetchImpl });
    expect(response.status).toBe(502);
    expect((await jsonOf(response)).kind).toBe('too-large');
  });

  it('accepts a file at the size limit', async () => {
    const { fetchImpl } = fakeGithub(() => reply(new Uint8Array(4_000_000)));
    const response = await handleDocs(request('/api/docs/docs/engine/diagrams/big.png'), { env, fetchImpl });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(4_000_000);
  });

  it('refuses on the content-length header and does not read the body', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const getReader = vi.fn();
    const fetchImpl: DocFetch = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '9000000' }), arrayBuffer, body: { getReader } as unknown as ReadableStream<Uint8Array<ArrayBuffer>> });
    const response = await handleDocs(request('/api/docs/docs/engine/diagrams/big.png'), { env, fetchImpl });
    expect(response.status).toBe(502);
    expect((await jsonOf(response)).kind).toBe('too-large');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('stops reading a body that grows past the limit when no content-length is sent', async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1_000_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: DocFetch = async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0), body: body as ReadableStream<Uint8Array<ArrayBuffer>> });
    const response = await handleDocs(request('/api/docs/docs/engine/diagrams/big.png'), { env, fetchImpl });
    expect(response.status).toBe(502);
    expect((await jsonOf(response)).kind).toBe('too-large');
    expect(cancelled).toBe(true);
    // 4 chunks fit and the 5th crosses the limit. The endless stream is not read to its end.
    expect(pulled).toBeLessThan(10);
  });

  it('maps a network failure to 504, without the text of the error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl: DocFetch = async () => {
      throw new Error(`connect ECONNRESET with ${TOKEN}`);
    };
    const response = await handleDocs(request(path), { env, fetchImpl });
    expect(response.status).toBe(504);
    expect((await jsonOf(response)).kind).toBe('network');
    await expectNoSecrets(response);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it.each(['HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'])('answers 405 to %s and makes no GitHub call', async (method) => {
    const fetchImpl = vi.fn();
    const response = await handleDocs(request(path, { method, ...(method === 'PUT' || method === 'POST' ? { body: 'x' } : {}) }), { env, fetchImpl });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('the real content types of the GitHub contents API (checked against the live API)', () => {
    const FILE = 'application/vnd.github.raw+json; charset=utf-8';
    const FOLDER = 'application/json; charset=utf-8';

    it('serves a file that GitHub labels application/vnd.github.raw+json', async () => {
      const { fetchImpl } = fakeGithub(() => reply('# text', 200, { 'content-type': FILE }));
      const response = await handleDocs(request(path), { env, fetchImpl });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('# text');
    });

    it.each([FOLDER, 'application/json', 'Application/JSON; charset=utf-8', ' application/json ;charset=utf-8'])('refuses a folder listing labeled %j', async (type) => {
      const { fetchImpl } = fakeGithub(() => reply('[{"name":"x"}]', 200, { 'content-type': type }));
      const response = await handleDocs(request(path), { env, fetchImpl });
      expect(response.status).toBe(502);
      expect((await jsonOf(response)).kind).toBe('bad-response');
    });

    it('does not treat another +json type as a listing', async () => {
      const { fetchImpl } = fakeGithub(() => reply('# text', 200, { 'content-type': 'application/vnd.github.v3.raw+json' }));
      expect((await handleDocs(request(path), { env, fetchImpl })).status).toBe(200);
    });
  });

  describe('Retry-After from the rate-limit headers', () => {
    const NOW = new Date('2026-10-12T12:00:00Z');
    const epoch = (secondsFromNow: number): string => String(Math.floor(NOW.getTime() / 1000) + secondsFromNow);
    const limited = (headers: Record<string, string>, status = 403) => fakeGithub(() => reply('LEAK-MARKER', status, headers)).fetchImpl;

    it.each([
      ['the reset time of the primary limit', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(120) }, 403, '120'],
      ['a reset time in the past (at least 1)', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(-50) }, 403, '1'],
      ['a reset time far away (at most 3600)', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(99999) }, 403, '3600'],
      ['no reset time (the default)', { 'x-ratelimit-remaining': '0' }, 403, '60'],
      ['a reset time that is not a number (the default)', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }, 403, '60'],
      ['retry-after of a secondary limit', { 'retry-after': '45' }, 403, '45'],
      ['retry-after before the reset time', { 'retry-after': '45', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(500) }, 403, '45'],
      ['a 429 with the reset time', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(30) }, 429, '30'],
    ])('uses %s', async (_name, headers, status, expected) => {
      const response = await handleDocs(request(path), { env, fetchImpl: limited(headers, status), now: () => NOW });
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe(expected);
      expect(await response.clone().text()).not.toContain('LEAK-MARKER');
    });

    it('ignores the reset time when the limit is not used up', async () => {
      const response = await handleDocs(request(path), { env, fetchImpl: limited({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': epoch(120) }), now: () => NOW });
      expect(response.status).toBe(502);
      expect(response.headers.get('Retry-After')).toBeNull();
    });
  });

  it('is wired as a Web standard handler: the default export has fetch(request)', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    expect((await docsFunction.fetch(request(path))).status).toBe(500);
    expect((await docsFunction.fetch(request('/api/docs/%2e%2e/x.md'))).status).toBe(400);
    vi.unstubAllEnvs();
  });
});
