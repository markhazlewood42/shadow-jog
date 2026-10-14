// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveState } from '../fixtures/hosted/world';
import { Diagram } from '../src/web/agents/Diagram';
import { agentsOf } from '../src/web/hosted/panels';
import { MIN, NOW, ago } from './agents-diagram-helpers';

// The agent boxes of the hosted Agents page: the rows of the reporter go through agentsOf and the same Diagram that the local page uses.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const row = (id: string, agents: Record<string, unknown>) =>
  ({ id, title: `Session ${id}`, branch: 'b', folder: 'f', state: 'working', startedAt: ago(30 * MIN), agents, yourMove: null }) as never;

async function draw(sessions: unknown[]): Promise<void> {
  const live = agentsOf(liveState({ sessions: sessions as never }));
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Diagram live={live} nowMs={NOW} />
      </MemoryRouter>,
    );
  });
}

const boxes = () => [...container.querySelectorAll('[data-box="agent"]')];
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim();

describe('agent boxes on the hosted page', () => {
  it('draws one box for each item, with the label, the state, the model and the run time', async () => {
    await draw([
      row('s1', {
        running: 1,
        done: 1,
        names: ['Build the page', 'Read the docs'],
        items: [
          { label: 'Build the page', state: 'running', model: 'sonnet', startedAt: ago(3 * MIN), endedAt: null },
          { label: 'Read the docs', state: 'done', model: 'fable', startedAt: ago(20 * MIN), endedAt: ago(10 * MIN) },
        ],
      }),
    ]);
    const found = boxes();
    expect(found).toHaveLength(2);
    // In order of start: the older, done agent first.
    expect(text(found[0]?.querySelector('[data-part="title"]'))).toBe('Read the docs');
    expect(found[0]?.getAttribute('data-state')).toBe('done');
    expect(text(found[0]?.querySelector('[data-part="detail"]'))).toBe('fable · done');
    expect(text(found[1]?.querySelector('[data-part="title"]'))).toBe('Build the page');
    expect(found[1]?.getAttribute('data-state')).toBe('running');
    expect(text(found[1]?.querySelector('[data-part="detail"]'))).toBe('sonnet · 3 min');
  });

  it('shows a label with markup as text, never as html, and draws no Copy button', async () => {
    await draw([row('s1', { running: 1, done: 0, names: [], items: [{ label: '<img src=x onerror=alert(1)>', state: 'running', model: null, startedAt: null, endedAt: null }] })]);
    expect(container.querySelector('img')).toBeNull();
    expect(text(boxes()[0]?.querySelector('[data-part="title"]'))).toBe('<img src=x onerror=alert(1)>');
    expect(boxes()[0]?.querySelector('button')).toBeNull();
  });

  it('draws the names with their state from the counts when the reporter sends no items', async () => {
    await draw([row('s1', { running: 1, done: 1, names: ['runner', 'reader'] })]);
    expect(boxes().map((box) => [text(box.querySelector('[data-part="title"]')), box.getAttribute('data-state')])).toEqual([
      ['runner', 'running'],
      ['reader', 'done'],
    ]);
  });

  it('draws no agent box for a session with no agents', async () => {
    await draw([row('s1', { running: 0, done: 0, names: [], items: [] })]);
    expect(container.querySelectorAll('[data-box="session"]')).toHaveLength(1);
    expect(boxes()).toHaveLength(0);
  });
});
