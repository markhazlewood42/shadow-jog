import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compose } from '../src/server/compose';
import { registerNowRoutes } from '../src/server/routes/now';
import type { PanelSource } from '../src/server/source';
import type { Decision, DecisionsInfo, GithubInfo, Panel, SessionsInfo, StatusInfo, YourMoveInfo } from '../src/shared/types';
import { PACKAGE_DIR, getFrom, makeApp, makeTestConfig, noopRunner } from './helpers';

// GET /api/now/your-move: the list "Your move" of the Now page, made from the panels of five sources. The tests give the route stub sources
// (a source here is only a Panel to read), so no gh, no git and no session file is involved, except in the last test, which composes the real server.

const parent = mkdtempSync(join(tmpdir(), 'cc-now-route-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const T0 = '2026-10-06T10:00:00.000Z';

/** A source that answers one panel. The route reads sources and does not start them. */
function stub<T>(panel: Panel<T>): PanelSource<T> & { reads: () => number } {
  let reads = 0;
  return {
    async get() {
      reads += 1;
      return panel;
    },
    start() {},
    stop() {},
    reads: () => reads,
  };
}

const goodDecisions: Panel<DecisionsInfo> = {
  ok: true,
  updatedAt: T0,
  data: {
    open: [
      {
        number: 41,
        title: 'Decision: Where should Burrow keep its cache?',
        url: 'https://github.com/octo-owner/octo-repo/issues/41',
        state: 'open',
        question: 'Where?',
        context: null,
        options: [{ id: 'A', text: 'Here' }],
        recommended: null,
        docs: [],
        raisedBy: null,
        waitsOn: null,
        createdAt: '2026-10-05T08:00:00Z',
        answer: null,
        problem: null,
      },
    ],
    recent: [],
  },
};
const noSessions: Panel<SessionsInfo> = { ok: true, updatedAt: T0, data: { sessions: [], scanned: 0, skipped: 0, hiddenSdk: 0 } };
const noPrs: Panel<GithubInfo> = { ok: true, updatedAt: T0, data: { open: [], merged: [] } };
const noDocDecisions: Panel<Decision[]> = { ok: true, updatedAt: T0, data: [] };
const goodStatus: Panel<StatusInfo> = {
  ok: true,
  updatedAt: T0,
  data: { updated: null, nextUpForMark: [{ text: 'Pick the color.', html: '<p>Pick the color.</p>' }], milestone: { current: null, problem: null }, milestones: [] },
};

function routeWith(overrides: { decisions?: Panel<DecisionsInfo>; github?: Panel<GithubInfo> } = {}) {
  const { app } = makeApp();
  const sources = {
    decisions: stub(overrides.decisions ?? goodDecisions),
    sessions: stub(noSessions),
    status: stub(goodStatus),
    github: stub(overrides.github ?? noPrs),
    engine: stub(noDocDecisions),
  };
  registerNowRoutes(app, sources);
  return { app, sources };
}

describe('GET /api/now/your-move', () => {
  it('answers the Panel of the list made from the five sources, stamped with the time it was made', async () => {
    const { app, sources } = routeWith();
    const before = Date.now();
    const res = await getFrom(app, '/api/now/your-move');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const panel = (await res.json()) as Panel<YourMoveInfo>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.missing).toEqual([]);
    expect(panel.data.items.map((item) => [item.source, item.text, item.href])).toEqual([
      ['decision-issue', 'Decision #41: Where should Burrow keep its cache?', '/decisions/41'],
      ['status', 'Pick the color.', '/docs/status'],
    ]);
    // The list is made now, from the panels that the sources have now: its time is the time of the request, not one of the sources'.
    expect(Date.parse(panel.updatedAt)).toBeGreaterThanOrEqual(before);
    // Each source was read once, and none was asked to load again (the route only reads).
    for (const source of Object.values(sources)) expect(source.reads()).toBe(1);
  });

  it('a source that failed does not fail the panel: the list is made from the others, and the failed source is named in missing', async () => {
    const signedOut = { ok: false as const, error: { code: 'gh-not-signed-in', message: 'gh is not signed in to GitHub.' }, updatedAt: null, lastGood: null };
    const { app } = routeWith({ decisions: signedOut, github: signedOut });
    const res = await getFrom(app, '/api/now/your-move');
    // Not an HTTP error (a browser logs each of those as an error of the page), and not a failed Panel either: the list was made.
    expect(res.status).toBe(200);
    const panel = (await res.json()) as Panel<YourMoveInfo>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.items.map((item) => item.source)).toEqual(['status']);
    expect(panel.data.missing).toEqual([
      { source: 'decision-issue', message: 'gh is not signed in to GitHub.' },
      { source: 'pr', message: 'gh is not signed in to GitHub.' },
    ]);
  });

  it('only GET is answered, and a request takes nothing from the client', async () => {
    const { app } = routeWith();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/api/now/your-move', { method, headers: { host: 'localhost:3009' } });
      expect(res.status, method).toBe(405);
    }
    // Whatever a request adds to the address, the list is the same one (only the time it was made differs).
    const itemsOf = async (path: string) => ((await (await getFrom(app, path)).json()) as { data: YourMoveInfo }).data;
    const plain = await itemsOf('/api/now/your-move');
    for (const query of ['?refresh=1', '?path=../../etc', '?session=abc', '?source=pr']) expect(await itemsOf(`/api/now/your-move${query}`), query).toEqual(plain);
    // A path under it is not a route.
    expect((await getFrom(app, '/api/now/your-move/pr')).status).toBe(404);
    expect((await getFrom(app, '/api/now')).status).toBe(404);
  });
});

describe('the server', () => {
  it('compose mounts the route (ruling R3): GET /api/now/your-move answers on the real app, and every source that cannot be read is named', async () => {
    // An empty repo folder and a runner that prints nothing: the docs have no status.md, and gh prints no list. Each source then fails on
    // its own, and the list is empty, with all of them named. The real wiring (compose.ts) is what is under test here.
    const repo = join(parent, 'repo');
    const config = makeTestConfig({ repoRoot: repo, roots: [repo] });
    const composed = compose({ config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web') });
    try {
      const res = await getFrom(composed.app, '/api/now/your-move', config);
      expect(res.status).toBe(200);
      const panel = (await res.json()) as Panel<YourMoveInfo>;
      expect(panel.ok).toBe(true);
      if (!panel.ok) return;
      expect(panel.data.items).toEqual([]);
      expect(panel.data.missing.map((entry) => entry.source).sort()).toEqual(['decision-issue', 'doc-decision', 'pr', 'status']);
    } finally {
      await composed.stop();
    }
  });
});
