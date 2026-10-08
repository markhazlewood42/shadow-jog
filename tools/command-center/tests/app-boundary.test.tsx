// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One page of the app that throws while it renders must show an error and leave the other pages working. The pages are replaced here by small stand-ins, so the test
// is about the boundary around the routes in App and nothing else. How the error looks in a real browser is the job of e2e/now.spec.ts.

vi.mock('../src/web/agents/AgentsPage', () => ({
  AgentsPage: () => {
    throw new Error('Cannot read the field "x" of a session');
  },
}));
vi.mock('../src/web/docs/DocsRoutes', () => ({ DocsRoutes: () => <p>DOCS-PAGE-OK</p> }));
vi.mock('../src/web/decisions/DecisionPage', () => ({ DecisionRoute: () => <p>DECISION-PAGE-OK</p> }));
vi.mock('../src/web/now/NowPage', () => ({ NowPage: () => <p>NOW-PAGE-OK</p> }));

import { App } from '../src/web/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let go: (path: string) => void;

/** Lets the test move to another address, as a click on a link does. */
function Navigator() {
  const navigate = useNavigate();
  go = (path) => navigate(path);
  return null;
}

beforeEach(() => {
  // React prints the error that the boundary catches. The test expects it, so it is kept out of the output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Navigator />
        <App />
      </MemoryRouter>,
    );
  });
}

describe('the error boundary around the pages', () => {
  it('shows the error state when a page throws while it renders, and the message of the error', async () => {
    await renderAt('/agents');
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Reload the page.');
    expect(alert?.textContent).toContain('Cannot read the field "x" of a session');
    expect(alert?.textContent).toContain('Reload');
  });

  it('error boundary shows one short line', async () => {
    await renderAt('/agents');
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // The words of the page are one line: it says to reload, and why the page can be old. The second paragraph is the message of the error, which is data.
    const paragraphs = [...(alert?.querySelectorAll('p') ?? [])];
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual(['Reload the page. If the server restarts, the page files can change.', 'Cannot read the field "x" of a session']);
    const line = paragraphs[0]?.textContent ?? '';
    // 20 words or fewer, with no contraction and no -ing form (ASD-STE100, design 5.8).
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(line).not.toMatch(/'|\w+ing\b/);
    // The two sentences of the old text are gone.
    expect(alert?.textContent).not.toContain('This page could not be shown');
    expect(alert?.textContent).not.toContain('has a new name');
    // The Reload button is still there: it is how the line is followed.
    expect(alert?.querySelector('button')?.textContent).toContain('Reload');
  });

  it('keeps the other pages working, and clears the error when Mark goes to another page', async () => {
    await renderAt('/agents');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    for (const [path, text] of [
      ['/docs/x', 'DOCS-PAGE-OK'],
      ['/decisions/20', 'DECISION-PAGE-OK'],
    ] as const) {
      await act(async () => go(path));
      expect(container.querySelector('[role="alert"]'), path).toBeNull();
      expect(container.textContent, path).toContain(text);
    }
    // The broken page is still broken when Mark returns to it, and it shows the error again.
    await act(async () => go('/agents'));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('draws a page that does not throw with no error state', async () => {
    await renderAt('/docs/x');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('DOCS-PAGE-OK');
  });
});
