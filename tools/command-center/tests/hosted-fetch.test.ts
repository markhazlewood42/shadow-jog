import { describe, expect, it } from 'vitest';
import { type FetchFn, LOGIN_MESSAGE, fetchHostedJson, fetchHostedText } from '../src/web/hosted/fetch';

// How a request of the hosted page is sorted (design 7): a lost login in any of its three forms is one kind, and nothing throws.

type Reply = { status?: number; type?: string; body?: string; contentType?: string };

function fake(reply: Reply | 'throw'): FetchFn {
  return async () => {
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

describe('fetchHostedJson', () => {
  it('returns the data of a JSON answer', async () => {
    const result = await fetchHostedJson<{ a: number }>('/api/x', fake({ body: '{"a":1}' }));
    expect(result).toEqual({ ok: true, data: { a: 1 } });
  });

  it('sends the request without following redirects, so a redirect to the login page is seen', async () => {
    let init: RequestInit | undefined;
    await fetchHostedJson('/api/x', async (_url, given) => {
      init = given;
      return { ok: true, status: 200, type: 'basic', headers: new Headers(), text: async () => '{}' };
    });
    expect(init?.redirect).toBe('manual');
    expect(init?.credentials).toBe('same-origin');
  });

  it.each([
    ['a 401', { status: 401, body: '<html>Authentication required</html>' }],
    ['a redirect that was not followed', { status: 0, type: 'opaqueredirect' }],
    ['a 302', { status: 302 }],
    ['a 200 answer that is HTML (the login page)', { body: '<!doctype html><html></html>' }],
    ['a 200 answer that is empty', { body: '' }],
  ] satisfies [string, Reply][])('says "login expired" for %s', async (_name, reply) => {
    const result = await fetchHostedJson('/api/x', fake(reply));
    expect(result).toMatchObject({ ok: false, error: { kind: 'login', code: 'login-expired', message: LOGIN_MESSAGE } });
  });

  it('says "network" when fetch throws', async () => {
    const result = await fetchHostedJson('/api/x', fake('throw'));
    expect(result).toMatchObject({ ok: false, error: { kind: 'network', code: 'network' } });
  });

  it('shows the status and the sentence of the function for an error answer', async () => {
    const result = await fetchHostedJson('/api/x', fake({ status: 502, body: '{"error":"the store could not be reached","kind":"store-unreachable"}' }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', code: 'http-502', status: 502, message: 'The server answered 502: the store could not be reached.' } });
  });

  it('shows the status alone for an error answer without a sentence', async () => {
    const result = await fetchHostedJson('/api/x', fake({ status: 500, body: '<html>Internal error</html>' }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', message: 'The server answered 500.' } });
  });

  it('keeps every message to one line of 20 words or fewer', async () => {
    const results = await Promise.all([
      fetchHostedJson('/api/x', fake({ status: 401 })),
      fetchHostedJson('/api/x', fake('throw')),
      fetchHostedJson('/api/x', fake({ status: 503, body: '{"error":"rate limited"}' })),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message.split(/\s+/).length).toBeLessThanOrEqual(20);
    }
  });
});

describe('fetchHostedText', () => {
  it('returns the text of a file', async () => {
    expect(await fetchHostedText('/api/docs/a.md', fake({ body: '# A', contentType: 'text/markdown; charset=utf-8' }))).toEqual({ ok: true, text: '# A' });
  });

  it('marks a 404 as not found, so the caller tries the next path', async () => {
    expect(await fetchHostedText('/api/docs/a.md', fake({ status: 404, body: '{"error":"not found"}' }))).toMatchObject({ ok: false, notFound: true });
  });

  it('says "login expired" for an HTML page with status 200 and for a 401', async () => {
    expect(await fetchHostedText('/api/docs/a.md', fake({ body: '<html></html>', contentType: 'text/html' }))).toMatchObject({ ok: false, notFound: false, error: { kind: 'login' } });
    expect(await fetchHostedText('/api/docs/a.md', fake({ status: 401 }))).toMatchObject({ ok: false, error: { kind: 'login' } });
  });

  it('reports other statuses and a network failure', async () => {
    expect(await fetchHostedText('/api/docs/a.md', fake({ status: 503 }))).toMatchObject({ ok: false, notFound: false, error: { code: 'http-503' } });
    expect(await fetchHostedText('/api/docs/a.md', fake('throw'))).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});
