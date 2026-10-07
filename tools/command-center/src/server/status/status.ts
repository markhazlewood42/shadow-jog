import MarkdownIt, { type Token } from 'markdown-it';
import type { StatusInfo } from '../../shared/types';
import { splitFrontmatter } from '../docs/frontmatter';
import { inlineText } from '../engine/decisions';
import { PanelError } from '../source';

// The two docs that the status module reads: status.md (the "Right now" section, and in it the
// "Next up for Mark" list) and docs/engine/migration.md (the table of milestones). Both are written
// by people and agents, so their shape drifts: a section is renamed, an old section is kept under
// "history", a table gains a column. The parsers therefore find things by their words and not by
// their place, ignore what is not the current one, and say what is missing in an error that names
// it. They never read the wrong thing in silence.

/** Where the two docs are in the repo. */
export const STATUS_DOC_PATH = 'status.md';
export const MIGRATION_DOC_PATH = 'docs/engine/migration.md';

/**
 * A parser of its own: this file reads the structure of a doc (its headings, lists and tables),
 * and hands the pieces of markdown on to the renderer that the caller gives it. The block structure
 * is needed here because "a wrapped list item is one item" is a rule about markdown, not about lines.
 */
const md = new MarkdownIt({ html: false, linkify: false });

/** A heading of a doc, with where it is. `line` and `bodyLine` count lines of the doc from 0: the heading starts at `line`, and what it holds starts at `bodyLine`. */
type Heading = { index: number; level: number; text: string; line: number; bodyLine: number };

/** The headings that are on the top level of a doc (not one inside a quote or a list), in order. */
function readHeadings(tokens: readonly Token[]): Heading[] {
  const headings: Heading[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open' || token.level !== 0 || token.map === null) return;
    headings.push({ index, level: Number(token.tag.slice(1)), text: inlineText(tokens[index + 1]?.content ?? ''), line: token.map[0], bodyLine: token.map[1] });
  });
  return headings;
}

/** The lines as text, without the blank lines at the start and at the end (the indent of the first text line stays: it may be code). */
function trimBlankLines(lines: readonly string[]): string {
  let from = 0;
  let to = lines.length;
  while (from < to && (lines[from] ?? '').trim() === '') from++;
  while (to > from && (lines[to - 1] ?? '').trim() === '') to--;
  return lines.slice(from, to).join('\n');
}

// ---- status.md ----

/** A heading of the current section: it starts with "Right now". An older section is kept under a heading that also says "history". */
const RIGHT_NOW = /^right now\b/i;
const HISTORY = /\bhistory\b/i;
/** The label of the list that is Mark's. It is bold text or a heading, and it ends with "(updated ...)" or a colon. */
const NEXT_UP_LABEL = /^next up for mark\b/i;

/**
 * The markdown of one list item without its marker: its first line with the marker cut off, and the
 * lines under it with the indent of the list taken off, so the item renders on its own. A lazy
 * continuation (a wrapped line with no indent) has none to lose. `map` is the item's lines in the doc.
 */
function itemMarkdown(lines: readonly string[], map: [number, number]): string {
  const [start, end] = map;
  const first = lines[start] ?? '';
  const marker = /^( {0,3})([-+*]|\d{1,9}[.)])( *)/.exec(first);
  if (marker === null) return '';
  // The text of an item starts after its marker and one to four spaces. With no space after the marker
  // (the text is on the next line), or with five or more (an indented code block), it starts one space after.
  const spaces = marker[3]?.length ?? 0;
  const indent = (marker[1]?.length ?? 0) + (marker[2]?.length ?? 0) + (spaces >= 1 && spaces <= 4 ? spaces : 1);
  const listIndent = new RegExp(`^ {0,${indent}}`);
  return trimBlankLines([first.slice(indent), ...lines.slice(start + 1, end).map((line) => line.replace(listIndent, ''))]);
}

/** The items of the list that opens at `tokens[listIndex]`, as the page shows them. */
function readItems(tokens: readonly Token[], listIndex: number, lines: readonly string[], render: (markdown: string) => string): StatusInfo['nextUpForMark'] {
  const list = tokens[listIndex] as Token;
  const closeType = list.type === 'ordered_list_open' ? 'ordered_list_close' : 'bullet_list_close';
  const items: StatusInfo['nextUpForMark'] = [];
  for (let i = listIndex + 1; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    if (token.type === closeType && token.level === list.level) break;
    if (token.type !== 'list_item_open' || token.level !== list.level + 1) continue; // inside an item that was already read

    // The words of the item are its own paragraphs: the ones one level in. A list inside the item is not part of its text, but it is part of its html.
    const words: string[] = [];
    let end = i + 1;
    for (; end < tokens.length; end++) {
      const inner = tokens[end] as Token;
      if (inner.type === 'list_item_close' && inner.level === token.level) break;
      if (inner.type === 'inline' && inner.level === token.level + 2) words.push(inlineText(inner.content));
    }
    i = end;

    const markdown = token.map === null ? '' : itemMarkdown(lines, token.map);
    const text = words.filter((word) => word !== '').join(' ');
    if (text === '' && markdown === '') continue; // an item with nothing in it is no work for Mark
    items.push({ text, html: render(markdown) });
  }
  return items;
}

/**
 * The first "Next up for Mark" list among the blocks of a section: the list that comes right after
 * the first block (a paragraph or a heading) whose words start with "Next up for Mark". When that
 * block has no list after it, Mark has nothing listed, and the answer is no items. A later label
 * is not looked at: the first one is the current one.
 */
function readNextUp(tokens: readonly Token[], lines: readonly string[], render: (markdown: string) => string): StatusInfo['nextUpForMark'] {
  for (let i = 0; i < tokens.length; i++) {
    const label = tokens[i] as Token;
    if (label.level !== 0 || (label.type !== 'paragraph_open' && label.type !== 'heading_open')) continue;
    if (!NEXT_UP_LABEL.test(inlineText(tokens[i + 1]?.content ?? ''))) continue;
    // A block is its opening token, its inline token and its closing token, so the next block starts three tokens on.
    const next = tokens[i + 3];
    return next?.type === 'ordered_list_open' || next?.type === 'bullet_list_open' ? readItems(tokens, i + 3, lines, render) : [];
  }
  return [];
}

/**
 * Reads status.md: its date, the current "Right now" section and the "Next up for Mark" list in it.
 *
 * The current section is the first heading that starts with "Right now" and does not say "history".
 * It holds everything up to the next heading of its own level or a higher one (a lower heading stays
 * inside it). An older "Right now" that is kept under a "history" heading is not it, and the list
 * that it holds is not read: the page must never show Mark an old to-do as a new one.
 *
 * `render` turns markdown into html that is safe to put into a page (the doc index's `renderFragment`
 * is one). The section and each item go through it. Throws a PanelError when there is no current
 * "Right now" section, so the page shows an error and not an empty box.
 */
export function parseStatus(source: string, render: (markdown: string) => string): Omit<StatusInfo, 'milestones'> {
  // The body has LF line breaks and no frontmatter, so its line numbers are the ones of the tokens.
  const { data, body } = splitFrontmatter(source);
  const lines = body.split('\n');
  const tokens = md.parse(body, {});

  const headings = readHeadings(tokens);
  const current = headings.find((heading) => RIGHT_NOW.test(heading.text) && !HISTORY.test(heading.text));
  if (current === undefined) {
    throw new PanelError('status-section-missing', `${STATUS_DOC_PATH} has no "Right now" section (a heading that starts with "Right now" and does not say "history"), so the project status cannot be shown.`);
  }
  const after = headings.find((heading) => heading.index > current.index && heading.level <= current.level);

  // The heading is three tokens (it opens, holds its words, and closes): the blocks of the section come after them.
  const sectionTokens = tokens.slice(current.index + 3, after?.index ?? tokens.length);
  const sectionMarkdown = trimBlankLines(lines.slice(current.bodyLine, after?.line ?? lines.length));

  return {
    updated: typeof data.updated === 'string' && data.updated.trim() !== '' ? data.updated.trim() : null,
    rightNow: { heading: current.text, html: sectionMarkdown === '' ? '' : render(sectionMarkdown) },
    nextUpForMark: readNextUp(sectionTokens, lines, render),
  };
}

// ---- docs/engine/migration.md ----

/** A table of a doc: its header names (plain words, in lower case) and its rows, each cell as the markdown that the author wrote. */
type Table = { headers: string[]; rows: string[][] };

/** Every table of a doc, also one inside a quote. */
function readTables(tokens: readonly Token[]): Table[] {
  const tables: Table[] = [];
  let table: Table | null = null;
  let row: string[] | null = null;
  let inHead = false;
  for (const token of tokens) {
    switch (token.type) {
      case 'table_open':
        table = { headers: [], rows: [] };
        tables.push(table);
        break;
      case 'thead_open':
        inHead = true;
        break;
      case 'thead_close':
        inHead = false;
        break;
      case 'tr_open':
        row = [];
        break;
      case 'inline':
        // The only inline text inside a table row is a cell's.
        if (row !== null) row.push(token.content);
        break;
      case 'tr_close':
        if (table !== null && row !== null) {
          if (inHead) table.headers = row.map((cell) => inlineText(cell).toLowerCase());
          else table.rows.push(row);
        }
        row = null;
        break;
      case 'table_close':
        table = null;
        break;
      default:
        break;
    }
  }
  return tables;
}

/** The names of the two columns that the milestone list needs, in lower case. */
const MILESTONE_COLUMN = 'milestone';
const SCOPE_COLUMN = 'one-line scope';

/**
 * The id and the name in the first cell of a milestone row. The doc writes the id in bold and the name
 * after it: `**M1b** 3D proof (parallel with M2)`. A cell with no bold part gives its first word as the
 * id and the rest as the name.
 */
function splitMilestone(cell: string): { id: string; name: string } {
  const bold = /^(\*\*|__)(.+?)\1\s*([\s\S]*)$/.exec(cell.trim());
  if (bold !== null) return { id: inlineText(bold[2] ?? ''), name: inlineText(bold[3] ?? '') };
  const [id = '', ...rest] = inlineText(cell).split(' ');
  return { id, name: rest.join(' ') };
}

/**
 * Reads the milestones from the table of docs/engine/migration.md: the table with a "Milestone" column
 * and a "One-line scope" column, found by those names wherever it is and in whatever order its columns
 * are. Another table that has a "Milestone" column (the doc has one that says which milestone moves
 * each part of the content) lacks the second name, so it is not taken. The table has no column for the
 * state of a milestone, so a milestone is its id, its name and its scope. Throws a PanelError that
 * names the two columns when there is no such table.
 */
export function parseMilestones(source: string): StatusInfo['milestones'] {
  const { body } = splitFrontmatter(source);
  const table = readTables(md.parse(body, {})).find((candidate) => candidate.headers.includes(MILESTONE_COLUMN) && candidate.headers.includes(SCOPE_COLUMN));
  if (table === undefined) {
    throw new PanelError('milestones-table-missing', `${MIGRATION_DOC_PATH} has no table with a "Milestone" column and a "One-line scope" column, so the milestone list cannot be shown.`);
  }
  const milestoneAt = table.headers.indexOf(MILESTONE_COLUMN);
  const scopeAt = table.headers.indexOf(SCOPE_COLUMN);

  const milestones: StatusInfo['milestones'] = [];
  for (const cells of table.rows) {
    const { id, name } = splitMilestone(cells[milestoneAt] ?? '');
    if (id === '') continue; // an empty row
    milestones.push({ id, name, scope: inlineText(cells[scopeAt] ?? '') });
  }
  return milestones;
}
