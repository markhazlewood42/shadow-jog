import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Health, Panel } from '../src/shared/types';
import { ApiError, getJson, getPanel, loadHealthPanel, mergeLastGood, postJson } from '../src/web/api';
import { PanelContent, PanelFrame } from '../src/web/PanelFrame';
import { type PanelResult, createCoalescingRunner } from '../src/web/usePanel';

// The page app is tested here only where it holds logic that does not need a browser. How it
// looks and behaves in a browser is the job of e2e/smoke.spec.ts.

const T0 = '2026-10-05T10:00:00.000Z';
const T1 = '2026-10-05T10:05:00.000Z';

/** Replaces fetch for one test with a function that answers as given. */
function stubFetch(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPanel', () => {
  it('passes a good panel through', async () => {
    const good: Panel<{ n: number }> = { ok: true, data: { n: 1 }, updatedAt: T0 };
    const fetchMock = stubFetch(() => json(good));
    expect(await getPanel<{ n: number }>('/api/x')).toEqual(good);
    // It asks for fresh JSON every time.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/x');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('passes an error panel through with its last good data', async () => {
    const failed: Panel<number> = { ok: false, error: { code: 'gh-offline', message: 'GitHub: offline' }, updatedAt: T0, lastGood: { data: 5, updatedAt: T0 } };
    stubFetch(() => json(failed));
    expect(await getPanel<number>('/api/github')).toEqual(failed);
  });

  it('turns a network failure into an error panel, not a throw', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await getPanel('/api/x')).toEqual({
      ok: false,
      error: { code: 'network', message: expect.stringContaining('Cannot reach') },
      updatedAt: null,
      lastGood: null,
    });
  });

  it('uses the error the server sent with an HTTP failure, or the status when the body is not ours', async () => {
    stubFetch(() => json({ ok: false, error: { code: 'internal-error', message: 'The server hit a problem.' } }, 500));
    expect(await getPanel('/api/x')).toMatchObject({ ok: false, error: { code: 'internal-error', message: 'The server hit a problem.' } });
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await getPanel('/api/x')).toMatchObject({ ok: false, error: { code: 'http-502' } });
  });

  it('says bad-response for a 200 that is not a panel', async () => {
    stubFetch(() => new Response('not json', { status: 200 }));
    expect(await getPanel('/api/x')).toMatchObject({ ok: false, error: { code: 'bad-response' } });
    stubFetch(() => json({ ok: true }));
    expect(await getPanel('/api/x')).toMatchObject({ ok: false, error: { code: 'bad-response' } });
    stubFetch(() => json([1, 2, 3]));
    expect(await getPanel('/api/x')).toMatchObject({ ok: false, error: { code: 'bad-response' } });
  });
});

describe('mergeLastGood', () => {
  const ok = (data: string, updatedAt: string): Panel<string> => ({ ok: true, data, updatedAt });
  const failed = (lastGood: { data: string; updatedAt: string } | null): Panel<string> => ({
    ok: false,
    error: { code: 'network', message: 'down' },
    updatedAt: lastGood?.updatedAt ?? null,
    lastGood,
  });

  it('keeps the data on screen when the next answer is an error that has none', () => {
    expect(mergeLastGood(ok('old', T0), failed(null))).toEqual(failed({ data: 'old', updatedAt: T0 }));
    // An error that came with its own last good data keeps that one (the server knows it best).
    expect(mergeLastGood(ok('old', T0), failed({ data: 'server', updatedAt: T1 }))).toEqual(failed({ data: 'server', updatedAt: T1 }));
    // Two errors in a row keep the data from before the first.
    expect(mergeLastGood(failed({ data: 'old', updatedAt: T0 }), failed(null))).toEqual(failed({ data: 'old', updatedAt: T0 }));
  });

  it('takes a good answer as it is, and an error with nothing before it as it is', () => {
    expect(mergeLastGood(failed({ data: 'old', updatedAt: T0 }), ok('new', T1))).toEqual(ok('new', T1));
    expect(mergeLastGood(null, failed(null))).toEqual(failed(null));
    expect(mergeLastGood(null, ok('first', T0))).toEqual(ok('first', T0));
  });
});

describe('getJson and postJson', () => {
  it('getJson gives back the parsed body, and an ApiError with the server message on failure', async () => {
    stubFetch(() => json({ hello: 'world' }));
    expect(await getJson('/api/x')).toEqual({ hello: 'world' });
    stubFetch(() => json({ ok: false, error: { code: 'not-found', message: 'No such route.' } }, 404));
    await expect(getJson('/api/x')).rejects.toMatchObject({ name: 'ApiError', code: 'not-found', message: 'No such route.' });
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(getJson('/api/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('postJson sends the JSON body with the token from the page in the X-CC-Token header', async () => {
    vi.stubGlobal('document', { querySelector: (selector: string) => (selector === 'meta[name="cc-token"]' ? { getAttribute: () => 'page-token-123' } : null) });
    const fetchMock = stubFetch(() => json({ ok: true }));
    expect(await postJson('/api/decisions/7/answer', { option: 'A', note: 'fine' })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/decisions/7/answer');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ option: 'A', note: 'fine' }) });
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-cc-token')).toBe('page-token-123');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('postJson throws an ApiError with the server error, and says so when the page has no token', async () => {
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => 'page-token-123' }) });
    stubFetch(() => json({ ok: false, error: { code: 'bad-token', message: 'Wrong token.' } }, 403));
    await expect(postJson('/api/x', {})).rejects.toMatchObject({ code: 'bad-token', message: 'Wrong token.' });
    vi.stubGlobal('document', { querySelector: () => null });
    await expect(postJson('/api/x', {})).rejects.toMatchObject({ code: 'no-token' });
  });

  it('an ApiError keeps the body that the server sent, so a page can read more than the code and the message', async () => {
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => 'page-token-123' }) });
    const sent = { ok: false, step: 'label', error: { code: 'gh-failed', message: 'gh failed' } };
    stubFetch(() => json(sent, 502));
    await expect(postJson('/api/x', {})).rejects.toMatchObject({ code: 'gh-failed', body: sent });
    // An answer that is not an error body of ours has no body to keep.
    stubFetch(() => new Response('Bad Gateway', { status: 502 }));
    await expect(postJson('/api/x', {})).rejects.toMatchObject({ code: 'http-502', body: null });
  });
});

describe('loadHealthPanel', () => {
  const health: Health = { ok: true, name: 'Shadow Jog Command Center', version: '0.1.0', startedAt: T0, gameUrl: 'http://localhost:3007', links: [] };

  it('wraps the bare /api/health reply as a panel, stamped with the time it arrived', async () => {
    stubFetch(() => json(health));
    const panel = await loadHealthPanel();
    expect(panel).toMatchObject({ ok: true, data: health });
    expect(Number.isNaN(Date.parse((panel as { updatedAt: string }).updatedAt))).toBe(false);
  });

  it('gives an error panel when the server cannot be reached', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await loadHealthPanel()).toMatchObject({ ok: false, error: { code: 'network' }, updatedAt: null, lastGood: null });
  });
});

describe('createCoalescingRunner', () => {
  it('runs the task once, and once more after it when it was asked for again while it ran', async () => {
    let release: () => void = () => undefined;
    let runs = 0;
    const runner = createCoalescingRunner(async () => {
      runs += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    runner.trigger();
    runner.trigger(); // while run 1 waits
    runner.trigger(); // so does this: both become one more run
    expect(runs).toBe(1);
    release();
    await vi.waitFor(() => expect(runs).toBe(2));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(runs).toBe(2);
    // An idle runner starts again at once.
    runner.trigger();
    expect(runs).toBe(3);
    release();
  });

  it('reports a task that throws and keeps working', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let runs = 0;
    const runner = createCoalescingRunner(async () => {
      runs += 1;
      if (runs === 1) throw new Error('first run broke');
    });
    runner.trigger();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    runner.trigger();
    await vi.waitFor(() => expect(runs).toBe(2));
    logged.mockRestore();
  });
});

describe('PanelContent', () => {
  const reload = () => undefined;
  const aside = createElement('span', { className: 'the-aside' }, 'ASIDE');
  const render = (result: PanelResult<number>, withAside = true) =>
    renderToStaticMarkup(createElement(PanelContent<number>, { title: 'Numbers', result, ...(withAside ? { aside } : {}), children: (n: number) => createElement('p', null, `the number is ${n}`) }));

  it('draws no frame of its own: a header and a body, for whatever frame the panel sits in', () => {
    const html = render({ state: 'ready', panel: { ok: true, data: 7, updatedAt: T0 }, reload });
    expect(html).not.toContain('<section');
    expect(html).toContain('<h2');
    expect(html).toContain('the number is 7');
    expect(html).toContain(`dateTime="${T0}"`);
  });

  it('draws its aside next to the title in every state: loading, good and failed', () => {
    const states: PanelResult<number>[] = [
      { state: 'loading', panel: null, reload },
      { state: 'ready', panel: { ok: true, data: 7, updatedAt: T0 }, reload },
      { state: 'error', panel: { ok: false, error: { code: 'gh-offline', message: 'GitHub: offline' }, updatedAt: null, lastGood: null }, reload },
    ];
    for (const result of states) {
      const html = render(result);
      expect(html, result.state).toContain('ASIDE');
      // It is in the header, with the title, and not in the body.
      expect(html.indexOf('ASIDE'), result.state).toBeGreaterThan(html.indexOf('Numbers'));
      expect(html.indexOf('ASIDE'), result.state).toBeLessThan(html.indexOf('</header>'));
    }
  });

  it('has the markup that the header always had when there is no aside', () => {
    const html = render({ state: 'ready', panel: { ok: true, data: 7, updatedAt: T0 }, reload }, false);
    expect(html).toContain('<h2 class="text-base font-semibold">Numbers</h2>');
    expect(html).not.toContain('the-aside');
  });
});

describe('PanelFrame', () => {
  const reload = () => undefined;
  const render = (result: PanelResult<number>, extra: { focal?: boolean } = {}) =>
    renderToStaticMarkup(createElement(PanelFrame<number>, { title: 'Numbers', result, ...extra, children: (n: number) => createElement('p', null, `the number is ${n}`) }));

  it('shows its title and a loading note while the first load runs', () => {
    const html = render({ state: 'loading', panel: null, reload });
    expect(html).toContain('Numbers');
    expect(html).toContain('Loading');
    expect(html).not.toContain('the number is');
  });

  it('shows its data and when it was updated', () => {
    const html = render({ state: 'ready', panel: { ok: true, data: 7, updatedAt: T0 }, reload });
    expect(html).toContain('the number is 7');
    expect(html).toContain('Updated');
    expect(html).toContain(`dateTime="${T0}"`);
    expect(html).not.toContain('role="alert"');
  });

  it('shows the error, its code and a Retry button, and says nothing was ever loaded when there is no data', () => {
    const html = render({ state: 'error', panel: { ok: false, error: { code: 'gh-not-signed-in', message: 'GitHub: gh is not signed in' }, updatedAt: null, lastGood: null }, reload });
    expect(html).toContain('role="alert"');
    expect(html).toContain('GitHub: gh is not signed in');
    expect(html).toContain('gh-not-signed-in');
    expect(html).toContain('Retry');
    expect(html).toContain('Not updated yet');
    expect(html).not.toContain('the number is');
  });

  it('draws the icon of the error in ink, not amber, so that a page with several failing panels keeps to the one or two amber items of the Look', () => {
    const html = render({ state: 'error', panel: { ok: false, error: { code: 'gh-not-signed-in', message: 'GitHub: gh is not signed in' }, updatedAt: null, lastGood: null }, reload });
    const icon = /<div role="alert"[^>]*>\s*<svg[^>]*>/.exec(html)?.[0] ?? '';
    expect(icon).toContain('text-cc-ink');
    expect(icon).not.toContain('cc-accent');
  });

  it('shows the error above the last good data, with the time of that data', () => {
    const html = render({ state: 'error', panel: { ok: false, error: { code: 'network', message: 'Cannot reach the server.' }, updatedAt: T0, lastGood: { data: 3, updatedAt: T0 } }, reload });
    expect(html).toContain('Cannot reach the server.');
    expect(html).toContain('Retry');
    expect(html).toContain('the number is 3');
    expect(html).toContain('last good');
    expect(html).toContain(`dateTime="${T0}"`);
  });

  it('marks a focal panel with the accent border, and only that one', () => {
    const plain = render({ state: 'loading', panel: null, reload });
    const focal = render({ state: 'loading', panel: null, reload }, { focal: true });
    expect(focal).toContain('border-cc-accent');
    expect(plain).not.toContain('border-cc-accent');
  });
});
