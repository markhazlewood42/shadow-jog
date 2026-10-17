import { describe, expect, it, vi } from 'vitest';
import { handleAnswer } from '../src/hosted/answer';
import { MIN_WRITE_MS, WriteRefused, createRestExecutor, ghWrite, isAllowedWrite } from '../src/hosted/github-rest';
import { FakeWorld, HOST, MARK, ORIGIN, REPO_PATH, SENTINEL, answerRequest, env, openDecision } from './vercel-answer-helpers';

// The Ask for more info on POST /api/answer (docs/command-center/needs-info-brief.md, option A: the field `action`). GitHub and the protection probe are the fake `fetch`
// of tests/vercel-answer-helpers.ts. Each test names the hard pass line (1 to 9 of the brief) that it proves.

type Json = Record<string, unknown>;
const bodyOf = async (response: Response): Promise<Json> => (await response.clone().json()) as Json;
const errorOf = async (response: Response): Promise<{ code: string; message: string }> => (await bodyOf(response)).error as { code: string; message: string };

const T0 = '2026-10-10T00:00:10Z'; // older than every comment that the fake world writes
const markSays = (body: string, createdAt = T0) => ({ author: MARK, body, createdAt });
const base = (number: number) => `${REPO_PATH}/issues/${number}`;

function setup() {
  const world = new FakeWorld();
  world.add(openDecision(41));
  const send = (body: unknown, headers: Record<string, string | undefined> = {}, environment: Record<string, string | undefined> = env(), init: { method?: string; rawBody?: string } = {}) =>
    handleAnswer(answerRequest(body, headers, init), { env: environment, fetchImpl: world.fetch });
  const ask = (note: string, number = 41) => send({ number, action: 'ask', note });
  return { world, send, ask };
}

describe('pass line 1: a hosted Ask', () => {
  it('writes one Question: comment and then the label needs-info, and leaves the issue open with decision, with no decided, no close and no Decision: comment', async () => {
    const { world, ask } = setup();
    const response = await ask('What does option C cost to undo?');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await bodyOf(response)).toMatchObject({ ok: true, ask: { text: 'What does option C cost to undo?' } });
    expect(world.writes).toEqual([`POST ${base(41)}/comments`, `POST ${base(41)}/labels`]);
    const bodies = world.githubCalls.filter((call) => call.method !== 'GET' && !call.url.endsWith('/graphql')).map((call) => call.body);
    expect(bodies).toEqual([{ body: 'Question: What does option C cost to undo?' }, { labels: ['needs-info'] }]);
    const issue = world.issues.get(41);
    expect(issue?.state).toBe('OPEN');
    expect(issue?.labels).toEqual(['decision', 'needs-info']);
    expect(issue?.comments).toHaveLength(1);
    expect(issue?.comments[0]).toMatchObject({ author: MARK });
    expect(issue?.comments[0]?.body.startsWith('Question:')).toBe(true);
  });

  it('makes line breaks one kind (\\n) and trims the ends of the question', async () => {
    const { world, ask } = setup();
    expect((await ask('  First line\r\nsecond line\rthird  ')).status).toBe(200);
    expect(world.issues.get(41)?.comments[0]?.body).toBe('Question: First line\nsecond line\nthird');
  });

  it('a body with no action is an answer, and action "answer" is the same answer', async () => {
    const { world, send } = setup();
    world.add(openDecision(42));
    expect((await send({ number: 41, option: 'A' })).status).toBe(200);
    expect((await send({ number: 42, option: 'A', action: 'answer' })).status).toBe(200);
    expect(world.issues.get(41)?.comments[0]?.body).toBe('Decision: A');
    expect(world.issues.get(42)?.comments[0]?.body).toBe('Decision: A');
  });

  it('asking again on an issue that has needs-info is allowed: the new question is a second comment', async () => {
    const { world, ask } = setup();
    expect((await ask('First?')).status).toBe(200);
    expect((await ask('Second?')).status).toBe(200);
    expect(world.issues.get(41)?.comments.map((comment) => comment.body)).toEqual(['Question: First?', 'Question: Second?']);
    expect(world.issues.get(41)?.state).toBe('OPEN');
  });
});

describe('pass line 2: what an Ask refuses writes nothing', () => {
  it('an issue that is closed, answered, a pull request, missing, not by Mark, or without the decision label gives 404 or 409 and no write', async () => {
    const { world, ask } = setup();
    world.add(openDecision(50, { state: 'CLOSED' }));
    world.add(
      openDecision(51, {
        state: 'CLOSED',
        labels: ['decided'],
        comments: [markSays('Decision: A. done')],
        events: [{ label: 'decided', actor: MARK, createdAt: '2026-10-10T00:00:11Z' }],
      }),
    );
    world.add(openDecision(52));
    world.pullRequests.add(52);
    world.add(openDecision(53, { author: 'stranger-1' }));
    world.add(openDecision(54, { labels: ['bug'] }));
    // Open, but an answer stopped after the label swap: `decided` is on and `decision` is off.
    world.add(openDecision(55, { labels: ['decided'], comments: [markSays('Decision: A. half')], events: [{ label: 'decided', actor: MARK, createdAt: '2026-10-10T00:00:11Z' }] }));
    const expected: [number, number, string][] = [
      [50, 409, 'not-open'],
      [51, 409, 'already-answered'],
      [52, 404, 'decision-not-found'],
      [53, 404, 'decision-not-found'],
      [54, 404, 'decision-not-found'],
      [55, 409, 'not-a-decision'],
      [999, 404, 'decision-not-found'],
    ];
    for (const [number, status, code] of expected) {
      const response = await ask('Why?', number);
      expect(response.status, String(number)).toBe(status);
      expect((await errorOf(response)).code, String(number)).toBe(code);
    }
    expect(world.writes).toEqual([]);
  });

  it.each([
    ['an action that is not allowed', { number: 41, action: 'close', note: 'x' }],
    ['an action in the wrong case', { number: 41, action: 'Ask', note: 'x' }],
    ['an action that is null', { number: 41, action: null, option: 'A' }],
    ['an action that is a number', { number: 41, action: 1, option: 'A' }],
    ['an action that is a list', { number: 41, action: ['ask'], note: 'x' }],
    ['an option on an Ask', { number: 41, action: 'ask', option: 'A', note: 'x' }],
    ['an option that is null on an Ask', { number: 41, action: 'ask', option: null, note: 'x' }],
    ['no question', { number: 41, action: 'ask' }],
    ['an empty question', { number: 41, action: 'ask', note: '' }],
    ['a question of only spaces and line breaks', { number: 41, action: 'ask', note: ' \r\n \n ' }],
    ['a question of only zero-width characters', { number: 41, action: 'ask', note: '\u200B\u200C\u200D\u2060\uFEFF' }],
    ['a question of spaces and a zero-width space', { number: 41, action: 'ask', note: ' \u200B\n\uFEFF ' }],
    ['a question of invisible format and filler characters', { number: 41, action: 'ask', note: '\u00AD\u3164\u2800\u202E\u034F\uFE0F' }],
    ['a question that is not text', { number: 41, action: 'ask', note: 5 }],
    ['a question of 2001 characters', { number: 41, action: 'ask', note: 'x'.repeat(2001) }],
    ['a question with a control character', { number: 41, action: 'ask', note: 'a\u0000b' }],
    ['a question with a vertical tab', { number: 41, action: 'ask', note: 'a\u000bb' }],
    ['no issue number', { action: 'ask', note: 'x' }],
    ['an issue number as text', { number: '41', action: 'ask', note: 'x' }],
  ])('%s gives 422 and no GitHub call at all', async (_name, body) => {
    const { world, send } = setup();
    const response = await send(body);
    expect(response.status).toBe(422);
    expect(world.githubCalls).toEqual([]);
  });

  it.each([['a list', '[]'], ['null', 'null'], ['a string', '"x"'], ['a number', '5']])('a body that is %s gives 422 with the ask message and no GitHub call', async (_name, rawBody) => {
    const { world, send } = setup();
    const response = await send(null, {}, env(), { rawBody });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).message).toContain('A question needs text');
    expect(world.githubCalls).toEqual([]);
  });

  // Hostile input. The raw JSON text is sent, because `JSON.stringify` of an object with a `__proto__` key drops it. `JSON.parse` makes `__proto__` an own property and never a prototype.
  const HOSTILE_INVALID: [string, string][] = [
    ['a __proto__ key that holds the question and no note of its own', '{"number":41,"action":"ask","__proto__":{"note":"x"}}'],
    ['a __proto__ key that holds the action, with an action that is a list', '{"number":41,"action":["ask"],"__proto__":{"action":"ask"},"note":"x"}'],
    ['an action that is a list', '{"number":41,"action":["ask"],"note":"x"}'],
    ['an action that is a list of one object', '{"number":41,"action":[{"ask":1}],"note":"x"}'],
  ];
  it.each(HOSTILE_INVALID)('hostile input: %s gives 422 and no GitHub call at all', async (_name, rawBody) => {
    const { world, send } = setup();
    const response = await send(null, {}, env(), { rawBody });
    expect(response.status).toBe(422);
    expect(world.githubCalls).toEqual([]);
    expect(world.writes).toEqual([]);
  });

  const HOSTILE_VALID: [string, string][] = [
    ['a __proto__ key that holds an option and an action: both are ignored', '{"number":41,"action":"ask","note":"Why?","__proto__":{"option":"A","action":"answer"}}'],
    ['U+2028 and U+2029 in the note', JSON.stringify({ number: 41, action: 'ask', note: 'one two three' })],
    ['a byte order mark at the start of the note', JSON.stringify({ number: 41, action: 'ask', note: '﻿Why?' })],
    ['zero-width characters inside the note', JSON.stringify({ number: 41, action: 'ask', note: 'Wh​y‌?‍⁠' })],
    ['CRLF, CR and LF line breaks', JSON.stringify({ number: 41, action: 'ask', note: 'a\r\nb\rc\nd' })],
  ];
  it.each(HOSTILE_VALID)('hostile input: %s is taken as a plain question: the comment starts with "Question: " and holds no carriage return', async (_name, rawBody) => {
    const { world, send } = setup();
    const response = await send(null, {}, env(), { rawBody });
    expect(response.status).toBe(200);
    // One comment and one label: the Ask, and no answer (no Decision: comment, no decided, no close).
    expect(world.writes).toEqual([`POST ${base(41)}/comments`, `POST ${base(41)}/labels`]);
    const issue = world.issues.get(41);
    expect(issue?.state).toBe('OPEN');
    expect(issue?.labels).toEqual(['decision', 'needs-info']);
    const body = issue?.comments[0]?.body ?? '';
    expect(body.startsWith('Question: ')).toBe(true);
    expect(body).not.toContain('\r');
  });

  it('a note that starts with a byte order mark loses it, and CRLF becomes LF', async () => {
    const { world, send } = setup();
    await send({ number: 41, action: 'ask', note: '﻿a\r\nb' });
    expect(world.issues.get(41)?.comments[0]?.body).toBe('Question: a\nb');
  });

  it('a question of exactly 2000 characters is taken', async () => {
    const { world, ask } = setup();
    expect((await ask('x'.repeat(2000))).status).toBe(200);
    expect(world.issues.get(41)?.comments[0]?.body).toBe(`Question: ${'x'.repeat(2000)}`);
  });
});

describe('pass line 3: every gate of #137 runs before any write, for an Ask', () => {
  const ask = { number: 41, action: 'ask', note: 'Why?' };

  it.each([
    ['a GET', {}, env(), { method: 'GET' }, 405],
    ['GITHUB_TOKEN absent', {}, env({ GITHUB_TOKEN: undefined }), {}, 500],
    ['CC_ORIGIN absent', {}, env({ CC_ORIGIN: undefined }), {}, 500],
    ['the wrong Host', { host: 'shadow-jog-cc.vercel.app' }, env(), {}, 403],
    ['a Content-Type that is not JSON', { 'content-type': 'text/plain' }, env(), {}, 415],
    ['no Origin', { origin: undefined }, env(), {}, 403],
    ['a foreign Origin', { origin: 'https://evil.example' }, env(), {}, 403],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }, env(), {}, 403],
    ['a body that is not JSON', {}, env(), { rawBody: 'not json' }, 400],
    ['a body over 16 KB', {}, env(), { rawBody: JSON.stringify({ ...ask, note: 'x'.repeat(20_000) }) }, 413],
    ['the bypass secret set', {}, env({ VERCEL_AUTOMATION_BYPASS_SECRET: 'x' }), {}, 503],
  ] satisfies [string, Record<string, string | undefined>, Record<string, string | undefined>, { method?: string; rawBody?: string }, number][])(
    '%s gives its usual status and no GitHub call',
    async (_name, headers, environment, init, status) => {
      const { world, send } = setup();
      const response = await send(ask, headers, environment, init);
      expect(response.status).toBe(status);
      expect(world.githubCalls).toEqual([]);
      expect(world.issues.get(41)?.comments).toEqual([]);
    },
  );

  it('the protection probe that does not prove protection gives 503 protection-unproven, with no GitHub call', async () => {
    for (const probe of [{ status: 200 }, 'throw', 'timeout'] as const) {
      const { world, send } = setup();
      world.probe = probe;
      const response = await send(ask);
      expect(response.status).toBe(503);
      expect((await errorOf(response)).code).toBe('protection-unproven');
      expect(world.githubCalls).toEqual([]);
    }
  });

  it('a token of another account, a classic token and a failing GET /user give 500 or 502 and no write', async () => {
    const wrongLogin = setup();
    wrongLogin.world.viewer = { login: 'stranger-1', id: 1 };
    expect((await wrongLogin.ask('Why?')).status).toBe(500);
    expect(wrongLogin.world.writes).toEqual([]);

    const classic = setup();
    classic.world.userScopes = 'repo';
    expect((await classic.ask('Why?')).status).toBe(500);
    expect(classic.world.writes).toEqual([]);

    const failing = setup();
    failing.world.userMode = 'status-500';
    expect((await failing.ask('Why?')).status).toBe(502);
    expect(failing.world.writes).toEqual([]);
    // The issue was never read in any of the three.
    for (const { world } of [wrongLogin, classic, failing]) expect(world.graphqlQueries).toEqual([]);
  });

  it('an issue with more comments than the page cap gives 502 too-many and no write', async () => {
    const { world, ask: send } = setup();
    world.add(openDecision(51, { comments: Array.from({ length: 1001 }, (_, n) => ({ author: 'stranger-1', body: `noise ${n}`, createdAt: T0 })) }));
    const response = await send('Why?', 51);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('too-many');
    expect(world.writes).toEqual([]);
  });

  it('the issue is read from GitHub before the first write (the read comes before the comment)', async () => {
    const { world, ask: send } = setup();
    await send('Why?');
    const order = world.githubCalls.map((call) => (call.url.endsWith('/graphql') ? 'read' : call.url.endsWith('/user') ? 'user' : 'write'));
    expect(order).toEqual(['user', 'read', 'write', 'write']);
  });

  it('the repo, owner and labels in an Ask body are ignored: only the constant repo and the two Ask shapes are written', async () => {
    const { world, send } = setup();
    const response = await send({ number: 41, action: 'ask', note: 'Why?', repo: 'evil/other', owner: 'evil', labels: ['bug'], state: 'closed' });
    expect(response.status).toBe(200);
    expect(world.writes).toEqual([`POST ${base(41)}/comments`, `POST ${base(41)}/labels`]);
    expect(world.githubCalls.some((call) => JSON.stringify(call.body ?? null).includes('evil'))).toBe(false);
  });
});

describe('pass line 4: ghWrite() allows only the old three shapes and the two needs-info shapes', () => {
  const issue = base(41);
  it.each([
    { method: 'POST', path: `${issue}/labels`, body: { labels: ['needs-info'] } },
    { method: 'DELETE', path: `${issue}/labels/needs-info` },
    { method: 'POST', path: `${issue}/comments`, body: { body: 'Question: x' } },
  ] as const)('allows $method $path', (request) => {
    expect(isAllowedWrite(request, 41)).toBe(true);
  });

  const refused: [string, Parameters<typeof isAllowedWrite>[0]][] = [
    ['two labels, one of them needs-info', { method: 'POST', path: `${issue}/labels`, body: { labels: ['needs-info', 'decided'] } }],
    ['needs-info with another field', { method: 'POST', path: `${issue}/labels`, body: { labels: ['needs-info'], extra: 1 } }],
    ['a label in another case', { method: 'POST', path: `${issue}/labels`, body: { labels: ['Needs-Info'] } }],
    ['a label with a space', { method: 'POST', path: `${issue}/labels`, body: { labels: ['needs-info '] } }],
    ['a label that is not a list', { method: 'POST', path: `${issue}/labels`, body: { labels: 'needs-info' } }],
    ['a set of labels (PUT)', { method: 'PUT' as 'POST', path: `${issue}/labels`, body: { labels: ['needs-info'] } }],
    ['a removal with a body', { method: 'DELETE', path: `${issue}/labels/needs-info`, body: {} }],
    ['a removal of a label with a longer name', { method: 'DELETE', path: `${issue}/labels/needs-info-x` }],
    ['a removal of a label in another case', { method: 'DELETE', path: `${issue}/labels/Needs-Info` }],
    ['a removal of all labels', { method: 'DELETE', path: `${issue}/labels` }],
    ['a removal of needs-info on another issue', { method: 'DELETE', path: `${base(42)}/labels/needs-info` }],
    ['a removal of needs-info in another repo', { method: 'DELETE', path: '/repos/evil/shadow-jog/issues/41/labels/needs-info' }],
    ['a label with a path segment after it', { method: 'DELETE', path: `${issue}/labels/needs-info/x` }],
    ['a reopen', { method: 'PATCH', path: issue, body: { state: 'open' } }],
  ];
  it.each(refused)('refuses %s, and sends nothing', async (_name, request) => {
    expect(isAllowedWrite(request, 41)).toBe(false);
    const send = vi.fn();
    await expect(ghWrite(send, SENTINEL, request, 41)).rejects.toBeInstanceOf(WriteRefused);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('pass line 5: the trust rule on the hosted write path', () => {
  it('a Question: by another account is not the pending question of a retry: the comment is written', async () => {
    const { world, ask } = setup();
    world.add(openDecision(60, { comments: [{ author: 'stranger-1', body: 'Question: Why?', createdAt: T0 }] }));
    expect((await ask('Why?', 60)).status).toBe(200);
    expect(world.writes).toEqual([`POST ${base(60)}/comments`, `POST ${base(60)}/labels`]);
  });

  it('an Info: by another account does not answer the question: a retry still skips the comment', async () => {
    const { world, ask } = setup();
    world.add(
      openDecision(61, {
        comments: [markSays('Question: Why?'), { author: 'stranger-1', body: 'Info: all fine', createdAt: '2026-10-10T00:00:11Z' }],
      }),
    );
    expect((await ask('Why?', 61)).status).toBe(200);
    // The question is pending (the stranger's info does not count), so only the label is written.
    expect(world.writes).toEqual([`POST ${base(61)}/labels`]);
  });

  it('the label needs-info alone (no question) grants nothing: an Ask writes the comment and then the label', async () => {
    const { world, ask } = setup();
    world.add(openDecision(62, { labels: ['decision', 'needs-info'] }));
    expect((await ask('Why?', 62)).status).toBe(200);
    expect(world.writes).toEqual([`POST ${base(62)}/comments`, `POST ${base(62)}/labels`]);
  });
});

describe('pass line 9: a Retry writes nothing twice', () => {
  it('Ask: the label step fails after the comment, and the Retry adds the label only (one Question: comment in all)', async () => {
    const { world, ask } = setup();
    world.failWrite = { method: 'POST', suffix: '/labels', status: 500, times: 1 };
    const failed = await ask('Why is C slow?');
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'label' });
    expect(world.issues.get(41)?.comments).toHaveLength(1);
    expect(world.issues.get(41)?.labels).toEqual(['decision']);

    const retry = await ask('Why is C slow?');
    expect(retry.status).toBe(200);
    expect(world.issues.get(41)?.comments).toHaveLength(1);
    expect(world.issues.get(41)?.labels).toEqual(['decision', 'needs-info']);
    expect(world.writes).toEqual([`POST ${base(41)}/comments`, `POST ${base(41)}/labels`, `POST ${base(41)}/labels`]);
  });

  it('Ask: the Retry compares the text after line breaks are made alike, so a text typed with CR LF is the same question', async () => {
    const { world, ask } = setup();
    world.failWrite = { method: 'POST', suffix: '/labels', status: 500, times: 1 };
    await ask('Line one\r\nline two');
    expect((await ask('Line one\nline two')).status).toBe(200);
    expect(world.issues.get(41)?.comments).toHaveLength(1);
  });

  it('Ask: when the comment step fails nothing was written, and the Retry writes the comment once', async () => {
    const { world, ask } = setup();
    world.failWrite = { method: 'POST', suffix: '/comments', status: 500, times: 1 };
    const failed = await ask('Why?');
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'comment' });
    expect(world.issues.get(41)?.comments).toEqual([]);
    expect(world.issues.get(41)?.labels).toEqual(['decision']);
    expect((await ask('Why?')).status).toBe(200);
    expect(world.issues.get(41)?.comments).toHaveLength(1);
  });

  it('Ask: a question that was answered once can be asked again with the same words (the info came after it)', async () => {
    const { world, ask } = setup();
    world.add(openDecision(63, { comments: [markSays('Question: Why?', '2026-10-10T00:00:10Z'), markSays('Info: Because.', '2026-10-10T00:00:11Z')] }));
    expect((await ask('Why?', 63)).status).toBe(200);
    expect(world.issues.get(63)?.comments.map((comment) => comment.body)).toEqual(['Question: Why?', 'Info: Because.', 'Question: Why?']);
  });

  it('Ask: the same question twice in a row is written once (the second call finds nothing to do)', async () => {
    const { world, ask } = setup();
    expect((await ask('Why?')).status).toBe(200);
    const again = await ask('Why?');
    expect(again.status).toBe(200);
    expect(world.issues.get(41)?.comments).toHaveLength(1);
    expect(world.writes).toEqual([`POST ${base(41)}/comments`, `POST ${base(41)}/labels`]);
  });

  describe('an answer on an issue with needs-info (step 0)', () => {
    const flagged = (world: FakeWorld, number: number, extra: Parameters<typeof openDecision>[1] = {}) =>
      world.add(openDecision(number, { labels: ['decision', 'needs-info'], comments: [markSays('Question: Why?'), markSays('Info: Because.', '2026-10-10T00:00:11Z')], ...extra }));

    it('takes needs-info off first, then writes the comment, the label swap and the close', async () => {
      const { world, send } = setup();
      flagged(world, 70);
      expect((await send({ number: 70, option: 'B' })).status).toBe(200);
      expect(world.writes).toEqual([`DELETE ${base(70)}/labels/needs-info`, `POST ${base(70)}/comments`, `POST ${base(70)}/labels`, `DELETE ${base(70)}/labels/decision`, `PATCH ${base(70)}`]);
      expect(world.issues.get(70)?.labels).toEqual(['decided']);
      expect(world.issues.get(70)?.state).toBe('CLOSED');
    });

    it('does not call the label removal on an issue without needs-info', async () => {
      const { world, send } = setup();
      await send({ number: 41, option: 'A' });
      expect(world.writes.some((write) => write.endsWith('/labels/needs-info'))).toBe(false);
    });

    it('a failure at step 0 writes nothing else, names the step unflag, and the Retry starts there', async () => {
      const { world, send } = setup();
      flagged(world, 71);
      world.failWrite = { method: 'DELETE', suffix: '/labels/needs-info', status: 500, times: 1 };
      const failed = await send({ number: 71, option: 'B' });
      expect(failed.status).toBe(502);
      expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'unflag' });
      expect(world.writes).toEqual([`DELETE ${base(71)}/labels/needs-info`]);
      expect((await send({ number: 71, option: 'B' })).status).toBe(200);
      expect(world.issues.get(71)?.state).toBe('CLOSED');
    });

    it('a Retry of the answer after step 0 makes no second label removal (the comment step failed)', async () => {
      const { world, send } = setup();
      flagged(world, 72);
      world.failWrite = { method: 'POST', suffix: '/comments', status: 500, times: 1 };
      const failed = await send({ number: 72, option: 'B' });
      expect(failed.status).toBe(502);
      expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'comment' });
      expect((await send({ number: 72, option: 'B' })).status).toBe(200);
      expect(world.writes.filter((write) => write === `DELETE ${base(72)}/labels/needs-info`)).toHaveLength(1);
      expect(world.issues.get(72)?.comments.filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
    });

    it('the backfill shape: an old Decision: comment is not reused, a new answer writes its own Decision: comment', async () => {
      const { world, send } = setup();
      world.add(openDecision(73, { labels: ['decision', 'needs-info'], comments: [markSays('Decision: B. need more info')] }));
      expect((await send({ number: 73, option: 'B', note: 'need more info' })).status).toBe(200);
      expect(world.issues.get(73)?.comments.map((comment) => comment.body)).toEqual(['Decision: B. need more info', 'Decision: B. need more info']);
      expect(world.writes[0]).toBe(`DELETE ${base(73)}/labels/needs-info`);
    });

    it('the half answer of today still resumes when needs-info is off: an answer that stopped after the comment goes on at the label', async () => {
      const { world, send } = setup();
      world.add(openDecision(74, { comments: [markSays('Decision: B. half')] }));
      expect((await send({ number: 74, option: 'B', note: 'half' })).status).toBe(200);
      expect(world.writes).toEqual([`POST ${base(74)}/labels`, `DELETE ${base(74)}/labels/decision`, `PATCH ${base(74)}`]);
    });
  });
});

describe('the Ask does not leak the token', () => {
  it('no body or header of an Ask, a refused Ask or a failed Ask holds the token', async () => {
    const { world, send } = setup();
    world.failWrite = { method: 'POST', suffix: '/labels', status: 500, times: 1 };
    const replies = [await send({ number: 41, action: 'ask', note: 'Why?' }), await send({ number: 41, action: 'ask', note: 'Why?' }), await send({ number: 41, action: 'nope' })];
    for (const reply of replies) {
      expect(JSON.stringify(await bodyOf(reply))).not.toContain(SENTINEL);
      expect([...reply.headers.values()].join(' ')).not.toContain(SENTINEL);
    }
    expect(HOST).toBe('cc.example.vercel.app');
    expect(ORIGIN).toBe(`https://${HOST}`);
  });
});

describe('step 0 of an answer: the hosted unflag', () => {
  const executorWith = (status: number) =>
    createRestExecutor({ token: SENTINEL, number: 41, send: async () => ({ ok: status < 400, status, headers: new Headers(), text: async () => '' }), remainingMs: () => MIN_WRITE_MS });

  it('treats a 404 (the label is not on the issue) as done', async () => {
    expect(await executorWith(404).unflag()).toBeNull();
  });

  it('does not treat another failure as done, and flag does not treat a 404 as done', async () => {
    expect(await executorWith(500).unflag()).not.toBeNull();
    expect(await executorWith(404).flag()).not.toBeNull();
  });
});
