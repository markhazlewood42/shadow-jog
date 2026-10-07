import { describe, expect, it } from 'vitest';
import { parseReadingOrder, resolveReadingOrder } from '../src/server/docs/reading-order';

// A synthetic overview doc shaped like the engine README: a numbered section named "Reading order"
// that holds a numbered list. The first item has no link and says "This file".
const overview = (heading: string) => `---
type: design
title: "Overview of the made-up engine"
---

# Overview of the made-up engine

Some words before the list.

${heading}

1. This file.
2. [scene-graph.md](scene-graph.md): what the tree is made of.
3. [frame.md](frame.md#the-loop): the loop and the pipeline.
4. [\`interfaces.md\`](./interfaces.md): the key interfaces.

Source material: the notes, which are not part of the order.

## 4. Another section

1. [not-in-the-order.md](not-in-the-order.md)
`;

const README_ID = 'docs/engine/README.md';
const EXPECTED_PATHS = ['docs/engine/README.md', 'docs/engine/scene-graph.md', 'docs/engine/frame.md', 'docs/engine/interfaces.md'];

describe('parseReadingOrder', () => {
  it('reading order maps "This file" to the README and survives a renumbered heading', () => {
    const entries = parseReadingOrder(overview('## 3. Reading order'));
    expect(entries).toEqual([
      { label: 'This file', href: null },
      { label: 'scene-graph.md', href: 'scene-graph.md' },
      { label: 'frame.md', href: 'frame.md#the-loop' },
      { label: 'interfaces.md', href: './interfaces.md' },
    ]);
    // "This file" is the doc that holds the list, so it maps to the README itself, and the rest are
    // read from the README's folder.
    expect(resolveReadingOrder(entries, README_ID).map((e) => e.path)).toEqual(EXPECTED_PATHS);

    // The section number of the heading is not part of its name: renumbered, unnumbered, a
    // different level and a different style all give the same order.
    for (const heading of ['## 9. Reading order', '## Reading order', '### 3) Reading order', '## 12.  READING ORDER:', '#### Reading order', '## **4.** Reading *order*', 'Reading order\n-------------']) {
      expect(parseReadingOrder(overview(heading)), heading).toEqual(entries);
    }
  });

  it('gives an empty list when the doc has no Reading order heading, or the heading has no list', () => {
    expect(parseReadingOrder('# Title\n\n1. [a.md](a.md)\n')).toEqual([]);
    expect(parseReadingOrder('# Title\n\n## Reading order\n\nNo list here, only words.\n\n## Next\n\n1. [a.md](a.md)\n')).toEqual([]);
    expect(parseReadingOrder('')).toEqual([]);
    // A heading that only contains the words is not the heading.
    expect(parseReadingOrder('## The reading order of everything\n\n1. [a.md](a.md)\n')).toEqual([]);
  });

  it('reads a bullet list, an item that is only a link, an item with no link, and ignores a nested list', () => {
    const md = `## Reading order

- [One](one.md)
  - [nested.md](nested.md)
- Two, in words only: no link here.
- [Three](three.md) and [a second link](ignored.md)
`;
    expect(parseReadingOrder(md)).toEqual([
      { label: 'One', href: 'one.md' },
      { label: 'Two, in words only: no link here', href: null },
      { label: 'Three', href: 'three.md' },
    ]);
  });

  it('stops at the next heading of the same or a higher level, and reads only the first list', () => {
    const md = `## Reading order

1. [first.md](first.md)

A paragraph between.

1. [second-list.md](second-list.md)

### A deeper heading

1. [deeper.md](deeper.md)

## Done

1. [after.md](after.md)
`;
    expect(parseReadingOrder(md)).toEqual([{ label: 'first.md', href: 'first.md' }]);
  });

  it('reads the list when the doc has CRLF line breaks, a byte order mark and a frontmatter block', () => {
    const md = `﻿${overview('## 3. Reading order')}`.replace(/\n/g, '\r\n');
    expect(parseReadingOrder(md)).toHaveLength(4);
  });
});

describe('resolveReadingOrder', () => {
  it('resolves each address from the folder of the doc: ./ and ../, a leading slash, an anchor, a query and a percent-escape', () => {
    const resolved = resolveReadingOrder(
      [
        { label: 'a', href: 'a.md' },
        { label: 'b', href: './sub/b.md#top' },
        { label: 'c', href: '../c.md?plain=1' },
        { label: 'd', href: '/docs/d.md' },
        { label: 'e', href: 'with%20space.md' },
      ],
      'docs/engine/README.md',
    );
    expect(resolved.map((e) => e.path)).toEqual(['docs/engine/a.md', 'docs/engine/sub/b.md', 'docs/c.md', 'docs/d.md', 'docs/engine/with space.md']);
  });

  it('gives no path to an entry that is not a doc of the repo: no link, a web address, another file type, a path outside the repo', () => {
    const resolved = resolveReadingOrder(
      [
        { label: 'Words only', href: null },
        { label: 'web', href: 'https://example.com/a.md' },
        { label: 'mail', href: 'mailto:x@example.com' },
        { label: 'picture', href: 'a.png' },
        { label: 'outside', href: '../../../a.md' },
        { label: 'anchor only', href: '#section' },
        { label: 'ok', href: 'ok.md' },
      ],
      'docs/engine/README.md',
    );
    expect(resolved).toEqual([
      { label: 'Words only', path: null },
      { label: 'web', path: null },
      { label: 'mail', path: null },
      { label: 'picture', path: null },
      { label: 'outside', path: null },
      { label: 'anchor only', path: null },
      { label: 'ok', path: 'docs/engine/ok.md' },
    ]);
  });

  it('"This file" may end in a full stop and be written in any case; any other text with no link has no path', () => {
    const resolved = resolveReadingOrder(
      [
        { label: 'This file', href: null },
        { label: 'this FILE.', href: null },
        { label: 'This file and more', href: null },
      ],
      'README.md',
    );
    expect(resolved.map((e) => e.path)).toEqual(['README.md', 'README.md', null]);
  });
});
