import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DocPage, DocsListing, NavSection, Panel } from '../src/shared/types';
import { Backlinks } from '../src/web/docs/Backlinks';
import { DocView } from '../src/web/docs/DocView';
import { FrontmatterHeader } from '../src/web/docs/FrontmatterHeader';
import { Gone, missingDocOf } from '../src/web/docs/Gone';
import { Outline } from '../src/web/docs/Outline';
import { Overview } from '../src/web/docs/Overview';
import { SectionTree } from '../src/web/docs/SectionTree';
import type { PanelResult } from '../src/web/usePanel';

// The pieces of the docs site that can be checked without a browser: what they write for a given
// doc or listing. A server-side render runs no effect, so the click, scroll and zoom behaviour is
// the job of e2e/docs.spec.ts. What these tests pin down is the content, the order of the content
// (a banner in front of its heading, the footer last) and the empty and error states.

/** Renders an element the way the page would, inside a router at `path`. */
const render = (element: ReactElement, path = '/docs/x') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);

function makeDoc(overrides: Partial<DocPage> = {}): DocPage {
  return {
    id: 'docs/x.md',
    slug: 'x',
    title: 'The X doc',
    type: 'guide',
    status: 'approved',
    updated: '2026-01-10',
    updatedFrom: 'frontmatter',
    html: '<h1 id="the-x-doc">The X doc</h1>\n<p>Intro text.</p>\n<h2 id="alpha">Alpha</h2>\n<p>Alpha text.</p>\n<h2 id="beta">Beta</h2>\n<p>Beta text.</p>',
    headings: [
      { level: 2, text: 'Alpha', id: 'alpha' },
      { level: 2, text: 'Beta', id: 'beta' },
    ],
    backlinks: [],
    brokenLinks: [],
    frontmatterError: null,
    ...overrides,
  };
}

const after = (markup: string, first: string, second: string) => {
  const a = markup.indexOf(first);
  const b = markup.indexOf(second);
  return a !== -1 && b !== -1 && a < b;
};

describe('DocView', () => {
  it('shows the footer under the text of the doc', () => {
    const markup = render(<DocView doc={makeDoc()} footer={<p>FOOTER-MARK</p>} />);
    expect(after(markup, 'Beta text.', 'FOOTER-MARK')).toBe(true);
    // The outline and the backlinks sit beside the doc, in the same view.
    expect(markup).toContain('aria-label="Outline"');
    expect(markup).toContain('aria-label="Linked from"');
  });

  it('shows no footer when none is given', () => {
    expect(render(<DocView doc={makeDoc()} />)).not.toContain('FOOTER-MARK');
  });

  it('draws no ruled box for a footer that is empty: undefined, null, false, 0 and an empty text', () => {
    const box = 'mt-10 border-t border-cc-rule pt-6';
    for (const footer of [undefined, null, false, 0, '']) expect(render(<DocView doc={makeDoc()} footer={footer} />), String(footer)).not.toContain(box);
    // A real footer gets the box.
    expect(render(<DocView doc={makeDoc()} footer={<p>FOOTER-MARK</p>} />)).toContain(box);
  });

  it('puts each banner in front of the heading with its id, and keeps the heading and its text after it', () => {
    const markup = render(
      <DocView
        doc={makeDoc()}
        banners={[
          { anchor: 'beta', node: <aside>BANNER-BETA</aside> },
          { anchor: 'alpha', node: <aside>BANNER-ALPHA</aside> },
        ]}
      />,
    );
    expect(after(markup, 'Intro text.', 'BANNER-ALPHA')).toBe(true);
    expect(after(markup, 'BANNER-ALPHA', '<h2 id="alpha">')).toBe(true);
    expect(after(markup, 'Alpha text.', 'BANNER-BETA')).toBe(true);
    expect(after(markup, 'BANNER-BETA', '<h2 id="beta">')).toBe(true);
    // Nothing of the doc is lost by the cuts.
    expect(markup).toContain('<p>Alpha text.</p>');
    expect(markup).toContain('<p>Beta text.</p>');
  });

  it('shows a banner whose heading is not in the doc above the doc, so it does not disappear', () => {
    const markup = render(<DocView doc={makeDoc()} banners={[{ anchor: 'renamed-heading', node: <aside>BANNER-LOST</aside> }]} />);
    expect(after(markup, 'BANNER-LOST', '<h1 id="the-x-doc">')).toBe(true);
  });

  it('gives a doc that has no h1 its title as the h1, and adds none to a doc that has one', () => {
    const without = render(<DocView doc={makeDoc({ html: '<p>Only text.</p>' })} />);
    expect(without).toContain('<h1>The X doc</h1>');
    const withOne = render(<DocView doc={makeDoc()} />);
    expect(withOne.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('puts the html in as it is, with every link and heading id the server wrote', () => {
    const html = '<h1 id="t">T</h1>\n<p><a href="/docs/other#part">go</a> <span class="broken-link" title="the file does not exist in the repo">gone</span></p>';
    const markup = render(<DocView doc={makeDoc({ html })} />);
    expect(markup).toContain(html);
  });
});

describe('FrontmatterHeader', () => {
  it('shows the type and the status as chips, and the day with its time tag', () => {
    const markup = render(<FrontmatterHeader doc={makeDoc()} />);
    expect(markup).toContain('aria-label="Document details"');
    expect(markup).toMatch(/Type<\/dt><dd[^>]*><span class="chip[^"]*"[^>]*><span class="chip__label"[^>]*>guide</);
    expect(markup).toMatch(/Status<\/dt><dd[^>]*><span class="chip[^"]*"[^>]*><span class="chip__label"[^>]*>approved</);
    expect(markup).toContain('<time dateTime="2026-01-10" class="font-mono">2026-01-10</time>');
    expect(markup).not.toContain('from git');
  });

  it('shows a dash for a type or status that the doc does not have, and says where a date from git came from', () => {
    const markup = render(<FrontmatterHeader doc={makeDoc({ type: '', status: '', updatedFrom: 'git' })} />);
    expect(markup.match(/aria-label="none"/g)).toHaveLength(2);
    expect(markup).toContain('from git');
    expect(render(<FrontmatterHeader doc={makeDoc({ updatedFrom: 'file' })} />)).toContain('from the file time');
  });

  it('shows a long status as text that wraps, not as a chip, and in a row of its own', () => {
    const status = 'approved 2026-10-05 (final). First approval 2026-10-04 (all recommendations).';
    const markup = render(<FrontmatterHeader doc={makeDoc({ status })} />);
    expect(markup).toContain(status);
    expect(markup).not.toMatch(new RegExp(`chip__label[^>]*>${status.slice(0, 20)}`));
    expect(markup).toContain('order-last basis-full');
  });

  it('says how many links are broken, names each address, and cuts a very long one', () => {
    const long = `data:text/html;base64,${'A'.repeat(100)}`;
    const markup = render(<FrontmatterHeader doc={makeDoc({ brokenLinks: ['missing.md', long] })} />);
    expect(markup).toContain('2 broken links');
    expect(markup).toContain('missing.md');
    expect(markup).toContain('…');
    expect(markup).toContain(`title="${long}"`); // the whole address stays in the tooltip
    expect(render(<FrontmatterHeader doc={makeDoc({ brokenLinks: ['one.md'] })} />)).toContain('1 broken link in this doc');
    expect(render(<FrontmatterHeader doc={makeDoc()} />)).not.toContain('broken link');
  });

  it('says when the frontmatter could not be read, and shows the reason as text', () => {
    const markup = render(<FrontmatterHeader doc={makeDoc({ type: '', status: '', frontmatterError: 'Invalid YAML in the frontmatter: <b>bad</b> (line 2)' })} />);
    expect(markup).toContain('could not be read');
    expect(markup).toContain('Invalid YAML in the frontmatter: &lt;b&gt;bad&lt;/b&gt; (line 2)');
  });
});

describe('Outline and Backlinks', () => {
  it('lists the headings as links to the doc with the heading id as the hash, indented by level', () => {
    const markup = render(
      <Outline
        slug="engine/decisions"
        headings={[
          { level: 2, text: 'First', id: 'first' },
          { level: 3, text: 'Second', id: 'second' },
          { level: 4, text: 'Third & more', id: 'third-more' },
        ]}
      />,
    );
    expect(markup).toContain('href="/docs/engine/decisions#first"');
    expect(markup).toContain('href="/docs/engine/decisions#third-more"');
    expect(markup).toContain('Third &amp; more');
    expect(markup).toContain('pl-3'); // level 3
    expect(markup).toContain('pl-6'); // level 4
  });

  it('says so when a doc has no headings or no backlinks', () => {
    expect(render(<Outline slug="x" headings={[]} />)).toContain('This doc has no headings.');
    expect(render(<Backlinks refs={[]} />)).toContain('No other doc links here.');
  });

  it('lists the docs that link here, by title, as links to their pages', () => {
    const markup = render(<Backlinks refs={[{ slug: 'guides/setup', title: 'Setup <guide>' }]} />);
    expect(markup).toContain('href="/docs/guides/setup"');
    expect(markup).toContain('Setup &lt;guide&gt;');
  });
});

describe('Gone and missingDocOf', () => {
  it('says the doc was moved or deleted, names the address, and offers the docs with the same file name', () => {
    const markup = render(<Gone slug="live-edit/moving" suggestions={[{ slug: 'live-edit/old/moving', title: 'A doc that moves' }]} />);
    expect(markup).toContain('This doc was moved or deleted');
    expect(markup).toContain('/docs/live-edit/moving');
    expect(markup).toContain('href="/docs/live-edit/old/moving"');
    expect(markup).toContain('A doc that moves');
    expect(markup).toContain('href="/docs"');
  });

  it('says so when no other doc has the file name', () => {
    expect(render(<Gone slug="a/b/gone-doc" suggestions={[]} />)).toContain('No other doc has the file name &quot;gone-doc&quot; either.');
  });

  const failed = (code: string, extra: Record<string, unknown> = {}): Panel<DocPage> =>
    ({ ok: false, error: { code, message: 'm' }, updatedAt: null, lastGood: null, ...extra }) as Panel<DocPage>;

  it('reads the suggestions of a doc-not-found answer, and drops anything that is not a reference', () => {
    const suggestions = [{ slug: 'a/b', title: 'B' }, { slug: 5, title: 'bad' }, null, 'text', { slug: 'c' }];
    expect(missingDocOf(failed('doc-not-found', { suggestions }))).toEqual([{ slug: 'a/b', title: 'B' }]);
    expect(missingDocOf(failed('doc-not-found'))).toEqual([]);
    expect(missingDocOf(failed('doc-not-found', { suggestions: 'nope' }))).toEqual([]);
  });

  it('is null for every other panel: loading, a doc, and any other error', () => {
    expect(missingDocOf(null)).toBeNull();
    expect(missingDocOf({ ok: true, data: makeDoc(), updatedAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
    expect(missingDocOf(failed('network'))).toBeNull();
    expect(missingDocOf(failed('http-500', { suggestions: [{ slug: 'a', title: 'A' }] }))).toBeNull();
  });
});

const NAV: NavSection[] = [
  {
    id: 'guides',
    title: 'Guides',
    items: [
      { kind: 'doc', slug: 'guides/setup', title: 'Setup guide', updated: '2026-01-10' },
      { kind: 'doc', slug: 'a', title: 'A', updated: '2026-01-01' },
      { kind: 'doc', slug: 'b', title: 'B', updated: '2026-01-02' },
      { kind: 'doc', slug: 'c', title: 'C', updated: '2026-01-03' },
      { kind: 'doc', slug: 'd', title: 'D', updated: '2026-01-04' },
      { kind: 'doc', slug: 'e', title: 'E', updated: '2026-01-05' },
      { kind: 'doc', slug: 'f', title: 'F', updated: '2026-01-06' },
    ],
  },
  { id: 'decisions', title: 'Decisions', items: [{ kind: 'page', path: '/docs/decisions', title: 'All decisions' }] },
];

describe('SectionTree', () => {
  it('opens only the section that holds the open doc, and marks the doc as the current page', () => {
    const markup = render(<SectionTree nav={NAV} activeSlug="guides/setup" activePath="/docs/guides/setup" />);
    expect(markup).toContain('aria-label="Docs sections"');
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(1);
    // The folded list is hidden, so a keyboard and a screen reader skip it.
    expect(markup.match(/ hidden=""/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="page"[^>]*>Setup guide</);
    expect(markup).not.toMatch(/aria-current="page"[^>]*>All decisions</);
  });

  it('starts with every section folded when no doc is open, and shows a page item of the site as current by its address', () => {
    const folded = render(<SectionTree nav={NAV} activeSlug={null} activePath="/docs" />);
    expect(folded.match(/aria-expanded="false"/g)).toHaveLength(2);
    const page = render(<SectionTree nav={NAV} activeSlug={null} activePath="/docs/decisions" />);
    expect(page).toMatch(/aria-current="page"[^>]*>All decisions</);
    // The section of that page is open, as the section of a doc is.
    expect(page.match(/aria-expanded="true"/g)).toHaveLength(1);
  });

  it('names the list that each button opens, and the count is not part of the button name', () => {
    const markup = render(<SectionTree nav={NAV} activeSlug={null} activePath="/docs" />);
    expect(markup).toMatch(/<button[^>]*aria-controls="([^"]+)"/);
    const id = /aria-controls="([^"]+)"/.exec(markup)?.[1] ?? '';
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('aria-hidden="true" class="font-mono text-xs text-cc-soft">7<');
  });
});

describe('Overview', () => {
  const ready = (listing: DocsListing): PanelResult<DocsListing> => ({
    state: 'ready',
    panel: { ok: true, data: listing, updatedAt: '2026-01-10T10:00:00.000Z' },
    reload: () => undefined,
  });
  const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `docs/d${i}.md`, slug: `d${i}`, title: `D${i}`, type: '', status: '', updated: '2026-01-01', updatedFrom: 'git' as const }));

  it('shows a card for each section, with the first five pages and the day each one last changed', () => {
    const markup = render(<Overview listing={ready({ docs: docs(8), nav: NAV, problems: [] })} />, '/docs');
    expect(markup).toContain('<h1 class="text-3xl font-semibold tracking-tight">Docs</h1>');
    expect(markup).toContain('8 docs in 2 sections.');
    expect(markup).toContain('>Guides</h3>');
    expect(markup).toContain('>Decisions</h3>');
    expect(markup).toContain('<time dateTime="2026-01-10" class="shrink-0 font-mono text-xs text-cc-soft">2026-01-10</time>');
    // The sixth and seventh page are behind "Show all", and the card says how many there are.
    expect(markup).toContain('Setup guide');
    expect(markup).toContain('>D<');
    expect(markup).not.toContain('>E<');
    expect(markup).not.toContain('>F<');
    expect(markup).toContain('Show all 7 pages');
    // A page of the site that is not a doc has no date.
    expect(markup).toContain('href="/docs/decisions"');
    expect(markup).toContain('>page<');
  });

  it('says so when there are no docs, and shows the problems of the docs folded', () => {
    expect(render(<Overview listing={ready({ docs: [], nav: [], problems: [] })} />, '/docs')).toContain('No docs yet.');
    const markup = render(<Overview listing={ready({ docs: docs(1), nav: NAV.slice(1), problems: ['docs/a.md: broken link "x.md" (the file does not exist in the repo).', 'nav.json: a mistake'] })} />, '/docs');
    expect(markup).toContain('2 problems found in the docs');
    expect(markup).toContain('nav.json: a mistake');
    // Problems are plain text.
    expect(render(<Overview listing={ready({ docs: docs(1), nav: NAV.slice(1), problems: ['<img src=x onerror=alert(1)>'] })} />, '/docs')).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('keeps its title and introduction when the docs could not be loaded, and shows the error in the panel', () => {
    const failedResult: PanelResult<DocsListing> = {
      state: 'error',
      panel: { ok: false, error: { code: 'network', message: 'Cannot reach the command center server.' }, updatedAt: null, lastGood: null },
      reload: () => undefined,
    };
    const markup = render(<Overview listing={failedResult} />, '/docs');
    expect(markup).toContain('>Docs</h1>');
    expect(markup).toContain('Cannot reach the command center server.');
    expect(markup).toContain('Retry');
    expect(markup).not.toContain('Show all');
  });
});
