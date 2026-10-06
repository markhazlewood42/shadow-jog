import { posix } from 'node:path';
import GithubSlugger from 'github-slugger';
import MarkdownIt, { type Env, type StateBlock, type StateInline, type Token } from 'markdown-it';
import { splitFrontmatter } from './frontmatter';
import { type ResolvedLink, docUrl } from './links';

// One pass over a doc gives the site everything it needs from it: the html to show, the outline,
// the links (for backlinks), the frontmatter, and plain text for search. The pass is: read the
// frontmatter, let markdown-it turn the rest into a list of tokens (the pieces of the doc, such as
// "heading starts", "text", "link starts"), walk that list once to collect and tidy, then let
// markdown-it write the html from the same tokens. Nothing is parsed twice.
//
// The page puts this html straight into itself, and the page holds the token that lets Mark answer
// decisions. So doc text must never be able to run script. Three rules keep that true:
//   1. Raw HTML in a doc is escaped, never passed on (`html: false` below). The one thing dropped
//      instead of escaped is an HTML comment (see `dropCommentBlock`): it prints nothing at all.
//   2. A link or an image gets its address from a `ResolvedLink`, not from the doc text, and the
//      address is printed only after `isPrintable` has checked it again. (The one address that
//      comes from the doc text is an in-page `#anchor`, and it is printed only if it starts with #.)
//   3. Heading ids are built from letters, digits, hyphens and underscores by the slugger.

/** What `renderDoc` needs to know about the doc it renders. */
export type RenderContext = {
  /** The path of the doc inside the repo, with forward slashes, such as `docs/engine/decisions.md`. */
  docId: string;
  /** Says what a link points at. The doc index gives each doc a `resolve` that checks links against the repo (see `resolveHref`). */
  resolve(href: string): ResolvedLink;
};

/** What the site keeps of one doc. */
export type RenderedDoc = {
  /** The `title` of the frontmatter, else the first `#` heading, else the file name without `.md`. */
  title: string;
  /** The key: value pairs of the frontmatter. Empty when there is none, or when it could not be read. */
  frontmatter: Record<string, unknown>;
  /** What is wrong with the frontmatter, or null. A doc with a bad header still renders. */
  frontmatterError: string | null;
  /** The doc as html. Safe to put in a page: see the rules above. */
  html: string;
  /** The outline: the h2 to h4 headings, each with the id its heading has in `html`. */
  headings: { level: 2 | 3 | 4; text: string; id: string }[];
  /** Every link and image of the doc in the order they appear, each with what it points at. */
  links: { href: string; resolved: ResolvedLink }[];
  /** The words of the doc for search: headings, prose and code, one piece to a line. An HTML comment is not part of it. */
  text: string;
};

/**
 * One parser for every doc. It keeps no state between docs (what one doc needs travels in the
 * tokens), so sharing it is safe.
 */
const md = new MarkdownIt({
  html: false, // raw HTML in a doc is shown as text, never run
  linkify: false, // `README.md` or `build.sh` must not turn into a link just because `.md` and `.sh` are country domains
  typographer: false, // no curly quotes: the text on the page stays the text of the file
  breaks: false, // a single line break inside a paragraph is a space, as on GitHub
});

// Markdown-it refuses `javascript:` and `data:` links by leaving the markdown as plain text. We
// want the opposite: make the link anyway, so `resolveHref` can answer "broken" and the page can
// show a marker where the link was. No address reaches the html except through `printTarget`.
md.validateLink = () => true;

// HTML comments (`<!-- ... -->`, on one line or many) are notes for the author. GitHub does not
// show them, so this site does not either. With raw HTML off, markdown-it would read a comment as
// plain text: it would show on the page, a blank line inside it would cut it into paragraphs, and a
// `#` line inside it would become a heading. These two rules drop a comment before that happens.
// They drop comments and nothing else: all other raw HTML stays escaped text. They sit next to
// markdown-it's own HTML rules, so the parser has already decided what is code by the time they
// run: a comment in a code span, a fenced block or an indented block is code, and stays.
md.block.ruler.before('html_block', 'html_comment', dropCommentBlock, { alt: ['paragraph', 'reference', 'blockquote'] });
md.inline.ruler.before('html_inline', 'html_comment', dropCommentInline);

// A dropped block comment leaves an empty "gap" token where it was, and it prints nothing, with one
// exception. The paragraphs of a tight list item are hidden, so two of them print side by side, and
// without a line break between them the words around the comment would run together: the item
// "- item", then a comment line, then "continues", would print as "itemcontinues".
md.renderer.rules.html_comment = (tokens, idx) => (tokens[idx - 1]?.hidden ? '\n' : '');

/**
 * A comment that starts a line (up to three spaces in) runs to the line that holds its `-->`, as
 * CommonMark ends an HTML comment block. Those lines are dropped whole. What follows the `-->` on
 * the last line is kept, as a paragraph of its own.
 */
function dropCommentBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // Four spaces of indent make an indented code block, and a comment in code is code.
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false;
  const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  if (!state.src.startsWith('<!--', start)) return false;
  if (findClose(state, start + 2) === -1) return false; // no `-->` anywhere after it, so it cannot close
  // A dry run, asked by a paragraph: "does a comment start here?" Yes, and it ends the paragraph. The
  // answer must not depend on the list item or quote the paragraph is in: a comment line that is
  // not indented enough to belong to the item still ends the item's paragraph, as an HTML block does.
  if (silent) return true;

  // Find the line that closes the comment. On the first line the search starts at the dashes of
  // the opening, because `<!-->` is a whole comment.
  let closeLine = -1;
  let after = 0;
  for (let line = startLine; line < endLine; line++) {
    // A list item or a quote that ends before the comment closes cannot own a later line.
    if (line > startLine && !state.isEmpty(line) && (state.sCount[line] ?? 0) < state.blkIndent) break;
    const from = line === startLine ? start + 2 : (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
    const close = state.src.slice(from, state.eMarks[line] ?? from).indexOf('-->');
    if (close !== -1) {
      closeLine = line;
      after = from + close + 3;
      break;
    }
  }
  // A comment that never closes stays visible as text. (In CommonMark it would swallow the rest of the doc.)
  if (closeLine === -1) return false;

  state.line = closeLine + 1;
  const gap = state.push('html_comment', '', 0);
  gap.map = [startLine, closeLine + 1];
  // More comments may follow on the closing line. Drop those too, and keep whatever is left.
  let rest = state.src.slice(after, state.eMarks[closeLine] ?? after);
  for (;;) {
    rest = rest.trimStart();
    const close = rest.startsWith('<!--') ? rest.indexOf('-->', 2) : -1;
    if (close === -1) break;
    rest = rest.slice(close + 3);
  }
  rest = rest.trim();
  if (rest !== '') {
    const open = state.push('paragraph_open', 'p', 1);
    open.map = [closeLine, closeLine + 1];
    const inline = state.push('inline', '', 0);
    inline.content = rest; // markdown-it reads it as inline markdown later, so it is escaped like any other text
    inline.map = [closeLine, closeLine + 1];
    inline.children = [];
    state.push('paragraph_close', 'p', -1);
  }
  return true;
}

/** A comment inside a paragraph, a heading, a table cell or a link label, even one that runs over several lines. */
function dropCommentInline(state: StateInline): boolean {
  const start = state.pos;
  if (!state.src.startsWith('<!--', start)) return false;
  const close = findClose(state, start + 2);
  // The comment must close inside the text being read (a link label is read up to its `]` only).
  if (close === -1 || close + 3 > state.posMax) return false;
  state.pos = close + 3;
  return true;
}

/** The last search for a closing `-->` in each text that is being read. See `findClose`. */
const closeSearches = new WeakMap<StateBlock | StateInline, { from: number; at: number }>();

/**
 * Where the first `-->` at or after `from` is, or -1. The answer is remembered, because a comment
 * that never closes would otherwise search the rest of the text again for every later `<!--`, and a
 * text with thousands of them would take the square of its size in time.
 */
function findClose(state: StateBlock | StateInline, from: number): number {
  const last = closeSearches.get(state);
  // A search that began at or before `from` already knows: it found no `-->` at all, or one that is still ahead.
  if (last !== undefined && last.from <= from && (last.at === -1 || last.at >= from)) return last.at;
  const at = state.src.indexOf('-->', from);
  closeSearches.set(state, { from, at });
  return at;
}

/** The class of the span that stands where a link or image does not work. The page styles it. */
const BROKEN_CLASS = 'broken-link';

/** Why an address that a resolver handed back is not printed. */
const UNSAFE_REASON = 'the link has an address that is not safe to open';

export function renderDoc(src: string, ctx: RenderContext): RenderedDoc {
  const { data, body, error } = splitFrontmatter(src);
  const env: Env = {};
  const tokens = md.parse(body, env);
  const found = collect(tokens, ctx);
  const html = md.renderer.render(tokens, md.options, env);

  const headerTitle = typeof data.title === 'string' ? data.title.trim() : '';
  return {
    title: headerTitle || found.firstHeading || titleFromPath(ctx.docId),
    frontmatter: data,
    frontmatterError: error,
    html,
    headings: found.headings,
    links: found.links,
    text: found.textLines.join('\n'),
  };
}

type Collected = {
  firstHeading: string;
  headings: RenderedDoc['headings'];
  links: RenderedDoc['links'];
  textLines: string[];
};

/**
 * Walks the tokens once. It collects the outline, the links and the text, and it edits the tokens
 * that the html needs changed: heading ids, link addresses, and the images and links that must
 * become markers. The renderer then writes whatever the tokens say.
 */
function collect(tokens: Token[], ctx: RenderContext): Collected {
  // GitHub gives the same heading text the same id plus a counter (`setup`, `setup-1`, ...), and
  // counts every heading level together. A fresh slugger for each doc starts the counts at zero.
  const slugger = new GithubSlugger();
  const found: Collected = { firstHeading: '', headings: [], links: [], textLines: [] };

  tokens.forEach((token, index) => {
    if (token.type === 'heading_open') {
      const next = tokens[index + 1];
      const text = next?.type === 'inline' ? plainText(next.children ?? []).trim() : '';
      // The slugger counts an empty id like any other, so an empty heading must not reach it.
      const id = text === '' ? '' : slugger.slug(text);
      if (id !== '') token.attrSet('id', id);

      const level = Number(token.tag.slice(1)); // the tag is "h1" to "h6"
      if (level === 1 && found.firstHeading === '') found.firstHeading = text;
      if (isOutlineLevel(level) && text !== '' && id !== '') found.headings.push({ level, text, id });
    } else if (token.type === 'inline') {
      const children = token.children ?? [];
      // Read the words first: the pass below turns some images into markers, and an image's alt text counts as text.
      const line = plainText(children).trim();
      if (line !== '') found.textLines.push(line);
      tidyLinksAndImages(children, ctx, found.links);
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const code = token.content.replace(/\n$/, '');
      if (code !== '') found.textLines.push(code);
    }
  });
  return found;
}

/** The outline holds h2 to h4: the h1 is the title, and h5 and h6 are too fine to be worth a line in a side list. */
function isOutlineLevel(level: number): level is 2 | 3 | 4 {
  return level === 2 || level === 3 || level === 4;
}

/** The words of some inline tokens, with no markup: code and image alt text count, a line break is a space. */
function plainText(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
    else if (token.type === 'image') text += plainText(token.children ?? []);
  }
  return text;
}

/** The title when nothing else gives one: the file name without `.md`. */
function titleFromPath(docId: string): string {
  const name = posix.basename(docId).replace(/\.md$/i, '');
  return name === '' ? docId : name;
}

/** Checks each link and image of one paragraph (or heading, or table cell) and rewrites its token to match. */
function tidyLinksAndImages(children: Token[], ctx: RenderContext, links: RenderedDoc['links']): void {
  // Links never nest in markdown, so the link_close that follows a link_open is always its own.
  let linkIsMarker = false;
  let insideLink = false;
  for (const token of children) {
    if (token.type === 'link_open') {
      insideLink = true;
      const href = attributeText(token, 'href');
      const resolved = resolveSafely(ctx, href);
      links.push({ href, resolved });
      const target = printTarget(resolved, href);
      if ('reason' in target) {
        turnIntoMarker(token, target.reason);
        linkIsMarker = true;
      } else {
        token.attrSet('href', target.href);
        if (target.newTab) {
          token.attrSet('target', '_blank');
          // noopener stops the new tab from reaching back into this one (window.opener).
          token.attrSet('rel', 'noopener noreferrer');
        }
      }
    } else if (token.type === 'link_close') {
      if (linkIsMarker) token.tag = 'span';
      linkIsMarker = false;
      insideLink = false;
    } else if (token.type === 'image') {
      const href = attributeText(token, 'src');
      const resolved = resolveSafely(ctx, href);
      links.push({ href, resolved });
      tidyImage(token, href, resolved, insideLink);
    }
  }
}

/** The address a link is printed with, or the reason it is not printed. */
type Target = { href: string; newTab: boolean } | { reason: string };

function printTarget(resolved: ResolvedLink, href: string): Target {
  switch (resolved.kind) {
    case 'doc':
      return { href: docUrl(resolved.slug, resolved.anchor), newTab: false };
    case 'anchor':
      // The only address printed from the doc's own text, and only because it starts with #.
      return href.startsWith('#') ? { href, newTab: false } : { reason: UNSAFE_REASON };
    case 'asset':
      // A file of the repo, served by this site: it opens in a new tab, so Mark keeps his place in the doc.
      return isPrintable(resolved.url) ? { href: resolved.url, newTab: true } : { reason: UNSAFE_REASON };
    case 'github':
    case 'external':
      // A mail address opens the mail program, and a new tab for it would stay empty.
      return isPrintable(resolved.url) ? { href: resolved.url, newTab: !/^mailto:/i.test(resolved.url) } : { reason: UNSAFE_REASON };
    case 'broken':
      return { reason: resolved.reason };
  }
}

/**
 * An address that is safe to put in an `href` or `src`: a path on this site (one slash, not two:
 * `//host` would go to another site), or an http, https or mailto address. A resolver is trusted to
 * answer well, and this is the second look in case it does not.
 */
function isPrintable(url: string): boolean {
  // A browser drops tabs and line breaks from an address before it reads it, so `/<tab>/host`
  // would turn into `//host`. No control character is allowed anywhere. (A plain space is fine:
  // the browser encodes it, and it cannot change where the address goes.)
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  return /^\/(?![/\\])/.test(url) || /^(https?:\/\/|mailto:)\S/i.test(url);
}

/** Turns a link that does not work into a span that says so. The words inside it stay as they were. */
function turnIntoMarker(token: Token, reason: string): void {
  token.tag = 'span';
  token.attrs = [
    ['class', BROKEN_CLASS],
    ['title', reason],
  ];
}

/** The files that a browser shows in an <img>. The site also serves the HTML source of a diagram, which it does not. */
const PICTURE_URL = /\.(png|jpe?g|gif|webp|svg)(#.*)?$/i;

/**
 * An image becomes one of three things. A picture the site serves stays an image, and gets
 * `data-zoom` so the page can open it large. A file that is not a picture (another site, a repo
 * file the site does not serve, or the HTML source of a diagram that the site does serve) becomes
 * a link to it, because the page may only load images from itself and an HTML file cannot be
 * shown in an <img>. Anything else becomes a marker.
 */
function tidyImage(token: Token, href: string, resolved: ResolvedLink, insideLink: boolean): void {
  if (resolved.kind === 'asset' && isPrintable(resolved.url) && PICTURE_URL.test(resolved.url)) {
    token.attrSet('src', resolved.url);
    // The address of the large picture. It is the same file today, and the zoom view reads it from here.
    token.attrSet('data-zoom', resolved.url);
    return;
  }

  const alt = plainText(token.children ?? []).trim();
  const label = md.utils.escapeHtml(alt === '' ? href : alt);
  const elsewhere = (resolved.kind === 'external' || resolved.kind === 'github' || resolved.kind === 'asset') && isPrintable(resolved.url);
  let html: string;
  if (elsewhere && insideLink) {
    // The link around the image already leads somewhere, and a link inside a link is not valid html.
    html = label;
  } else if (elsewhere) {
    html = `<a href="${md.utils.escapeHtml(resolved.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } else {
    const reason =
      resolved.kind === 'broken'
        ? resolved.reason
        : resolved.kind === 'doc' || resolved.kind === 'anchor'
          ? 'an image must be a picture file, not a doc or an anchor'
          : UNSAFE_REASON;
    html = `<span class="${BROKEN_CLASS}" title="${md.utils.escapeHtml(reason)}">${label}</span>`;
  }
  // markdown-it writes the content of an html_inline token as it is. Everything in it was escaped above.
  token.type = 'html_inline';
  token.tag = '';
  token.attrs = null;
  token.children = null;
  token.content = html;
}

function attributeText(token: Token, name: string): string {
  const value = token.attrGet(name);
  return value === null ? '' : String(value);
}

/** Asks the resolver, and turns a throw into a broken link: one bad link must not stop the doc from rendering. */
function resolveSafely(ctx: RenderContext, href: string): ResolvedLink {
  try {
    return ctx.resolve(href);
  } catch {
    return { kind: 'broken', reason: 'the link could not be checked' };
  }
}
