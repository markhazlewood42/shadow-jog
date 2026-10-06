import { describe, expect, it } from 'vitest';
import { type HtmlPart, hasHeadingLevel1, placeBanners } from '../src/web/docs/html';

// A doc is html from the server. A banner (Task 9: "a decision is open on this section") sits in
// front of the heading that it names. placeBanners cuts the html there, so each piece can be put
// into the page as it is and the banner (a React element) goes between the pieces.

const HTML = [
  '<h1 id="title">Title</h1>',
  '<p>Intro.</p>',
  '<h2 id="alpha">Alpha</h2>',
  '<p>Alpha text.</p>',
  '<h2 id="beta">Beta</h2>',
  '<p>Beta text.</p>',
].join('\n');

const banner = (anchor: string, node: string) => ({ anchor, node });

/** The parts as one text: the html as it is, and each banner as [node]. */
const textOf = (parts: HtmlPart<string>[]) => parts.map((part) => (part.kind === 'html' ? part.html : `[${part.banner.node}]`)).join('');

describe('placeBanners', () => {
  it('gives the html as one piece when there is no banner', () => {
    expect(placeBanners(HTML, [])).toEqual([{ kind: 'html', html: HTML }]);
  });

  it('puts a banner in front of the heading with its id, and the pieces join back into the same html', () => {
    const parts = placeBanners(HTML, [banner('beta', 'B')]);
    expect(parts.map((part) => part.kind)).toEqual(['html', 'banner', 'html']);
    expect(textOf(parts)).toBe(HTML.replace('<h2 id="beta">', '[B]<h2 id="beta">'));
    expect(parts[2]).toEqual({ kind: 'html', html: '<h2 id="beta">Beta</h2>\n<p>Beta text.</p>' });
  });

  it('puts a banner before the first heading with nothing in front of it', () => {
    const parts = placeBanners(HTML, [banner('title', 'T')]);
    expect(parts.map((part) => part.kind)).toEqual(['banner', 'html']);
    expect(textOf(parts)).toBe(`[T]${HTML}`);
  });

  it('keeps the order of the banners that name the same heading, and sorts the others by their place in the doc', () => {
    const parts = placeBanners(HTML, [banner('beta', '2'), banner('alpha', '1'), banner('beta', '3')]);
    expect(textOf(parts)).toBe(HTML.replace('<h2 id="alpha">', '[1]<h2 id="alpha">').replace('<h2 id="beta">', '[2][3]<h2 id="beta">'));
  });

  it('shows a banner whose heading is not in the doc first, so a decision never disappears', () => {
    const parts = placeBanners(HTML, [banner('gone', 'G'), banner('alpha', 'A')]);
    expect(textOf(parts)).toBe(`[G]${HTML.replace('<h2 id="alpha">', '[A]<h2 id="alpha">')}`);
  });

  it('shows the banners and nothing else for an empty doc', () => {
    expect(textOf(placeBanners('', [banner('x', 'X')]))).toBe('[X]');
    expect(placeBanners('', [])).toEqual([]);
  });

  it('finds a heading that a quote or a list holds, and puts the banner in front of that whole block', () => {
    const quote = '<p>Before.</p>\n<blockquote>\n<h2 id="inner">Inner</h2>\n<p>In the quote.</p>\n</blockquote>\n<p>After.</p>';
    expect(textOf(placeBanners(quote, [banner('inner', 'Q')]))).toBe(quote.replace('<blockquote>', '[Q]<blockquote>'));

    const list = '<ul>\n<li>\n<h3 id="deep">Deep</h3>\n</li>\n</ul>\n<hr>\n<h2 id="next">Next</h2>';
    expect(textOf(placeBanners(list, [banner('deep', 'L'), banner('next', 'N')]))).toBe(`[L]${list.replace('<h2 id="next">', '[N]<h2 id="next">')}`);
  });

  it('is not fooled by tags that hold no depth: a rule, a line break and an image', () => {
    const html = '<p>One<br>two <img src="/files/a/b.png" alt="x"></p>\n<hr>\n<h2 id="after">After</h2>';
    expect(textOf(placeBanners(html, [banner('after', 'A')]))).toBe(html.replace('<h2 id="after">', '[A]<h2 id="after">'));
  });

  it('reads an id that came percent-encoded, as a browser writes it for a heading with a non-ASCII word', () => {
    // The heading is not the first thing in the doc: a banner whose id is not found would go to the top instead.
    const html = '<p>Intro.</p>\n<h2 id="über-uns">Über uns</h2>';
    expect(textOf(placeBanners(html, [banner('%C3%BCber-uns', 'U')]))).toBe(html.replace('<h2', '[U]<h2'));
  });

  it('does not read a tag out of escaped text', () => {
    // The server escapes every "<" of the doc's own text, so this is text, not a heading.
    const html = '<p>&lt;h2 id="fake"&gt;not a heading&lt;/h2&gt;</p>\n<h2 id="real">Real</h2>';
    expect(textOf(placeBanners(html, [banner('fake', 'F'), banner('real', 'R')]))).toBe(`[F]${html.replace('<h2 id="real">', '[R]<h2 id="real">')}`);
  });
});

describe('hasHeadingLevel1', () => {
  it('is true when the html holds an h1 anywhere, and false otherwise', () => {
    expect(hasHeadingLevel1('<h1 id="a">A</h1>')).toBe(true);
    expect(hasHeadingLevel1('<p>x</p>\n<h1>B</h1>')).toBe(true);
    expect(hasHeadingLevel1('<h2 id="a">A</h2><p>h1</p>')).toBe(false);
    expect(hasHeadingLevel1('')).toBe(false);
  });
});
