// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocPage } from '../src/shared/types';
import { type DocBanner, DocView } from '../src/web/docs/DocView';

// The DocView tests that need a DOM. The page puts attributes on the html that the server wrote (a
// picture that can be zoomed gets a tab stop and the role of a button), and React sets that html
// again when the banners change. A render on the server runs no effect, so only a DOM, here the
// simulated one of happy-dom, can show whether the attributes are still there. How the page looks
// and behaves in a real browser is the job of e2e/docs.spec.ts.

// Tells React that a test drives it, so that `act` waits for effects and updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HTML = [
  '<h1 id="the-x-doc">The X doc</h1>',
  '<p><img src="/files/aaaaaaaa/one.png" alt="First diagram" data-zoom="/files/aaaaaaaa/one.png"></p>',
  '<h2 id="beta">Beta</h2>',
  '<p><img src="/files/bbbbbbbb/two.png" alt="Second diagram" data-zoom="/files/bbbbbbbb/two.png"></p>',
  '<p><img src="/files/cccccccc/plain.png" alt="A picture that is not a diagram"></p>',
].join('\n');

const DOC: DocPage = {
  id: 'docs/x.md',
  slug: 'x',
  title: 'The X doc',
  type: 'guide',
  status: 'approved',
  updated: '2026-01-10',
  updatedFrom: 'frontmatter',
  html: HTML,
  headings: [{ level: 2, text: 'Beta', id: 'beta' }],
  backlinks: [],
  brokenLinks: [],
  frontmatterError: null,
};

const banner = (anchor: string): DocBanner => ({ anchor, node: <aside data-banner={anchor}>A banner for {anchor}</aside> });

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

/** Renders the doc with these banners. Calling it again is a new set of props for the same page, as when a banner arrives later. */
function show(banners: readonly DocBanner[] = []): void {
  act(() => root.render(<MemoryRouter initialEntries={['/docs/x']}><DocView doc={DOC} banners={banners} /></MemoryRouter>));
}

const zoomable = () => [...container.querySelectorAll<HTMLImageElement>('img[data-zoom]')];

/** A picture that can be zoomed must be a tab stop and a button for a screen reader. */
function expectButton(picture: HTMLImageElement): void {
  expect(picture.getAttribute('tabindex')).toBe('0');
  expect(picture.getAttribute('role')).toBe('button');
  expect(picture.getAttribute('aria-haspopup')).toBe('dialog');
}

describe('DocView, in a DOM', () => {
  it('makes each picture that can be zoomed a button for the keyboard, and leaves the other pictures alone', () => {
    show();
    expect(zoomable()).toHaveLength(2);
    for (const picture of zoomable()) expectButton(picture);
    const plain = container.querySelector('img[alt="A picture that is not a diagram"]');
    expect(plain?.getAttribute('tabindex')).toBeNull();
    expect(plain?.getAttribute('role')).toBeNull();
  });

  it('keeps the keyboard role of the pictures when a banner arrives after the doc', () => {
    show();
    const before = zoomable();
    expect(before).toHaveLength(2);

    show([banner('beta')]);

    // The html was cut in two and set again, so the second picture is a new element. Its attributes were not copied.
    const after = zoomable();
    expect(after).toHaveLength(2);
    expect(after[1]).not.toBe(before[1]);
    for (const picture of after) expectButton(picture);
    // The banner is in front of its heading, and the doc is whole.
    const bannerNode = container.querySelector('[data-banner="beta"]');
    const heading = container.querySelector('#beta');
    expect(bannerNode).not.toBeNull();
    expect((bannerNode as Node).compareDocumentPosition(heading as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('img')).toHaveLength(3);
  });

  it('keeps the keyboard role of the pictures when the banners change again and when they go away', () => {
    show([banner('beta')]);
    show([banner('beta'), banner('the-x-doc')]);
    expect(zoomable()).toHaveLength(2);
    for (const picture of zoomable()) expectButton(picture);

    const beforeRemoval = zoomable();
    show();
    expect(zoomable()).toHaveLength(2);
    expect(zoomable()[0]).not.toBe(beforeRemoval[0]);
    for (const picture of zoomable()) expectButton(picture);
  });
});
