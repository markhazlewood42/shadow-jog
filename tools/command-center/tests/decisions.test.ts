import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type RawDecision,
  approvedTextsOf,
  classifyDecisions,
  classifyUpdateChoices,
  inlineText,
  parseEngineDecisions,
  parseUpdateChoices,
  readmeWaitsForMark,
} from '../src/server/engine/decisions';
import { PanelError } from '../src/server/source';
import type { DocHeading } from '../src/shared/types';
import { PACKAGE_DIR } from './helpers';
import { SAMPLE_ROWS, decisionsMd, readmeMd, sampleBody, sampleHeading } from './engine-helpers';

// The parsers of the decision tables (docs/engine/decisions.md and the quoted table of
// docs/engine/README.md), and the rule that turns a row into a status. The parsers read plain text:
// the docs of the sample are made up in engine-helpers.ts, and the real README of the Phase 0
// update is the frozen copy in fixtures/repo.

/** A raw decision with every field set, so a test changes only the field it is about. */
function raw(over: Partial<RawDecision> = {}): RawDecision {
  return {
    id: 'E1',
    number: 'E1',
    source: 'engine',
    question: 'A question',
    answer: 'The recommendation',
    milestone: 'M1',
    who: 'Mark',
    option: 'A',
    docSlug: 'engine/decisions',
    anchor: null,
    text: '| E1 | A question |',
    ...over,
  };
}

/** The error that a parser throws, or a failure of the test when it does not throw. */
function failureOf(run: () => unknown): PanelError {
  try {
    run();
  } catch (error) {
    if (error instanceof PanelError) return error;
    throw error;
  }
  throw new Error('expected a PanelError, but nothing was thrown');
}

describe('the words of a cell', () => {
  it('are plain text: code, links, emphasis, escapes and entities are turned into their words', () => {
    // The list is shown as text, and a cell can hold any inline markdown that a person wrote in a doc.
    expect(inlineText('a \\| b &amp; c &lt;tag&gt; **bold** *slanted* `code | pipe` [a link](x.md) ![a picture](img.png)')).toBe(
      'a | b & c <tag> bold slanted code | pipe a link a picture',
    );
    // A line break and runs of spaces are one space, and the ends are trimmed.
    expect(inlineText('  two\n   lines\t here  ')).toBe('two lines here');
    expect(inlineText('')).toBe('');
  });
});

describe('the engine decision table', () => {
  it('columns are found by header name, in any order', () => {
    // The same two decisions, with the columns shuffled, one column that nothing reads, and the
    // header names in other cases and with extra spaces.
    const md = [
      '# Decisions',
      '',
      '| who  DECIDES | Your answer | Notes | # | Needed before | Decision | recommendation |',
      '|---|---|---|---|---|---|---|',
      '| Mark | A | a note | E1 | M1 | How behaviour is written | Phaser style |',
      '| Agent (FYI) |  | a note | E2 | Phase 0 | Name of the hook | `fixedUpdate(tick)` |',
      '',
    ].join('\n');

    const rows = parseEngineDecisions(md);
    expect(rows.map(({ text: _text, ...fields }) => fields)).toEqual([
      {
        id: 'E1',
        number: 'E1',
        source: 'engine',
        question: 'How behaviour is written',
        answer: 'Phaser style',
        milestone: 'M1',
        who: 'Mark',
        option: 'A',
        docSlug: 'engine/decisions',
        anchor: null,
      },
      {
        id: 'E2',
        number: 'E2',
        source: 'engine',
        question: 'Name of the hook',
        // Markdown in a cell is not shown as markdown: the words are the text of the code.
        answer: 'fixedUpdate(tick)',
        milestone: 'Phase 0',
        who: 'Agent (FYI)',
        // An empty cell is no answer, not an empty answer.
        option: null,
        docSlug: 'engine/decisions',
        anchor: null,
      },
    ]);
  });

  it('the "Editor rule check" table is ignored (it also has E rows)', () => {
    const rows = parseEngineDecisions(decisionsMd());
    // One row for each id of the summary table, in numeric order (the table lists Mark's decisions first).
    expect(rows.map((row) => row.id)).toEqual(['E1', 'E2', 'E3', 'E4', 'E9', 'E10']);
    // The words come from the summary table: the editor rule table would say "Holds" (its "Result" column).
    expect(rows[0]?.question).toBe('How behaviour is written');
    expect(rows.map((row) => row.question)).not.toContain('Holds');
    // The "record-only rows" table has a "Where" column that names E3, and it is not a decision table either.
    expect(rows.filter((row) => row.id === 'E3')).toHaveLength(1);

    // The doc is edited by hand, so the sections may change places: with the "Editor rule check" table above the summary, the answer is the same.
    const reordered = parseEngineDecisions(decisionsMd({ editorRuleFirst: true }));
    expect(reordered.map((row) => [row.id, row.question])).toEqual(rows.map((row) => [row.id, row.question]));
  });

  it('keeps the text of a row and its section, and nothing of the next section', () => {
    const rows = parseEngineDecisions(decisionsMd({ bodies: { E1: 'The words of E1.', E2: 'The words of E2.' } }));
    const [e1, e2] = rows;
    expect(e1?.text).toContain('| E1 | How behaviour is written |');
    expect(e1?.text).toContain('## E1. What is the answer of E1?');
    expect(e1?.text).toContain('The words of E1.');
    expect(e1?.text).not.toContain('The words of E2.');
    expect(e2?.text).toContain('The words of E2.');
    // Another row's line is not part of it.
    expect(e1?.text).not.toContain('| E2 |');
    // A row with no section of its own has its row only.
    const [alone] = parseEngineDecisions(decisionsMd({ withoutSection: ['E1'] }));
    expect(alone?.text).toContain('| E1 |');
    expect(alone?.text).not.toContain('## E1.');
  });

  it('gives each decision the anchor of its own section, else of the heading above the table, else none', () => {
    const headings: DocHeading[] = [
      { level: 2, text: 'Summary', id: 'summary' },
      // E10 is listed before E1 on purpose: a search for the heading of E1 that only looks at how it starts would find E10's.
      ...SAMPLE_ROWS.filter((row) => row.id !== 'E2')
        .sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)))
        .map((row) => ({ level: 2 as const, text: sampleHeading(row), id: `id-${row.id.toLowerCase()}` })),
    ];
    const byId = new Map(parseEngineDecisions(decisionsMd(), headings).map((row) => [row.id, row.anchor]));
    expect(byId.get('E1')).toBe('id-e1');
    // E1 is not E10: a heading "E10. ..." is not the section of E1, and the other way round.
    expect(byId.get('E10')).toBe('id-e10');
    // E2 has no heading in the page: the table that holds its row sits under "Summary".
    expect(byId.get('E2')).toBe('summary');
    // No headings given (a parser run on an old version of a doc): no anchors.
    expect(parseEngineDecisions(decisionsMd()).every((row) => row.anchor === null)).toBe(true);
  });

  it('a missing column throws an error that names it, and so does a missing table', () => {
    const lacking = decisionsMd({ columns: ['#', 'Decision', 'Recommendation', 'Needed before', 'Your answer'] });
    const one = failureOf(() => parseEngineDecisions(lacking));
    expect(one.message).toContain('"Who decides"');
    expect(one.message).toContain('docs/engine/decisions.md');
    expect(one.code).toBe('decisions-column-missing');

    // Several columns are all named.
    const many = failureOf(() => parseEngineDecisions(decisionsMd({ columns: ['#', 'Decision', 'Recommendation', 'Needed before'] })));
    expect(many.message).toContain('"Who decides"');
    expect(many.message).toContain('"Your answer"');

    // A doc that has no table with these columns: the error says what to put there.
    const none = failureOf(() => parseEngineDecisions('# Decisions\n\nNo table here.\n\n| # | Result | Why |\n|---|---|---|\n| E1 | Holds | Yes |\n'));
    expect(none.code).toBe('decisions-table-missing');
    expect(none.message).toContain('Who decides');
  });
});

describe('the Phase 0 update choices (C1 to C7)', () => {
  /** The README of the Phase 0 update as it was on main at 959ddf4: the quoted table has three columns, and the status says it waits for Mark. */
  const frozenReadme = readFileSync(join(PACKAGE_DIR, 'fixtures', 'repo', 'docs', 'engine', 'README.md'), 'utf8');

  it('C1 to C7 come from the quoted README table', () => {
    const rows = parseUpdateChoices(frozenReadme);
    expect(rows.map((row) => row.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(rows.map((row) => row.number)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    for (const row of rows) {
      expect(row.source).toBe('engine-update');
      expect(row.who).toBe('Mark');
      expect(row.milestone).toBeNull();
      expect(row.docSlug).toBe('engine/README');
      // The frozen table has no "Your answer" column.
      expect(row.option).toBeNull();
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    // The words are plain text: the quote marks, the backticks and the link markup are gone.
    expect(byId.get('C1')?.question).toBe(
      'roundPixels off. Snap to pixel does the rounding. It is not exact for a fractional scale of an odd-sized picture, for a snap-off node at a half pixel, or for the 1.09x battle push.',
    );
    expect(byId.get('C1')?.answer).toBe('Accept. M3 decides what the battle push may do.');
    expect(byId.get('C4')?.answer).toBe('Keep 1 second.');
    expect(byId.get('C7')?.answer).toBe('Accept. See conventions.md section 3.');
    expect(rows.every((row) => !row.question.includes('>') && !row.question.includes('`'))).toBe(true);
  });

  it('reads the "Your answer" column when the table has one, and finds the columns by name', () => {
    const rows = parseUpdateChoices(readmeMd({ answerColumn: true }));
    expect(rows.map((row) => [row.id, row.option])).toEqual([
      ['C1', 'Accepted 2026-10-05'],
      ['C2', 'Accepted 2026-10-05'],
      ['C3', 'Accepted 2026-10-05'],
    ]);
    expect(rows[2]?.question).toBe('Only context-lost retries.');
    // The text of a row is the row as written (a later task may compare it), and it names the row.
    expect(rows[0]?.text).toContain('| C1 |');
  });

  it('gives each choice the anchor of the heading above the table', () => {
    const headings: DocHeading[] = [
      { level: 2, text: 'What the spike changed', id: 'what-the-spike-changed' },
      { level: 2, text: '3. Reading order', id: '3-reading-order' },
    ];
    expect(parseUpdateChoices(readmeMd(), headings).map((row) => row.anchor)).toEqual(['what-the-spike-changed', 'what-the-spike-changed', 'what-the-spike-changed']);
    expect(parseUpdateChoices(readmeMd()).every((row) => row.anchor === null)).toBe(true);
  });

  it('a README table that lacks the Recommendation column throws an error that names it', () => {
    const md = ['# Overview', '', '> | # | Real choice |', '> |---|---|', '> | C1 | Something |', ''].join('\n');
    const error = failureOf(() => parseUpdateChoices(md));
    expect(error.message).toContain('"Recommendation"');
    expect(error.message).toContain('docs/engine/README.md');
  });

  it('C rows are open while the README waits for Mark, and approved after', () => {
    const rows = parseUpdateChoices(readmeMd());
    // The status line of the README, as the frozen copy says it: waiting for Mark.
    expect(readmeWaitsForMark(frozenReadme)).toBe(true);
    expect(readmeWaitsForMark(readmeMd({ status: 'approved 2026-10-05 (final). Phase 0 update accepted' }))).toBe(false);
    // The words can be in any case, and part of a longer sentence.
    expect(readmeWaitsForMark(readmeMd({ status: 'Draft, Waiting for MARK to look at it' }))).toBe(true);
    // No status line at all: nothing waits.
    expect(readmeWaitsForMark('# A README with no frontmatter\n')).toBe(false);

    const waiting = classifyUpdateChoices(rows, readmeWaitsForMark(readmeMd()));
    expect(waiting.map((row) => [row.id, row.status, row.change])).toEqual([
      ['C1', 'open', null],
      ['C2', 'open', null],
      ['C3', 'open', null],
    ]);
    const approved = classifyUpdateChoices(rows, readmeWaitsForMark(readmeMd({ status: 'approved 2026-10-05 (final)' })));
    expect(approved.map((row) => [row.id, row.status, row.change])).toEqual([
      ['C1', 'approved', null],
      ['C2', 'approved', null],
      ['C3', 'approved', null],
    ]);
    // The row's text is for the comparison with the approval commit, and a Decision does not carry it.
    expect(approved[0]).not.toHaveProperty('text');
  });

  it('a README whose frontmatter cannot be read throws an error, so a broken status does not approve the choices', () => {
    const broken = '---\nstatus: [unclosed\n---\n\n# Overview\n';
    const error = failureOf(() => readmeWaitsForMark(broken));
    expect(error.code).toBe('readme-frontmatter-unreadable');
    expect(error.message).toContain('docs/engine/README.md');
  });
});

describe('the status of a decision', () => {
  it('open: Who decides is Mark and the answer is empty or says OPEN, else approved', () => {
    const status = (over: Partial<RawDecision>) => classifyDecisions([raw(over)], null)[0]?.status;

    // Mark's decision with no answer, or an answer that says OPEN (in any case, with words after it): open.
    expect(status({ who: 'Mark', option: null })).toBe('open');
    expect(status({ who: 'Mark', option: 'OPEN' })).toBe('open');
    expect(status({ who: 'Mark', option: 'Open: waiting for the milestone' })).toBe('open');
    expect(status({ who: 'Mark', option: '  open ' })).toBe('open');
    // Mark's decision with an answer: approved.
    expect(status({ who: 'Mark', option: 'A' })).toBe('approved');
    expect(status({ who: 'Mark', option: 'B. 640x360, chosen on 2026-10-05' })).toBe('approved');
    // A word that only starts with "open" is not OPEN.
    expect(status({ who: 'Mark', option: 'Opened up in the spike' })).toBe('approved');
    // The agents decide the rest: with no answer it is still not waiting for Mark.
    expect(status({ who: 'Agent (FYI)', option: null })).toBe('approved');
    expect(status({ who: 'Agent (FYI)', option: 'OPEN' })).toBe('approved');

    // A PHASE-0.2 line has no "Your answer" cell: the words after the dash are the answer.
    const phase = (answer: string) => classifyDecisions([raw({ source: 'phase-0.2', id: 'D5', number: 'D5', option: null, answer })], null)[0]?.status;
    expect(phase('decided 2026-10-02: (a)')).toBe('approved');
    expect(phase('answered 2026-10-02: the loop')).toBe('approved');
    expect(phase('OPEN (2026-10-04).')).toBe('open');
  });

  it('compares the text with the text at the approval commit once whitespace is collapsed', () => {
    const at = (text: string, approved: string | undefined) =>
      classifyDecisions([raw({ text })], approved === undefined ? new Map() : new Map([['E1', approved]]))[0];

    // The same words with other spaces, other line breaks and another line ending: the same text.
    expect(at('| E1 |  a  b |\n\n\nMore\ttext', '| E1 | a b |\r\nMore text\r\n')).toMatchObject({ status: 'approved', change: null });
    // Other words: changed, edited.
    expect(at('| E1 | a c |', '| E1 | a b |')).toMatchObject({ status: 'changed', change: 'edited' });
    // Not there at the approval commit: changed, added.
    expect(at('| E1 | a b |', undefined)).toMatchObject({ status: 'changed', change: 'added' });
    // An open decision is open, whatever its text did since.
    expect(classifyDecisions([raw({ option: null, text: 'new' })], new Map([['E1', 'old']]))[0]).toMatchObject({ status: 'open', change: null });
    // No text to compare with (the check is not available): nothing is flagged.
    expect(classifyDecisions([raw({ text: 'anything' })], null)[0]).toMatchObject({ status: 'approved', change: null });
  });

  it('a Decision carries the fields of the interface and not the text', () => {
    const [decision] = classifyDecisions([raw({ anchor: 'e1-a-question' })], null);
    expect(decision).toEqual({
      id: 'E1',
      number: 'E1',
      source: 'engine',
      question: 'A question',
      answer: 'The recommendation',
      milestone: 'M1',
      who: 'Mark',
      option: 'A',
      status: 'approved',
      change: null,
      docSlug: 'engine/decisions',
      anchor: 'e1-a-question',
    });
  });

  it('approvedTextsOf maps each id to its text', () => {
    const map = approvedTextsOf([raw({ id: 'E1', text: 'one' }), raw({ id: 'E2', number: 'E2', text: 'two' })]);
    expect([...map]).toEqual([
      ['E1', 'one'],
      ['E2', 'two'],
    ]);
  });
});

// A last look at the sample builders: a test that depends on them needs them to be what they say.
describe('the sample docs', () => {
  it('give each row its own section', () => {
    const md = decisionsMd();
    for (const row of SAMPLE_ROWS) {
      expect(md).toContain(`## ${sampleHeading(row)}`);
      expect(md).toContain(sampleBody(row.id));
    }
  });
});
