import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, NOW_ISO, decision, liveAnswer, liveState, pr, row, snapshot } from '../fixtures/hosted/world';
import type { Snapshot } from '../src/github-api/types';
import type { AgentsLive, Decision, DocPageData, DocsListing, GitInfo, Health, Panel, StatusInfo, YourMoveInfo } from '../src/shared/types';
import type { FetchFn } from '../src/web/hosted/fetch';
import { createResolver, docSlugOf } from '../src/web/hosted/resolve';
import { LIVE_URL, SNAPSHOT_URL, createHostedStore } from '../src/web/hosted/store';
import { type WorkstreamsView } from '../src/web/hosted/workstreams';
import { clearDocCache } from '../src/web/hosted/rendered';
import { REPO_DIR } from './helpers';

// The hosted data layer answers the URLs of the local server from the snapshot, the live key and the doc files (src/web/hosted/resolve.ts). These tests
// drive it with a fake fetch, so no network and no browser are used. The docs, the status and the engine decisions run over the real files of this repo.

type Answer = { status?: number; body?: unknown; type?: string };

function fakeFetch() {
  const answers = new Map<string, Answer | 'throw'>();
  const fetchImpl: FetchFn = async (url) => {
    const answer = answers.get(url);
    if (answer === undefined || answer === 'throw') throw new TypeError('Failed to fetch');
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, type: (answer.type ?? 'basic') as ResponseType, headers: new Headers(), text: async () => JSON.stringify(answer.body) };
  };
  return { answers, fetchImpl };
}

function setup(options: { snap?: Snapshot | Answer | 'throw'; live?: ReturnType<typeof liveAnswer> | Answer | 'throw' } = {}) {
  const server = fakeFetch();
  const snap = options.snap ?? snapshot();
  const live = options.live ?? liveAnswer('online');
  server.answers.set(SNAPSHOT_URL, snap === 'throw' ? 'throw' : 'at' in snap ? { body: snap } : snap);
  server.answers.set(LIVE_URL, live === 'throw' ? 'throw' : 'reporter' in live ? { body: live } : live);
  const store = createHostedStore({ fetchImpl: server.fetchImpl, now: () => NOW, visibility: { isVisible: () => true, onChange: () => () => {} } });
  const resolve = createResolver(store, { origin: () => 'https://cc.example.vercel.app', now: () => NOW });
  return { server, store, resolve };
}

/** The panel's data, or a failure of the test when the panel is an error. */
function dataOf<T>(panel: Panel<T>): T {
  if (!panel.ok) throw new Error(`expected a good panel, got ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

describe('the panels made from the snapshot', () => {
  it('answers /api/github and /api/ci with the parts of the snapshot, stamped with the time of the snapshot', async () => {
    const { resolve } = setup({ snap: snapshot({ github: { open: [pr(1, 'a', { attention: 'merge' })], merged: [] } }) });
    const github = await resolve<{ open: { number: number }[] }>('/api/github');
    expect(dataOf(github).open[0]?.number).toBe(1);
    expect(github.ok && github.updatedAt).toBe(NOW_ISO);
    expect(dataOf(await resolve<{ state: string }>('/api/ci')).state).toBe('passing');
  });

  it('answers /api/git with main as the current branch, level with GitHub', async () => {
    const { resolve } = setup();
    const git = dataOf(await resolve<GitInfo>('/api/git'));
    expect(git).toMatchObject({ current: 'main', ahead: 0, behind: 0 });
    expect(git.branches[0]).toMatchObject({ name: 'main', upstream: 'origin/main' });
  });

  it('answers /api/health with the repo and links that open on the hosted origin', async () => {
    const { resolve } = setup();
    const health = dataOf(await resolve<Health>('/api/health'));
    expect(health.githubRepo).toBe('markhazlewood42/shadow-jog');
    expect(health.links.map((link) => link.url)).toContain('https://cc.example.vercel.app/docs/roadmap/README');
  });

  it('shows a failed first load as an error panel with the reason, no data, and loads again on the next ask (Retry)', async () => {
    const { resolve, server, store } = setup({ snap: { status: 502, body: { error: 'the store could not be reached', kind: 'store-error' } } });
    const failed = await resolve<unknown>('/api/github');
    expect(failed).toMatchObject({ ok: false, error: { code: 'http-502', message: 'The server answered 502: the store could not be reached.' }, lastGood: null });
    server.answers.set(SNAPSHOT_URL, { body: snapshot() });
    // Another panel asking inside the poll interval gets the known error; the Retry button opens the gate.
    expect((await resolve<unknown>('/api/github')).ok).toBe(false);
    store.allowRetry();
    expect((await resolve<unknown>('/api/github')).ok).toBe(true);
  });

  it('shows the last good data under the error when a later poll fails (the panel is stale)', async () => {
    const { resolve, store, server } = setup({ snap: snapshot({ github: { open: [pr(7, 'a')], merged: [] } }) });
    expect((await resolve<unknown>('/api/github')).ok).toBe(true);
    server.answers.set(SNAPSHOT_URL, { status: 401, body: '<html></html>' });
    await store.load('snapshot');
    const stale = await resolve<{ open: { number: number }[] }>('/api/github');
    expect(stale).toMatchObject({ ok: false, error: { code: 'login-expired' }, updatedAt: NOW_ISO });
    expect(!stale.ok && stale.lastGood?.data.open[0]?.number).toBe(7);
  });

  it('answers the Status panel from the real status.md and migration.md', async () => {
    const status = readFileSync(join(REPO_DIR, 'status.md'), 'utf8');
    const migration = readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8');
    const roadmap = readFileSync(join(REPO_DIR, 'docs', 'roadmap', 'roadmap.json'), 'utf8');
    const { resolve } = setup({ snap: snapshot({ main: { status, roadmap, migration } }) });
    const panel = await resolve<StatusInfo>('/api/status');
    // A good panel, or a milestone problem that rides along with the data. Either way the milestones are read.
    const info = panel.ok ? panel.data : panel.lastGood?.data;
    expect(info?.milestones.length).toBeGreaterThan(3);
    expect(info?.milestones[0]?.id).toBe('Phase 0');
    if (!panel.ok) expect(panel.error.code).toMatch(/milestone/);
    // The done squares are the roadmap's (the hosted page joins the same way as the local server).
    expect(panel.ok).toBe(true);
    const byId = new Map(info?.milestones.map((milestone) => [milestone.id, milestone.done]));
    expect(byId.get('Phase 0')).toBe(true);
    expect(byId.get('ET')).toBe(true);
    expect(byId.get('M8a')).toBe(true);
    expect(byId.get('M8b')).toBe(true);
    expect(byId.get('M8c')).toBe(true);
    expect(byId.get('M8d')).toBe(false);
  });

  it('says that the roadmap is missing or unreadable, with the status riding along, when main has no usable roadmap.json', async () => {
    const status = readFileSync(join(REPO_DIR, 'status.md'), 'utf8');
    const migration = readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8');
    for (const [roadmap, code] of [
      [null, 'milestones-roadmap-missing'],
      ['{ not json', 'milestones-roadmap-unreadable'],
    ] as const) {
      const { resolve } = setup({ snap: snapshot({ main: { status, roadmap, migration } }) });
      const panel = await resolve<StatusInfo>('/api/status');
      expect(panel.ok, code).toBe(false);
      if (panel.ok) continue;
      expect(panel.error.code).toBe(code);
      expect(panel.lastGood?.data.milestones).toEqual([]);
      expect(panel.lastGood?.data.updated).not.toBeNull();
    }
  });

  it('says that status.md is missing, with its code, when main has none', async () => {
    const { resolve } = setup();
    expect(await resolve<StatusInfo>('/api/status')).toMatchObject({ ok: false, error: { code: 'status-missing' } });
  });
});

describe('the panels made from the live key', () => {
  const sessions = liveState({
    sessions: [
      { id: 'new', title: 'Newer', branch: 'a', folder: 'f', state: 'waiting', startedAt: '2026-10-12T11:00:00.000Z', agents: { running: 0, done: 0, names: [] }, yourMove: null },
      { id: 'old', title: 'Older', branch: 'b', folder: 'f', state: 'working', startedAt: '2026-10-12T09:00:00.000Z', agents: { running: 2, done: 1, names: ['x', 'y', 'z'] }, yourMove: null },
    ],
  });

  it('lists the sessions of an online reporter, the oldest first', async () => {
    const { resolve } = setup({ live: liveAnswer('online', sessions) });
    const agents = dataOf(await resolve<AgentsLive>('/api/agents'));
    expect(agents.sessions.map((session) => session.id)).toEqual(['old', 'new']);
    expect(agents.sessions[0]).toMatchObject({ title: 'Older', state: 'working', nodes: [expect.objectContaining({ label: 'x', kind: 'agent' }), expect.objectContaining({ label: 'y', kind: 'agent' }), expect.objectContaining({ label: 'z', state: 'done' })] });
  });

  it('says "reporter not running" when the key is gone', async () => {
    const { resolve } = setup({ live: liveAnswer('not-running') });
    expect(await resolve<AgentsLive>('/api/agents')).toMatchObject({ ok: false, error: { code: 'reporter-not-running', message: expect.stringContaining('Reporter not running') }, lastGood: null });
  });

  it('says "reporter offline since" with the time, and keeps the last rows under the error', async () => {
    const { resolve } = setup({ live: liveAnswer('offline', { ...sessions, writtenAt: '2026-10-12T11:50:00.000Z' }) });
    const panel = await resolve<AgentsLive>('/api/agents');
    expect(panel).toMatchObject({ ok: false, error: { code: 'reporter-offline', message: expect.stringMatching(/Reporter offline since \d\d:\d\d:\d\d/) } });
    expect(!panel.ok && panel.lastGood?.data.sessions).toHaveLength(2);
  });

  it('says the live value is unreadable when it has the wrong shape', async () => {
    const { resolve } = setup({ live: { reporter: { state: 'online', writtenAt: NOW_ISO, ageSeconds: 1, offlineAfterSeconds: 150 }, live: { writtenAt: NOW_ISO, sessions: 'no', worktrees: [] } } as never });
    expect(await resolve<AgentsLive>('/api/agents')).toMatchObject({ ok: false, error: { code: 'live-unreadable' } });
  });

  it('shows a failed request for /api/live as an error', async () => {
    const { resolve } = setup({ live: { status: 503, body: { error: 'rate limited' } } });
    expect(await resolve<AgentsLive>('/api/agents')).toMatchObject({ ok: false, error: { code: 'http-503' } });
  });
});

describe('the Workstreams view and "Your move"', () => {
  it('builds the view from both slots, and does not fail when the reporter is away', async () => {
    const { resolve } = setup({ snap: snapshot({ workstreams: [row('alpha'), row('broken', { workstream: { ok: false, path: 'docs/workstreams/broken.md', errors: ['x'], message: 'docs/workstreams/broken.md: x' } })] }), live: liveAnswer('not-running') });
    const view = dataOf(await resolve<WorkstreamsView>('/api/workstreams'));
    expect(view.lanes[0]?.cards[0]?.branch).toBe('alpha');
    expect(view.invalid[0]?.path).toBe('docs/workstreams/broken.md');
    expect(view.live).toEqual({ state: 'not-running' });
  });

  it('serves the spike PRs in /api/github unchanged: the hide is in the panel, not in the data', async () => {
    const spike = pr(3, 'spike/side-battle', { isDraft: true });
    const { resolve } = setup({ snap: snapshot({ github: { open: [spike, pr(30, 'alpha')], merged: [] } }) });
    expect(dataOf(await resolve<{ open: { number: number }[] }>('/api/github')).open.map((entry) => entry.number)).toEqual([3, 30]);
  });

  it('builds "Your move" from the decisions and the asks of the live key, with no PR item (the shared rule; see hosted-your-move.test.ts)', async () => {
    const live = liveState({
      sessions: [{ id: 's1', title: 'Flip it', branch: 'alpha', folder: 'f', state: 'waiting', startedAt: null, agents: { running: 0, done: 0, names: [] }, yourMove: { at: NOW_ISO, lines: ['Look at the picture'] } }],
    });
    const { resolve } = setup({ snap: snapshot({ github: { open: [pr(30, 'alpha', { attention: 'merge' })], merged: [] }, decisions: { open: [decision(5)], recent: [] } }), live: liveAnswer('online', live) });
    const info = dataOf(await resolve<YourMoveInfo>('/api/now/your-move'));
    expect(info.items.map((item) => item.source)).toEqual(['decision-issue', 'session']);
    expect(info.missing).toEqual([]);
  });
});

describe('decisions', () => {
  it('answers /api/decisions/<n> from the snapshot, and says "not found" for another number', async () => {
    const { resolve } = setup({ snap: snapshot({ decisions: { open: [decision(12)], recent: [decision(8, { state: 'answered' })] } }) });
    expect(dataOf(await resolve<{ number: number; sections: unknown[] }>('/api/decisions/12'))).toMatchObject({ number: 12, sections: [] });
    expect(dataOf(await resolve<{ number: number }>('/api/decisions/8')).number).toBe(8);
    expect(await resolve<unknown>('/api/decisions/99')).toMatchObject({ ok: false, error: { code: 'decision-not-found' } });
  });

  it('answers /api/decisions (the list that the docs page checks the engine decisions against) from the snapshot', async () => {
    const { resolve } = setup({ snap: snapshot({ decisions: { open: [decision(12)], recent: [decision(8, { state: 'answered' })] } }) });
    const info = dataOf(await resolve<{ open: { number: number }[]; recent: { number: number }[] }>('/api/decisions'));
    expect(info.open.map((entry) => entry.number)).toEqual([12]);
    expect(info.recent.map((entry) => entry.number)).toEqual([8]);
  });
});

describe('endpoints the hosted page does not have', () => {
  it('says search needs the local server, and names an unknown address', async () => {
    const { resolve } = setup();
    expect(await resolve<unknown>('/api/search?q=x')).toMatchObject({ ok: false, error: { code: 'search-unavailable' } });
    expect(await resolve<unknown>('/api/sessions')).toMatchObject({ ok: false, error: { code: 'local-only' } });
    expect(await resolve<unknown>('/api/nothing')).toMatchObject({ ok: false, error: { code: 'unknown-endpoint' } });
  });
});

describe('docs, read through /api/docs/<repo path>', () => {
  const requested: string[] = [];

  /** Serves the real files of this repo under /api/docs/<path>, as the function does. */
  beforeEach(() => {
    clearDocCache();
    requested.length = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const path = url.replace('/api/docs/', '');
      try {
        const text = readFileSync(join(REPO_DIR, path), 'utf8');
        return new Response(text, { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } });
      } catch {
        return new Response('{"error":"not found","kind":"not-found"}', { status: 404, headers: { 'content-type': 'application/json' } });
      }
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a doc with the same renderer as the local page, and resolves its links to this site', async () => {
    const { resolve } = setup();
    const doc = dataOf(await resolve<DocPageData>('/api/docs/engine/decisions'));
    expect(doc).toMatchObject({ id: 'docs/engine/decisions.md', slug: 'engine/decisions', updatedFrom: 'frontmatter' });
    expect(doc.html).toContain('<h1');
    expect(doc.headings.length).toBeGreaterThan(0);
    expect(doc.title).not.toBe('');
    expect(requested).toEqual(['/api/docs/docs/engine/decisions.md']);
  });

  it('shows the roadmap chart (an svg) as a picture, not as a link', async () => {
    const { resolve } = setup();
    const doc = dataOf(await resolve<DocPageData>('/api/docs/roadmap/README'));
    expect(doc.html).toMatch(/<img [^>]*src="\/api\/docs\/docs\/roadmap\/roadmap\.svg"[^>]*data-zoom="\/api\/docs\/docs\/roadmap\/roadmap\.svg"/);
    expect(doc.html).not.toMatch(/<a [^>]*>The roadmap as a Gantt-style chart/);
  });

  it('tries the root file when a slug has no folder and no file in docs/', async () => {
    const { resolve } = setup();
    // `status` is named by nav.json as status.md, so it is the first and only try.
    const doc = dataOf(await resolve<DocPageData>('/api/docs/status'));
    expect(doc.id).toBe('status.md');
    expect(requested).toEqual(['/api/docs/status.md']);
  });

  it('gives the "Doc not found" answer, with a list of suggestions, when no path has the doc', async () => {
    const { resolve } = setup();
    const panel = await resolve<DocPageData>('/api/docs/no/such/doc');
    expect(panel).toMatchObject({ ok: false, error: { code: 'doc-not-found' }, suggestions: [] });
  });

  it('refuses a slug that cannot name a doc before it reaches /api/docs: "..", ".", an empty part and a bad escape', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      return new Response('# x', { status: 200, headers: { 'content-type': 'text/markdown' } });
    });
    const { resolve } = setup();
    for (const path of ['/api/docs/..%2Fsecrets', '/api/docs/a//b', '/api/docs/a/%E0%A4%A', '/api/docs/a%2Fb', '/api/docs/']) {
      expect(await resolve<DocPageData>(path), path).toMatchObject({ ok: false, error: { code: 'doc-not-found' } });
    }
    expect(requested).toEqual([]);
  });

  it('docSlugOf refuses ".", "..", empty parts and a bad escape, and decodes the rest', () => {
    for (const raw of ['', 'a/', '/a', 'a//b', '.', '..', 'a/../b', 'a/./b', '%2e%2e', 'a/%E0%A4%A', 'a%2Fb', 'a%5Cb']) expect(docSlugOf(raw), raw).toBeNull();
    expect(docSlugOf('docs/engine/decisions')).toBe('docs/engine/decisions');
    expect(docSlugOf('docs/my%20doc')).toBe('docs/my doc');
  });

  it('shows a lost login as an error, not as "not found"', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const { resolve } = setup();
    expect(await resolve<DocPageData>('/api/docs/status')).toMatchObject({ ok: false, error: { code: 'login-expired' } });
  });

  it('banners: the open decisions that link to a heading of the doc', async () => {
    const issue = decision(3, { docs: [{ docId: 'docs/engine/decisions.md', slug: 'engine/decisions', anchor: 'the-heading', heading: null }] });
    const { resolve } = setup({ snap: snapshot({ decisions: { open: [issue], recent: [] } }) });
    const doc = dataOf(await resolve<DocPageData>('/api/docs/engine/decisions'));
    expect(doc.decisions).toEqual([{ number: 3, title: 'Decision: question 3', anchor: 'the-heading' }]);
  });

  it('banners are null, so the page can say they are missing, when the snapshot could not be read', async () => {
    const { resolve } = setup({ snap: 'throw' });
    const doc = dataOf(await resolve<DocPageData>('/api/docs/engine/decisions'));
    expect(doc.decisions).toBeNull();
  });

  it('names the heading of a linked section when the decision links a heading that the doc has', async () => {
    const { resolve } = setup({ snap: snapshot({ decisions: { open: [decision(3, { docs: [{ docId: 'docs/command-center/design.md', slug: 'command-center/design', anchor: '59-workstreams-revision-3', heading: null }] })], recent: [] } }) });
    const detail = dataOf(await resolve<{ docs: { heading: string | null }[]; sections: { heading: string | null }[] }>('/api/decisions/3'));
    expect(detail.sections[0]?.heading).toBe('5.9 Workstreams (revision 3)');
    expect(detail.docs[0]?.heading).toBe('5.9 Workstreams (revision 3)');
  });

  it('leaves the heading empty when the doc cannot be read, so the page says "Section not found"', async () => {
    const { resolve } = setup({ snap: snapshot({ decisions: { open: [decision(3, { docs: [{ docId: 'docs/nope.md', slug: 'nope', anchor: 'x', heading: null }] })], recent: [] } }) });
    const detail = dataOf(await resolve<{ sections: { heading: string | null }[] }>('/api/decisions/3'));
    expect(detail.sections[0]?.heading).toBeNull();
  });

  it('lists the files that nav.json names, the pages of the site, and a note for each folder and for each file the function cannot serve', async () => {
    const { resolve } = setup();
    const listing = dataOf(await resolve<DocsListing>('/api/docs'));
    const titles = listing.nav.flatMap((section) => section.items.map((item) => item.title));
    expect(titles).toContain('Workstreams');
    expect(titles).toContain('All decisions');
    expect(listing.nav.find((section) => section.id === 'start')?.items.map((item) => item.kind === 'doc' && item.slug)).toEqual(['status', 'README', 'CLAUDE']);
    expect(listing.problems.some((problem) => problem.includes('docs/engine/'))).toBe(true);
    expect(listing.problems.some((problem) => problem.includes('tools/command-center/README.md'))).toBe(true);
  });

  it('reads the engine decision table from the three docs, and says that the change flags need the local server', async () => {
    const { resolve } = setup();
    const panel = await resolve<Decision[]>('/api/engine/decisions');
    expect(panel).toMatchObject({ ok: false, error: { code: 'approval-check-unavailable' } });
    const kept = !panel.ok ? panel.lastGood?.data : undefined;
    expect(kept?.length).toBeGreaterThan(10);
    expect(kept?.every((decisionRow) => decisionRow.change === null)).toBe(true);
    expect(requested.sort()).toEqual(['/api/docs/docs/PHASE-0.2.md', '/api/docs/docs/engine/README.md', '/api/docs/docs/engine/decisions.md']);
  });
});
