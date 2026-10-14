// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The header of the site is one component (src/web/SiteHeader.tsx), drawn once by App above every page. Mark's ask (2026-10-14): the links must not jump between pages, so the
// header is the same on every page. The pages are replaced here by small stand-ins: this test is about the header around the routes. How it looks and where the links stand
// in a real browser (the same x position at 1280 px wide) is the job of e2e/site-header.spec.ts.

vi.mock('../src/web/agents/AgentsPage', () => ({ AgentsPage: () => <h1>AGENTS-PAGE</h1> }));
vi.mock('../src/web/docs/DocsRoutes', () => ({ DocsRoutes: () => <h1>DOCS-PAGE</h1> }));
vi.mock('../src/web/decisions/DecisionPage', () => ({ DecisionRoute: () => <h1>DECISION-PAGE</h1> }));
vi.mock('../src/web/now/NowPage', () => ({ NowPage: () => <h1>NOW-PAGE</h1> }));
vi.mock('../src/web/workstreams/LocalWorkstreams', () => ({ LocalWorkstreams: () => <h1>LOCAL-WORKSTREAMS-PAGE</h1> }));
vi.mock('../src/web/workstreams/WorkstreamsPage', () => ({ WorkstreamsPage: () => <h1>WORKSTREAMS-PAGE</h1> }));
vi.mock('../src/web/hosted/HostedBanner', () => ({ HostedBanner: () => null }));

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
  vi.unstubAllEnvs();
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
}

/** The header as a page-independent picture: its tag classes, the title, and the links in order. Which link is current is left out, and tested on its own. */
function pictureOfHeader() {
  const header = container.querySelector('header');
  const nav = header?.querySelector('nav');
  return {
    headerClass: header?.className,
    rowClass: header?.firstElementChild?.className,
    title: header?.querySelector('a')?.textContent,
    titleHref: header?.querySelector('a')?.getAttribute('href'),
    navClass: nav?.className,
    navLabel: nav?.getAttribute('aria-label'),
    links: [...(nav?.querySelectorAll('a') ?? [])].map((link) => [link.textContent, link.getAttribute('href')]),
  };
}

const currentLinks = () => [...container.querySelectorAll('nav[aria-label="Main"] a[aria-current="page"]')].map((link) => link.textContent);

const ROUTES: readonly (readonly [string, string, string | null])[] = [
  // [address, text of the page body, the link that is current]
  ['/', 'NOW-PAGE', 'Now'],
  ['/docs/roadmap/README', 'DOCS-PAGE', 'Roadmap'],
  ['/docs', 'DOCS-PAGE', 'Docs'],
  ['/docs/engine/decisions', 'DOCS-PAGE', 'Docs'],
  ['/agents', 'AGENTS-PAGE', 'Agents'],
  ['/decisions/41', 'DECISION-PAGE', null],
  ['/workstreams', 'LOCAL-WORKSTREAMS-PAGE', null],
  ['/no-such-page', 'NOW-PAGE', 'Now'],
];

describe('the header of the site (local build)', () => {
  it.each(ROUTES)('renders on %s: one header, one Main navigation, and the page body after it', async (path, bodyText) => {
    await renderAt(path);
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(1);
    expect(container.textContent).toContain(bodyText);
    const header = container.querySelector('header') as HTMLElement;
    // The header comes before the page in the document, and the page is not inside it.
    expect(header.compareDocumentPosition(container.querySelector('h1') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.querySelector('h1')).toBeNull();
  });

  it.each(ROUTES)('marks the current page on %s', async (path, _body, current) => {
    await renderAt(path);
    expect(currentLinks()).toEqual(current === null ? [] : [current]);
  });

  it('is the same header on every page: same classes, same title, same links in the same order', async () => {
    const pictures: ReturnType<typeof pictureOfHeader>[] = [];
    for (const [path] of ROUTES) {
      await renderAt(path);
      pictures.push(pictureOfHeader());
      act(() => root.unmount());
      root = createRoot(container);
    }
    const [first, ...others] = pictures;
    expect(first?.title).toBe('Shadow Jog Command Center');
    expect(first?.links).toEqual([
      ['Now', '/'],
      ['Roadmap', '/docs/roadmap/README'],
      ['Docs', '/docs'],
      ['Agents', '/agents'],
    ]);
    expect(first?.navLabel).toBe('Main');
    // The links are pushed to the right edge, and the header sticks to the top.
    expect(first?.navClass).toContain('ml-auto');
    expect(first?.headerClass).toContain('sticky top-0');
    for (const other of others) expect(other).toEqual(first);
  });

  it('shows no search box: the search belongs to the body of the Docs page', async () => {
    await renderAt('/docs');
    expect(container.querySelector('header [role="combobox"], header input')).toBeNull();
  });

  it('does not offer Workstreams in the local build', async () => {
    await renderAt('/');
    expect(container.querySelector('nav[aria-label="Main"] a[href="/workstreams"]')).toBeNull();
  });
});

describe('the header of the site (hosted build)', () => {
  it.each([...ROUTES.map((route) => route[0]), '/workstreams'])('has Workstreams as the last link on %s', async (path) => {
    vi.stubEnv('VITE_HOSTED', '1');
    await renderAt(path);
    const links = [...container.querySelectorAll('nav[aria-label="Main"] a')].map((link) => link.textContent);
    expect(links).toEqual(['Now', 'Roadmap', 'Docs', 'Agents', 'Workstreams']);
    expect(container.querySelectorAll('header')).toHaveLength(1);
  });

  it('marks Workstreams as the current page at /workstreams', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    await renderAt('/workstreams');
    expect(currentLinks()).toEqual(['Workstreams']);
  });
});

describe('no page builds its own header', () => {
  /** Every .tsx file of src/web. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return path.endsWith('.tsx') ? [path] : [];
    });
  }
  const web = join(__dirname, '..', 'src', 'web');

  it('only SiteHeader.tsx holds the Main navigation and the sticky top bar', () => {
    const offenders = sources(web).filter((file) => {
      if (file.endsWith('SiteHeader.tsx')) return false;
      const text = readFileSync(file, 'utf8');
      return text.includes('aria-label="Main"') || text.includes('sticky top-0 z-30 border-b');
    });
    expect(offenders).toEqual([]);
  });
});
