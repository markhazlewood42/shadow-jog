import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/server/engine/decisions';
import { parsePhaseDecisions } from '../src/server/engine/phase';
import type { DocHeading } from '../src/shared/types';
import { PanelError } from '../src/server/source';
import { PACKAGE_DIR } from './helpers';
import { SAMPLE_PHASE_LINES, phaseMd } from './engine-helpers';

// The decisions of docs/PHASE-0.2.md: not a table but lines in the form
// `**N. Question** — **decided|answered|OPEN ...** more words`. A decision is its line and the
// lines under it, up to the next decision or the next heading.

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

describe('the PHASE-0.2 decision lines', () => {
  it('PHASE-0.2 lines give decided, answered and OPEN', () => {
    const rows = parsePhaseDecisions(phaseMd());
    expect(rows.map(({ text: _text, ...fields }) => fields)).toEqual([
      {
        id: 'D1',
        number: 'D1',
        source: 'phase-0.2',
        // The words are plain text: the backticks of the doc are gone.
        question: "Should today's game be frozen as v0.1.0?",
        // What the bold words after the dash say is the answer.
        answer: 'decided 2026-10-02: (a)',
        milestone: null,
        who: 'Mark',
        option: null,
        docSlug: 'PHASE-0.2',
        anchor: null,
      },
      {
        id: 'D2',
        number: 'D2',
        source: 'phase-0.2',
        question: 'What makes the game feel right?',
        answer: 'answered 2026-10-02: the loop, not the camera.',
        milestone: null,
        who: 'Mark',
        option: null,
        docSlug: 'PHASE-0.2',
        anchor: null,
      },
      {
        id: 'D5',
        number: 'D5',
        source: 'phase-0.2',
        question: 'What happens to PixelLab?',
        answer: 'OPEN (2026-10-04).',
        milestone: null,
        who: 'Mark',
        option: null,
        docSlug: 'PHASE-0.2',
        anchor: null,
      },
    ]);

    // Decided and answered are approved. OPEN is open, and it is Mark's: the number 5 of the real doc reads open.
    expect(classifyDecisions(rows, null).map((row) => [row.id, row.status])).toEqual([
      ['D1', 'approved'],
      ['D2', 'approved'],
      ['D5', 'open'],
    ]);
  });

  it('a decision is its line and the lines under it, up to the next decision or heading', () => {
    const [d1, d2, d5] = parsePhaseDecisions(phaseMd());
    expect(d1?.text).toContain('**1.');
    expect(d1?.text).toContain('Options: (a) yes; (b) no.');
    expect(d1?.text).toContain('**Recommendation: (a).** Go.');
    expect(d1?.text).not.toContain('**2.');
    expect(d2?.text).toContain('More words.');
    expect(d2?.text).not.toContain('**5.');
    // The last one ends at the next heading, so the words under "New concepts" are not its text.
    expect(d5?.text).toContain('Options: (a) let it lapse; (b) spend it.');
    expect(d5?.text).not.toContain('New concepts');
    expect(d5?.text).not.toContain('Nothing here.');
  });

  it('only a line in the form of a decision is one: a status note and a line in a code block are not', () => {
    const md = phaseMd([
      '**3. A real one?** — **decided 2026-10-02: (b)**',
      '',
      '```',
      '**4. A line in a code block?** — **decided never**',
      '```',
      '',
      'A line with no dash: **7. Not a decision** and more.',
    ]);
    expect(parsePhaseDecisions(md).map((row) => row.id)).toEqual(['D3']);
    // The code block belongs to the text of the decision above it (it is under it), and does not end it.
    expect(parsePhaseDecisions(md)[0]?.text).toContain('```');
  });

  it('a decision line with a verdict that the page does not know is an error that names it, and not a row that vanishes', () => {
    for (const [line, verdict] of [
      ['**18. Is it blocked?** — **blocked on the spike**', 'blocked'],
      ['**18. Is it deferred?** — **Deferred (2026-10-06).** Later.', 'Deferred'],
      ['**18. Is it deferred?** - **maybe tomorrow**', 'maybe'],
    ] as const) {
      const error = failureOf(() => parsePhaseDecisions(phaseMd([...SAMPLE_PHASE_LINES, '', line])));
      expect(error.code, line).toBe('engine-decision-unreadable');
      expect(error.message).toContain('Decision 18');
      expect(error.message).toContain(`"${verdict}"`);
      expect(error.message).toContain('docs/PHASE-0.2.md');
    }
  });

  it('a decision line with a verdict inside a code block is not an error', () => {
    const md = phaseMd([...SAMPLE_PHASE_LINES, '', '```', '**18. A line in a code block?** — **blocked**', '```']);
    expect(parsePhaseDecisions(md).map((row) => row.id)).toEqual(parsePhaseDecisions(phaseMd()).map((row) => row.id));
  });

  it('puts the decisions in numeric order and finds the anchor of the heading above them', () => {
    const lines = ['**10. Tenth?** — **decided 2026-10-02: (a)**', '', '**2. Second?** — **OPEN (2026-10-04).**'];
    const headings: DocHeading[] = [
      { level: 2, text: 'Decisions for Mark', id: 'decisions-for-mark' },
      { level: 2, text: 'New concepts', id: 'new-concepts' },
    ];
    const rows = parsePhaseDecisions(phaseMd(lines), headings);
    expect(rows.map((row) => row.id)).toEqual(['D2', 'D10']);
    expect(rows.map((row) => row.anchor)).toEqual(['decisions-for-mark', 'decisions-for-mark']);
    // A doc whose page has no such heading: the row has no anchor and opens the doc at its top.
    expect(parsePhaseDecisions(phaseMd(lines), []).every((row) => row.anchor === null)).toBe(true);
  });

  it('a doc with no decision lines gives no rows', () => {
    expect(parsePhaseDecisions('# Nothing\n\nNo decisions here.\n')).toEqual([]);
  });

  it('reads the frozen PHASE-0.2 of the fixtures: decisions 1 to 17, and only number 5 is open', () => {
    const md = readFileSync(join(PACKAGE_DIR, 'fixtures', 'repo', 'docs', 'PHASE-0.2.md'), 'utf8');
    const rows = parsePhaseDecisions(md);
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 17 }, (_unused, i) => `D${i + 1}`));
    const decisions = classifyDecisions(rows, null);
    expect(decisions.filter((row) => row.status === 'open').map((row) => row.id)).toEqual(['D5']);
    // Decision 4 says "answered in practice", and decision 16 has a verdict and no more words in its bold part.
    expect(decisions.find((row) => row.id === 'D4')?.answer).toMatch(/^answered in practice 2026-10-02: /);
    expect(decisions.find((row) => row.id === 'D16')?.answer).toBe('decided 2026-10-03 and 2026-10-04.');
    expect(decisions.find((row) => row.id === 'D17')?.question).toContain('Which engine carries the game');
  });
});

// The sample lines are what the tests above read. A change to them must not go unnoticed.
describe('the sample lines', () => {
  it('hold three decisions', () => {
    expect(SAMPLE_PHASE_LINES.filter((line) => /^\*\*\d+\./.test(line))).toHaveLength(3);
  });
});
