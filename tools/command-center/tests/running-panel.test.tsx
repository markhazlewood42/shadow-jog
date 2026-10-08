// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AgentsLive, LiveNode, LiveSession } from '../src/shared/types';
import { RunningList } from '../src/web/now/RunningPanel';

// The list of the Running panel: the Claude sessions that are alive now (design 5.1, revision 2), from `GET /api/agents`. The list is a plain function of that
// data and of the clock, so these tests draw it once into a document and ask the document, with no server and no browser. How the panel looks and updates in a
// browser is the job of e2e/now.spec.ts.

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function liveNode(id: string, extra: Partial<LiveNode> = {}): LiveNode {
  return { id, parentId: 's1', kind: 'agent', label: `Label of ${id}`, model: 'sonnet', state: 'running', startedAt: ago(5 * MIN), endedAt: null, filePath: `/fixture/${id}.jsonl`, messages: { count: 0, approximate: false }, ...extra };
}

function liveSession(id: string, extra: Partial<LiveSession> = {}): LiveSession {
  return { id, title: `Title of ${id}`, state: 'working', startedAt: ago(30 * MIN), filePath: `/fixture/${id}.jsonl`, nodes: [], ...extra };
}

const live = (sessions: LiveSession[], extra: Partial<AgentsLive> = {}): AgentsLive => ({ sessions, hiddenScripts: 0, source: 'process-list', ...extra });

/** The list drawn into a document, so that a test can ask the document and not match text. A link needs a router around it, as it has in the app. */
function draw(data: AgentsLive): HTMLElement {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <RunningList live={data} now={NOW} />
    </MemoryRouter>,
  );
  return new DOMParser().parseFromString(markup, 'text/html').body;
}

/** The text of each label (paragraph) of the list, in order. */
const labels = (host: HTMLElement): (string | null)[] => [...host.querySelectorAll('p')].map((label) => label.textContent);

/** The text of each row, the way a person reads it: the pieces of the row with one space between them. */
const rowTexts = (host: HTMLElement): string[] => [...host.querySelectorAll('ul > li')].map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('the Running panel', () => {
  it('running panel lists active sessions and links to the agents page', () => {
    const host = draw(
      live([
        // The first session has an agent and a workflow. They are not rows: the Agents page draws them.
        liveSession('s1', {
          title: 'Build the Now page',
          state: 'working',
          startedAt: ago(30 * MIN),
          nodes: [liveNode('a1'), liveNode('wf_1', { kind: 'workflow', label: 'fixture-build', progress: { phase: 'Build', done: 2, started: 3 } })],
        }),
        liveSession('s2', { title: 'Review the engine docs', state: 'waiting', startedAt: ago(125 * MIN) }),
        // The title is transcript text: its markup characters are characters, and not a tag.
        liveSession('s3', { title: 'Third <b>session</b>', state: 'working', startedAt: ago(45_000) }),
      ]),
    );

    // One row for each session, in the order that the API gives: the title, the state word and the time since the start. The sessions are not sorted again: the
    // second one started first and the third last, and the rows stand in the order that the API gave.
    expect(host.querySelector('ul')?.getAttribute('aria-label')).toBe('Active sessions');
    expect(rowTexts(host)).toEqual(['Build the Now page working 30 min', 'Review the engine docs waiting 2 h 5 min', 'Third <b>session</b> working 45 s']);
    expect(host.querySelector('b')).toBeNull();

    // The whole row is a link to the Agents page, and it is an address of this site, so the router follows it without loading a new page.
    const rows = [...host.querySelectorAll('ul > li')];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const link = row.firstElementChild;
      expect(link?.tagName).toBe('A');
      expect(link?.getAttribute('href')).toBe('/agents');
      expect(link?.hasAttribute('target')).toBe(false);
      // Nothing of the row stands outside the link.
      expect(link?.textContent).toBe(row.textContent);
      expect(row.children).toHaveLength(1);
    }

    // No agent row, no workflow row, and no bar: a session is one row.
    expect(host.textContent).not.toContain('Label of a1');
    expect(host.textContent).not.toContain('fixture-build');
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    // Nothing is a sentence: the list has no paragraph while the sources are good and nothing is hidden.
    expect(labels(host)).toEqual([]);
  });

  it('running panel shows the hidden runs label', () => {
    const sessions = [liveSession('s1')];
    // One run: the singular. More: the plural.
    expect(labels(draw(live(sessions, { hiddenScripts: 1 })))).toEqual(['1 script run hidden']);
    expect(labels(draw(live(sessions, { hiddenScripts: 2 })))).toEqual(['2 script runs hidden']);
    expect(labels(draw(live(sessions, { hiddenScripts: 12 })))).toEqual(['12 script runs hidden']);
    // None: no label at all.
    expect(labels(draw(live(sessions, { hiddenScripts: 0 })))).toEqual([]);
    expect(draw(live(sessions, { hiddenScripts: 0 })).textContent).not.toMatch(/script run/);
    // The count shows with no session too (all the live sessions may be runs of a script), under the empty state.
    expect(labels(draw(live([], { hiddenScripts: 3 })))).toEqual(['No active session', '3 script runs hidden']);
    // The rows are the same with and without the label.
    expect(rowTexts(draw(live(sessions, { hiddenScripts: 2 })))).toEqual(rowTexts(draw(live(sessions))));
  });

  it('running panel shows the empty state and the fallback label', () => {
    // No session: one label, and no list.
    const empty = draw(live([]));
    expect(labels(empty)).toEqual(['No active session']);
    expect(empty.querySelector('ul')).toBeNull();

    // The process list cannot be read, so the file ages decided: the label says so, under the empty state.
    const fallback = draw(live([], { source: 'file-age' }));
    expect(labels(fallback)).toEqual(['No active session', 'Process list unavailable']);
    expect(fallback.querySelector('ul')).toBeNull();

    // The label shows with rows too, and the empty state does not.
    const withRows = draw(live([liveSession('s1')], { source: 'file-age' }));
    expect(rowTexts(withRows)).toEqual(['Title of s1 working 30 min']);
    expect(labels(withRows)).toEqual(['Process list unavailable']);

    // The two labels together, in this order: the runs that a script started, then the state of the source.
    expect(labels(draw(live([liveSession('s1')], { source: 'file-age', hiddenScripts: 1 })))).toEqual(['1 script run hidden', 'Process list unavailable']);
  });

  it('leaves out the run time of a session whose start is not known, and keeps the row', () => {
    const host = draw(live([liveSession('s1', { startedAt: null }), liveSession('s2', { startedAt: 'not a time' })]));
    expect(rowTexts(host)).toEqual(['Title of s1 working', 'Title of s2 working']);
    for (const link of host.querySelectorAll('li > a')) expect(link.getAttribute('href')).toBe('/agents');
  });
});
