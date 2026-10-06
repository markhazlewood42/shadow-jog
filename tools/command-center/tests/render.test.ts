import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KnownTargets } from '../src/server/docs/links';
import { type RenderContext, renderDoc } from '../src/server/docs/render';
import {
  FIXTURE_REPO,
  assetUrl,
  attributesOf,
  knownFor,
  listFiles,
  render,
  renderFile,
  tagNames,
} from './doc-helpers';
import { REPO_DIR } from './helpers';

// renderDoc reads a doc once and gives back everything the site needs from it: the html, the
// outline, the links, the frontmatter and the plain text for search. These tests feed it small
// texts (to pin each rule) and the sample docs of fixtures/repo (to see them work together).

const fixtureKnown = knownFor(FIXTURE_REPO, listFiles(FIXTURE_REPO, 'docs'));
const fixtureDoc = (name: string) => renderFile(FIXTURE_REPO, `docs/${name}`, fixtureKnown);

/** A made-up repo with one picture and one doc, for the tests that need a link to resolve. */
const known: KnownTargets = {
  docs: new Map([['docs/other.md', 'other']]),
  assets: new Map([
    ['docs/diagrams/flow.png', '/files/aaaa1111/flow.png'],
    ['docs/diagrams/flow.html', '/files/bbbb2222/flow.html'],
  ]),
  exists: (path) => ['docs/other.md', 'docs/diagrams/flow.png', 'docs/diagrams/flow.html', 'src/main.ts', 'src/art.png'].includes(path),
};

describe('renderDoc: the title', () => {
  it('no frontmatter: the title is the first # heading, else the file name', () => {
    // The first # heading is the title, even when other text comes before it or other headings after it.
    expect(render('Some intro text.\n\n# The real title\n\n## A section\n\n# A second title\n').title).toBe('The real title');
    // Markup in the heading is not part of the title.
    expect(render('# The `code` and *emphasis* title\n').title).toBe('The code and emphasis title');
    // A heading written with an underline counts, and a # line inside a code fence does not.
    expect(render('Underlined title\n================\n').title).toBe('Underlined title');
    expect(render('```\n# not a heading\n```\n\n# The heading\n').title).toBe('The heading');
    // With no # heading at all, the title is the file name without its .md. Type and status stay empty.
    const noHeading = render('Just prose.\n\n## Only a second-level heading\n', 'docs/engine/my-notes.md');
    expect(noHeading.title).toBe('my-notes');
    expect(noHeading.frontmatter).toEqual({});
    expect(noHeading.frontmatterError).toBeNull();
    expect(render('', 'README.md').title).toBe('README');
  });

  it('a title in the frontmatter wins over the first heading', () => {
    expect(render('---\ntitle: "  The header title  "\n---\n# The heading\n').title).toBe('The header title');
    // A title that is not text, or only spaces, is ignored.
    expect(render('---\ntitle: 1984\n---\n# The heading\n').title).toBe('The heading');
    expect(render('---\ntitle: "   "\n---\n# The heading\n').title).toBe('The heading');
  });
});

describe('renderDoc: line endings', () => {
  it('CRLF source renders like LF', () => {
    const lf =
      '---\ntitle: Windows\nstatus: draft\n---\n# Heading\n\nA line,\nand the next line.\n\n## Part\n\n```sh\necho hi\n```\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[a link](https://example.com)\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(render(crlf)).toEqual(render(lf));
    expect(render(crlf).frontmatter).toEqual({ title: 'Windows', status: 'draft' });

    // The sample file is saved with CRLF (git must not turn it into LF), and it renders like its LF form.
    const saved = readFileSync(join(FIXTURE_REPO, 'docs', 'crlf.md'), 'utf8');
    expect(saved.match(/\r\n/g)?.length).toBeGreaterThan(10);
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n'); // no bare LF left over
    const fromFile = fixtureDoc('crlf.md');
    expect(fromFile).toEqual(render(saved.replace(/\r\n/g, '\n'), 'docs/crlf.md', fixtureKnown));
    expect(fromFile.title).toBe('A doc saved with Windows line endings');
    expect(fromFile.frontmatter).toMatchObject({ type: 'note', status: 'draft' });
    expect(fromFile.headings.map((h) => h.text)).toEqual(['First part', 'Second part']);
  });
});

describe('renderDoc: headings', () => {
  it('heading ids match GitHub slugs and duplicates get -1', () => {
    const doc = render(
      [
        '# Intro',
        '## Intro',
        '## Setup',
        '## Setup',
        '## Setup',
        '## Notes',
        '## Notes',
        '## Notes-1',
        "## What's new? (v2)",
        '## The `scenes/battle.ts` file',
        '## Über cool',
        '## Fish &amp; chips',
        '## A & B',
        '## 2026 plan',
        '## E12: The *last* [choice](https://example.com)',
      ].join('\n\n'),
    );
    expect(doc.headings.map((h) => h.id)).toEqual([
      'intro-1', // the # heading took "intro", and GitHub counts every level together
      'setup',
      'setup-1',
      'setup-2',
      'notes',
      'notes-1',
      'notes-1-1', // "Notes-1" is already an id, so the next one gets its own -1
      'whats-new-v2',
      'the-scenesbattlets-file',
      'über-cool',
      'fish--chips',
      'a--b',
      '2026-plan',
      'e12-the-last-choice',
    ]);
    // The ids are in the html, on the headings they name.
    expect(doc.html).toContain('<h1 id="intro">Intro</h1>');
    expect(doc.html).toContain('<h2 id="intro-1">Intro</h2>');
    expect(doc.html).toContain('<h2 id="setup-2">Setup</h2>');
    expect(doc.html).toContain('<h2 id="the-scenesbattlets-file">The <code>scenes/battle.ts</code> file</h2>');
    // The outline text is plain: the markup is gone and an entity is the character it stands for.
    expect(doc.headings.map((h) => h.text).slice(-6)).toEqual(['The scenes/battle.ts file', 'Über cool', 'Fish & chips', 'A & B', '2026 plan', 'E12: The last choice']);

    // The sample doc with repeated headings, as the page will show it.
    const sample = fixtureDoc('duplicate-headings.md');
    expect(sample.headings).toEqual([
      { level: 2, text: 'Notes', id: 'notes' },
      { level: 2, text: 'Notes', id: 'notes-1' },
      { level: 3, text: 'Notes', id: 'notes-2' },
      { level: 2, text: "What's new? (v2)", id: 'whats-new-v2' },
      { level: 2, text: 'The config.json file', id: 'the-configjson-file' },
    ]);
  });

  it('a heading with no words, or only punctuation, gets no id and no outline entry', () => {
    const doc = render('##\n\n##\n\n## ???\n\n## Real');
    expect(doc.html).toBe('<h2></h2>\n<h2></h2>\n<h2>???</h2>\n<h2 id="real">Real</h2>\n');
    expect(doc.headings).toEqual([{ level: 2, text: 'Real', id: 'real' }]);
  });

  it('the outline holds h2 to h4 only', () => {
    const doc = render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n> ## Quoted\n\nSetext two\n----------\n');
    expect(doc.headings).toEqual([
      { level: 2, text: 'Two', id: 'two' },
      { level: 3, text: 'Three', id: 'three' },
      { level: 4, text: 'Four', id: 'four' },
      { level: 2, text: 'Quoted', id: 'quoted' },
      { level: 2, text: 'Setext two', id: 'setext-two' },
    ]);
    // The headings left out of the outline still get an id, so a link to one of them works.
    for (const [tag, id] of [['h1', 'one'], ['h5', 'five'], ['h6', 'six']] as const) {
      expect(doc.html).toContain(`<${tag} id="${id}">`);
    }
  });
});

describe('renderDoc: links', () => {
  it('a javascript: or data: link renders as a broken marker', () => {
    const doc = render(
      [
        '[click me](javascript:alert(1))',
        '[mixed case](JaVaScRiPt:alert(1))',
        '[entity](jav&#x09;ascript:alert(1))',
        '[colon entity](javascript&colon;alert(1))',
        '[data link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
        '[vb link](vbscript:msgbox(1))',
        '[a reference][r]',
        '![an image](javascript:alert(1))',
        '![a data image](data:image/png;base64,AAAA)',
        '[r]: javascript:alert(1)',
      ].join('\n\n'),
    );
    // No anchor and no picture at all: all nine became a marked span that keeps the words of the link.
    expect(tagNames(doc.html)).toEqual(['p', 'span']);
    expect(doc.html.match(/<span class="broken-link"/g)).toHaveLength(9);
    for (const words of ['click me', 'mixed case', 'entity', 'colon entity', 'data link', 'vb link', 'a reference', 'an image', 'a data image']) {
      expect(doc.html, words).toMatch(new RegExp(`<span class="broken-link"[^>]*>${words}</span>`));
    }
    expect(doc.html).not.toMatch(/href=|src=|javascript:|vbscript:|data:/i);
    expect(doc.links.every((link) => link.resolved.kind === 'broken')).toBe(true);

    // An autolink of that kind shows its text in a marker too, and there is no link to follow.
    expect(tagNames(render('<javascript:alert(1)>').html)).toEqual(['p', 'span']);
  });

  it('a broken link renders a marked span, not an anchor', () => {
    const doc = render('A [gone link](missing.md) and a [live one](#top), and a [leaving one](../../../outside.md).');
    expect(doc.html).toContain('<span class="broken-link" title="the file does not exist in the repo">gone link</span>');
    expect(doc.html).toContain('<span class="broken-link" title="the link points outside the repo">leaving one</span>');
    expect(doc.html).toContain('<a href="#top">live one</a>');
    expect(doc.html.match(/<a /g)).toHaveLength(1);
    // The words inside a broken link keep their own markup.
    expect(render('[a `code` word](missing.md)').html).toContain('>a <code>code</code> word</span>');
    // The sample doc of broken links: the first link works, the other four are markers.
    const sample = fixtureDoc('broken-link.md');
    expect(sample.html.match(/class="broken-link"/g)).toHaveLength(4);
    expect(sample.html).toContain('<a href="/docs/no-frontmatter">A link to a doc that exists</a>');
  });

  it('an external link opens in a new tab with noopener', () => {
    const doc = render('[an example](https://example.com/a?b=1&c=2), <https://example.org>, [titled](http://example.net "A title") and [mail](mailto:someone@example.com).');
    expect(doc.html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">an example</a>');
    expect(doc.html).toContain('<a href="https://example.org/" target="_blank" rel="noopener noreferrer">https://example.org</a>');
    expect(doc.html).toContain('<a href="http://example.net/" title="A title" target="_blank" rel="noopener noreferrer">titled</a>');
    // A mail link opens the mail program: a new tab would stay empty.
    expect(doc.html).toContain('<a href="mailto:someone@example.com">mail</a>');
  });

  it('links between docs stay in the tab, and links to files open in a new tab', () => {
    const doc = render(
      '[a doc](other.md#part), [code](../src/main.ts#L5), [a diagram source](diagrams/flow.html) and [a picture](diagrams/flow.png)',
      'docs/page.md',
      known,
    );
    expect(doc.html).toContain('<a href="/docs/other#part">a doc</a>');
    expect(doc.html).toContain('<a href="https://github.com/fixture-owner/fixture-repo/blob/main/src/main.ts#L5" target="_blank" rel="noopener noreferrer">code</a>');
    expect(doc.html).toContain('<a href="/files/bbbb2222/flow.html" target="_blank" rel="noopener noreferrer">a diagram source</a>');
    expect(doc.html).toContain('<a href="/files/aaaa1111/flow.png" target="_blank" rel="noopener noreferrer">a picture</a>');
  });

  it('links lists every link and image of the doc, in order, each with what it resolves to', () => {
    const doc = render(
      'See [a doc](other.md#x), ![a picture](diagrams/flow.png), <https://example.com> and [a reference][ref].\n\n[gone](missing.md) and [up](#top)\n\n[ref]: https://example.org/page\n',
      'docs/page.md',
      known,
    );
    expect(doc.links).toEqual([
      { href: 'other.md#x', resolved: { kind: 'doc', slug: 'other', anchor: 'x' } },
      { href: 'diagrams/flow.png', resolved: { kind: 'asset', url: '/files/aaaa1111/flow.png' } },
      { href: 'https://example.com', resolved: { kind: 'external', url: 'https://example.com/' } },
      { href: 'https://example.org/page', resolved: { kind: 'external', url: 'https://example.org/page' } },
      { href: 'missing.md', resolved: { kind: 'broken', reason: 'the file does not exist in the repo' } },
      { href: '#top', resolved: { kind: 'anchor' } },
    ]);
    expect(render('No links here.').links).toEqual([]);
  });

  it('a resolver that throws, or hands back an address that is not safe to print, cannot put a script in the page', () => {
    // A resolver that throws: the link is a marker, the doc still renders, and the failure is in `links`.
    const throwing: RenderContext = {
      docId: 'docs/x.md',
      resolve: () => {
        throw new Error('boom');
      },
    };
    const doc = renderDoc('# Title\n\n[a link](x.md) and ![a picture](x.png)', throwing);
    expect(doc.title).toBe('Title');
    expect(tagNames(doc.html)).toEqual(['h1', 'p', 'span']);
    expect(doc.links.map((link) => link.resolved.kind)).toEqual(['broken', 'broken']);

    // A resolver of another make that answers with an address that could run script: the renderer checks it again.
    const unsafe = ['javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//evil.example/x', 'x-custom:thing', ''];
    for (const url of unsafe) {
      for (const kind of ['external', 'github', 'asset'] as const) {
        const hostile: RenderContext = { docId: 'docs/x.md', resolve: () => ({ kind, url }) };
        const rendered = renderDoc('[a link](x) and ![a picture](y)', hostile);
        expect(tagNames(rendered.html), `${kind} ${JSON.stringify(url)}`).toEqual(['p', 'span']);
        expect(rendered.html).not.toMatch(/href=|src=/i);
      }
    }
    // A resolver that calls a link in-page when it does not start with # gets a marker, not a link.
    const anchor: RenderContext = { docId: 'docs/x.md', resolve: () => ({ kind: 'anchor' }) };
    expect(tagNames(renderDoc('[a](javascript:alert(1))', anchor).html)).toEqual(['p', 'span']);
    expect(renderDoc('[a](#top)', anchor).html).toContain('<a href="#top">a</a>');
  });
});

describe('renderDoc: images', () => {
  it('an image gets its asset url and data-zoom', () => {
    const doc = render('![A flow of three boxes](diagrams/flow.png "The flow")', 'docs/diagram.md', known);
    expect(attributesOf(doc.html, 'img')).toEqual({
      src: '/files/aaaa1111/flow.png',
      alt: 'A flow of three boxes',
      title: 'The flow',
      'data-zoom': '/files/aaaa1111/flow.png',
    });
    expect(doc.links).toEqual([{ href: 'diagrams/flow.png', resolved: { kind: 'asset', url: '/files/aaaa1111/flow.png' } }]);

    // The sample doc: the picture, then the link to its editable source.
    const sample = fixtureDoc('diagram.md');
    const flow = assetUrl('docs/diagrams/flow.png');
    expect(attributesOf(sample.html, 'img')).toMatchObject({ src: flow, 'data-zoom': flow });
    expect(attributesOf(sample.html, 'img').alt).toBe('A flow of three boxes: input, work and output, joined by arrows.');
    expect(sample.html).toContain(`<a href="${assetUrl('docs/diagrams/flow.html')}" target="_blank" rel="noopener noreferrer">diagrams/flow.html</a>`);
  });

  it('an image the site cannot serve becomes a link out or a marker, never a picture the page cannot load', () => {
    const doc = render(
      '![an outside picture](https://example.com/a.png) ![a repo picture](../src/art.png) ![a missing picture](missing.png) ![a doc](other.md) ![](missing.png)',
      'docs/page.md',
      known,
    );
    expect(tagNames(doc.html)).toEqual(['a', 'p', 'span']);
    expect(doc.html).toContain('<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">an outside picture</a>');
    expect(doc.html).toContain('<a href="https://github.com/fixture-owner/fixture-repo/blob/main/src/art.png" target="_blank" rel="noopener noreferrer">a repo picture</a>');
    expect(doc.html).toContain('<span class="broken-link" title="the file does not exist in the repo">a missing picture</span>');
    expect(doc.html).toContain('<span class="broken-link" title="an image must be a picture file, not a doc or an anchor">a doc</span>');
    // With no alt text, the marker shows the address as written.
    expect(doc.html).toContain('title="the file does not exist in the repo">missing.png</span>');

    // A picture inside a link (a badge) shows its words, and the link around it stays the only link: html has no link inside a link.
    const badge = render('[![build badge](https://img.example.com/b.svg)](https://example.com/build)');
    expect(badge.html).toBe('<p><a href="https://example.com/build" target="_blank" rel="noopener noreferrer">build badge</a></p>\n');
    expect(badge.links.map((link) => link.href)).toEqual(['https://example.com/build', 'https://img.example.com/b.svg']);
    // Once the link has closed, a picture after it is a link again.
    expect(render('[a link](missing.md) then ![an outside picture](https://example.com/a.png)').html).toContain(
      '<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">an outside picture</a>',
    );
  });
});

describe('renderDoc: plain prose', () => {
  it('a single line break stays inside its paragraph, quotes stay straight, and a bare file name is not turned into a link', () => {
    const doc = render('Open README.md, run build.sh and say "hi".\nA second line.');
    expect(doc.html).toBe('<p>Open README.md, run build.sh and say &quot;hi&quot;.\nA second line.</p>\n');
    expect(doc.links).toEqual([]);
  });

  it('renders one doc without leaving a trace in the next', () => {
    const source = '# One\n\n## Same\n\n## Same\n\n[a link](missing.md)';
    const first = render(source);
    render('# Other\n\n## Same\n\n## Different');
    expect(render(source)).toEqual(first);
    expect(render('## Same').headings).toEqual([{ level: 2, text: 'Same', id: 'same' }]);
  });
});

describe('renderDoc: raw HTML', () => {
  it('raw HTML in a doc is escaped', () => {
    const doc = render(
      [
        '# Title',
        '<script>alert(1)</script>',
        'Inline <b onclick="x()">bold</b> and <img src=x onerror=alert(1)> here.',
        '<div class="x">block <a href="javascript:alert(1)">link</a></div>',
        '<!-- a comment -->',
        '<iframe src="https://example.com"></iframe>',
        '<style>body { display: none }</style>',
        '<details><summary>More</summary>hidden</details>',
        '```html\n<script>inside a fence</script>\n```',
        'An inline `<script>` span.',
      ].join('\n\n'),
    );
    // Every tag in the output is one that markdown made. None of the tags in the doc text got through.
    expect(tagNames(doc.html)).toEqual(['code', 'h1', 'p', 'pre']);
    expect(doc.html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(doc.html).toContain('&lt;b onclick=&quot;x()&quot;&gt;bold&lt;/b&gt;');
    expect(doc.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(doc.html).toContain('&lt;!-- a comment --&gt;');
    expect(doc.html).toContain('<pre><code class="language-html">&lt;script&gt;inside a fence&lt;/script&gt;\n</code></pre>');
    expect(doc.html).not.toMatch(/<(script|iframe|style|details|div|b|img)\b/i);
    // An escaped tag is still text, so it can be searched.
    expect(doc.text).toContain('<script>alert(1)</script>');
  });
});

describe('renderDoc: text for search', () => {
  it('text holds headings, prose and code', () => {
    const doc = render(
      [
        '---\ntitle: Not in the text\nstatus: also not\n---',
        '# Search title',
        'Some *prose* with `inline code`, a [link label](https://example.com/hidden-address) and an ![alt words](missing.png) image.',
        '## A section heading',
        '```ts\nconst answer = forty + 2;\n```',
        '- first item\n- second item',
        '| cell one | cell two |\n|---|---|\n| cell three | cell four |',
        '> a quoted line',
        'A paragraph with a soft break\nand a second line, then a hard break  \nand a third.',
      ].join('\n\n'),
    );
    for (const piece of [
      'Search title',
      'Some prose with inline code, a link label and an alt words image.',
      'A section heading',
      'const answer = forty + 2;',
      'first item',
      'second item',
      'cell one',
      'cell four',
      'a quoted line',
      'A paragraph with a soft break and a second line, then a hard break and a third.', // a line break is a space, not nothing
    ]) {
      expect(doc.text, piece).toContain(piece);
    }
    // The markup, the addresses and the frontmatter are not text.
    for (const left of ['*prose*', '`inline code`', 'hidden-address', 'https://', 'Not in the text', 'also not', '```', '##']) {
      expect(doc.text, left).not.toContain(left);
    }
    // One piece to a line, so a search hit can show the line it was found in.
    expect(doc.text.split('\n')).toContain('Search title');
    expect(doc.text.split('\n')).toContain('const answer = forty + 2;');
    expect(render('').text).toBe('');
  });
});

describe('renderDoc: the sample docs', () => {
  it('render as their names say', () => {
    const plain = fixtureDoc('no-frontmatter.md');
    expect(plain.title).toBe('A plain doc');
    expect(plain.frontmatter).toEqual({});
    expect(plain.frontmatterError).toBeNull();
    expect(plain.links.map((link) => link.resolved)).toEqual([
      { kind: 'doc', slug: 'tables', anchor: 'alignment' },
      { kind: 'doc', slug: 'diagram' },
      { kind: 'doc', slug: 'duplicate-headings', anchor: 'notes-1' },
    ]);

    const tables = fixtureDoc('tables.md');
    expect(tables.html.match(/<table>/g)).toHaveLength(2);
    expect(tables.html).toContain('<th style="text-align:right">Count</th>');
    expect(tables.html).toContain('<td style="text-align:center">an escaped pipe</td>');
    expect(tables.html).toContain('<td style="text-align:left">a | b</td>');
    expect(tables.html).toContain('<td style="text-align:left"><code>pears</code></td>');
    expect(tables.html).toContain('<a href="/docs/no-frontmatter">the plain doc</a>');
    expect(tables.frontmatter).toEqual({ title: 'Tables', type: 'reference', updated: '2026-01-02' });
    expect(tables.text).toContain('a long cell with several words in it');

    expect(fixtureDoc('diagram.md').frontmatter).toMatchObject({ type: 'design', status: 'approved', updated: '2026-01-04' });
  });
});

describe('renderDoc: odd sources', () => {
  it('render without a throw', () => {
    const sources = [
      '',
      '\n',
      '---',
      '---\n',
      '---\n---\n',
      '---\n---',
      '\uFEFF',
      '\0',
      'a\0b\r\0',
      '# ',
      '#',
      '[]()',
      '[]( )',
      '![]()',
      '[a](<>)',
      '[a](<b c>)',
      '[\\]](x)',
      '<',
      '&',
      '&#0;',
      '&#xFFFFFFFF;',
      '[a]: ',
      '[a]: <>\n\n[a]',
      `${'['.repeat(5000)}x`,
      `${'> '.repeat(500)}x`,
      `${'- '.repeat(500)}x`,
      `${'* '.repeat(5000)}x`,
      `${'`'.repeat(5001)}`,
      'x'.repeat(1_000_000),
      Array.from({ length: 2000 }, (_, i) => `## Heading ${i % 7}`).join('\n'),
      '```\nnever closed',
      '| a | b |\n|---|\n| 1 |',
    ];
    for (const src of sources) {
      const doc = render(src);
      expect(typeof doc.html, JSON.stringify(src.slice(0, 40))).toBe('string');
      expect(typeof doc.title).toBe('string');
    }
  });

  it('keep repeated headings unique however many there are', () => {
    const doc = render(Array.from({ length: 300 }, () => '## Same').join('\n\n'));
    const ids = doc.headings.map((heading) => heading.id);
    expect(new Set(ids).size).toBe(300);
    expect(ids.slice(0, 3)).toEqual(['same', 'same-1', 'same-2']);
  });
});

describe('the real docs of the repo', () => {
  const docFiles = listFiles(REPO_DIR, 'docs');
  const rootFiles = readdirSync(REPO_DIR).filter((name) => name.toLowerCase().endsWith('.md'));
  const realKnown = knownFor(REPO_DIR, [...docFiles, ...rootFiles]);

  /** Renders each file and lists what went wrong: a throw, or a doc with no title, no html or a script tag. */
  const renderAll = (files: string[]): string[] => {
    const problems: string[] = [];
    for (const file of files) {
      try {
        const doc = renderFile(REPO_DIR, file, realKnown);
        if (doc.title === '') problems.push(`${file}: no title`);
        if (doc.html === '') problems.push(`${file}: no html`);
        if (/<script/i.test(doc.html)) problems.push(`${file}: a script tag in the html`);
      } catch (error) {
        problems.push(`${file}: threw ${String(error)}`);
      }
    }
    return problems;
  };

  it('every real docs/**/*.md renders without a throw', () => {
    const docs = docFiles.filter((file) => file.toLowerCase().endsWith('.md'));
    expect(docs.length, 'the search found the real docs').toBeGreaterThan(30);
    expect(renderAll(docs)).toEqual([]);
  });

  it('the markdown files at the root render without a throw too', () => {
    expect(rootFiles).toEqual(expect.arrayContaining(['README.md', 'CHANGELOG.md', 'status.md']));
    expect(renderAll(rootFiles)).toEqual([]);
  });
});
