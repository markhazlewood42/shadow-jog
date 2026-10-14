import MarkdownIt, { type Token } from 'markdown-it';

// The plain words of a piece of inline markdown. Three modules need it (the engine decisions, the status reader, and the "Your move" lines of the local page and the reporter),
// so it lives here and not in the engine module: the reporter (src/server/publish/map.ts) must not depend on the engine docs reader to strip a mark from a line.

/** A parser of its own: this file reads the words of a cell or a line, and never renders it. */
const md = new MarkdownIt({ html: false, linkify: false });

/** Every run of white space (spaces, tabs, line breaks of any kind) as one space, and no space at the ends. */
export function collapseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The words of some inline tokens: text and code, with line breaks as spaces, and the alt text of a picture. */
function plainText(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
    else if (token.type === 'image') text += plainText(token.children ?? []);
  }
  return text;
}

/**
 * The words of a piece of inline markdown, with no markup: `code` is its text, `[a link](x.md)` is
 * "a link", and a cell with `\|` in it has a `|`. The decision list is plain text, and issue text and
 * doc text must never reach the page as html.
 */
export function inlineText(markdown: string): string {
  return collapseSpace(plainText(md.parseInline(markdown, {})[0]?.children ?? []));
}
