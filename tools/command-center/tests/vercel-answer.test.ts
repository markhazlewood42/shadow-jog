import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import answerFunction from '../functions/answer';
import { handleAnswer } from '../src/hosted/answer';
import { MIN_WRITE_MS, WriteRefused, createRestExecutor, ghWrite, isAllowedWrite, withDeadline } from '../src/hosted/github-rest';
import { isStrictVercelLogin } from '../src/server/publish/protection';
import { PACKAGE_DIR } from './helpers';
import { FakeWorld, HOST, MARK, ORIGIN, REPO_PATH, SENTINEL, answerRequest, env, openDecision } from './vercel-answer-helpers';

// POST /api/answer (docs/command-center/hosted-answer-brief.md, "Hard pass lines" 1 to 13). GitHub and the protection probe are a fake `fetch` (tests/vercel-answer-helpers.ts).
// No test reaches the network, and the token is a sentinel. Each test names the pass line it proves.

type Json = Record<string, unknown>;
const bodyOf = async (response: Response): Promise<Json> => (await response.clone().json()) as Json;
const errorOf = async (response: Response): Promise<{ code: string; message: string }> => ((await bodyOf(response)).error as { code: string; message: string });

/** A world with one open decision (#41, options A, B and C) and a handler call on it. */
function setup() {
  const world = new FakeWorld();
  world.add(openDecision(41));
  const send = (body: unknown, headers: Record<string, string | undefined> = {}, environment: Record<string, string | undefined> = env(), init: { method?: string; rawBody?: string } = {}) =>
    handleAnswer(answerRequest(body, headers, init), { env: environment, fetchImpl: world.fetch });
  return { world, send };
}

const consoleSpies = () => (['error', 'log', 'warn', 'info', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));

afterEach(() => vi.restoreAllMocks());

describe('pass line 1: the answer', () => {
  it('writes one comment, the label changes and one close, in that order, all on the constant repo, and replies with the answer', async () => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B', note: 'Because it is second.' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await bodyOf(response);
    expect(body).toMatchObject({ ok: true, answer: { option: 'B', note: 'Because it is second.' } });
    expect(world.writes).toEqual([`POST ${REPO_PATH}/issues/41/comments`, `POST ${REPO_PATH}/issues/41/labels`, `DELETE ${REPO_PATH}/issues/41/labels/decision`, `PATCH ${REPO_PATH}/issues/41`]);
    const write = (index: number) => world.githubCalls.filter((call) => call.method !== 'GET' && !call.url.endsWith('/graphql'))[index]?.body;
    expect(write(0)).toEqual({ body: 'Decision: B. Because it is second.' });
    expect(write(1)).toEqual({ labels: ['decided'] });
    expect(write(3)).toEqual({ state: 'closed' });
    // The fake repository ended in the state that the CLAUDE.md rule reads as an answer: closed, `decided` by Mark, `decision` off, the comment by Mark.
    const issue = world.issues.get(41);
    expect(issue?.state).toBe('CLOSED');
    expect(issue?.labels).toEqual(['decided']);
    expect(issue?.comments.at(-1)).toMatchObject({ author: MARK, body: 'Decision: B. Because it is second.' });
    expect(issue?.events.at(-1)).toMatchObject({ label: 'decided', actor: MARK });
  });

  it('writes `Decision: <id>` with no note when there is none, and sends the token only to api.github.com', async () => {
    const { world, send } = setup();
    expect((await send({ number: 41, option: 'A' })).status).toBe(200);
    expect(world.issues.get(41)?.comments.at(-1)?.body).toBe('Decision: A');
    for (const call of world.githubCalls) expect(call.headers.authorization).toBe(`Bearer ${SENTINEL}`);
    for (const call of world.probeCalls) expect(call.headers.authorization).toBeUndefined();
  });

  it('is the default export of functions/answer.ts with a fetch handler that refuses a GET', async () => {
    const response = await answerFunction.fetch(new Request(`${ORIGIN}/api/answer`));
    expect(response.status).toBe(405);
  });
});

describe('pass line 2: clearDecided', () => {
  it('removes `decided` first when another account put it on, then adds it (one remove before the add)', async () => {
    const { world, send } = setup();
    world.add(openDecision(42, { labels: ['decision', 'decided'], events: [{ label: 'decided', actor: 'stranger-1', createdAt: '2026-10-10T00:00:01Z' }] }));
    const response = await send({ number: 42, option: 'A' });
    expect(response.status).toBe(200);
    expect(world.writes).toEqual([
      `POST ${REPO_PATH}/issues/42/comments`,
      `DELETE ${REPO_PATH}/issues/42/labels/decided`,
      `POST ${REPO_PATH}/issues/42/labels`,
      `DELETE ${REPO_PATH}/issues/42/labels/decision`,
      `PATCH ${REPO_PATH}/issues/42`,
    ]);
    // The newest `labeled decided` event is now Mark's, which is what makes the answer trusted.
    expect(world.issues.get(42)?.events.at(-1)).toMatchObject({ label: 'decided', actor: MARK });
  });

  it('does not remove `decided` when Mark put it on himself (no stale label)', async () => {
    const { world, send } = setup();
    expect((await send({ number: 41, option: 'A' })).status).toBe(200);
    expect(world.writes.filter((write) => write.startsWith('DELETE') && write.endsWith('/labels/decided'))).toEqual([]);
  });
});

describe('pass line 3: protection off', () => {
  const NOT_PROVEN: [string, FakeWorld['probe']][] = [
    ['a 200 (the page is public)', { status: 200 }],
    ['a JSON 401', { status: 401, contentType: 'application/json' }],
    ['a redirect to a subdomain of vercel.com', { status: 302, location: 'https://evil.vercel.com/sso-api?x=1' }],
    ['a redirect to vercel.com with only a next= query', { status: 302, location: 'https://vercel.com/?next=/sso-api' }],
    ['a redirect to vercel.com on a path that only starts like a login', { status: 302, location: 'https://vercel.com/ssoX' }],
    ['a redirect to another site', { status: 302, location: 'https://evil.example/sso-api' }],
    ['a redirect with no Location', { status: 302 }],
    ['a 301 to the login', { status: 301, location: 'https://vercel.com/login' }],
    ['a 500', { status: 500 }],
    ['a network error', 'throw'],
    ['a timeout', 'timeout'],
  ];

  it.each(NOT_PROVEN)('%s gives 503 protection-unproven and no GitHub call of any kind', async (_name, probe) => {
    const { world, send } = setup();
    world.probe = probe;
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('protection-unproven');
    expect(world.githubCalls).toEqual([]);
    expect(world.issues.get(41)?.comments).toEqual([]);
  });

  it.each([
    ['302 to /sso-api', { status: 302, location: 'https://vercel.com/sso-api?url=x' }],
    ['307 to /login', { status: 307, location: 'https://vercel.com/login?next=x' }],
    ['302 to /sso/deeper', { status: 302, location: 'https://vercel.com/sso/deeper' }],
  ] satisfies [string, FakeWorld['probe']][])('a %s is proof', async (_name, probe) => {
    const { world, send } = setup();
    world.probe = probe;
    expect((await send({ number: 41, option: 'B' })).status).toBe(200);
  });

  it('isStrictVercelLogin: host exactly vercel.com over https, and the path exactly /sso-api, /sso or /login or one of them followed by a slash', () => {
    const base = ORIGIN;
    expect(isStrictVercelLogin('https://vercel.com/sso-api?url=1', base)).toBe(true);
    expect(isStrictVercelLogin('https://vercel.com/sso', base)).toBe(true);
    expect(isStrictVercelLogin('https://vercel.com/login/x', base)).toBe(true);
    for (const wrong of ['https://vercel.com/ssoX', 'https://vercel.com/login-help', 'https://vercel.com/', 'https://vercel.com/?next=x', 'https://www.vercel.com/login', 'https://vercel.com:8443/login', 'http://vercel.com/login', 'https://user@vercel.com/login', '/login', null]) {
      expect(isStrictVercelLogin(wrong, base), String(wrong)).toBe(false);
    }
  });
});

describe('pass line 4: probe shape', () => {
  it('sends no Cookie header, Accept text/html and manual redirects, to CC_ORIGIN/api/snapshot, with a time limit', async () => {
    const { world, send } = setup();
    await send({ number: 41, option: 'B' }, { cookie: '_vercel_jwt=SESSION' });
    expect(world.probeCalls).toHaveLength(1);
    const [probe] = world.probeCalls;
    expect(probe?.url).toBe(`${ORIGIN}/api/snapshot`);
    expect(probe?.method).toBe('GET');
    expect(probe?.headers.cookie).toBeUndefined();
    expect(probe?.headers.accept).toBe('text/html');
    expect(probe?.redirect).toBe('manual');
    expect(probe?.hasSignal).toBe(true);
    expect(Object.keys(probe?.headers ?? {})).toEqual(['accept']);
  });

  it('a JSON 401 (the case of the reporter) gives 503, never success', async () => {
    const { world, send } = setup();
    world.probe = { status: 401, contentType: 'application/json' };
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(503);
    expect(world.githubCalls).toEqual([]);
  });
});

describe('pass line 5: host', () => {
  it.each([
    ['another alias', 'shadow-jog-cc.vercel.app'],
    ['a deployment URL', 'shadow-jog-command-center-abc123-mark.vercel.app'],
    ['the right host with another port', `${HOST}:8443`],
    ['a look-alike prefix', `evil-${HOST}`],
  ])('%s gives 403 wrong-host, with no probe and no GitHub call', async (_name, host) => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B' }, { host });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('wrong-host');
    expect(error.message).toBe(`Answer from ${ORIGIN}.`);
    expect(world.calls).toEqual([]);
  });

  it('compares the host in lower case', async () => {
    const { send } = setup();
    expect((await send({ number: 41, option: 'B' }, { host: HOST.toUpperCase() })).status).toBe(200);
  });
});

describe('pass line 6: bypass on', () => {
  it('VERCEL_AUTOMATION_BYPASS_SECRET set (even empty) gives 503 bypass-on and no GitHub call, and the value is never read', async () => {
    for (const value of ['some-secret-value', '']) {
      const { world, send } = setup();
      const response = await send({ number: 41, option: 'B' }, {}, env({ VERCEL_AUTOMATION_BYPASS_SECRET: value }));
      expect(response.status).toBe(503);
      expect((await errorOf(response)).code).toBe('bypass-on');
      expect(world.calls).toEqual([]);
      expect(JSON.stringify(await bodyOf(response))).not.toContain('some-secret-value');
    }
  });
});

describe('pass line 7: cross-site and media type', () => {
  it.each([
    ['no Origin', { origin: undefined }],
    ['a foreign Origin', { origin: 'https://evil.example' }],
    ['the host with http as Origin', { origin: `http://${HOST}` }],
    ['no Sec-Fetch-Site', { 'sec-fetch-site': undefined }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }],
  ] satisfies [string, Record<string, string | undefined>][])('%s gives 403, with no probe and no GitHub call', async (_name, headers) => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B' }, headers);
    expect(response.status).toBe(403);
    expect(world.calls).toEqual([]);
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['no type', undefined],
  ])('%s as Content-Type gives 415 and no call', async (_name, type) => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B' }, { 'content-type': type });
    expect(response.status).toBe(415);
    expect(world.calls).toEqual([]);
  });

  it('accepts application/json with a charset', async () => {
    const { send } = setup();
    expect((await send({ number: 41, option: 'B' }, { 'content-type': 'Application/JSON; charset=utf-8' })).status).toBe(200);
  });

  it.each([
    ['not JSON', { rawBody: 'not json' }, 400],
    ['no number', { rawBody: JSON.stringify({ option: 'B' }) }, 422],
    ['a number that is not an integer', { rawBody: JSON.stringify({ number: 4.5, option: 'B' }) }, 422],
    ['a number below 1', { rawBody: JSON.stringify({ number: 0, option: 'B' }) }, 422],
    ['a number as text', { rawBody: JSON.stringify({ number: '41', option: 'B' }) }, 422],
    ['no option', { rawBody: JSON.stringify({ number: 41 }) }, 422],
    ['an option that is too long', { rawBody: JSON.stringify({ number: 41, option: 'x'.repeat(65) }) }, 422],
    ['a note that is not text', { rawBody: JSON.stringify({ number: 41, option: 'B', note: 5 }) }, 422],
    ['a note that is too long', { rawBody: JSON.stringify({ number: 41, option: 'B', note: 'x'.repeat(2001) }) }, 422],
    ['a note with a control character', { rawBody: JSON.stringify({ number: 41, option: 'B', note: 'a\u0000b' }) }, 422],
    ['a body over 16 KB', { rawBody: JSON.stringify({ number: 41, option: 'B', note: 'x'.repeat(20_000) }) }, 413],
  ])('%s gives %i and no GitHub call', async (_name, init, status) => {
    const { world, send } = setup();
    const response = await send(null, {}, env(), init);
    expect(response.status).toBe(status);
    expect(world.githubCalls).toEqual([]);
  });

  it('stops reading a body without Content-Length at the cap and gives 413, whatever its size', async () => {
    const { world } = setup();
    let pulled = 0;
    // A stream that never ends and has no Content-Length: a read of the whole body would never return.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4096).fill(120));
      },
    });
    const request = new Request(`${ORIGIN}/api/answer`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
      body: endless,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    const response = await handleAnswer(request, { env: env(), fetchImpl: world.fetch });
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(20);
    expect(world.githubCalls).toEqual([]);
  });

  it('refuses a method other than POST with 405 and Allow: POST', async () => {
    const { world, send } = setup();
    const response = await send(null, {}, env(), { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(world.calls).toEqual([]);
  });
});

describe('pass line 8: token owner', () => {
  it.each([
    ['another login', { login: 'someone-else', id: 79615015 }],
    ['the right login with another id', { login: MARK, id: 1234 }],
  ])('%s gives 500 misconfigured and no write', async (_name, viewer) => {
    const { world, send } = setup();
    world.viewer = viewer;
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe('misconfigured');
    expect(world.writes).toEqual([]);
    expect(world.graphqlQueries).toEqual([]);
  });

  it.each(['status-500', 'throw', 'timeout', 'not-json'] as const)('GET /user that fails (%s) gives 502 github and no write', async (mode) => {
    const { world, send } = setup();
    world.userMode = mode;
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('github');
    expect(world.writes).toEqual([]);
    expect(world.graphqlQueries).toEqual([]);
  });

  it('gives 500 misconfigured and no write when GET /user carries x-oauth-scopes (a classic token), even with an empty value', async () => {
    for (const scopes of ['repo, read:user', '']) {
      const { world, send } = setup();
      world.userScopes = scopes;
      const response = await send({ number: 41, option: 'B' });
      expect(response.status).toBe(500);
      expect((await errorOf(response)).code).toBe('misconfigured');
      expect(world.writes).toEqual([]);
      expect(world.graphqlQueries).toEqual([]);
    }
  });

  it('accepts a token whose GET /user has no x-oauth-scopes header (a fine-grained token)', async () => {
    const { world, send } = setup();
    expect(world.userScopes).toBeNull();
    expect((await send({ number: 41, option: 'B' })).status).toBe(200);
  });

  it('accepts the login in any case when the id is right', async () => {
    const { world, send } = setup();
    world.viewer = { login: 'MarkHazlewood42', id: 79615015 };
    expect((await send({ number: 41, option: 'B' })).status).toBe(200);
  });
});

describe('pass line 9: fixed repo and three writes', () => {
  it('ignores repo, owner and labels in the body: the mock sees only the constant repo and the three write shapes', async () => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B', repo: 'evil/other', owner: 'evil', labels: ['bug', 'decided-by-me'], state: 'open', title: 'x' });
    expect(response.status).toBe(200);
    for (const call of world.githubCalls) {
      if (call.url.endsWith('/graphql')) expect(call.body).toMatchObject({ variables: { owner: 'markhazlewood42', name: 'shadow-jog' } });
      else expect(call.url.startsWith('https://api.github.com/user') || call.url.startsWith(`https://api.github.com${REPO_PATH}/issues/41`)).toBe(true);
    }
    expect(world.writes).toEqual([`POST ${REPO_PATH}/issues/41/comments`, `POST ${REPO_PATH}/issues/41/labels`, `DELETE ${REPO_PATH}/issues/41/labels/decision`, `PATCH ${REPO_PATH}/issues/41`]);
    expect(world.githubCalls.some((call) => JSON.stringify(call.body ?? null).includes('evil'))).toBe(false);
  });

  describe('ghWrite() and isAllowedWrite()', () => {
    const base = `${REPO_PATH}/issues/41`;
    const allowed = [
      { method: 'POST', path: `${base}/comments`, body: { body: 'Decision: A' } },
      { method: 'POST', path: `${base}/labels`, body: { labels: ['decided'] } },
      { method: 'DELETE', path: `${base}/labels/decided` },
      { method: 'DELETE', path: `${base}/labels/decision` },
      { method: 'PATCH', path: base, body: { state: 'closed' } },
    ] as const;

    it.each(allowed)('allows $method $path', (request) => {
      expect(isAllowedWrite(request, 41)).toBe(true);
    });

    const refused: [string, Parameters<typeof isAllowedWrite>[0], number][] = [
      ['another issue number', { method: 'POST', path: `${base}/comments`, body: { body: 'x' } }, 42],
      ['another repo', { method: 'POST', path: '/repos/evil/other/issues/41/comments', body: { body: 'x' } }, 41],
      ['another owner', { method: 'POST', path: '/repos/evil/shadow-jog/issues/41/comments', body: { body: 'x' } }, 41],
      ['a comment body with another field', { method: 'POST', path: `${base}/comments`, body: { body: 'x', extra: 1 } }, 41],
      ['a comment body that is not text', { method: 'POST', path: `${base}/comments`, body: { body: 5 } }, 41],
      ['another label to add', { method: 'POST', path: `${base}/labels`, body: { labels: ['bug'] } }, 41],
      ['two labels to add', { method: 'POST', path: `${base}/labels`, body: { labels: ['decided', 'bug'] } }, 41],
      ['another label to remove', { method: 'DELETE', path: `${base}/labels/bug` }, 41],
      ['a delete with a body', { method: 'DELETE', path: `${base}/labels/decided`, body: {} }, 41],
      ['a label path with a slash', { method: 'DELETE', path: `${base}/labels/decided/x` }, 41],
      ['a patch that reopens', { method: 'PATCH', path: base, body: { state: 'open' } }, 41],
      ['a patch with a title', { method: 'PATCH', path: base, body: { state: 'closed', title: 'x' } }, 41],
      ['a patch with another field only', { method: 'PATCH', path: base, body: { title: 'x' } }, 41],
      ['a patch with no body', { method: 'PATCH', path: base }, 41],
      ['a delete of the issue comment list', { method: 'DELETE', path: `${base}/comments` }, 41],
      ['a post to the issue itself', { method: 'POST', path: base, body: { state: 'closed' } }, 41],
      ['a post to the lock path', { method: 'POST', path: `${base}/lock`, body: {} }, 41],
      ['a post to assignees', { method: 'POST', path: `${base}/assignees`, body: { assignees: ['x'] } }, 41],
      ['a path with a query', { method: 'PATCH', path: `${base}?x=1`, body: { state: 'closed' } }, 41],
      ['a path with a dot segment', { method: 'PATCH', path: `${REPO_PATH}/issues/../issues/41`, body: { state: 'closed' } }, 41],
      ['an issue number of zero', { method: 'PATCH', path: `${REPO_PATH}/issues/0`, body: { state: 'closed' } }, 0],
    ];
    it.each(refused)('refuses %s', async (_name, request, number) => {
      expect(isAllowedWrite(request, number)).toBe(false);
      const send = vi.fn();
      await expect(ghWrite(send, SENTINEL, request, number)).rejects.toBeInstanceOf(WriteRefused);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses a method that is not POST, PATCH or DELETE', async () => {
      const send = vi.fn();
      await expect(ghWrite(send, SENTINEL, { method: 'PUT' as 'POST', path: base, body: { state: 'closed' } }, 41)).rejects.toBeInstanceOf(WriteRefused);
      expect(send).not.toHaveBeenCalled();
    });

    it('sends an allowed write to api.github.com with the token in the Authorization header only', async () => {
      const send = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => '' }));
      await ghWrite(send, SENTINEL, allowed[4], 41);
      expect(send).toHaveBeenCalledTimes(1);
      const [url, init] = send.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
      expect(url).toBe(`https://api.github.com${base}`);
      expect(init.method).toBe('PATCH');
      expect(init.body).toBe('{"state":"closed"}');
      expect(init.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
      expect(JSON.stringify(init.body)).not.toContain(SENTINEL);
    });
  });
});

describe('pass line 10: re-read', () => {
  const stranger = (n: number) => ({ author: 'stranger-1', body: `noise ${n}`, createdAt: `2026-10-10T00:${String(n % 60).padStart(2, '0')}:00Z` });

  it('reads the second page of comments and the earlier page of label events, and resumes from the close (no second comment)', async () => {
    const { world, send } = setup();
    // 120 comments by a stranger, then Mark's answer as comment 121 (on the second page of comments). 130 label events, the newest is Mark's `decided`.
    const comments = [...Array.from({ length: 120 }, (_, n) => stranger(n)), { author: MARK, body: 'Decision: B. same note', createdAt: '2026-10-10T05:00:00Z' }];
    const events = [
      ...Array.from({ length: 129 }, (_, n) => ({ label: 'noise', actor: 'stranger-1', createdAt: `2026-10-10T01:00:${String(n % 60).padStart(2, '0')}Z` })),
      { label: 'decided', actor: MARK, createdAt: '2026-10-10T06:00:00Z' },
    ];
    world.add(openDecision(50, { labels: ['decided'], comments, events }));
    const response = await send({ number: 50, option: 'B', note: 'same note' });
    expect(response.status).toBe(200);
    // The read paged: the first call, one more page of comments, and one earlier page of events.
    expect(world.graphqlQueries).toEqual(['AnswerIssue', 'MoreComments', 'AnswerEvents']);
    // Because the page read the comment on page 2 and the event on page 1, only the close was left to do.
    expect(world.writes).toEqual([`PATCH ${REPO_PATH}/issues/50`]);
  });

  it('gives 502 too-many and writes nothing when the issue has more comments than the page cap (10 pages of 100)', async () => {
    const { world, send } = setup();
    world.add(openDecision(51, { comments: Array.from({ length: 1001 }, (_, n) => stranger(n)) }));
    const response = await send({ number: 51, option: 'B' });
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('too-many');
    expect(world.writes).toEqual([]);
  });

  it('reads an issue with exactly 10 pages of comments', async () => {
    const { world, send } = setup();
    world.add(openDecision(52, { comments: Array.from({ length: 1000 }, (_, n) => stranger(n)) }));
    expect((await send({ number: 52, option: 'B' })).status).toBe(200);
  });

  it('gives 502 too-many and writes nothing when the issue has more label events than the page cap', async () => {
    const { world, send } = setup();
    world.add(openDecision(53, { events: Array.from({ length: 1001 }, (_, n) => ({ label: 'noise', actor: 'stranger-1', createdAt: `2026-10-10T00:00:${String(n % 60).padStart(2, '0')}Z` })) }));
    const response = await send({ number: 53, option: 'B' });
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('too-many');
    expect(world.writes).toEqual([]);
  });

  it('gives 404 and no write for a pull request, a missing issue, and an issue not by Mark', async () => {
    const { world, send } = setup();
    world.add(openDecision(60));
    world.pullRequests.add(60);
    world.add(openDecision(61, { author: 'stranger-1' }));
    world.add(openDecision(62, { labels: ['bug'] }));
    for (const number of [60, 61, 62, 999]) {
      const response = await send({ number, option: 'B' });
      expect(response.status, String(number)).toBe(404);
      expect((await errorOf(response)).code).toBe('decision-not-found');
    }
    expect(world.writes).toEqual([]);
  });

  it('does not trust a `Decision:` comment of a stranger as progress (the comment is posted)', async () => {
    const { world, send } = setup();
    world.add(openDecision(54, { comments: [{ author: 'stranger-1', body: 'Decision: B', createdAt: '2026-10-10T05:00:00Z' }] }));
    expect((await send({ number: 54, option: 'B' })).status).toBe(200);
    expect(world.writes[0]).toBe(`POST ${REPO_PATH}/issues/54/comments`);
  });
});

describe('pass line 11: rules as local', () => {
  it('gives 422 for an option the issue does not have, and 409 for an answered or a closed issue, with no write', async () => {
    const { world, send } = setup();
    expect((await send({ number: 41, option: 'Z' })).status).toBe(422);
    world.add(
      openDecision(70, {
        state: 'CLOSED',
        labels: ['decided'],
        comments: [{ author: MARK, body: 'Decision: A', createdAt: '2026-10-10T05:00:00Z' }],
        events: [{ label: 'decided', actor: MARK, createdAt: '2026-10-10T06:00:00Z' }],
      }),
    );
    world.add(openDecision(71, { state: 'CLOSED' }));
    const answered = await send({ number: 70, option: 'B' });
    expect(answered.status).toBe(409);
    expect((await errorOf(answered)).code).toBe('already-answered');
    const closed = await send({ number: 71, option: 'B' });
    expect(closed.status).toBe(409);
    expect((await errorOf(closed)).code).toBe('not-open');
    expect(world.writes).toEqual([]);
  });

  it.each([
    ['comment', 'POST', '/comments', 'comment'],
    ['label', 'POST', '/labels', 'label'],
    ['close', 'PATCH', '', 'close'],
  ] as const)('a failed %s step gives 502 with the step name and no fixed text from GitHub', async (_name, method, suffix, step) => {
    const { world, send } = setup();
    world.failWrite = { method, suffix, status: 500, times: 1 };
    const response = await send({ number: 41, option: 'B', note: 'n' });
    expect(response.status).toBe(502);
    const body = await bodyOf(response);
    expect(body.ok).toBe(false);
    expect(body.step).toBe(step);
    expect(JSON.stringify(body)).not.toContain('GitHub says no');
  });

  it('Retry resumes at the failed step: no second comment, and the answer completes', async () => {
    const { world, send } = setup();
    world.failWrite = { method: 'POST', suffix: '/labels', status: 500, times: 1 };
    const first = await send({ number: 41, option: 'B', note: 'n' });
    expect(first.status).toBe(502);
    expect((await bodyOf(first)).step).toBe('label');
    expect(world.issues.get(41)?.comments).toHaveLength(1);
    const second = await send({ number: 41, option: 'B', note: 'n' });
    expect(second.status).toBe(200);
    const issue = world.issues.get(41);
    expect(issue?.comments).toHaveLength(1);
    expect(issue?.state).toBe('CLOSED');
    expect(issue?.labels).toEqual(['decided']);
  });

  it('Retry with another choice posts a new comment (the newest comment is the one that Mark means)', async () => {
    const { world, send } = setup();
    world.failWrite = { method: 'POST', suffix: '/labels', status: 500, times: 1 };
    await send({ number: 41, option: 'B' });
    expect((await send({ number: 41, option: 'C' })).status).toBe(200);
    expect(world.issues.get(41)?.comments.map((comment) => comment.body)).toEqual(['Decision: B', 'Decision: C']);
  });

  it('a removal of a label that is not on the issue (404) counts as done', async () => {
    const { world, send } = setup();
    world.add(openDecision(72, { labels: ['decision', 'decided'], events: [{ label: 'decided', actor: 'stranger-1', createdAt: '2026-10-10T00:00:01Z' }] }));
    world.failWrite = { method: 'DELETE', suffix: '/labels/decided', status: 404, times: 1 };
    expect((await send({ number: 72, option: 'A' })).status).toBe(200);
  });

  it('a write that the token may not make (403) names the permission and stops at that step', async () => {
    const { world, send } = setup();
    world.failWrite = { method: 'POST', suffix: '/comments', status: 403, times: 1 };
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('forbidden');
    expect(world.writes).toHaveLength(1);
  });

  it('a network error on a write gives 502 with the step', async () => {
    const { world, send } = setup();
    world.throwWrite = { method: 'POST', suffix: '/comments' };
    const response = await send({ number: 41, option: 'B' });
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).toMatchObject({ ok: false, step: 'comment', error: { code: 'network' } });
  });
});

describe('pass line 12: config', () => {
  it.each([
    ['GITHUB_TOKEN absent', env({ GITHUB_TOKEN: undefined })],
    ['GITHUB_TOKEN empty', env({ GITHUB_TOKEN: '  ' })],
    ['CC_ORIGIN absent', env({ CC_ORIGIN: undefined })],
    ['CC_ORIGIN with a path', env({ CC_ORIGIN: `${ORIGIN}/app` })],
    ['CC_ORIGIN with a trailing slash', env({ CC_ORIGIN: `${ORIGIN}/` })],
    ['CC_ORIGIN with http', env({ CC_ORIGIN: `http://${HOST}` })],
    ['CC_ORIGIN that is not an address', env({ CC_ORIGIN: 'not an address' })],
    ['CC_ORIGIN with a user name', env({ CC_ORIGIN: `https://user@${HOST}` })],
  ])('%s gives 500 misconfigured and no call at all', async (_name, environment) => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B' }, {}, environment);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe('misconfigured');
    expect(world.calls).toEqual([]);
  });

  it('a bad CC_ORIGIN is refused before the Host compare (even when the Host is wrong)', async () => {
    const { world, send } = setup();
    const response = await send({ number: 41, option: 'B' }, { host: 'other.example' }, env({ CC_ORIGIN: undefined }));
    expect(response.status).toBe(500);
    expect(world.calls).toEqual([]);
  });
});

describe('pass line 13: no leak', () => {
  const SECRET_FRAGMENTS = [SENTINEL, 'github_pat_', 'ghp_', 'X-CC-Token'];

  async function everything(response: Response): Promise<string> {
    const headers = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
    return `${response.status}\n${headers}\n${await response.clone().text()}`;
  }

  it('no answer body or header, and no logged line, holds the token: on success and on every forced error path', async () => {
    const spies = consoleSpies();
    const results: Response[] = [];
    const run = async (arrange: (world: FakeWorld) => void, request: (world: FakeWorld) => Promise<Response>) => {
      const { world } = setup();
      arrange(world);
      results.push(await request(world));
    };
    const normal = (world: FakeWorld, body: unknown = { number: 41, option: 'B' }) => handleAnswer(answerRequest(body), { env: env(), fetchImpl: world.fetch });

    await run(() => undefined, (world) => normal(world));
    await run((world) => (world.userMode = 'status-500'), (world) => normal(world)); // a 502 body from GitHub that echoes the token
    await run((world) => (world.failWrite = { method: 'POST', suffix: '/comments', status: 401, times: 1 }), (world) => normal(world)); // a GitHub 401 on a write
    await run((world) => (world.failWrite = { method: 'PATCH', suffix: '', status: 500, times: 1 }), (world) => normal(world));
    await run((world) => (world.throwWrite = { method: 'POST', suffix: '/comments' }), (world) => normal(world));
    await run(() => undefined, (world) => normal(world, { number: 41, option: 'Z' }));
    await run((world) => (world.probe = 'throw'), (world) => normal(world));
    // A thrown error inside the handler (the body stream of the request breaks with an error that holds the token): the catch-all answers 500 internal and logs only the name.
    await run(
      () => undefined,
      (world) => {
        const stream = new ReadableStream({ start: (controller) => controller.error(new RangeError(`boom ${SENTINEL}`)) });
        const request = new Request(`${ORIGIN}/api/answer`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin' }, body: stream, duplex: 'half' } as RequestInit);
        return handleAnswer(request, { env: env(), fetchImpl: world.fetch });
      },
    );

    expect(results.length).toBe(8);
    for (const response of results) {
      const text = await everything(response);
      for (const fragment of SECRET_FRAGMENTS) expect(text, `${response.status} holds ${fragment}`).not.toContain(fragment);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    for (const fragment of SECRET_FRAGMENTS) expect(logged).not.toContain(fragment);
    // The catch-all did log (so the check above has something to look at), and only the name of the error.
    expect(spies[0]?.mock.calls.map((call) => call.join(' '))).toContain('answer failed: RangeError');
  });

  it('the committed bundle api/answer.js (and every api/*.js) holds no token prefix and no write-token header', () => {
    const dir = join(PACKAGE_DIR, 'api');
    const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
    expect(files).toContain('answer.js');
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const fragment of ['github_pat_', 'ghp_', 'X-CC-Token']) expect(text, `${file} holds ${fragment}`).not.toContain(fragment);
    }
  });

  it('the scan would notice a token (negative control)', () => {
    expect('const t = "github_pat_abc";').toContain('github_pat_');
  });
});

describe('Named Minor fixes: time', () => {
  it('refuses to start a write with less than 5 s left: the step fails with the code deadline and nothing is sent', async () => {
    const calls: string[] = [];
    const executor = createRestExecutor({
      token: SENTINEL,
      number: 41,
      send: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
      },
      remainingMs: () => MIN_WRITE_MS - 1,
    });
    expect(await executor.comment('Decision: A')).toMatchObject({ code: 'deadline' });
    expect(await executor.labels(true)).toMatchObject({ code: 'deadline' });
    expect(await executor.close()).toMatchObject({ code: 'deadline' });
    expect(calls).toEqual([]);
  });

  it('starts a write with exactly 5 s left', async () => {
    const executor = createRestExecutor({ token: SENTINEL, number: 41, send: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => '' }), remainingMs: () => MIN_WRITE_MS });
    expect(await executor.close()).toBeNull();
  });

  it('the whole request stops before the next write when the 25 s deadline is near, and a Retry resumes (502 with the step)', async () => {
    const world = new FakeWorld();
    world.add(openDecision(41));
    let clock = 0;
    // Each call to GitHub moves the clock by 9 s: the read takes 18 s, so the comment write has 25 - 18 = 7 s, the next one only -2 s.
    const base = world.fetch;
    const fetchImpl: typeof world.fetch = async (url, init) => {
      clock += 9_000;
      return base(url, init);
    };
    const response = await handleAnswer(answerRequest({ number: 41, option: 'B' }), { env: env(), fetchImpl, clock: () => clock });
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).toMatchObject({ ok: false, step: 'comment', error: { code: 'deadline' } });
    expect(world.writes).toEqual([]);
  });

  it('the deadline follows the monotonic clock: a calendar clock that jumps does not end it', async () => {
    const world = new FakeWorld();
    world.add(openDecision(41));
    // Each read of the calendar clock jumps an hour. The deadline clock stands still, so nothing runs out.
    let calendar = Date.UTC(2026, 9, 17);
    const response = await handleAnswer(answerRequest({ number: 41, option: 'B' }), {
      env: env(),
      fetchImpl: world.fetch,
      now: () => (calendar += 3_600_000),
      clock: () => 0,
    });
    expect(response.status).toBe(200);
    expect(world.writes.length).toBeGreaterThan(0);
  });

  it('a fixed calendar clock does not switch the deadline off: the monotonic clock ends it', async () => {
    const world = new FakeWorld();
    world.add(openDecision(41));
    let clock = 0;
    const base = world.fetch;
    const fetchImpl: typeof world.fetch = async (url, init) => {
      clock += 9_000;
      return base(url, init);
    };
    const response = await handleAnswer(answerRequest({ number: 41, option: 'B' }), { env: env(), fetchImpl, now: () => 1_000, clock: () => clock });
    expect(response.status).toBe(502);
    expect(await bodyOf(response)).toMatchObject({ error: { code: 'deadline' } });
  });

  it('withDeadline cuts each call at the smaller of its cap and the time left, and starts none after the deadline', async () => {
    const seen: AbortSignal[] = [];
    const base = async (_url: string, init: { signal?: AbortSignal }) => {
      if (init.signal !== undefined) seen.push(init.signal);
      return new Promise<never>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
    };
    let clock = 1_000;
    const send = withDeadline(base, 10_000, 1_030, () => clock);
    // 30 ms are left, the cap is 10 s: the call is cut at about 30 ms.
    const started = Date.now();
    await expect(send('https://x.example', { method: 'GET', headers: {} })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen).toHaveLength(1);
    // After the deadline no call starts.
    clock = 2_000;
    await expect(send('https://x.example', { method: 'GET', headers: {} })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(seen).toHaveLength(1);
  });

  it('withDeadline uses the cap when more time is left than the cap', async () => {
    let signal: AbortSignal | undefined;
    const send = withDeadline(
      async (_url, init) => {
        signal = init.signal;
        return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
      },
      50,
      Date.now() + 60_000,
    );
    await send('https://x.example', { method: 'GET', headers: {} });
    expect(signal?.aborted).toBe(false);
    await new Promise((done) => setTimeout(done, 120));
    expect(signal?.aborted).toBe(true);
  });
});

describe('Named Minor fixes: PATCH body', () => {
  it('pins the close to exactly { state: "closed" }', () => {
    const path = `${REPO_PATH}/issues/41`;
    expect(isAllowedWrite({ method: 'PATCH', path, body: { state: 'closed' } }, 41)).toBe(true);
    expect(isAllowedWrite({ method: 'PATCH', path, body: { state: 'closed', state_reason: 'not_planned' } }, 41)).toBe(false);
    expect(isAllowedWrite({ method: 'PATCH', path, body: { state: 'CLOSED' } }, 41)).toBe(false);
  });
});
