// Shared helpers for the engine review tests (decisions, phase and engine-module). This file has no
// tests of its own: the test runner only loads files that end in .test.ts or .test.tsx.
//
// The sample docs are synthetic. They have the shape of the three real docs that hold decisions
// (docs/engine/decisions.md, docs/engine/README.md and docs/PHASE-0.2.md), with made-up content,
// so a test can change one thing in them and know what the answer must be.

/** One row of the summary table of the sample decisions doc. */
export type SampleRow = { id: string; decision: string; recommendation: string; needed: string; who: string; answer: string };

/** The rows of the sample summary table, in an order that is not numeric (as in the real table, where Mark's decisions come first). */
export const SAMPLE_ROWS: readonly SampleRow[] = [
  { id: 'E1', decision: 'How behaviour is written', recommendation: 'Phaser style: scene code', needed: 'Phase 0', who: 'Mark', answer: 'A' },
  { id: 'E2', decision: 'Name of the hook', recommendation: '`fixedUpdate(tick)`', needed: 'M1', who: 'Mark', answer: '' },
  { id: 'E4', decision: 'Text object', recommendation: 'Own text object', needed: 'M3', who: 'Mark', answer: 'OPEN' },
  { id: 'E9', decision: 'Wrapper style', recommendation: 'Composition', needed: 'Phase 0', who: 'Agent (FYI)', answer: 'C' },
  { id: 'E10', decision: 'Time units', recommendation: 'Milliseconds', needed: 'M1', who: 'Agent (FYI)', answer: '' },
  { id: 'E3', decision: 'Resolution', recommendation: 'Keep 480x270', needed: 'Phase 0', who: 'Mark', answer: 'B. 640x360, chosen on 2026-10-05' },
];

/** The body that each sample row gets under its own `## E<n>.` heading. */
export function sampleBody(id: string): string {
  return `**Question.** The question of ${id}.\n\n**Recommendation.** The recommendation of ${id}.`;
}

/** The title of the `## E<n>.` heading of a sample row. */
export function sampleHeading(row: Pick<SampleRow, 'id'>): string {
  return `${row.id}. What is the answer of ${row.id}?`;
}

export type DecisionsMdOptions = {
  rows?: readonly SampleRow[];
  /** The text under a row's heading, by id. A row with no entry gets `sampleBody`. */
  bodies?: Record<string, string>;
  /** Ids that get no `## E<n>.` section at all. */
  withoutSection?: readonly string[];
  /** The header cells of the summary table, in the order to write them. */
  columns?: readonly string[];
  /** Write the "Editor rule check" table before the summary table (a doc that was edited can have its sections in any order). */
  editorRuleFirst?: boolean;
};

const DEFAULT_COLUMNS = ['#', 'Decision', 'Recommendation', 'Needed before', 'Who decides', 'Your answer'] as const;

function cellOf(row: SampleRow, column: string): string {
  switch (column) {
    case '#':
      return row.id;
    case 'Decision':
      return row.decision;
    case 'Recommendation':
      return row.recommendation;
    case 'Needed before':
      return row.needed;
    case 'Who decides':
      return row.who;
    case 'Your answer':
      return row.answer;
    default:
      return 'extra';
  }
}

/**
 * A sample of docs/engine/decisions.md: frontmatter, the summary table, a table of "record-only
 * rows" (a table with other columns), the "Editor rule check" table (it also has E rows and must
 * be ignored), and one `## E<n>.` section for each row.
 */
export function decisionsMd(options: DecisionsMdOptions = {}): string {
  const rows = options.rows ?? SAMPLE_ROWS;
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const sections = rows
    .filter((row) => !(options.withoutSection ?? []).includes(row.id))
    .slice()
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((row) => `## ${sampleHeading(row)}\n\n${options.bodies?.[row.id] ?? sampleBody(row.id)}\n`);
  const summary = [
    '## Summary',
    '',
    `| ${columns.join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${columns.map((column) => cellOf(row, column)).join(' | ')} |`),
    '',
  ];
  const recordOnly = ['## Phase 0 update: record-only rows', '', '| Change | Why it needs no choice | Where |', '|---|---|---|', '| The size is 640x360 (E3). | Mark chose it. | E3 |', ''];
  const editorRule = ['## Editor rule check', '', '| # | Result | Why |', '|---|---|---|', ...rows.map((row) => `| ${row.id} | Holds | Content stays data. |`), ''];
  return [
    '---',
    'type: design',
    'title: "Sample Engine — Decisions"',
    'status: approved 2026-10-04 (all recommendations)',
    '---',
    '',
    '# Sample Engine — Decisions',
    '',
    'This file lists the decisions.',
    '',
    ...(options.editorRuleFirst ? [...editorRule, ...summary, ...recordOnly] : [...summary, ...recordOnly, ...editorRule]),
    ...sections,
  ].join('\n');
}

export type ChoiceRow = { id: string; choice: string; recommendation: string; answer?: string };

export const SAMPLE_CHOICES: readonly ChoiceRow[] = [
  { id: 'C1', choice: '`roundPixels` off. Snap to pixel rounds.', recommendation: 'Accept. M3 decides.', answer: 'Accepted 2026-10-05' },
  { id: 'C2', choice: 'One private renderer.', recommendation: 'Accept. It leaked less.', answer: 'Accepted 2026-10-05' },
  { id: 'C3', choice: 'Only [context-lost](decisions.md) retries.', recommendation: 'Accept.', answer: 'Accepted 2026-10-05' },
];

export type ReadmeMdOptions = {
  /** The frontmatter `status`. */
  status?: string;
  /** The rows of the quoted C table, or null for a README with no such table. */
  choices?: readonly ChoiceRow[] | null;
  /** Add the "Your answer" column to the C table (the README has it once Mark has answered). */
  answerColumn?: boolean;
  /** The items of the "Reading order" list, as written (`This file.` or `[name](path)`). */
  order?: readonly string[];
};

/** A sample of docs/engine/README.md: a status, the quoted C table under a heading, and a "Reading order" list. */
export function readmeMd(options: ReadmeMdOptions = {}): string {
  const { status = 'approved 2026-10-04 (all recommendations). Phase 0 update on 2026-10-05, waiting for Mark\'s final approval' } = options;
  const choices = options.choices === undefined ? SAMPLE_CHOICES : options.choices;
  const header = options.answerColumn ? '| # | Real choice | Recommendation | Your answer |' : '| # | Real choice | Recommendation |';
  const divider = options.answerColumn ? '|---|---|---|---|' : '|---|---|---|';
  const table =
    choices === null
      ? []
      : [
          '> **What you approve now.** Seven real choices.',
          '>',
          `> ${header}`,
          `> ${divider}`,
          ...choices.map((c) => `> | ${c.id} | ${c.choice} | ${c.recommendation}${options.answerColumn ? ` | ${c.answer ?? ''}` : ''} |`),
          '>',
          '> **IDs.** C = a choice.',
        ];
  const order = options.order ?? ['This file.', '[scene-graph.md](scene-graph.md): the tree.', '[decisions.md](decisions.md): every decision.'];
  return [
    '---',
    'type: design',
    'title: "Sample Engine — Overview"',
    `status: ${status}`,
    '---',
    '',
    '# Sample Engine — Overview',
    '',
    '## What the spike changed',
    '',
    '- One change.',
    '',
    ...table,
    '',
    '---',
    '',
    '## 3. Reading order',
    '',
    ...order.map((item, i) => `${i + 1}. ${item}`),
    '',
    'Source material: none.',
    '',
  ].join('\n');
}

/** A sample of docs/PHASE-0.2.md: the lines of the "Decisions for Mark" section (a decision is one of these lines plus the lines under it). */
export function phaseMd(lines?: readonly string[]): string {
  return [
    '# Sample phase plan',
    '',
    'An intro. **Open: 5 (PixelLab).** is a status note, not a decision line.',
    '',
    '## Decisions for Mark',
    '',
    ...(lines ?? SAMPLE_PHASE_LINES),
    '',
    '## New concepts',
    '',
    'Nothing here.',
    '',
  ].join('\n');
}

/** Three decisions: one decided, one answered and one open. */
export const SAMPLE_PHASE_LINES: readonly string[] = [
  '**1. Should today\'s game be frozen as `v0.1.0`?** — **decided 2026-10-02: (a)** The new work belongs in 0.2.',
  'Options: (a) yes; (b) no.',
  '**Recommendation: (a).** Go.',
  '',
  '**2. What makes the game feel right?** — **answered 2026-10-02: the loop, not the camera.** More words.',
  '',
  '**5. What happens to PixelLab?** — **OPEN (2026-10-04).** You have 800 generations left.',
  'Options: (a) let it lapse; (b) spend it.',
];
