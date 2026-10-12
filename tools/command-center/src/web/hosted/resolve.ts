import type { Snapshot } from '../../github-api/types';
import type { Panel } from '../../shared/types';
import { errorPanel, failedPanel, agentsPanel, decisionDetailOf, gitInfoOf, hostedHealth, readLive } from './panels';
import { type HostedStore, hostedStore } from './store';
import { buildHostedYourMove } from './your-move';
import { type WorkstreamsView, buildWorkstreamsView } from './workstreams';

// The hosted data layer: it answers the same URLs the local server answers (`/api/github`, `/api/now/your-move`, ...), so the pages stay as they are. Each
// answer is made from the snapshot, the live key or a doc file, and has the same Panel shape, with the loading, error and last-good states of every panel.
// An endpoint that only the local server has gives a failed panel that says so. Nothing here fails silently.

const NO_ANSWER = { kind: 'network', code: 'no-answer', message: 'No answer from the server yet.' } as const;

/** What the local server has and the hosted page does not, by address start, with the sentence that the panel shows. */
const LOCAL_ONLY: { prefix: string; code: string; message: string }[] = [
  { prefix: '/api/search', code: 'search-unavailable', message: 'Search needs the local server.' },
  { prefix: '/api/sessions', code: 'local-only', message: 'Session files are on the local server only.' },
];

function lazyRendered() {
  return import('./rendered');
}

export type Resolver = <T>(url: string) => Promise<Panel<T>>;

export function createResolver(store: HostedStore, options: { origin?: () => string; now?: () => Date } = {}): Resolver {
  const origin = options.origin ?? (() => (typeof window === 'undefined' ? 'http://localhost' : window.location.origin));
  const now = options.now ?? (() => new Date());

  /** A panel made from the snapshot. A failed poll after a good one keeps the data and shows the error above it. */
  async function fromSnapshot<T>(map: (snapshot: Snapshot) => T | Promise<T>): Promise<Panel<T>> {
    await store.ensure('snapshot');
    const slot = store.snapshot();
    if (slot.data === null) return errorPanel<T>(slot.error ?? NO_ANSWER, null);
    const data = await map(slot.data);
    const updatedAt = slot.data.at;
    return slot.error === null ? { ok: true, data, updatedAt } : errorPanel<T>(slot.error, { data, updatedAt });
  }

  /** The same, for a map that already knows its own problems and answers with a Panel. */
  async function fromSnapshotPanel<T>(map: (snapshot: Snapshot) => Panel<T>): Promise<Panel<T>> {
    await store.ensure('snapshot');
    const slot = store.snapshot();
    if (slot.data === null) return errorPanel<T>(slot.error ?? NO_ANSWER, null);
    const panel = map(slot.data);
    if (slot.error === null || !panel.ok) return panel;
    return errorPanel<T>(slot.error, { data: panel.data, updatedAt: panel.updatedAt });
  }

  /** The Workstreams view from both slots. The view carries the state of the live rows, so a missing reporter does not fail the panel. */
  function viewOf(snapshot: Snapshot): WorkstreamsView {
    const read = readLive(store.live());
    return buildWorkstreamsView({ snapshot, live: read.live, liveStatus: read.status, now: now() });
  }

  async function resolve<T>(url: string): Promise<Panel<T>> {
    const { pathname } = new URL(url, 'http://hosted.invalid');

    if (pathname === '/api/health') return { ok: true, data: hostedHealth(origin()), updatedAt: now().toISOString() } as Panel<T>;
    if (pathname === '/api/github') return (await fromSnapshot((snapshot) => snapshot.github)) as Panel<T>;
    if (pathname === '/api/ci') return (await fromSnapshot((snapshot) => snapshot.ci)) as Panel<T>;
    if (pathname === '/api/git') return (await fromSnapshot(gitInfoOf)) as Panel<T>;

    if (pathname === '/api/status') {
      const { statusPanelOf } = await lazyRendered();
      return (await fromSnapshotPanel(statusPanelOf)) as Panel<T>;
    }

    if (pathname === '/api/agents') {
      await store.ensure('live');
      return agentsPanel(store.live()) as Panel<T>;
    }

    if (pathname === '/api/workstreams' || pathname === '/api/now/your-move') {
      await Promise.all([store.ensure('snapshot'), store.ensure('live')]);
      if (pathname === '/api/workstreams') return (await fromSnapshot(viewOf)) as Panel<T>;
      return (await fromSnapshot((snapshot) => buildHostedYourMove(snapshot, viewOf(snapshot)))) as Panel<T>;
    }

    const decision = /^\/api\/decisions\/([1-9]\d{0,9})$/.exec(pathname);
    if (decision !== null) {
      const number = Number(decision[1]);
      await store.ensure('snapshot');
      const slot = store.snapshot();
      if (slot.data === null) return errorPanel<T>(slot.error ?? NO_ANSWER, null);
      const detail = decisionDetailOf(slot.data, number);
      if (detail === null) return failedPanel({ code: 'decision-not-found', message: `Decision #${number} is not in the open or recent decisions.` }, null, null);
      const { withSections } = await lazyRendered();
      const full = await withSections(detail);
      return (slot.error === null ? { ok: true, data: full, updatedAt: slot.data.at } : errorPanel(slot.error, { data: full, updatedAt: slot.data.at })) as Panel<T>;
    }

    if (pathname === '/api/docs') {
      const { hostedListing } = await lazyRendered();
      return { ok: true, data: hostedListing(), updatedAt: now().toISOString() } as Panel<T>;
    }
    if (pathname.startsWith('/api/docs/')) {
      const slug = pathname
        .slice('/api/docs/'.length)
        .split('/')
        .map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        })
        .join('/');
      // The snapshot gives the decision banners. If it cannot be read, the doc still shows, and the banners are missing.
      await store.ensure('snapshot');
      const { docPanel } = await lazyRendered();
      return (await docPanel(slug, store.snapshot().data, now().getTime())) as Panel<T>;
    }
    if (pathname === '/api/engine/decisions') {
      const { engineDecisionsPanel } = await lazyRendered();
      return (await engineDecisionsPanel(now().getTime())) as Panel<T>;
    }

    const localOnly = LOCAL_ONLY.find((entry) => pathname.startsWith(entry.prefix));
    if (localOnly !== undefined) return failedPanel<T>(localOnly, null, null);
    return failedPanel<T>({ code: 'unknown-endpoint', message: `The hosted page has no data for ${pathname}.` }, null, null);
  }

  // A throw inside a map (a parser that meets a shape it does not know) must show as a failed panel, never as a blank box.
  return async function safe<T>(url: string): Promise<Panel<T>> {
    try {
      return await resolve<T>(url);
    } catch (error) {
      return failedPanel<T>({ code: 'hosted-failed', message: `The hosted page could not make this panel: ${error instanceof Error ? error.message : String(error)}` }, null, null);
    }
  };
}

/** The resolver of the page, on the store of the page. */
export const hostedPanel: Resolver = createResolver(hostedStore);
