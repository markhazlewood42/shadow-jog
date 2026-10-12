// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveAnswer, snapshot } from '../fixtures/hosted/world';
import { OWNER, REPO } from '../src/github-api/queries';
import type { NavSection } from '../src/shared/types';
import { HOSTED_REPO, WORKSTREAMS_PATH, isHosted, visibleNav } from '../src/web/hosted/mode';

// How the page decides to be the hosted page (src/web/hosted/mode.ts and api.ts), and what changes with it. The choice is a build flag, VITE_HOSTED=1.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav: NavSection[] = [
  { id: 'a', title: 'A', items: [{ kind: 'doc', slug: 'x', title: 'X', updated: '' }] },
  {
    id: 'b',
    title: 'B',
    items: [
      { kind: 'page', path: '/docs/decisions', title: 'All decisions' },
      { kind: 'page', path: WORKSTREAMS_PATH, title: 'Workstreams' },
    ],
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the flag', () => {
  it('is off by default and on when the build sets VITE_HOSTED=1', () => {
    expect(isHosted()).toBe(false);
    vi.stubEnv('VITE_HOSTED', '1');
    expect(isHosted()).toBe(true);
    vi.stubEnv('VITE_HOSTED', '0');
    expect(isHosted()).toBe(false);
  });

  it('names the repo of the GitHub API adapter', () => {
    expect(HOSTED_REPO).toBe(`${OWNER}/${REPO}`);
  });
});

describe('the docs navigation', () => {
  it('hides the Workstreams entry in the local build and keeps it in the hosted build', () => {
    expect(visibleNav(nav, false).flatMap((section) => section.items.map((item) => item.title))).toEqual(['X', 'All decisions']);
    expect(visibleNav(nav, true).flatMap((section) => section.items.map((item) => item.title))).toEqual(['X', 'All decisions', 'Workstreams']);
  });

  it('nav.json lists the Workstreams page', async () => {
    const { default: navFile } = await import('../nav.json');
    const items: unknown[] = navFile.sections.flatMap((section) => section.items as unknown[]);
    expect(items).toContainEqual({ page: WORKSTREAMS_PATH, title: 'Workstreams' });
  });
});

describe('the data layer switch in api.ts', () => {
  it('local: getPanel asks the local server', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true, data: { fromLocal: true }, updatedAt: '2026-10-12T12:00:00.000Z' }), { status: 200 });
    });
    const api = await import('../src/web/api');
    const panel = await api.getPanel<{ fromLocal: boolean }>('/api/github');
    expect(panel).toMatchObject({ ok: true, data: { fromLocal: true } });
    expect(calls).toEqual(['/api/github']);
  });

  it('hosted: getPanel answers from /api/snapshot and never asks for /api/github', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const body = url === '/api/snapshot' ? snapshot() : liveAnswer('not-running');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const api = await import('../src/web/api');
    const panel = await api.getPanel<{ open: unknown[] }>('/api/github');
    expect(panel).toMatchObject({ ok: true, data: { open: [] } });
    expect(calls).toEqual(['/api/snapshot']);
    // The health reply has no endpoint: it is made on the page.
    const health = await api.loadHealthPanel();
    expect(health).toMatchObject({ ok: true, data: { githubRepo: HOSTED_REPO } });
    expect(calls).toEqual(['/api/snapshot']);
  });

  it('hosted: subscribeEvents is told the connection and the changed modules by the store, not by an event stream', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    class NoEventSource {
      constructor() {
        throw new Error('the hosted page must not open /api/events');
      }
    }
    vi.stubGlobal('EventSource', NoEventSource);
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url === '/api/snapshot' ? snapshot() : liveAnswer('not-running')), { status: 200 }));
    const api = await import('../src/web/api');
    const seen: string[] = [];
    const stop = api.subscribeEvents((event) => seen.push(event.type === 'changed' ? `changed:${event.event.module}` : event.type === 'connection' ? `connection:${event.state}` : event.type));
    await vi.waitFor(() => expect(seen).toContain('connection:live'));
    expect(seen).toContain('changed:github');
    expect(seen).toContain('changed:agents');
    stop();
  });
});

describe('the pages that change with the flag', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('local: the Workstreams link is not in the navigation, and the route says the hosted page has the view', async () => {
    const { WorkstreamsNavLink } = await import('../src/web/workstreams/WorkstreamsNavLink');
    const { LocalWorkstreams } = await import('../src/web/workstreams/LocalWorkstreams');
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkstreamsNavLink />
          <LocalWorkstreams />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('a[href="/workstreams"]')).toBeNull();
    expect(container.textContent).toContain('The hosted page has this view');
  });

  it('hosted: the Workstreams link is in the navigation', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    const { WorkstreamsNavLink } = await import('../src/web/workstreams/WorkstreamsNavLink');
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkstreamsNavLink />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('a[href="/workstreams"]')?.textContent).toBe('Workstreams');
  });
});
