import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_FORCED_REFRESH_GAP_MS, registerPanelRoute } from '../src/server/routes/panel';
import type { PanelSource } from '../src/server/source';
import type { Panel } from '../src/shared/types';
import { getFrom, makeApp } from './helpers';

// The route helper that the status, git and GitHub routes share: it answers a source's Panel, and
// decides when a request may make the source load again.

type Answer = 'good' | 'bad';

/** A source whose answer a test sets, and that counts how often it was asked to load. */
function stubSource(first: Answer = 'good') {
  let answer: Answer = first;
  let loads = 0;
  let current: Panel<number> | null = null;
  const make = (): Panel<number> => (answer === 'good' ? { ok: true, data: loads, updatedAt: 'now' } : { ok: false, error: { code: 'broken', message: 'It is broken.' }, updatedAt: null, lastGood: null });
  const source: PanelSource<number> = {
    async get(refresh) {
      if (current === null || refresh) {
        loads += 1;
        current = make();
      }
      return current;
    },
    start() {},
    stop() {},
  };
  return { source, setAnswer: (next: Answer) => void (answer = next), loads: () => loads };
}

function routeFor(source: PanelSource<number>, options: Parameters<typeof registerPanelRoute>[3] = {}) {
  const { app } = makeApp();
  registerPanelRoute(app, '/api/stub', source, options);
  return async (query = '') => {
    const res = await getFrom(app, `/api/stub${query}`);
    return { status: res.status, panel: (await res.json()) as Panel<number> };
  };
}

describe('registerPanelRoute', () => {
  afterEach(() => vi.useRealTimers());

  it('the gap between forced refreshes is 10 seconds', () => {
    expect(MIN_FORCED_REFRESH_GAP_MS).toBe(10_000);
  });

  it('answers the panel of the source with status 200, and a request without ?refresh=1 does not make the source load again', async () => {
    const { source, loads } = stubSource();
    const ask = routeFor(source);
    expect((await ask()).status).toBe(200);
    await ask();
    await ask();
    expect(loads()).toBe(1); // the first request found nothing and loaded; the rest were answered from it
  });

  it('?refresh=1 loads once, and again only 10 s after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    const { source, loads } = stubSource();
    const ask = routeFor(source);
    await ask(); // 1 load: nothing was there
    await ask('?refresh=1'); // 2
    await ask('?refresh=1');
    expect(loads()).toBe(2);
    vi.setSystemTime(1_000_000 + 9_999);
    await ask('?refresh=1');
    expect(loads()).toBe(2);
    vi.setSystemTime(1_000_000 + 10_000);
    await ask('?refresh=1');
    expect(loads()).toBe(3);
  });

  it('a failed panel is asked again by the next request, not more often than a forced refresh would be', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    const { source, loads, setAnswer } = stubSource('bad');
    const ask = routeFor(source);

    // The first request loads (1) and finds a failure, so it tries once more (2). The answer is still a panel with status 200.
    const first = await ask();
    expect(first.status).toBe(200);
    expect(first.panel).toMatchObject({ ok: false, error: { code: 'broken' } });
    expect(loads()).toBe(2);
    // Requests within 10 s do not try again: the Retry button of a panel cannot hammer a program.
    await ask();
    await ask('?refresh=1');
    expect(loads()).toBe(2);
    // Later a request does try again, and a mended source answers well at once.
    setAnswer('good');
    vi.setSystemTime(1_000_000 + 10_000);
    const mended = await ask();
    expect(mended.panel.ok).toBe(true);
    expect(loads()).toBe(3);
    // A good panel is not asked again by a plain request.
    await ask();
    expect(loads()).toBe(3);
  });

  it('with a gap of 0 every ?refresh=1 loads', async () => {
    const { source, loads } = stubSource();
    const ask = routeFor(source, { minGapMs: 0 });
    await ask();
    await ask('?refresh=1');
    await ask('?refresh=1');
    expect(loads()).toBe(3);
  });

  it('only GET is answered (the server refuses the other methods before the route sees them)', async () => {
    const { source } = stubSource();
    const { app } = makeApp();
    registerPanelRoute(app, '/api/stub', source);
    const res = await app.request('/api/stub', { method: 'POST', headers: { host: 'localhost:3009' } });
    expect(res.status).toBe(405);
  });
});
