// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The search box and the title of a docs page share one row (Mark, 2026-10-14: "The page title can be aligned with the search bar"). The real DocsRoutes is used here: the other
// pages are small stand-ins, and `fetch` answers from a table. tests/site-header.test.tsx cannot see inside the Docs page (it replaces it), so the search box is checked here:
// it is on the Docs pages, in the body and on the title row, and on no other page. How the row looks at 1280 and 390 px is the job of e2e/site-header.spec.ts.

vi.mock('../src/web/agents/AgentsPage', () => ({ AgentsPage: () => <h1>AGENTS-PAGE</h1> }));
vi.mock('../src/web/decisions/DecisionPage', () => ({ DecisionRoute: () => <h1>DECISION-PAGE</h1> }));
vi.mock('../src/web/now/NowPage', () => ({ NowPage: () => <h1>NOW-PAGE</h1> }));
vi.mock('../src/web/workstreams/LocalWorkstreams', () => ({ LocalWorkstreams: () => <h1>LOCAL-WORKSTREAMS-PAGE</h1> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-10-14T10:00:00.000Z';
const panel = (data: unknown) => ({ ok: true, data, updatedAt: NOW });
const DOC = {
  id: 'docs/x.md',
  slug: 'x',
  title: 'The X doc',
  type: 'guide',
  status: 'approved',
  updated: '2026-01-10',
  updatedFrom: 'frontmatter',
  html: '<h1 id="the-x-doc">The X doc</h1>\n<p>Intro text.</p>',
  headings: [],
  backlinks: [],
  brokenLinks: [],
  frontmatterError: null,
  decisions: [],
};
const ANSWERS: Record<string, unknown> = {
  '/api/docs': panel({ docs: [], nav: [], problems: [] }),
  '/api/docs/x': panel(DOC),
  '/api/docs/no-title': panel({ ...DOC, slug: 'no-title', html: '<p>Lead text.</p>\n<h1 id="late">Late title</h1>' }),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(JSON.stringify(ANSWERS[url] ?? { ok: false, error: { code: 'not-found', message: 'No such address.' }, updatedAt: null, lastGood: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
  if (typeof EventSource === 'undefined') {
    vi.stubGlobal('EventSource', class { addEventListener() {} close() {} onerror = null; onmessage = null; });
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function renderAt(path: string) {
  const { App } = await import('../src/web/App');
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  // The panels load after the first render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const searchBoxes = () => container.querySelectorAll('input[role="combobox"]');

describe('the search box of the Docs pages', () => {
  it.each(['/docs', '/docs/x', '/docs/decisions', '/docs/no-title', '/docs/missing/page'])('is in the body of %s, once, and not in the header', async (path) => {
    await renderAt(path);
    expect(searchBoxes()).toHaveLength(1);
    expect(container.querySelector('header [role="combobox"], header input')).toBeNull();
    expect(container.querySelector('main input[role="combobox"]')).not.toBeNull();
  });

  it.each(['/', '/agents', '/decisions/41', '/workstreams', '/no-such-page'])('is not on %s', async (path) => {
    await renderAt(path);
    expect(searchBoxes()).toHaveLength(0);
  });

  it('puts the title of the overview and the search box on one row, title first, with no row of the search alone above them', async () => {
    await renderAt('/docs');
    const h1 = container.querySelector('main h1') as HTMLElement;
    const search = container.querySelector('input[role="combobox"]') as HTMLElement;
    expect(h1.textContent).toBe('Docs');
    const row = h1.closest('main > div') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.contains(search)).toBe(true);
    // The title is before the search in the row, and the row is the first thing in the page body.
    expect(h1.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('main')?.firstElementChild).toBe(row);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('puts the h1 of a doc on the same row, above its details', async () => {
    await renderAt('/docs/x');
    const h1 = container.querySelector('main h1') as HTMLElement;
    expect(h1.textContent).toBe('The X doc');
    const row = h1.closest('main > div') as HTMLElement;
    expect(row.contains(container.querySelector('input[role="combobox"]'))).toBe(true);
    const details = container.querySelector('[aria-label="Document details"]') as HTMLElement;
    expect(h1.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.contains(details)).toBe(false);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('keeps the search box at the top for a page with no title in the row, without an empty box beside it', async () => {
    await renderAt('/docs/no-title');
    const row = container.querySelector('input[role="combobox"]')?.closest('main > div') as HTMLElement;
    expect(container.querySelector('main')?.firstElementChild).toBe(row);
    // The page has its own h1 in its text (it does not open the doc), and the row has none.
    expect(row.querySelector('h1')).toBeNull();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    // The place for the title is empty, so the stylesheet hides it (`empty:hidden`).
    const slot = row.firstElementChild as HTMLElement;
    expect(slot.childElementCount).toBe(0);
    expect(slot.className).toContain('empty:hidden');
  });
});
