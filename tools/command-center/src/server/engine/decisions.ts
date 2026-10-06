import MarkdownIt, { type Token } from 'markdown-it';
import type { Decision, DecisionStatus, DocHeading } from '../../shared/types';
import { splitFrontmatter } from '../docs/frontmatter';
import { PanelError } from '../source';

// The decisions of the engine docs, read out of their markdown. Two of the three places that hold
// decisions are tables, and this file reads those: the summary table of docs/engine/decisions.md
// (the E decisions) and the table of "real choices" that the Phase 0 update of docs/engine/README.md
// quotes (C1 to C7). The third place, the numbered lines of docs/PHASE-0.2.md, is read by phase.ts.
//
// A doc is edited by people and agents, so a table can change shape: a column moves, a column is
// added, another table with E rows appears next to it. The tables are therefore found by their
// header names and not by their place or the order of their columns, and a table that has lost a
// column it needs is an error that names the column. It is never read wrongly in silence.

/**
 * The three docs that hold decisions: where each one is in the repo, and its address on the site
 * (the doc index's rule: the repo path without `.md` and without a leading `docs/`).
 */
export const ENGINE_DOCS = {
  decisions: { path: 'docs/engine/decisions.md', slug: 'engine/decisions' },
  readme: { path: 'docs/engine/README.md', slug: 'engine/README' },
  phase: { path: 'docs/PHASE-0.2.md', slug: 'PHASE-0.2' },
} as const;

/**
 * A decision as the parsers read it, before it has a status. `text` is what the doc says about it
 * (its row and its section, or its line and the lines under it, as written): it is what a later
 * check compares with the text at the approval commit.
 */
export type RawDecision = Omit<Decision, 'status' | 'change'> & { text: string };

/** A parser of its own: this file reads a doc's structure and the words of its cells, and never renders it. */
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

// ---- reading a doc's structure ----

type TableRow = {
  /** The words of each cell, left to right. */
  cells: string[];
  /** The lines of the row in the doc: from `startLine` up to (not including) `endLine`, counted from 0. */
  startLine: number;
  endLine: number;
};

type Table = {
  headers: string[];
  rows: TableRow[];
  /** The words of the last heading above the table, or "" when there is none. */
  headingAbove: string;
};

type HeadingLine = { level: number; text: string; startLine: number };

/**
 * Every table of a doc, also one inside a quote (the C table of the README is one: each of its lines
 * starts with `> `, which the markdown parser takes off). The line numbers are those of the doc.
 */
function readTables(tokens: readonly Token[]): Table[] {
  const tables: Table[] = [];
  let heading = '';
  let table: Table | null = null;
  let row: TableRow | null = null;
  let inHead = false;
  tokens.forEach((token, index) => {
    switch (token.type) {
      case 'heading_open':
        heading = inlineText(tokens[index + 1]?.content ?? '');
        break;
      case 'table_open':
        table = { headers: [], rows: [], headingAbove: heading };
        tables.push(table);
        break;
      case 'thead_open':
        inHead = true;
        break;
      case 'thead_close':
        inHead = false;
        break;
      case 'tr_open':
        row = { cells: [], startLine: token.map?.[0] ?? 0, endLine: token.map?.[1] ?? 0 };
        break;
      case 'inline':
        // The only inline text inside a table row is a cell's.
        if (table !== null && row !== null) row.cells.push(inlineText(token.content));
        break;
      case 'tr_close':
        if (table !== null && row !== null) {
          if (inHead) table.headers = row.cells;
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
  });
  return tables;
}

/** Every heading of a doc, in order. */
function readHeadings(tokens: readonly Token[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    headings.push({ level: Number(token.tag.slice(1)), text: inlineText(tokens[index + 1]?.content ?? ''), startLine: token.map?.[0] ?? 0 });
  });
  return headings;
}

// ---- finding columns ----

/** A header name as it is compared: without regard to case, and with every run of spaces as one. */
const normalized = (name: string): string => collapseSpace(name).toLowerCase();

/** The place of each wanted column in the table's header (-1 when it has none), and the names that are missing. */
function findColumns<Name extends string>(table: Table, names: readonly Name[]): { at: Record<Name, number>; missing: Name[] } {
  const at = {} as Record<Name, number>;
  const missing: Name[] = [];
  for (const name of names) {
    at[name] = table.headers.findIndex((header) => normalized(header) === normalized(name));
    if (at[name] === -1) missing.push(name);
  }
  return { at, missing };
}

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"`. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  const last = quoted.pop();
  return quoted.length === 0 ? (last ?? '') : `${quoted.join(', ')} and ${last}`;
}

/** The cell of a row in the column at `index`, or "" when the column is not there or the row is short. */
const cellAt = (row: TableRow, index: number): string => (index < 0 ? '' : (row.cells[index] ?? ''));

// ---- anchors ----

/** The id that the page gives the first heading with exactly these words, or null. */
export function anchorOfHeading(headings: readonly DocHeading[], text: string): string | null {
  return text === '' ? null : (headings.find((heading) => heading.text === text)?.id ?? null);
}

/** The id of the heading of the section of decision `id` ("E12. What is ...?" for E12), or null. A heading "E10." is not the section of E1. */
function anchorOfSection(headings: readonly DocHeading[], id: string): string | null {
  return headings.find((heading) => heading.text.startsWith(`${id}.`))?.id ?? null;
}

// ---- numbering ----

/** The number in an id: 12 for `E12`. */
const numberOfId = (id: string): number => Number(id.replace(/\D/g, ''));

/** The decisions in numeric order: the table lists Mark's decisions first, and a reader looks for E9 between E8 and E10. */
export function sortByNumber(rows: RawDecision[]): RawDecision[] {
  return rows.sort((a, b) => numberOfId(a.id) - numberOfId(b.id));
}

// ---- the E decisions: the summary table of docs/engine/decisions.md ----

/** The columns of the summary table, as their headers are written. Every one is needed. */
const ENGINE_COLUMNS = ['#', 'Decision', 'Recommendation', 'Needed before', 'Who decides', 'Your answer'] as const;

/**
 * The table that is the summary of the decisions: the one whose header has the most of the names
 * above (and at least two of them). The doc has other tables, and one of them (the "Editor rule
 * check") has a row for each E decision as well, so a table that has `#` and nothing else of
 * the six is not it. Choosing by the header, and not by the place in the doc, keeps this right when
 * a section is added, moved or renamed.
 */
function pickSummaryTable(tables: readonly Table[]): Table | null {
  let best: Table | null = null;
  let bestScore = 1;
  for (const table of tables) {
    const score = ENGINE_COLUMNS.filter((name) => table.headers.some((header) => normalized(header) === normalized(name))).length;
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The words of the section of decision `id`: its `## E<n>.` heading and everything up to the next
 * heading of the same or a higher level. "" when the doc has no such section.
 */
function sectionTextOf(lines: readonly string[], headings: readonly HeadingLine[], id: string): string {
  const at = headings.findIndex((heading) => heading.level === 2 && heading.text.startsWith(`${id}.`));
  const section = headings[at];
  if (section === undefined) return '';
  const next = headings.slice(at + 1).find((heading) => heading.level <= section.level);
  return lines.slice(section.startLine, next?.startLine ?? lines.length).join('\n');
}

/**
 * The E decisions of docs/engine/decisions.md: one for each row of the summary table, with the words
 * of its row and of its `## E<n>.` section as `text`. `headings` are the headings of the doc's page
 * (when the caller has them), so that a decision can say which heading to open the doc at.
 *
 * Throws a PanelError (`decisions-table-missing` or `decisions-column-missing`) that names what is
 * wrong, so the page shows an error that says what to fix.
 */
export function parseEngineDecisions(markdown: string, headings: readonly DocHeading[] = []): RawDecision[] {
  const { path, slug } = ENGINE_DOCS.decisions;
  const { body } = splitFrontmatter(markdown);
  const lines = body.split('\n');
  const tokens = md.parse(body, {});

  const table = pickSummaryTable(readTables(tokens));
  if (table === null) {
    throw new PanelError(
      'decisions-table-missing',
      `${path} has no decision table. The table needs the columns ${ENGINE_COLUMNS.map((name) => `"${name}"`).join(', ')}.`,
    );
  }
  const { at, missing } = findColumns(table, ENGINE_COLUMNS);
  if (missing.length > 0) {
    throw new PanelError('decisions-column-missing', `The decision table in ${path} is missing the ${missing.length === 1 ? 'column' : 'columns'} ${quotedList(missing)}.`);
  }

  const sectionHeadings = readHeadings(tokens);
  const tableAnchor = anchorOfHeading(headings, table.headingAbove);

  const rows: RawDecision[] = [];
  for (const row of table.rows) {
    const id = cellAt(row, at['#']);
    // Only a row that is an E decision. (A later table row such as a total is not one.)
    if (!/^E\d+$/.test(id)) continue;

    const rowText = lines.slice(row.startLine, row.endLine).join('\n');
    const sectionText = sectionTextOf(lines, sectionHeadings, id);

    rows.push({
      id,
      number: id,
      source: 'engine',
      question: cellAt(row, at.Decision),
      answer: cellAt(row, at.Recommendation),
      milestone: cellAt(row, at['Needed before']) || null,
      who: cellAt(row, at['Who decides']),
      option: cellAt(row, at['Your answer']) || null,
      docSlug: slug,
      anchor: anchorOfSection(headings, id) ?? tableAnchor,
      text: sectionText === '' ? rowText : `${rowText}\n${sectionText}`,
    });
  }
  return sortByNumber(rows);
}

// ---- the C choices: the quoted table of the Phase 0 update in docs/engine/README.md ----

/** The columns that the C table needs. It may also have a "Your answer" column (once Mark has answered), which is read when it is there. */
const UPDATE_COLUMNS = ['#', 'Real choice', 'Recommendation'] as const;

/**
 * The seven real choices of the Phase 0 update (C1 to C7), from the table headed `# | Real choice |
 * Recommendation` in docs/engine/README.md. The table is in a quote in the README, and the markdown
 * parser takes the `> ` off. A README with no such table gives no choices and no error: the
 * choices are a part of one update, and a later README may not have them.
 *
 * Their status does not come from the table but from the README's own status line: see
 * `readmeWaitsForMark` and `classifyUpdateChoices`.
 */
export function parseUpdateChoices(markdown: string, headings: readonly DocHeading[] = []): RawDecision[] {
  const { path, slug } = ENGINE_DOCS.readme;
  const { body } = splitFrontmatter(markdown);
  const lines = body.split('\n');
  const table = readTables(md.parse(body, {})).find((candidate) => candidate.headers.some((header) => normalized(header) === normalized('Real choice')));
  if (table === undefined) return [];

  const { at, missing } = findColumns(table, UPDATE_COLUMNS);
  if (missing.length > 0) {
    throw new PanelError('decisions-column-missing', `The table of real choices in ${path} is missing the ${missing.length === 1 ? 'column' : 'columns'} ${quotedList(missing)}.`);
  }
  const answerAt = table.headers.findIndex((header) => normalized(header) === normalized('Your answer'));
  const anchor = anchorOfHeading(headings, table.headingAbove);

  const rows: RawDecision[] = [];
  for (const row of table.rows) {
    const id = cellAt(row, at['#']);
    if (!/^C\d+$/.test(id)) continue;
    rows.push({
      id,
      number: id,
      source: 'engine-update',
      question: cellAt(row, at['Real choice']),
      answer: cellAt(row, at.Recommendation),
      milestone: null,
      who: 'Mark',
      option: cellAt(row, answerAt) || null,
      docSlug: slug,
      anchor,
      text: lines.slice(row.startLine, row.endLine).join('\n'),
    });
  }
  return sortByNumber(rows);
}

/**
 * Whether the README still waits for Mark: its frontmatter `status` says "waiting for Mark" (in any
 * case). A README with no status, or another one, does not. A frontmatter that cannot be read is an
 * error and not an answer: the choices would otherwise read as approved because a status line was
 * broken.
 */
export function readmeWaitsForMark(markdown: string): boolean {
  const { data, error } = splitFrontmatter(markdown);
  if (error !== null) {
    throw new PanelError('readme-frontmatter-unreadable', `${ENGINE_DOCS.readme.path} has a frontmatter that cannot be read, so its status is not known. ${error}`);
  }
  return typeof data.status === 'string' && /waiting for mark/i.test(data.status);
}

// ---- status ----

/** What the doc records of Mark's reply: the "Your answer" cell of a table row, or, for a PHASE-0.2 line (which has no such cell), the bold words after the dash. */
function replyOf(raw: RawDecision): string {
  return (raw.source === 'phase-0.2' ? raw.answer : (raw.option ?? '')).trim();
}

/**
 * Whether the decision waits for Mark: it is his to decide, and his reply is empty or says OPEN
 * (in any case, with more words after it). The agents decide the rest, and a decision of theirs with no
 * answer is not waiting for him.
 */
function isOpenForMark(raw: RawDecision): boolean {
  if (!/^mark\b/i.test(raw.who.trim())) return false;
  const reply = replyOf(raw);
  return reply === '' || /^open\b/i.test(reply);
}

/** The decision without its text, with its status. */
function withStatus(raw: RawDecision, status: DecisionStatus, change: Decision['change']): Decision {
  const { id, number, source, question, answer, milestone, who, option, docSlug, anchor } = raw;
  return { id, number, source, question, answer, milestone, who, option, status, change, docSlug, anchor };
}

/** What each decision said at the approval commit, by id: the thing a decision's text is compared with. */
export function approvedTextsOf(raws: readonly RawDecision[]): Map<string, string> {
  return new Map(raws.map((raw) => [raw.id, raw.text]));
}

/**
 * The status of the E decisions and the PHASE-0.2 decisions:
 *
 * - `open` when the decision waits for Mark (see isOpenForMark). An open decision is shown as open
 *   whatever its text did since the approval: it was never approved.
 * - `changed` when its text, with every run of white space as one space, is not its text at the
 *   approval commit (`edited`), or it was not there then (`added`).
 * - `approved` otherwise.
 *
 * `approved` is what each decision said at the approval commit, by id. Null means that is not
 * known (the approval commit could not be read): no decision is then flagged as changed.
 */
export function classifyDecisions(raws: readonly RawDecision[], approved: ReadonlyMap<string, string> | null): Decision[] {
  return raws.map((raw) => {
    if (isOpenForMark(raw)) return withStatus(raw, 'open', null);
    if (approved === null) return withStatus(raw, 'approved', null);
    const before = approved.get(raw.id);
    if (before === undefined) return withStatus(raw, 'changed', 'added');
    return collapseSpace(before) === collapseSpace(raw.text) ? withStatus(raw, 'approved', null) : withStatus(raw, 'changed', 'edited');
  });
}

/** The status of the C choices: all open while the README waits for Mark, all approved after. They have no check against the approval commit. */
export function classifyUpdateChoices(raws: readonly RawDecision[], waitingForMark: boolean): Decision[] {
  return raws.map((raw) => withStatus(raw, waitingForMark ? 'open' : 'approved', null));
}
