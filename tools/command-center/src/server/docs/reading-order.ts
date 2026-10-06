import { posix } from 'node:path';
import MarkdownIt, { type Token } from 'markdown-it';
import { splitFrontmatter } from './frontmatter';

// Some docs end up with a "Reading order": a numbered list that says in which order to read a
// folder of docs (the engine README has one). nav.json can ask for it with
// `{ "readingOrder": "docs/engine/README.md" }`, and the nav then lists the docs in that order.
// This file reads the list, and turns each item into the path of a doc.

/** One item of a reading order, as written: the words of the item and the address its link points at. */
export type ReadingEntry = {
  /** The text of the link, or the words of the item when it has no link (without a full stop at the end). */
  label: string;
  /** The address of the item's first link as the doc wrote it, or null when the item has no link. */
  href: string | null;
};

/** A reading-order item turned into a repo path. `path` is null when the item does not name a doc. */
export type ResolvedEntry = { label: string; path: string | null };

/** A parser of its own: this file reads a doc's structure, and never renders it. */
const md = new MarkdownIt({ html: false, linkify: false });

/**
 * Whether a heading's text is "Reading order". The number in front of it ("3." or "3)" or "12.")
 * is not part of its name: sections get renumbered when a doc is edited, and the nav must not
 * stop working because of that.
 */
function isReadingOrderHeading(text: string): boolean {
  const name = text
    .replace(/^[\s\d.)]+/, '')
    .replace(/[\s:.]+$/, '')
    .toLowerCase();
  return name === 'reading order';
}

/** The words of some inline tokens: text and code, with line breaks as spaces. */
function plainText(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
  }
  return text;
}

/** One list item, from its first line of text (the inline token of its first paragraph). */
function entryOf(inline: Token): ReadingEntry | null {
  const children = inline.children ?? [];
  const open = children.findIndex((token) => token.type === 'link_open');
  const linkOpen = children[open];
  if (linkOpen !== undefined) {
    const close = children.findIndex((token, i) => i > open && token.type === 'link_close');
    const href = String(linkOpen.attrGet('href') ?? '');
    const label = plainText(children.slice(open + 1, close === -1 ? undefined : close)).trim();
    return { label: label || href, href: href === '' ? null : href };
  }
  // No link: the words of the item, without the full stop or colon that ends a sentence.
  const label = plainText(children).trim().replace(/[.:;,\s]+$/, '');
  return label === '' ? null : { label, href: null };
}

/**
 * The reading order of a doc: the items of the first list under its "Reading order" heading, in
 * order. The heading may have any level and any number in front of it. The list ends at the end
 * of the list, and the search for it ends at the next heading of the same or a higher level.
 * An item takes the first link in its own line; a nested list is not part of the order.
 * Gives an empty list when the doc has no such heading or no list under it.
 */
export function parseReadingOrder(markdown: string): ReadingEntry[] {
  const tokens = md.parse(splitFrontmatter(markdown).body, {});
  const headingAt = tokens.findIndex((token, i) => token.type === 'heading_open' && isReadingOrderHeading(plainText(tokens[i + 1]?.children ?? [])));
  const heading = tokens[headingAt];
  if (heading === undefined) return [];
  const headingLevel = Number(heading.tag.slice(1)); // the tag is "h1" to "h6"

  // Find the first list below the heading, without leaving the heading's section.
  let list: Token | undefined;
  let listAt = -1;
  for (let i = headingAt + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token.type === 'heading_open' && Number(token.tag.slice(1)) <= headingLevel) return [];
    if (token.type === 'ordered_list_open' || token.type === 'bullet_list_open') {
      list = token;
      listAt = i;
      break;
    }
  }
  if (list === undefined) return [];

  const entries: ReadingEntry[] = [];
  for (let i = listAt + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token.level === list.level && (token.type === 'ordered_list_close' || token.type === 'bullet_list_close')) break;
    if (token.type !== 'list_item_open' || token.level !== list.level + 1) continue;

    // The item's own line: the first inline token before a nested list or the end of the item.
    for (let j = i + 1; j < tokens.length; j++) {
      const inner = tokens[j];
      if (inner === undefined || (inner.type === 'list_item_close' && inner.level === token.level)) break;
      if (inner.type === 'ordered_list_open' || inner.type === 'bullet_list_open') break;
      if (inner.type === 'inline') {
        const entry = entryOf(inner);
        if (entry !== null) entries.push(entry);
        break;
      }
    }
  }
  return entries;
}

/**
 * The repo path that an address points at, read from the folder of the doc that holds it, or null
 * when it is not a markdown file of the repo (a web address, a picture, a path out of the repo, an
 * anchor with no file).
 */
function docPathOf(href: string, fromDocId: string): string | null {
  // Any scheme (https:, mailto:) and a "//host" address point out of the repo.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  // The anchor and the query say nothing about which file it is.
  let path = (href.split('#')[0] ?? '').split('?')[0] ?? '';
  if (path === '') return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\\]/.test(path)) return null;
  // A leading slash means the repo root, as on GitHub; anything else starts at the doc's own folder.
  const joined = path.startsWith('/') ? posix.normalize(path.replace(/^\/+/, '')) : posix.join(posix.dirname(fromDocId), path);
  if (joined === '..' || joined.startsWith('../') || !/\.md$/i.test(joined)) return null;
  return joined;
}

/**
 * Turns the items of a reading order into repo paths. `fromDocId` is the path of the doc that
 * holds the list: its links are read from its folder, and an item that says "This file" is the
 * doc itself.
 */
export function resolveReadingOrder(entries: readonly ReadingEntry[], fromDocId: string): ResolvedEntry[] {
  return entries.map(({ label, href }) => {
    if (href === null) return { label, path: /^this file\.?$/i.test(label.trim()) ? fromDocId : null };
    return { label, path: docPathOf(href, fromDocId) };
  });
}
