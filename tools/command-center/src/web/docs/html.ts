import { decodeOrKeep } from './paths';

// Helpers for the html of a doc, which the server renders (src/server/docs/render.ts). The page
// puts that html into itself as it is. The one thing it does with it is to put a banner in front
// of a heading, and for that it must cut the html there.
//
// The html has one thing that makes this simple and safe: the server escapes every "<" of the doc's
// own text (a doc cannot hold a tag), so every "<" in the html starts a real tag, and a scan over
// the tags sees exactly the structure that the browser will build.

/** Something to show in front of the heading with this id (a React node, in the page). */
export type Banner<N> = { anchor: string; node: N };

/** The html of a doc as pieces: html to put in as it is, and the banners that go between the pieces. */
export type HtmlPart<N> = { kind: 'html'; html: string } | { kind: 'banner'; banner: Banner<N> };

/** Tags that have no end tag, so they do not make a block that holds other tags. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** One tag of the html: whether it closes, its name, and what is between the name and the ">". */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)>/g;
const HEADING_TAG = /^h[1-6]$/;
const ID_ATTRIBUTE = /\sid="([^"]*)"/;

/**
 * For each heading that has an id: where the top-level block that holds it starts. A heading at the
 * top level is its own block. A heading inside a quote or a list is in the block of the quote or the
 * list, and cutting the html at the heading itself would cut that block in two.
 */
function headingBlocks(html: string): Map<string, number> {
  const blocks = new Map<string, number>();
  let depth = 0;
  let blockStart = 0;
  for (const match of html.matchAll(TAG)) {
    const name = (match[2] ?? '').toLowerCase();
    if (match[1] === '/') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) blockStart = match.index ?? 0;
    if (HEADING_TAG.test(name)) {
      const id = ID_ATTRIBUTE.exec(match[3] ?? '')?.[1];
      // Heading ids are unique in a doc (the server numbers a repeat), so the first one is the one.
      if (id !== undefined && !blocks.has(id)) blocks.set(id, blockStart);
    }
    if (!VOID_TAGS.has(name)) depth += 1;
  }
  return blocks;
}

/**
 * Cuts a doc's html in front of each heading that a banner names, and puts the banner there. The
 * pieces joined together are the html again. Banners for the same heading keep their order, and a
 * banner whose heading is not in the doc goes first of all: it says something about the doc that
 * Mark must see, and a heading that was renamed must not make it disappear.
 */
export function placeBanners<N>(html: string, banners: readonly Banner<N>[]): HtmlPart<N>[] {
  const blocks = headingBlocks(html);
  const placed = banners.map((banner, order) => ({
    banner,
    order,
    // An id may come percent-encoded, as a browser writes it for a heading with a non-ASCII word.
    at: blocks.get(banner.anchor) ?? blocks.get(decodeOrKeep(banner.anchor)) ?? 0,
  }));
  placed.sort((a, b) => a.at - b.at || a.order - b.order);

  const parts: HtmlPart<N>[] = [];
  let cursor = 0;
  for (const { banner, at } of placed) {
    if (at > cursor) {
      parts.push({ kind: 'html', html: html.slice(cursor, at) });
      cursor = at;
    }
    parts.push({ kind: 'banner', banner });
  }
  if (cursor < html.length) parts.push({ kind: 'html', html: html.slice(cursor) });
  return parts;
}

/** Whether the doc has a top heading of its own. A doc with none gets its title as the h1 (see DocView). */
export function hasHeadingLevel1(html: string): boolean {
  return /<h1[\s>]/i.test(html);
}
