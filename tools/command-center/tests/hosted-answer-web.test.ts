import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_URL, PROTECTION_MESSAGE, SETUP_MESSAGE, UNAVAILABLE_MESSAGE, answerFailureOf, answerOf, sendHostedAnswer } from '../src/web/hosted/answer';
import { type FetchFn, LOGIN_MESSAGE, postHostedJson } from '../src/web/hosted/fetch';

// How the hosted page sends Mark's answer and sorts what comes back (src/web/hosted/fetch.ts and answer.ts). The browser is replaced by a small fake `fetch`.

type Reply = { status?: number; type?: string; body?: string; contentType?: string };

function fake(reply: Reply | 'throw', seen: { url?: string; init?: RequestInit } = {}): FetchFn {
  return async (url, init) => {
    seen.url = url;
    seen.init = init;
    if (reply === 'throw') throw new TypeError('Failed to fetch');
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      type: (reply.type ?? 'basic') as ResponseType,
      headers: new Headers(reply.contentType === undefined ? {} : { 'content-type': reply.contentType }),
      text: async () => reply.body ?? '',
    };
  };
}

const errorBody = (code: string, message: string, step?: string) => JSON.stringify({ ok: false, error: { code, message }, ...(step === undefined ? {} : { step }) });

afterEach(() => vi.unstubAllGlobals());

describe('postHostedJson', () => {
  it('posts JSON with the same-origin cookie, no caching and manual redirects, and returns the data', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await postHostedJson<{ ok: boolean }>('/api/answer', { number: 61, option: 'B' }, fake({ body: '{"ok":true}' }, seen));
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(seen.url).toBe('/api/answer');
    expect(seen.init?.method).toBe('POST');
    expect(seen.init?.body).toBe('{"number":61,"option":"B"}');
    expect(seen.init?.redirect).toBe('manual');
    expect(seen.init?.credentials).toBe('same-origin');
    expect(seen.init?.cache).toBe('no-store');
    expect(seen.init?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
  });

  it.each([
    ['a redirect that was not followed', { status: 0, type: 'opaqueredirect' }],
    ['a 302', { status: 302 }],
    ['a 401', { status: 401, body: 'Authentication Required', contentType: 'text/html' }],
    ['a 200 with an HTML page', { body: '<!doctype html><html></html>', contentType: 'text/html' }],
  ] satisfies [string, Reply][])('%s is a lost login', async (_name, reply) => {
    const result = await postHostedJson('/api/answer', {}, fake(reply));
    expect(result).toMatchObject({ ok: false, error: { kind: 'login', message: LOGIN_MESSAGE } });
  });

  it('keeps the word, the sentence and the step of an error answer of the function', async () => {
    const result = await postHostedJson('/api/answer', {}, fake({ status: 502, body: errorBody('forbidden', 'The server token cannot write.', 'comment'), contentType: 'application/json' }));
    expect(result).toEqual({ ok: false, error: { kind: 'http', code: 'forbidden', serverCode: 'forbidden', message: 'The server token cannot write.', status: 502, step: 'comment' } });
  });

  it('shows the status when an error answer has no JSON (a platform page), and says "network" when fetch throws', async () => {
    expect(await postHostedJson('/api/answer', {}, fake({ status: 504, body: '<html>Gateway timeout</html>', contentType: 'text/html' }))).toMatchObject({ ok: false, error: { code: 'http-504', message: 'The server answered 504.' } });
    expect(await postHostedJson('/api/answer', {}, fake('throw'))).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('answerFailureOf', () => {
  const error = (status: number, serverCode: string, message: string, step?: string) => ({ kind: 'http' as const, code: serverCode, serverCode, message, status, ...(step === undefined ? {} : { step }) });

  it('uses the page words for the two protection 503s and for 500 misconfigured, and no step', () => {
    expect(answerFailureOf(error(503, 'protection-unproven', 'x'))).toEqual({ step: null, code: 'protection-unproven', message: PROTECTION_MESSAGE });
    expect(answerFailureOf(error(503, 'bypass-on', 'x'))).toEqual({ step: null, code: 'bypass-on', message: PROTECTION_MESSAGE });
    expect(answerFailureOf(error(500, 'misconfigured', 'x'))).toEqual({ step: null, code: 'misconfigured', message: SETUP_MESSAGE });
    // Any other 503 (a platform error, with or without a JSON body) does not claim a privacy failure.
    expect(answerFailureOf({ kind: 'http', code: 'http-503', message: 'The server answered 503.', status: 503 })).toEqual({ step: null, code: 'http-503', message: UNAVAILABLE_MESSAGE });
    expect(answerFailureOf(error(503, 'rate-limited', 'x'))).toEqual({ step: null, code: 'rate-limited', message: UNAVAILABLE_MESSAGE });
    expect(UNAVAILABLE_MESSAGE).toBe('Not answered: the server is unavailable. Nothing was written.');
    expect(PROTECTION_MESSAGE).toBe('Not answered: the page could not prove that it is private. Nothing was written.');
    expect(SETUP_MESSAGE).toBe('Not answered: the hosted setup is incomplete.');
  });

  it('keeps the sentence of the function for wrong-host, and the step of a failed write', () => {
    expect(answerFailureOf(error(403, 'wrong-host', 'Answer from https://cc.example.vercel.app.'))).toEqual({ step: null, code: 'wrong-host', message: 'Answer from https://cc.example.vercel.app.' });
    expect(answerFailureOf(error(502, 'network', 'GitHub could not be reached.', 'label'))).toEqual({ step: 'label', code: 'network', message: 'GitHub could not be reached.' });
    expect(answerFailureOf(error(502, 'network', 'x', 'nonsense')).step).toBeNull();
  });

  it('keeps the login message of a lost login', () => {
    expect(answerFailureOf({ kind: 'login', code: 'login-expired', message: LOGIN_MESSAGE, status: 302 })).toEqual({ step: null, code: 'login-expired', message: LOGIN_MESSAGE });
  });
});

describe('sendHostedAnswer', () => {
  it('posts the number, the option and the note to /api/answer, and leaves an empty note out', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, answer: { option: 'B', note: null, at: '2026-10-16T10:00:00.000Z' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(ANSWER_URL).toBe('/api/answer');
    const sent = await sendHostedAnswer(61, 'B', '   ');
    expect(sent).toEqual({ ok: true, answer: { option: 'B', note: null, at: '2026-10-16T10:00:00.000Z' } });
    await sendHostedAnswer(61, 'B', 'a note');
    expect(bodies).toEqual([{ number: 61, option: 'B' }, { number: 61, option: 'B', note: 'a note' }]);
  });

  it('treats a 200 with an unknown shape as a failure that tells Mark to check GitHub, never as an answer', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const sent = await sendHostedAnswer(61, 'B', '');
    expect(sent).toMatchObject({ ok: false, failure: { step: null, code: 'bad-response' } });
  });

  it('turns the reply into the answer of the decision page (complete)', () => {
    expect(answerOf({ option: 'B', note: 'n', at: '2026-10-16T10:00:00.000Z' })).toEqual({ option: 'B', note: 'n', at: '2026-10-16T10:00:00.000Z', complete: true });
  });
});
