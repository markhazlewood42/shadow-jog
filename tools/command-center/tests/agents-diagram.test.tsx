// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AgentsLive } from '../src/shared/types';
import { agentDetail, messagesText, runTimeText, sessionDetail, workflowChip } from '../src/web/agents/boxText';
import { Diagram } from '../src/web/agents/Diagram';
import { MIN, NOW, SEC, ago, kids, live, liveNode, liveSession, liveWorkflow } from './agents-diagram-helpers';

// The Agents diagram, drawn once into a document and asked with selectors (no server and no browser). The diagram is a plain function of the live data and of the clock, so
// these tests fix both. How it looks, moves and reacts in a real browser is the job of e2e/agents.spec.ts.

/** The diagram drawn into a document, so that a test can ask the document and not match text. A link needs a router around it, as it has in the app. */
function draw(data: AgentsLive, nowMs: number = NOW): HTMLElement {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <Diagram live={data} nowMs={nowMs} />
    </MemoryRouter>,
  );
  return new DOMParser().parseFromString(markup, 'text/html').body;
}

const clusters = (host: HTMLElement): Element[] => [...host.querySelectorAll('[data-cluster]')];
/** The text of an element, with its white space made plain. */
const textOf = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The box with this title (the name of its group). */
function boxOf(host: HTMLElement, title: string): Element {
  const found = [...host.querySelectorAll('[role="group"]')].find((group) => group.querySelector('[data-part="title"]')?.textContent === title);
  if (found === undefined) throw new Error(`No box titled ${title}.`);
  return found;
}
const detailOf = (box: Element): string => textOf(box.querySelector('[data-part="detail"]'));
const titleClasses = (box: Element): string[] => (box.querySelector('[data-part="title"]')?.className ?? '').split(/\s+/);

describe('the text of a box', () => {
  it('run time is in seconds, minutes, or hours and minutes, and absent when the start is not known', () => {
    expect(runTimeText(ago(45 * SEC), NOW)).toBe('45 s');
    expect(runTimeText(ago(12 * MIN), NOW)).toBe('12 min');
    expect(runTimeText(ago(65 * MIN), NOW)).toBe('1 h 5 min');
    expect(runTimeText(null, NOW)).toBeNull();
    expect(runTimeText('not a time', NOW)).toBeNull();
    // A start that is ahead of the clock (two clocks that differ a little) is 0, never a negative length.
    expect(runTimeText(new Date(NOW + 5 * SEC).toISOString(), NOW)).toBe('0 s');
  });

  it('a session says its state word and how long it ran', () => {
    expect(sessionDetail(liveSession('s1', { state: 'working', startedAt: ago(30 * MIN) }), NOW)).toBe('working · 30 min');
    expect(sessionDetail(liveSession('s1', { state: 'waiting', startedAt: ago(125 * MIN) }), NOW)).toBe('waiting · 2 h 5 min');
    expect(sessionDetail(liveSession('s1', { state: 'working', startedAt: null }), NOW)).toBe('working');
  });

  it('an agent says its model and how long it runs, or its model and done', () => {
    expect(agentDetail(liveNode('a', { model: 'fable', startedAt: ago(12 * MIN) }), NOW)).toBe('fable · 12 min');
    // A finished agent shows "done" and no time: its length is no longer growing, and the box says so.
    expect(agentDetail(liveNode('a', { model: 'sonnet', state: 'done', endedAt: ago(MIN) }), NOW)).toBe('sonnet · done');
    // No model is no word, and not a guess.
    expect(agentDetail(liveNode('a', { model: null, startedAt: ago(90 * SEC) }), NOW)).toBe('1 min');
    expect(agentDetail(liveNode('a', { model: null, state: 'done' }), NOW)).toBe('done');
    expect(agentDetail(liveNode('a', { model: 'sonnet', startedAt: null }), NOW)).toBe('sonnet');
  });

  it('a workflow chip is the phase and the agents done of the agents started', () => {
    expect(workflowChip(liveWorkflow('w', { progress: { phase: 'Build', done: 2, started: 3 } }))).toBe('Build · 2 of 3');
    expect(workflowChip(liveWorkflow('w', { progress: { phase: null, done: 0, started: 0 } }))).toBe('0 of 0');
    expect(workflowChip(liveNode('a'))).toBe('');
  });

  it('a count of messages is a number, with a plus when it may be short', () => {
    expect(messagesText({ count: 0, approximate: false })).toBeNull();
    expect(messagesText({ count: 0, approximate: true })).toBeNull();
    expect(messagesText({ count: 1, approximate: false })).toBe('1 message');
    expect(messagesText({ count: 2, approximate: false })).toBe('2 messages');
    expect(messagesText({ count: 3, approximate: true })).toBe('3+ messages');
  });
});

describe('the Agents diagram', () => {
  it('draws one cluster for each session, in the order of the data', () => {
    // The second session is older and its id sorts first: a page that sorted by age or by id would put it elsewhere.
    const host = draw(live([liveSession('s-b', { startedAt: ago(10 * MIN) }), liveSession('s-a', { startedAt: ago(50 * MIN) }), liveSession('s-c', { startedAt: ago(5 * MIN) })]));
    expect(clusters(host).map((cluster) => cluster.getAttribute('data-cluster'))).toEqual(['s-b', 's-a', 's-c']);
    // One SVG layer for each cluster (the icons of the boxes are SVG too, so the layer is found by its mark).
    expect(host.querySelectorAll('svg[data-lines]')).toHaveLength(3);
  });

  it('a session box shows its title, its state word with a dot, and its run time', () => {
    const host = draw(
      live([
        liveSession('s1', { title: 'Build the page', state: 'working', startedAt: ago(30 * MIN) }),
        liveSession('s2', { title: 'Review the docs', state: 'waiting', startedAt: ago(125 * MIN) }),
        liveSession('s3', { title: 'No start known', state: 'working', startedAt: null }),
      ]),
    );
    const working = boxOf(host, 'Build the page');
    expect(working.getAttribute('data-box')).toBe('session');
    expect(working.getAttribute('data-state')).toBe('working');
    expect(detailOf(working)).toBe('working · 30 min');
    // The dot: filled for a session that works, outlined for one that waits. It is decoration: the state is also a word.
    expect(working.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('filled');
    expect(working.querySelector('[data-dot]')?.getAttribute('aria-hidden')).toBe('true');
    const waiting = boxOf(host, 'Review the docs');
    expect(detailOf(waiting)).toBe('waiting · 2 h 5 min');
    expect(waiting.getAttribute('data-state')).toBe('waiting');
    expect(waiting.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('outlined');
    expect(detailOf(boxOf(host, 'No start known'))).toBe('working');
    // A session box has the anchor id that the links of "Your move" use.
    expect(working.closest('[data-cluster]')?.id).toBe('session-s1');
  });

  it('every box has one title line and one detail line, and the size of its kind', () => {
    const host = draw(live([liveSession('s1', { nodes: [liveNode('a'), liveWorkflow('w')] })]));
    for (const box of host.querySelectorAll('[role="group"]')) {
      expect(box.querySelectorAll('[data-part="title"]')).toHaveLength(1);
      expect(box.querySelectorAll('[data-part="detail"]')).toHaveLength(1);
    }
    const sizes = [...host.querySelectorAll<HTMLElement>('[role="group"]')].map((box) => [box.getAttribute('data-box'), box.style.width, box.style.height]);
    expect(sizes).toEqual([
      ['session', '240px', '52px'],
      ['agent', '216px', '44px'],
      ['workflow', '216px', '44px'],
    ]);
  });

  it('an agent box shows its label, model and run time, and a finished agent shows done and is dimmed', () => {
    const host = draw(
      live([
        liveSession('s1', {
          nodes: [
            liveNode('a1', { label: 'Explore the docs', model: 'fable', startedAt: ago(12 * MIN) }),
            liveNode('a2', { label: 'Check the table', model: 'sonnet', state: 'done', endedAt: ago(2 * MIN) }),
          ],
        }),
      ]),
    );
    const running = boxOf(host, 'Explore the docs');
    expect(running.getAttribute('data-box')).toBe('agent');
    expect(running.getAttribute('data-state')).toBe('running');
    expect(detailOf(running)).toBe('fable · 12 min');
    const done = boxOf(host, 'Check the table');
    expect(done.getAttribute('data-state')).toBe('done');
    expect(detailOf(done)).toBe('sonnet · done');
    // The dimming is the look of the inner element: a quieter frame and quieter text, from the tokens, and never an opacity (text on a faded box would fall below 4.5 to 1).
    const look = (box: Element) => (box.firstElementChild?.className ?? '').split(/\s+/);
    expect(look(running)).toContain('border-cc-rule-solid');
    expect(look(done)).toContain('border-cc-rule');
    expect(look(done)).not.toContain('border-cc-rule-solid');
    expect(titleClasses(done)).toContain('text-cc-muted');
    expect(titleClasses(running)).toContain('text-cc-ink');
    expect(look(done).some((name) => name.includes('opacity'))).toBe(false);
  });

  it('a workflow box shows its name and one progress chip, and has no Copy button without a file', () => {
    const host = draw(
      live([
        liveSession('s1', {
          nodes: [
            liveWorkflow('w1', { label: 'fixture-build', progress: { phase: 'Build', done: 2, started: 3 } }),
            liveWorkflow('w2', { label: 'no-phase', progress: { phase: null, done: 1, started: 4 }, filePath: null }),
          ],
        }),
      ]),
    );
    const one = boxOf(host, 'fixture-build');
    expect(one.getAttribute('data-box')).toBe('workflow');
    expect(detailOf(one)).toBe('Build · 2 of 3');
    expect(one.querySelector('[data-part="detail"] [data-chip]')).not.toBeNull();
    expect(one.querySelector('button[aria-label="Copy path"]')).not.toBeNull();
    const two = boxOf(host, 'no-phase');
    expect(detailOf(two)).toBe('1 of 4');
    expect(two.querySelector('button')).toBeNull();
  });

  it('every box with a file has a Copy button named Copy path', () => {
    const host = draw(live([liveSession('s1', { nodes: [liveNode('a')] })]));
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBe('Copy path');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('cuts a long title with an ellipsis and keeps the whole text in its title attribute', () => {
    const long = 'A very long task label that cannot fit in a box of two hundred and sixteen pixels and must be cut';
    const host = draw(live([liveSession('s1', { title: long, nodes: [liveNode('a', { label: long })] })]));
    for (const title of host.querySelectorAll('[data-part="title"]')) {
      expect(title.getAttribute('title')).toBe(long);
      expect(title.className).toContain('truncate');
      expect(title.textContent).toBe(long);
    }
  });

  it('shows the words of a session file as text, never as markup', () => {
    const host = draw(live([liveSession('s1', { title: '<b>Bold</b> title', nodes: [liveNode('a', { label: '<img src=x onerror=alert(1)> task' })] })]));
    expect(boxOf(host, '<b>Bold</b> title')).toBeTruthy();
    expect(boxOf(host, '<img src=x onerror=alert(1)> task')).toBeTruthy();
    expect(host.querySelector('b, img, script')).toBeNull();
  });

  it('shows 12 children and a plain label for the rest', () => {
    const host = draw(live([liveSession('s1', { nodes: kids(15) })]));
    expect(host.querySelectorAll('[data-box="agent"]')).toHaveLength(12);
    const more = host.querySelectorAll('[data-more]');
    expect(more).toHaveLength(1);
    expect(textOf(more[0])).toBe('+3 more');
    // A plain label: not a button, not a link, not in the tab order.
    expect(more[0]?.tagName).toBe('SPAN');
    expect(more[0]?.querySelector('button, a')).toBeNull();
    expect(more[0]?.closest('button, a')).toBeNull();
    expect(more[0]?.hasAttribute('tabindex')).toBe(false);
  });

  it('draws one trunk for each parent, one spawn line for each box, and a message line with its count only when messages passed', () => {
    const messages = (count: number, approximate = false) => ({ messages: { count, approximate } });
    const host = draw(live([liveSession('s1', { nodes: [liveNode('a', messages(0)), liveNode('b', messages(2)), liveNode('c', { parentId: 'b', ...messages(7, true) })] })]));
    const paths = (kind: string) => [...host.querySelectorAll(`path[data-line="${kind}"]`)];
    expect(paths('trunk').map((path) => path.getAttribute('data-owner'))).toEqual(['s1', 'b']);
    expect(paths('spawn').map((path) => path.getAttribute('data-owner'))).toEqual(['a', 'b', 'c']);
    expect(paths('messages').map((path) => path.getAttribute('data-owner'))).toEqual(['b', 'c']);
    // The counts are on the message lines: "2", and "7+" for a count that may be short. There is no count at 0, and no message text.
    expect([...host.querySelectorAll('[data-count]')].map((label) => [label.getAttribute('data-count'), textOf(label)])).toEqual([
      ['b', '2'],
      ['c', '7+'],
    ]);
    // A spawn line ends in an arrow; the trunk and the message line do not. A message line is dashed.
    const marker = host.querySelector('marker');
    expect(marker?.id).toBeTruthy();
    for (const path of paths('spawn')) expect(path.getAttribute('marker-end')).toBe(`url(#${marker?.id})`);
    for (const path of [...paths('trunk'), ...paths('messages')]) expect(path.hasAttribute('marker-end')).toBe(false);
    for (const path of paths('messages')) expect(path.getAttribute('stroke-dasharray')).toBeTruthy();
    for (const path of [...paths('trunk'), ...paths('spawn')]) expect(path.hasAttribute('stroke-dasharray')).toBe(false);
    // Every path has a real path: no NaN.
    for (const path of host.querySelectorAll('path[data-line]')) expect(path.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
  });

  it('the lines are one SVG layer behind the boxes: hidden from a screen reader and out of the way of the pointer', () => {
    const host = draw(live([liveSession('s1', { nodes: kids(2) })]));
    const svg = host.querySelector('svg[data-lines]');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain('pointer-events-none');
    // The SVG comes before the boxes in the cluster, so that the boxes are drawn over it, and the boxes are HTML (no box is inside the SVG).
    const stage = host.querySelector('[data-cluster] > div');
    expect(stage?.firstElementChild).toBe(svg);
    expect(svg?.querySelector('foreignObject, [role="group"]')).toBeNull();
    expect(stage?.querySelectorAll(':scope > [role="group"]')).toHaveLength(3);
  });

  it('shows the labels above the diagram, and the empty state when no session is live', () => {
    const labels = (host: HTMLElement) => [...host.querySelectorAll('p')].map((label) => textOf(label));
    expect(labels(draw(live([liveSession('s1')])))).toEqual([]);
    expect(labels(draw(live([liveSession('s1')], { source: 'file-age' })))).toEqual(['Process list unavailable']);
    expect(labels(draw(live([liveSession('s1')], { hiddenScripts: 1 })))).toEqual(['1 script run hidden']);
    expect(labels(draw(live([liveSession('s1')], { hiddenScripts: 3 })))).toEqual(['3 script runs hidden']);
    expect(labels(draw(live([liveSession('s1')], { hiddenScripts: 3, source: 'file-age' })))).toEqual(['3 script runs hidden', 'Process list unavailable']);

    const empty = draw(live([]));
    expect(labels(empty)).toEqual(['No active session']);
    expect(clusters(empty)).toEqual([]);
    expect(empty.querySelector('ul')).toBeNull();
    expect(labels(draw(live([], { source: 'file-age', hiddenScripts: 2 })))).toEqual(['2 script runs hidden', 'Process list unavailable', 'No active session']);
  });

  it('sizes the columns of the grid by the widest cluster, at 352 pixels at the least', () => {
    const columns = (host: HTMLElement) => host.querySelector('[data-cluster]')?.parentElement?.getAttribute('style');
    expect(columns(draw(live([liveSession('s1', { nodes: kids(3) })])))).toContain('grid-template-columns:repeat(auto-fill, minmax(min(352px, 100%), 1fr))');
    // A chain of five agents that each started the next is 5 levels of 56 pixels and a box of 216, which is 496 pixels: every column is as wide as it.
    const chain = [liveNode('c1', { parentId: 's2' }), liveNode('c2', { parentId: 'c1' }), liveNode('c3', { parentId: 'c2' }), liveNode('c4', { parentId: 'c3' }), liveNode('c5', { parentId: 'c4' })];
    expect(columns(draw(live([liveSession('s1'), liveSession('s2', { nodes: chain })])))).toContain('minmax(min(496px, 100%), 1fr)');
  });

  it('the run times follow the clock they are given', () => {
    const data = live([liveSession('s1', { startedAt: ago(12 * MIN + 50 * SEC), nodes: [liveNode('a', { startedAt: ago(40 * SEC) })] })]);
    expect(detailOf(boxOf(draw(data, NOW), 'Title of s1'))).toBe('working · 12 min');
    expect(detailOf(boxOf(draw(data, NOW + 15 * SEC), 'Title of s1'))).toBe('working · 13 min');
    expect(detailOf(boxOf(draw(data, NOW), 'Label of a'))).toBe('sonnet · 40 s');
    expect(detailOf(boxOf(draw(data, NOW + 30 * SEC), 'Label of a'))).toBe('sonnet · 1 min');
  });
});

describe('the text list under the diagram', () => {
  const list = (host: HTMLElement) => host.querySelector('ul[aria-label="Sessions and agents"]');

  it('names every session and every agent in text, with the state and the time', () => {
    const host = draw(
      live([
        liveSession('s1', { title: 'Build the page', nodes: [liveNode('a', { label: 'Explore the docs', model: 'fable', startedAt: ago(12 * MIN) }), liveNode('b', { label: 'Check the table', state: 'done', model: 'sonnet' }), liveWorkflow('w', { label: 'fixture-build' })] }),
        liveSession('s2', { title: 'Review the docs', state: 'waiting', startedAt: ago(125 * MIN) }),
      ]),
    );
    const items = [...(list(host)?.querySelectorAll('li') ?? [])].map((item) => textOf(item.firstElementChild));
    expect(items).toEqual([
      'Build the page, working, 30 min',
      'Explore the docs, fable, running, 12 min',
      'Check the table, sonnet, done',
      'fixture-build, workflow, running, Build · 2 of 3',
      'Review the docs, waiting, 2 h 5 min',
    ]);
    // It is hidden from the eye, and not from a screen reader or a test.
    expect(list(host)?.className).toContain('sr-only');
  });

  it('names an agent that started another agent under its parent, and every agent past the limit of 12', () => {
    const host = draw(live([liveSession('s1', { title: 'Many', nodes: [liveNode('p', { label: 'Parent agent' }), liveNode('c', { parentId: 'p', label: 'Nested agent' }), ...kids(14)] })]));
    const root = list(host);
    // The nested agent is in a list inside the item of its parent.
    const parent = [...(root?.querySelectorAll('li') ?? [])].find((item) => textOf(item.firstElementChild).startsWith('Parent agent'));
    expect(parent?.querySelectorAll(':scope > ul > li')).toHaveLength(1);
    expect(textOf(parent?.querySelector(':scope > ul > li'))).toContain('Nested agent');
    // 14 agents past the limit are all named, though the diagram draws 12 of them.
    for (let i = 1; i <= 14; i += 1) expect(textOf(root)).toContain(`Label of k${i},`);
    expect(host.querySelectorAll('[data-box="agent"]')).toHaveLength(2 + 12 - 1);
  });

  it('adds how many messages passed', () => {
    const host = draw(live([liveSession('s1', { nodes: [liveNode('a', { label: 'Talks', messages: { count: 3, approximate: true } }), liveNode('b', { label: 'Quiet' })] })]));
    const items = [...(list(host)?.querySelectorAll('li') ?? [])].map((item) => textOf(item.firstElementChild));
    expect(items[1]).toBe('Talks, sonnet, running, 5 min, 3+ messages');
    expect(items[2]).toBe('Quiet, sonnet, running, 5 min');
  });

  it('is not drawn when no session is live', () => {
    expect(list(draw(live([])))).toBeNull();
  });
});
