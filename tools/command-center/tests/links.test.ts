import { describe, expect, it, vi } from 'vitest';
import { type KnownTargets, docUrl, resolveHref } from '../src/server/docs/links';
import { GITHUB_BLOB_BASE, render } from './doc-helpers';

// resolveHref turns the text of a link, as a doc writes it, into what it points at. It is pure: the
// doc index hands it what exists, and a test hands it a made-up repo, so none of this touches a disk.

/** The files and folders of the made-up repo. */
const FILES = new Set([
  'README.md', 'status.md', 'package.json',
  'docs', 'docs/GDD.md', 'docs/engine', 'docs/engine/README.md', 'docs/engine/decisions.md', 'docs/engine/notes.txt',
  'docs/diagrams', 'docs/diagrams/flow.png', 'docs/diagrams/flow.html',
  'src', 'src/main.ts', 'src/engine/scene graph.ts', 'src/art.png',
]);

const known: KnownTargets = {
  docs: new Map([
    ['status.md', 'status'],
    ['docs/GDD.md', 'GDD'],
    ['docs/engine/README.md', 'engine/README'],
    ['docs/engine/decisions.md', 'engine/decisions'],
  ]),
  assets: new Map([
    ['docs/diagrams/flow.png', '/files/aaaa1111/flow.png'],
    ['docs/diagrams/flow.html', '/files/bbbb2222/flow.html'],
  ]),
  exists: (path) => FILES.has(path),
};

/** Resolves a link as written in docs/engine/README.md, unless another doc is named. */
const resolve = (href: string, from = 'docs/engine/README.md') => resolveHref(href, from, known, GITHUB_BLOB_BASE);

const broken = (reason: RegExp) => ({ kind: 'broken', reason: expect.stringMatching(reason) });

describe('resolveHref', () => {
  it('a doc link becomes /docs/<slug>#anchor', () => {
    // What the link points at: the doc, found from the folder of the doc that holds the link.
    expect(resolve('decisions.md#e1-first-choice')).toEqual({ kind: 'doc', slug: 'engine/decisions', anchor: 'e1-first-choice' });
    expect(resolve('./decisions.md')).toEqual({ kind: 'doc', slug: 'engine/decisions' });
    expect(resolve('../GDD.md')).toEqual({ kind: 'doc', slug: 'GDD' });
    expect(resolve('../../status.md')).toEqual({ kind: 'doc', slug: 'status' });
    expect(resolve('docs/GDD.md', 'status.md')).toEqual({ kind: 'doc', slug: 'GDD' });
    expect(resolve('/docs/GDD.md#setting')).toEqual({ kind: 'doc', slug: 'GDD', anchor: 'setting' }); // a leading / is the repo root
    expect(resolve('decisions.md#')).toEqual({ kind: 'doc', slug: 'engine/decisions' }); // an empty anchor is no anchor

    // The address it becomes on this site.
    expect(docUrl('engine/decisions', 'e1-first-choice')).toBe('/docs/engine/decisions#e1-first-choice');
    expect(docUrl('GDD')).toBe('/docs/GDD');
    expect(docUrl('notes/a b', 'café')).toBe('/docs/notes/a%20b#caf%C3%A9');

    // And the address a rendered doc prints for it.
    const doc = render('[the decisions](decisions.md#e1-first-choice) and [the GDD](../GDD.md)', 'docs/engine/README.md', known);
    expect(doc.html).toContain('<a href="/docs/engine/decisions#e1-first-choice">the decisions</a>');
    expect(doc.html).toContain('<a href="/docs/GDD">the GDD</a>');
  });

  it('a link to a repo file that is not a doc resolves to kind github', () => {
    const base = GITHUB_BLOB_BASE;
    expect(resolve('../../src/main.ts')).toEqual({ kind: 'github', url: `${base}/src/main.ts` });
    expect(resolve('../../src/main.ts#L10-L20')).toEqual({ kind: 'github', url: `${base}/src/main.ts#L10-L20` });
    expect(resolve('notes.txt')).toEqual({ kind: 'github', url: `${base}/docs/engine/notes.txt` });
    expect(resolve('/package.json')).toEqual({ kind: 'github', url: `${base}/package.json` });
    // A name with a space is encoded, from the plain text form and from the encoded one.
    expect(resolve('../../src/engine/scene graph.ts')).toEqual({ kind: 'github', url: `${base}/src/engine/scene%20graph.ts` });
    expect(resolve('../../src/engine/scene%20graph.ts')).toEqual({ kind: 'github', url: `${base}/src/engine/scene%20graph.ts` });
    // A folder is a repo path too, with or without the slash on the end, and a base with a slash on the end works.
    expect(resolve('../')).toEqual({ kind: 'github', url: `${base}/docs` });
    expect(resolve('../../src')).toEqual({ kind: 'github', url: `${base}/src` });
    expect(resolveHref('../../src/main.ts', 'docs/engine/README.md', known, `${base}/`)).toEqual({ kind: 'github', url: `${base}/src/main.ts` });
  });

  it('a link to a missing file or outside the repo is broken', () => {
    const exists = vi.fn((path: string) => FILES.has(path));
    const strict: KnownTargets = { ...known, exists };
    const from = 'docs/engine/README.md';

    expect(resolveHref('missing.md', from, strict, GITHUB_BLOB_BASE)).toEqual(broken(/does not exist/));
    expect(resolveHref('../../src/missing.ts#L1', from, strict, GITHUB_BLOB_BASE)).toEqual(broken(/does not exist/));
    // Outside the repo: one step too far up, a root link that climbs, and the same climb written with %2e.
    for (const href of ['../../../outside.md', '../../../../a/b/c.md', '/../outside.md', '%2e%2e/%2e%2e/%2e%2e/outside.md', '../../..']) {
      expect(resolveHref(href, from, strict, GITHUB_BLOB_BASE), href).toEqual(broken(/outside the repo/));
    }
    // The repo root itself is neither a file nor a folder that has a page.
    for (const href of ['../..', '/', '../../.', './../../']) {
      expect(resolveHref(href, from, strict, GITHUB_BLOB_BASE), href).toEqual(broken(/repo root/));
    }
    // `exists` is asked only about clean repo paths, and never about a path that leaves the repo.
    expect(exists.mock.calls.map(([path]) => path)).toEqual(['docs/engine/missing.md', 'src/missing.ts']);
  });

  it('an anchor-only link is kind anchor', () => {
    expect(resolve('#setup')).toEqual({ kind: 'anchor' });
    expect(resolve('#')).toEqual({ kind: 'anchor' });
    const doc = render('[up](#setup) and [odd](<#a b%20c>)', 'docs/engine/README.md', known);
    expect(doc.html).toContain('<a href="#setup">up</a>');
    expect(doc.links).toEqual([
      { href: '#setup', resolved: { kind: 'anchor' } },
      { href: '#a%20b%20c', resolved: { kind: 'anchor' } },
    ]);
  });

  it('http, https and mailto links are external, and a link that starts with // is read as https', () => {
    expect(resolve('http://example.com/a')).toEqual({ kind: 'external', url: 'http://example.com/a' });
    expect(resolve('https://example.com/a?b=1#c')).toEqual({ kind: 'external', url: 'https://example.com/a?b=1#c' });
    expect(resolve('HTTPS://EXAMPLE.COM')).toEqual({ kind: 'external', url: 'https://example.com/' });
    expect(resolve('mailto:someone@example.com')).toEqual({ kind: 'external', url: 'mailto:someone@example.com' });
    expect(resolve('//example.com/path')).toEqual({ kind: 'external', url: 'https://example.com/path' });
    // An address the browser would refuse is broken, not external.
    for (const href of ['https://', 'http://exa mple.com', 'http://example.com:99999', '//']) {
      expect(resolve(href), href).toEqual(broken(/not a valid web address/));
    }
  });

  it('a scheme other than http, https or mailto is broken, however it is spelled', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'ftp://example.com/file',
      'tel:+15550100',
      'blob:https://example.com/0000',
      'about:blank',
      'view-source:https://example.com',
      'C:\\Windows\\win.ini',
      'x-custom:thing',
    ]) {
      expect(resolve(href), JSON.stringify(href)).toEqual(broken(/scheme/));
    }
    // The reason names the scheme, in lower case, and nothing else of the link.
    expect(resolve('JaVaScRiPt:alert(document.cookie)')).toEqual({ kind: 'broken', reason: 'the link scheme "javascript" is not allowed' });
  });

  it('a path is decoded before the lookup, and a query string is ignored', () => {
    expect(resolve('..%2FGDD.md')).toEqual({ kind: 'doc', slug: 'GDD' });
    expect(resolve('../../src/engine/scene%20graph.ts?plain=1#L3')).toEqual({ kind: 'github', url: `${GITHUB_BLOB_BASE}/src/engine/scene%20graph.ts#L3` });
    expect(resolve('decisions.md?plain=1#caf%C3%A9')).toEqual({ kind: 'doc', slug: 'engine/decisions', anchor: 'café' });
    expect(resolve('decisions.md#100%')).toEqual({ kind: 'doc', slug: 'engine/decisions', anchor: '100%' }); // a bad escape in an anchor is kept as written
    expect(resolve('%')).toEqual(broken(/malformed/)); // a bad escape in a path is broken
    expect(resolve('decisions%2emd')).toEqual({ kind: 'doc', slug: 'engine/decisions' });
  });

  it('an asset gives its url, with the anchor kept, and no lookup of the file is needed', () => {
    expect(resolve('../diagrams/flow.png')).toEqual({ kind: 'asset', url: '/files/aaaa1111/flow.png' });
    expect(resolve('../diagrams/flow.html#top')).toEqual({ kind: 'asset', url: '/files/bbbb2222/flow.html#top' });
    const exists = vi.fn(() => true);
    resolveHref('../diagrams/flow.png', 'docs/engine/README.md', { ...known, exists }, GITHUB_BLOB_BASE);
    resolveHref('../GDD.md', 'docs/engine/README.md', { ...known, exists }, GITHUB_BLOB_BASE);
    expect(exists).not.toHaveBeenCalled();
  });

  it('an empty link, a link of only a query, and a path with a backslash or a control character are broken', () => {
    expect(resolve('')).toEqual(broken(/empty/));
    expect(resolve('   ')).toEqual(broken(/empty/));
    expect(resolve('?plain=1')).toEqual(broken(/no path/));
    expect(resolve('..\\GDD.md')).toEqual(broken(/characters/));
    expect(resolve('GDD%00.md')).toEqual(broken(/characters/));
    expect(resolve('GDD%0A.md')).toEqual(broken(/characters/));
  });
});
