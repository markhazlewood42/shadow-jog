// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsLive, Panel } from '../src/shared/types';
import type { ServerEvent } from '../src/web/api';
import { MIN, NOW, SEC, ago, live, liveNode, liveSession, liveWorkflow } from './agents-diagram-helpers';

// The Agents page as a whole (heading, panel, diagram), over a made-up connection: `getPanel` answers what a test says, and the event stream is a function that the test
// calls. The page reads GET /api/agents and reloads on an event of the module "agents". The run times move on a clock of their own, which a fake clock drives here.
// How the page looks in a real browser is the job of e2e/agents.spec.ts.

const api = vi.hoisted(() => ({ getPanel: vi.fn(), listeners: new Set<(event: ServerEvent) => void>() }));
vi.mock('../src/web/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/web/api')>()),
  getPanel: api.getPanel,
  subscribeEvents: (listener: (event: ServerEvent) => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));

import { AgentsPage } from '../src/web/agents/AgentsPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const ok = (data: AgentsLive): Panel<AgentsLive> => ({ ok: true, data, updatedAt: new Date(NOW).toISOString() });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  api.getPanel.mockReset();
  api.listeners.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** Opens the page and lets the first load finish. */
async function openPage(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/agents']}>
        <AgentsPage />
      </MemoryRouter>,
    );
  });
}

/** Says to the page that the server sent an event. */
const send = (event: ServerEvent) => act(async () => void [...api.listeners].forEach((listener) => listener(event)));
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const sessionDetail = () => container.querySelector('[data-box="session"] [data-part="detail"]')?.textContent?.replace(/\s+/g, ' ').trim();

describe('the Agents page', () => {
  it('reads the live agents and draws the heading, the panel and the diagram, with no sentence of its own', async () => {
    api.getPanel.mockResolvedValue(ok(live([liveSession('s1', { title: 'Build the page', nodes: [liveNode('a', { label: 'Explore' })] })])));
    await openPage();

    expect(api.getPanel).toHaveBeenCalledExactlyOnceWith('/api/agents');
    expect(document.title).toBe('Agents · Shadow Jog Command Center');
    expect(container.querySelector('h1')?.textContent).toBe('Agents');
    const panel = container.querySelector('section[aria-label="Agents"]');
    expect(panel?.querySelector('h2')?.textContent).toBe('Agents');
    expect(panel?.querySelectorAll('[data-cluster]')).toHaveLength(1);
    // The page has no paragraph: the heading, the panel's own header and the diagram are all that it holds while the sources are good.
    const paragraphs = [...container.querySelectorAll('p')].map((paragraph) => paragraph.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(paragraphs.filter((text) => !text.startsWith('Updated '))).toEqual([]);
    // The top bar leads to the other pages, and marks this one.
    expect(container.querySelector('nav a[aria-current="page"]')?.textContent).toBe('Agents');
  });

  it('moves the run times on every 15 seconds, between two loads of the data, and asks the server for nothing', async () => {
    // The session began 12 min 50 s ago: its run time says "13 min" 10 seconds from now. The ticker is 15 seconds, so the change shows at 15 s, and not before.
    api.getPanel.mockResolvedValue(ok(live([liveSession('s1', { startedAt: ago(12 * MIN + 50 * SEC) })])));
    await openPage();
    expect(sessionDetail()).toBe('working · 12 min');
    await advance(14 * SEC);
    expect(sessionDetail()).toBe('working · 12 min');
    await advance(SEC);
    expect(sessionDetail()).toBe('working · 13 min');
    // The clock goes on, and no request is made for it.
    await advance(46 * SEC);
    expect(sessionDetail()).toBe('working · 13 min');
    await advance(15 * SEC);
    expect(sessionDetail()).toBe('working · 14 min');
    expect(api.getPanel).toHaveBeenCalledTimes(1);
  });

  it('loads the diagram again when the agents change, and not when another module does', async () => {
    api.getPanel.mockResolvedValueOnce(ok(live([liveSession('s1', { title: 'First title' })])));
    await openPage();
    expect(container.querySelector('[data-part="title"]')?.textContent).toBe('First title');

    // Another module changed: the page does not load.
    await send({ type: 'changed', event: { module: 'sessions', at: new Date(NOW).toISOString() } });
    expect(api.getPanel).toHaveBeenCalledTimes(1);

    // The agents changed: the page loads again, and draws the new data.
    api.getPanel.mockResolvedValueOnce(ok(live([liveSession('s1', { title: 'First title' }), liveSession('s2', { title: 'Second title' })])));
    await send({ type: 'changed', event: { module: 'agents', at: new Date(NOW).toISOString() } });
    expect(api.getPanel).toHaveBeenCalledTimes(2);
    expect([...container.querySelectorAll('[data-box="session"] [data-part="title"]')].map((title) => title.textContent)).toEqual(['First title', 'Second title']);
  });

  it('shows the error of a load that fails above the last good diagram, with a Retry button', async () => {
    api.getPanel.mockResolvedValueOnce(ok(live([liveSession('s1', { title: 'A session that was drawn' })])));
    await openPage();

    api.getPanel.mockResolvedValueOnce({ ok: false, error: { code: 'agents-failed', message: 'The server cannot read the live sessions (EACCES).' }, updatedAt: null, lastGood: null });
    await send({ type: 'hello' });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The server cannot read the live sessions (EACCES).');
    expect(alert?.querySelector('button')?.textContent).toContain('Retry');
    // The diagram of the last good load is still there, under the error.
    expect(container.querySelector('[data-part="title"]')?.textContent).toBe('A session that was drawn');
    expect(container.textContent).toContain('Last good data');

    // Retry loads again, and the error goes.
    api.getPanel.mockResolvedValueOnce(ok(live([liveSession('s1', { title: 'A session that was drawn' })])));
    await act(async () => (alert?.querySelector('button') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('Last good data');
  });

  it('each Copy button copies the file of its own box, and a box with no file has no button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    api.getPanel.mockResolvedValue(
      ok(
        live([
          liveSession('s1', {
            filePath: '/fixture/session-one.jsonl',
            nodes: [liveNode('a1', { filePath: '/fixture/agent-one.jsonl' }), liveWorkflow('w1', { filePath: '/fixture/journal-one.jsonl' }), liveWorkflow('w2', { filePath: null })],
          }),
        ]),
      ),
    );
    await openPage();

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy path"]')];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) await act(async () => button.click());
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(['/fixture/session-one.jsonl', '/fixture/agent-one.jsonl', '/fixture/journal-one.jsonl']);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shows the labels and the empty state from the data', async () => {
    api.getPanel.mockResolvedValue(ok(live([], { source: 'file-age', hiddenScripts: 1 })));
    await openPage();
    const labels = [...container.querySelectorAll('section[aria-label="Agents"] p')].map((paragraph) => paragraph.textContent?.replace(/\s+/g, ' ').trim()).filter((text) => !text?.startsWith('Updated'));
    expect(labels).toEqual(['1 script run hidden', 'Process list unavailable', 'No active session']);
    expect(container.querySelector('[data-cluster]')).toBeNull();
  });
});
