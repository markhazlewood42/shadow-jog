import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE, loadConfig } from '../src/server/config';
import { createDocIndex, slugOf } from '../src/server/docs/index';
import { splitFrontmatter } from '../src/server/docs/frontmatter';
import { createHub } from '../src/server/hub';
import { registerStatusRoutes } from '../src/server/routes/status';
import { createRunner } from '../src/server/runner';
import { PanelError } from '../src/server/source';
import { createStatusSource } from '../src/server/status/module';
import { MIGRATION_DOC_PATH, STATUS_DOC_PATH, parseMilestoneKey, parseMilestones, parseStatus } from '../src/server/status/status';
import { type DocHeading, MIGRATION_DOC_SLUG, type Panel, STATUS_DOC_SLUG, type StatusInfo } from '../src/shared/types';
import { type DocsRepo, makeDocsRepo, makeIndex, waitFor } from './doc-index-helpers';
import { FIXTURE_REPO } from './doc-helpers';
import { REPO_DIR, getFrom, makeApp } from './helpers';

// The status module: the date, the "Next up for Mark" list and the `milestone` key of status.md, and the
// milestones of docs/engine/migration.md. The parsers are tested on made-up docs (and on the sample
// status.md of fixtures/repo); the module is tested over a temp folder with a real doc index.

/** Stands in for the markdown renderer, so a test can see exactly which markdown the parser handed over. */
const show = (markdown: string): string => `[[${markdown}]]`;

/** The error that `fn` throws, or a failure when it throws nothing. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, and it did not');
}

/** A status file with a current "Right now" section that holds `current`, and an older one under "history" that holds `old`. */
function statusDoc(current: string, old: string, frontmatter = '---\nupdated: 2026-01-02\n---\n'): string {
  return `${frontmatter}# Project

## Where we left off

### Right now (2026-01-02)

${current}

### Right now (2026-01-01, history)

${old}

### Earlier "Right now" notes (history)

- an old note
`;
}

const NEXT_UP = (items: string) => `**Next up for Mark** (updated 2026-01-02):\n${items}`;

describe('parseStatus', () => {
  it('status: the first "Next up for Mark" list in the current "Right now" section is used and the "history" one is ignored', () => {
    const md = statusDoc(
      `A paragraph.

**Next for agents** (in this order):
1. Agent job one.

${NEXT_UP('1. Answer the first question.\n2. Look at the second picture.')}

${NEXT_UP('1. A second list in the same section, which is not read.')}`,
      `**Next up for Mark** (in this order):
1. OLD-ITEM one.
2. OLD-ITEM two.`,
    );
    const info = parseStatus(md, show);

    expect(info.nextUpForMark.map((item) => item.text)).toEqual(['Answer the first question.', 'Look at the second picture.']);
    // Nothing of the history section, or of the list of the agents, is in what the page gets.
    expect(JSON.stringify(info)).not.toContain('OLD-ITEM');
    expect(info.nextUpForMark.map((item) => item.text).join(' ')).not.toContain('Agent job');
    expect(info.updated).toBe('2026-01-02');

    // The sample status.md of the fixtures has the same two lists, and its history list is left out too.
    const fixture = parseStatus(readFileSync(join(FIXTURE_REPO, 'status.md'), 'utf8'), show);
    expect(fixture.nextUpForMark.map((item) => item.text)).toEqual([
      'Review the widget pictures: the round one, the square one, and the long one, which wraps onto a second line with an indent.',
      'Pick the gadget color. The choices are in the setup guide, and this item wraps onto a second line with no indent.',
      'A short last item.',
    ]);
    expect(JSON.stringify(fixture)).not.toContain('This item is old');
  });

  it('takes the current section, not the history one, also when the history section comes first or the current one has no list', () => {
    // The old section first, the current one after it: "current" is the section that is not marked as history.
    const reversed = `## Notes

### Right now (2026-01-01, history)

${NEXT_UP('1. OLD-ITEM.')}

### Right now (2026-01-02)

${NEXT_UP('1. Current item.')}
`;
    expect(parseStatus(reversed, show).nextUpForMark.map((item) => item.text)).toEqual(['Current item.']);

    // The current section says nothing for Mark: the answer is an empty list, and the old list is not used instead.
    const none = statusDoc('Nothing for Mark right now.', '**Next up for Mark** (old):\n1. OLD-ITEM.');
    expect(parseStatus(none, show).nextUpForMark).toEqual([]);

    // A label with a paragraph after it and no list is no list either.
    const noList = statusDoc('**Next up for Mark**: nothing today.\n\nA paragraph.\n\n1. A list that has no label.', '');
    expect(parseStatus(noList, show).nextUpForMark).toEqual([]);

    // The first label is the current one: when it says nothing, a later label with a list is not used in its place.
    const laterLabel = statusDoc(`**Next up for Mark**: nothing today.\n\n${NEXT_UP('1. LATER-ITEM.')}`, '');
    expect(parseStatus(laterLabel, show).nextUpForMark).toEqual([]);
  });

  it('reads a "Next up for Mark" list that is a bullet list, or that sits under a heading, or has a blank line after its label', () => {
    const bullets = statusDoc(`${NEXT_UP('- Bullet one.\n- Bullet two.')}`, '');
    expect(parseStatus(bullets, show).nextUpForMark.map((item) => item.text)).toEqual(['Bullet one.', 'Bullet two.']);

    const underHeading = statusDoc('#### Next up for Mark\n\n1. Item under a heading.', '');
    expect(parseStatus(underHeading, show).nextUpForMark.map((item) => item.text)).toEqual(['Item under a heading.']);

    const spaced = statusDoc('**NEXT UP FOR MARK:**\n\n1. Item after a blank line.', '');
    expect(parseStatus(spaced, show).nextUpForMark.map((item) => item.text)).toEqual(['Item after a blank line.']);
  });

  it('a wrapped list item stays one item', () => {
    const items = `1. First item that is
   wrapped with an indent.
2. Second item that is
wrapped with no indent (a lazy continuation).
3. Third item with two paragraphs.

   Its second paragraph is indented under it.
4. Fourth item with a list in it:
   - one
   - two
10. Last item.`;
    const info = parseStatus(statusDoc(NEXT_UP(items), ''), show);

    expect(info.nextUpForMark.map((item) => item.text)).toEqual([
      'First item that is wrapped with an indent.',
      'Second item that is wrapped with no indent (a lazy continuation).',
      'Third item with two paragraphs. Its second paragraph is indented under it.',
      'Fourth item with a list in it:',
      'Last item.',
    ]);
    // The html of an item is its own markdown: no list marker, and the list's indent taken off, so it renders on its own.
    expect(info.nextUpForMark.map((item) => item.html)).toEqual([
      '[[First item that is\nwrapped with an indent.]]',
      '[[Second item that is\nwrapped with no indent (a lazy continuation).]]',
      '[[Third item with two paragraphs.\n\nIts second paragraph is indented under it.]]',
      '[[Fourth item with a list in it:\n- one\n- two]]',
      '[[Last item.]]',
    ]);
  });

  it('an item with nothing in it is left out', () => {
    const info = parseStatus(statusDoc(NEXT_UP(['1. First.', '2.', '3. Third.'].join('\n')), ''), show);
    expect(info.nextUpForMark.map((item) => item.text)).toEqual(['First.', 'Third.']);
  });

  it('hands the markdown of each item, and nothing else, to the renderer, and gives back what it returns', () => {
    // The section itself is not rendered any more (the Status panel shows no text of status.md): the renderer gets the items and nothing more.
    const handed: string[] = [];
    const info = parseStatus(statusDoc(`Body line one.\n\nBody line two with \`code\`.\n\n${NEXT_UP('1. First item.\n2. Second item with `code`.')}`, 'OLD body.'), (markdown) => {
      handed.push(markdown);
      return `<p>${handed.length}</p>`;
    });
    expect(handed).toEqual(['First item.', 'Second item with `code`.']);
    expect(info.nextUpForMark.map((item) => item.html)).toEqual(['<p>1</p>', '<p>2</p>']);

    // A section with no list renders nothing at all.
    handed.length = 0;
    parseStatus(statusDoc('Body line one.', 'OLD body.'), (markdown) => {
      handed.push(markdown);
      return '';
    });
    expect(handed).toEqual([]);
  });

  it('the section ends at the next heading of its own level or a higher one, and a lower heading stays inside', () => {
    // A list under a lower heading is inside the section and is read. A list after the next heading of the section's own level is not, and neither is one after a higher heading.
    const inside = `## Top

### Right now (2026-01-02)

Before.

#### A part

${NEXT_UP('1. Inside the part.')}

### The next section

${NEXT_UP('1. AFTER-ITEM.')}
`;
    expect(parseStatus(inside, show).nextUpForMark.map((item) => item.text)).toEqual(['Inside the part.']);

    const after = `## Top

### Right now (2026-01-02)

Before, and no list.

### The next section

${NEXT_UP('1. AFTER-ITEM.')}
`;
    expect(parseStatus(after, show).nextUpForMark).toEqual([]);

    const higher = `### Right now (2026-01-02)

Before, and no list.

## A higher heading

${NEXT_UP('1. AFTER-ITEM.')}
`;
    expect(parseStatus(higher, show).nextUpForMark).toEqual([]);
  });

  it('does not take a heading in a code block, and takes "Right now" at any heading level', () => {
    const md = `# Project

\`\`\`
### Right now (2026-09-09)

**Next up for Mark**:
1. IN-CODE-ITEM.
\`\`\`

## Right now

${NEXT_UP('1. The real one.')}
`;
    expect(parseStatus(md, show).nextUpForMark.map((item) => item.text)).toEqual(['The real one.']);
    // A heading that holds code is still the section.
    expect(parseStatus('### Right now `now` (2026-01-02)\n\n**Next up for Mark**:\n1. Found.\n', show).nextUpForMark.map((item) => item.text)).toEqual(['Found.']);
  });

  it('takes the date of the frontmatter as it is written, or null', () => {
    expect(parseStatus('### Right now\n\ntext\n', show).updated).toBeNull();
    expect(parseStatus('---\nupdated: 2026-10-05\n---\n### Right now\n\ntext\n', show).updated).toBe('2026-10-05');
    // A frontmatter that cannot be read leaves the date out, and the section is still found.
    const broken = parseStatus('---\nupdated: [oops\n---\n### Right now\n\n**Next up for Mark**:\n1. Still found.\n', show);
    expect(broken.updated).toBeNull();
    expect(broken.nextUpForMark.map((item) => item.text)).toEqual(['Still found.']);
  });

  it('reads a doc with Windows line breaks and a byte order mark', () => {
    const md = '﻿### Right now (2026-01-02)\r\n\r\n**Next up for Mark**:\r\n1. One\r\n   wrapped.\r\n2. Two.\r\n';
    expect(parseStatus(md, show).nextUpForMark.map((item) => item.text)).toEqual(['One wrapped.', 'Two.']);
  });

  it('item text is plain words, and the item html comes from the renderer (so a doc cannot add script)', () => {
    const md = statusDoc(NEXT_UP('1. Read **the [plan](docs/plan.md)** with `code` and <script>alert(1)</script> in it.'), '');
    const [item] = parseStatus(md, show).nextUpForMark;
    expect(item?.text).toBe('Read the plan with code and <script>alert(1)</script> in it.');
    expect(item?.html).toBe('[[Read **the [plan](docs/plan.md)** with `code` and <script>alert(1)</script> in it.]]');
  });

  it('no "Right now" section gives an error panel, not an empty one', async () => {
    // The parser throws a PanelError that names the problem and the fix ...
    const error = thrown(() => parseStatus('# Project\n\n## Where we are\n\nText.\n', show));
    expect(error).toBeInstanceOf(PanelError);
    expect((error as PanelError).code).toBe('status-section-missing');
    expect((error as PanelError).message).toContain('"Right now"');
    // ... also when the only "Right now" is one that says history, which is not the current one ...
    expect((thrown(() => parseStatus(statusDoc('x', 'y').replace('### Right now (2026-01-02)', '### Notes'), show)) as PanelError).code).toBe('status-section-missing');
    // ... and "Right now" in the middle of a heading is not a section either.
    expect((thrown(() => parseStatus('### Not right now\n\ntext\n', show)) as PanelError).code).toBe('status-section-missing');

    // ... and the module turns it into a panel that is not ok (with the reason), never into an empty panel.
    const rig = rigWith({ 'status.md': '# Project\n\nNo section here.\n' });
    const panel = await rig.status.get();
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('status-section-missing');
    expect(panel.lastGood).toBeNull();
  });
});

/** The table of milestones as the real migration.md writes it, in a doc with other tables around it. */
const MIGRATION_DOC = `# Migration

## 1. Principles

| Principle | Text |
|---|---|
| One | Nothing to see |

## 2. The milestones

Some words.

| Milestone | One-line scope | Touches |
|---|---|---|
| **Phase 0** Platform spike | A spike branch that closed the unknowns (section 3). Done. | \`src/sje/\`, \`e2e/\` |
| **Pre-M0** 640x360 move | Move the game to 640x360 on its own branch. | 7 files |
| **M0** Prepare | Size module, bundle gate, [canary](x.md) suite | \`src/sje/core/size.ts\` |
| **M1b** 3D proof (parallel with M2) | A spinning cube in a \`Scene3D\`, with the hand-off tests | \`src/sje/three/\` |
| **M4** UI scenes (optional) | \`NineSlice\` windows, a \\| in a cell | The UI scenes |

## 5. From today's engine

| Content today | Becomes | Milestone | Why there |
|---|---|---|---|
| Enemies | A data file | M3 | The stage port reads them |
`;

/** No heading of the doc is known: every milestone then has no anchor. */
const NO_HEADINGS: DocHeading[] = [];

describe('parseMilestones', () => {
  it('milestone ids such as "Phase 0" and "M1b" parse', () => {
    expect(parseMilestones(MIGRATION_DOC, NO_HEADINGS)).toEqual([
      { id: 'Phase 0', name: 'Platform spike', scope: 'A spike branch that closed the unknowns (section 3). Done.', anchor: null },
      { id: 'Pre-M0', name: '640x360 move', scope: 'Move the game to 640x360 on its own branch.', anchor: null },
      { id: 'M0', name: 'Prepare', scope: 'Size module, bundle gate, canary suite', anchor: null },
      { id: 'M1b', name: '3D proof (parallel with M2)', scope: 'A spinning cube in a Scene3D, with the hand-off tests', anchor: null },
      { id: 'M4', name: 'UI scenes (optional)', scope: 'NineSlice windows, a | in a cell', anchor: null },
    ]);
  });

  it('finds the columns by their header names, in any order, and ignores another table that also has a "Milestone" column', () => {
    const shuffled = `## The milestones

| Touches | one-line SCOPE | Milestone |
|---|---|---|
| files | What it does | **M9** Last step |
`;
    expect(parseMilestones(shuffled, NO_HEADINGS)).toEqual([{ id: 'M9', name: 'Last step', scope: 'What it does', anchor: null }]);
    // The table of the content moves has a "Milestone" column, and it is not the milestones. It is not taken after them ...
    expect(parseMilestones(MIGRATION_DOC, NO_HEADINGS).map((milestone) => milestone.id)).not.toContain('M3');
    // ... and it is not taken when it comes first, either.
    const decoyFirst = '| Content | Milestone |\n|---|---|\n| Enemies | M3 |\n\n| Milestone | One-line scope |\n|---|---|\n| **M2** Effects | Particles |\n';
    expect(parseMilestones(decoyFirst, NO_HEADINGS)).toEqual([{ id: 'M2', name: 'Effects', scope: 'Particles', anchor: null }]);
  });

  it('a first cell with no bold id takes its first word as the id, and a row with no name text is still listed', () => {
    const doc = `| Milestone | One-line scope |
|---|---|
| M7 Plain row | Scope text |
| **M8** | Only an id |
| | An empty first cell |
`;
    expect(parseMilestones(doc, NO_HEADINGS)).toEqual([
      { id: 'M7', name: 'Plain row', scope: 'Scope text', anchor: null },
      { id: 'M8', name: '', scope: 'Only an id', anchor: null },
    ]);
  });

  it('a doc with no such table, or a table that lost a column, is an error that names the columns', () => {
    for (const doc of ['# Nothing\n', '| Milestone | Touches |\n|---|---|\n| **M1** x | y |\n', '| Name | One-line scope |\n|---|---|\n| **M1** x | y |\n']) {
      const error = thrown(() => parseMilestones(doc, NO_HEADINGS));
      expect(error).toBeInstanceOf(PanelError);
      expect((error as PanelError).code).toBe('milestones-table-missing');
      expect((error as PanelError).message).toContain('"Milestone"');
      expect((error as PanelError).message).toContain('"One-line scope"');
    }
  });

  it('reads the real docs/engine/migration.md: the milestones from Phase 0 to M8, each with a name and a scope', () => {
    const milestones = parseMilestones(readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8'), NO_HEADINGS);
    const ids = milestones.map((milestone) => milestone.id);
    for (const id of ['Phase 0', 'Pre-M0', 'M0', 'M1', 'M1b', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) expect(ids).toContain(id);
    for (const milestone of milestones) {
      expect(milestone.name, milestone.id).not.toBe('');
      expect(milestone.scope, milestone.id).not.toBe('');
      expect(milestone.id, 'no markdown in an id').not.toMatch(/[*_`]/);
    }
  });

  it('a milestone takes the id of the first heading that starts with its id, and null when no heading does', () => {
    const heading = (text: string, id: string, level: 2 | 3 | 4 = 3): DocHeading => ({ level, text, id });
    const headings = [
      heading('2. The milestones', 'the-milestones', 2),
      heading('M0 Prepare', 'm0-prepare'),
      // These two start with "M1" and come before the heading of M1, so a match on the first letters alone would take one of them for it.
      heading('M1b 3D proof', 'm1b-3d-proof'),
      heading('M10 Later', 'm10-later'),
      heading('M1 Shell', 'm1-shell'),
      heading('M1 Shell', 'm1-shell-1'), // a second heading with the same words: the first one is the milestone's
      heading('M4', 'm4'), // the heading is the id alone
    ];
    const doc = `| Milestone | One-line scope |
|---|---|
| **Phase 0** Platform spike | Done. |
| **M0** Prepare | One |
| **M1** Shell | Two |
| **M1b** 3D proof (parallel with M2) | Three |
| **M10** Later | Four |
| **M2** Effects | Five |
| **M4** | Six |
`;
    expect(parseMilestones(doc, headings).map((milestone) => [milestone.id, milestone.anchor])).toEqual([
      ['Phase 0', null],
      ['M0', 'm0-prepare'],
      ['M1', 'm1-shell'],
      ['M1b', 'm1b-3d-proof'],
      ['M10', 'm10-later'],
      ['M2', null], // no heading for it
      ['M4', 'm4'],
    ]);
  });
});

// ---- the milestone key of status.md ----

describe('parseMilestoneKey', () => {
  const IDS = ['Phase 0', 'M0', 'M1b', 'M2'];
  /** A status.md whose frontmatter holds these lines. */
  const withKey = (...lines: string[]) => `---\ntype: status\nupdated: 2026-01-02\n${lines.map((line) => `${line}\n`).join('')}---\n\n# Project\n`;

  it('milestone key reads none, an id, and flags an unknown id or a missing key', () => {
    // The value none: no milestone has started. That is a good key: no current milestone, and no problem.
    expect(parseMilestoneKey(withKey('milestone: none'), IDS)).toEqual({ current: null, problem: null });
    // An id of the table: it is the current milestone, whatever its shape (a letter after the number, a space, a dash).
    expect(parseMilestoneKey(withKey('milestone: M1b'), IDS)).toEqual({ current: 'M1b', problem: null });
    expect(parseMilestoneKey(withKey('milestone: M0'), IDS)).toEqual({ current: 'M0', problem: null });
    expect(parseMilestoneKey(withKey('milestone: Phase 0'), IDS)).toEqual({ current: 'Phase 0', problem: null });
    expect(parseMilestoneKey(withKey('milestone: "M2"'), IDS)).toEqual({ current: 'M2', problem: null });
    expect(parseMilestoneKey(withKey('milestone: Pre-M0'), ['Pre-M0'])).toEqual({ current: 'Pre-M0', problem: null });

    // A value that names no milestone is unknown: not none, not the nearest id. The page never guesses.
    for (const value of ['M99', 'M1', 'm0', 'M0b', 'None', 'NONE', 'nothing', 'M0 Prepare', '3', 'true', '[M0]', '{ id: M0 }']) {
      expect(parseMilestoneKey(withKey(`milestone: ${value}`), IDS), value).toEqual({ current: null, problem: 'unknown' });
    }
    // The ids are the ones of the table now: an id that the table lost is unknown, and with no table every id is.
    expect(parseMilestoneKey(withKey('milestone: M2'), ['M0'])).toEqual({ current: null, problem: 'unknown' });
    expect(parseMilestoneKey(withKey('milestone: M2'), [])).toEqual({ current: null, problem: 'unknown' });
    // The value none does not need the table.
    expect(parseMilestoneKey(withKey('milestone: none'), [])).toEqual({ current: null, problem: null });

    // A key that is not there, or has no value, is missing: with no frontmatter at all, with a frontmatter that cannot be read, with the key spelled another way,
    // and with the words "milestone: M0" in the body of the doc, which is not the frontmatter.
    expect(parseMilestoneKey(withKey(), IDS)).toEqual({ current: null, problem: 'missing' });
    expect(parseMilestoneKey('# Project\n\nmilestone: M0\n', IDS)).toEqual({ current: null, problem: 'missing' });
    expect(parseMilestoneKey('---\nupdated: [oops\nmilestone: M0\n---\n# Project\n', IDS)).toEqual({ current: null, problem: 'missing' });
    expect(parseMilestoneKey(withKey('milestones: M0'), IDS)).toEqual({ current: null, problem: 'missing' });
    expect(parseMilestoneKey(withKey('Milestone: M0'), IDS)).toEqual({ current: null, problem: 'missing' });
    for (const empty of ['milestone:', 'milestone: ""', 'milestone: "   "', 'milestone: null', 'milestone: ~']) {
      expect(parseMilestoneKey(withKey(empty), IDS), empty).toEqual({ current: null, problem: 'missing' });
    }
    expect(parseMilestoneKey('', IDS)).toEqual({ current: null, problem: 'missing' });
  });

  it('reads the key of the sample status.md of the fixtures: none', () => {
    expect(parseMilestoneKey(SAMPLE_STATUS, IDS)).toEqual({ current: null, problem: null });
  });
});

// ---- the module ----

type Rig = {
  repo: DocsRepo;
  status: ReturnType<typeof createStatusSource>;
  index: ReturnType<typeof createDocIndex>;
  events: { module: string }[];
};

const rigs: Rig[] = [];
afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.status.stop();
    await rig.index.close();
    rig.repo.close();
  }
});

/** A temp repo with `files`, a doc index over it and a status module on the same hub. A test calls `status.get()`. */
function rigWith(files: Record<string, string>): Rig {
  const repo = makeDocsRepo(files);
  const { index, hub, events } = makeIndex(repo);
  const status = createStatusSource({ config: repo.config, docs: index, hub });
  const rig = { repo, status, index, events };
  rigs.push(rig);
  return rig;
}

const SAMPLE_STATUS = readFileSync(join(FIXTURE_REPO, 'status.md'), 'utf8');

function dataOf(panel: Panel<StatusInfo>): StatusInfo {
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

describe('the status module', () => {
  it('reads status.md and the milestones of migration.md, and renders links as the docs site does', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': MIGRATION_DOC, 'docs/second.md': '# Second\n', 'docs/guides/setup.md': '# Setup\n' });
    const info = dataOf(await rig.status.get());

    expect(info.updated).toBe('2026-01-02');
    // A link to a doc of the repo is a link of the site, and the markdown is html (not text).
    expect(info.nextUpForMark).toHaveLength(3);
    expect(info.nextUpForMark[1]?.html).toContain('<a href="/docs/guides/setup">setup guide</a>');
    expect(info.milestones.map((milestone) => milestone.id)).toEqual(['Phase 0', 'Pre-M0', 'M0', 'M1b', 'M4']);
    // The sample status.md says `milestone: none`, and the table has no heading for any milestone.
    expect(info.milestone).toEqual({ current: null, problem: null });
    expect(info.milestones.map((milestone) => milestone.anchor)).toEqual([null, null, null, null, null]);
  });

  it('status payload has no right-now html and keeps the next up list', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': MIGRATION_DOC, 'docs/second.md': '# Second\n', 'docs/guides/setup.md': '# Setup\n' });
    rig.status.start();
    const { app } = makeApp({ config: rig.repo.config });
    registerStatusRoutes(app, rig.status);

    const res = await getFrom(app, '/api/status', rig.repo.config);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Panel<StatusInfo>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    // The payload holds what the Status panel reads and nothing else: the date, the Next up items, the milestone key and the milestones.
    expect(Object.keys(body.data).sort()).toEqual(['milestone', 'milestones', 'nextUpForMark', 'updated']);
    expect(text).not.toContain('rightNow');
    // No text of the "Right now" section leaves the server except the Next up items: its paragraphs, its bullets and its link to the second doc are not in the payload.
    for (const sectionText of ['The widget is done.', 'finished the widget', 'three', 'The gadget waits', 'Build the gadget', 'second doc', 'Right now (2026-01-02)']) {
      expect(text, sectionText).not.toContain(sectionText);
    }
    // The Next up list is all there, with its words and its html, in the order of the doc.
    expect(body.data.nextUpForMark.map((item) => item.text)).toEqual([
      'Review the widget pictures: the round one, the square one, and the long one, which wraps onto a second line with an indent.',
      'Pick the gadget color. The choices are in the setup guide, and this item wraps onto a second line with no indent.',
      'A short last item.',
    ]);
    expect(body.data.nextUpForMark[1]?.html).toContain('<a href="/docs/guides/setup">setup guide</a>');
    expect(body.data.updated).toBe('2026-01-02');
  });

  it('milestone anchors match the doc heading ids', async () => {
    // A migration doc whose headings are written as the real one writes them: `### <id> <name>`. The names have what a naive id would get wrong: a capital, a bracket, a
    // letter with an accent and an "&", and one heading is there twice (the docs site gives the second the id of the first and "-1").
    const doc = `${MIGRATION_DOC}
### M0 Prepare

Words.

### M1b 3D proof

Words.

### M4 UI scenes (optional)

Words.

### M5 Café & more

Words.

### M5 Café & more

The same words again.
`;
    const rig = rigWith({
      'status.md': SAMPLE_STATUS.replace('milestone: none', 'milestone: M1b'),
      'docs/engine/migration.md': doc.replace('| **M4** UI scenes (optional) | `NineSlice` windows, a \\| in a cell | The UI scenes |', '| **M4** UI scenes (optional) | `NineSlice` windows, a \\| in a cell | The UI scenes |\n| **M5** Café & more | Accents | Words |'),
    });
    const info = dataOf(await rig.status.get());
    expect(info.milestones.map((milestone) => milestone.id)).toEqual(['Phase 0', 'Pre-M0', 'M0', 'M1b', 'M4', 'M5']);

    // The ids as the docs site wrote them into the page of the doc.
    const page = rig.index.get(MIGRATION_DOC_SLUG);
    expect(page, 'the migration doc is on the site').not.toBeNull();
    const html = page?.html ?? '';
    const headingIds = [...html.matchAll(/<h3 id="([^"]+)">([^<]*)<\/h3>/g)].map(([, id, words]) => ({ id: id as string, words: (words as string).replaceAll('&amp;', '&') }));
    expect(headingIds.map((heading) => heading.id)).toEqual(['m0-prepare', 'm1b-3d-proof', 'm4-ui-scenes-optional', 'm5-café--more', 'm5-café--more-1']);

    // Each anchor is the id of the heading of its milestone in that page. A milestone with no heading has none.
    for (const milestone of info.milestones) {
      const heading = headingIds.find((candidate) => candidate.words === milestone.id || candidate.words.startsWith(`${milestone.id} `));
      expect(milestone.anchor, milestone.id).toBe(heading?.id ?? null);
    }
    expect(info.milestones.map((milestone) => milestone.anchor)).toEqual([null, null, 'm0-prepare', 'm1b-3d-proof', 'm4-ui-scenes-optional', 'm5-café--more']);
    // The ids come out of the outline of the doc index: every anchor is also the id of a heading in `headings`.
    for (const milestone of info.milestones) {
      if (milestone.anchor !== null) expect(page?.headings.some((heading) => heading.id === milestone.anchor), milestone.id).toBe(true);
    }
    expect(info.milestone).toEqual({ current: 'M1b', problem: null });
  });

  it('the anchors follow an edit of the migration doc, and a doc whose headings are gone leaves every anchor null', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': `${MIGRATION_DOC}\n### M0 Prepare\n\nWords.\n` });
    rig.status.start();
    expect(dataOf(await rig.status.get()).milestones.map((milestone) => milestone.anchor)).toEqual([null, null, 'm0-prepare', null, null]);

    rig.repo.write('docs/engine/migration.md', `${MIGRATION_DOC}\n### M0 Prepare, renamed\n\nWords.\n\n### M4 UI scenes\n\nWords.\n`);
    await rig.index.refresh(['docs/engine/migration.md']);
    await waitFor(async () => dataOf(await rig.status.get()).milestones[4]?.anchor === 'm4-ui-scenes', 'the new anchor');
    // "M0 Prepare, renamed" still starts with "M0 " and so is the heading of M0, with its new id.
    expect(dataOf(await rig.status.get()).milestones.map((milestone) => milestone.anchor)).toEqual([null, null, 'm0-prepare-renamed', null, 'm4-ui-scenes']);

    rig.repo.write('docs/engine/migration.md', MIGRATION_DOC);
    await rig.index.refresh(['docs/engine/migration.md']);
    await waitFor(async () => dataOf(await rig.status.get()).milestones.every((milestone) => milestone.anchor === null), 'no anchors');
  });

  it('checks the milestone key of status.md against the table: none, an id, an unknown id, a missing key', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': MIGRATION_DOC });
    rig.status.start();
    const key = async () => dataOf(await rig.status.get()).milestone;
    expect(await key()).toEqual({ current: null, problem: null });

    // Each edit is read again by the module, which listens to the doc index.
    const edit = async (line: string | null) => {
      rig.repo.write('status.md', SAMPLE_STATUS.replace('milestone: none\n', line === null ? '' : `${line}\n`));
      await rig.index.refresh(['status.md']);
    };
    await edit('milestone: M0');
    await waitFor(async () => (await key()).current === 'M0', 'the id');
    expect(await key()).toEqual({ current: 'M0', problem: null });
    await edit('milestone: M9');
    await waitFor(async () => (await key()).problem === 'unknown', 'the unknown id');
    expect(await key()).toEqual({ current: null, problem: 'unknown' });
    await edit(null);
    await waitFor(async () => (await key()).problem === 'missing', 'the missing key');
    expect(await key()).toEqual({ current: null, problem: 'missing' });
    // A bad key is data and not a failure: the panel stays good, and the rest of it is there.
    const panel = await rig.status.get();
    expect(panel.ok).toBe(true);
    expect(dataOf(panel).nextUpForMark).toHaveLength(3);
    expect(dataOf(panel).milestones).toHaveLength(5);
  });

  it('the slugs of the two docs that the Status panel links to are the slugs of the paths that the module reads', () => {
    expect(slugOf(STATUS_DOC_PATH)).toBe(STATUS_DOC_SLUG);
    expect(slugOf(MIGRATION_DOC_PATH)).toBe(MIGRATION_DOC_SLUG);
  });

  // The files of the real repo, so it runs on demand and not in the default suite (the same way as CC_REAL_NAV in docs-routes.test.ts):
  //   CC_REAL_NAV=1 npm --prefix tools/command-center run check
  it.skipIf(process.env.CC_REAL_NAV !== '1')('real status.md has a valid milestone key', async () => {
    const statusMd = readFileSync(join(REPO_DIR, STATUS_DOC_PATH), 'utf8');
    const migrationMd = readFileSync(join(REPO_DIR, MIGRATION_DOC_PATH), 'utf8');
    const ids = parseMilestones(migrationMd, NO_HEADINGS).map((milestone) => milestone.id);
    expect(ids.length).toBeGreaterThan(0);

    // The key is there, and it is `none` or an id of the table of the real migration doc.
    const key = parseMilestoneKey(statusMd, ids);
    expect(key.problem, `the key of status.md: ${JSON.stringify(key)}`).toBeNull();
    const raw = splitFrontmatter(statusMd).data.milestone;
    expect(typeof raw === 'string' && (raw === 'none' || ids.includes(raw)), `milestone: ${String(raw)} must be none or one of ${ids.join(', ')}`).toBe(true);

    // The same through the module, over the real docs (the doc index of the real repo): the panel is good, and each milestone from M0 to M8 has the id of its heading.
    const config = loadConfig(DEFAULT_CONFIG_FILE);
    const hub = createHub();
    const index = createDocIndex({ config, runner: createRunner(config), hub }, { watch: false });
    const status = createStatusSource({ config, docs: index, hub });
    try {
      const info = dataOf(await status.get());
      expect(info.milestone.problem).toBeNull();
      expect(info.updated).not.toBeNull();
      const byId = new Map(info.milestones.map((milestone) => [milestone.id, milestone]));
      for (const id of ['M0', 'M1', 'M1b', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
        expect(byId.get(id)?.anchor, `the heading of ${id} in docs/engine/migration.md`).toMatch(/^m[0-9a-z-]+$/);
      }
    } finally {
      status.stop();
      await index.close();
    }
  });

  it('an item with a script tag in it shows as text in the html, and as words in the text', async () => {
    const rig = rigWith({
      'status.md': statusDoc(NEXT_UP('1. Do <script>alert(1)</script> and <img src=x onerror=alert(2)> and [bad](javascript:alert(3)).'), ''),
      'docs/engine/migration.md': MIGRATION_DOC,
    });
    const [item] = dataOf(await rig.status.get()).nextUpForMark;
    expect(item?.html).not.toContain('<script>');
    expect(item?.html).not.toContain('<img');
    expect(item?.html).not.toContain('href="javascript:');
    expect(item?.html).toContain('&lt;script&gt;');
    expect(item?.text).toContain('<script>alert(1)</script>');
  });

  it('loads again when status.md changes, and keeps what it knew when the new text has no "Right now" section', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': MIGRATION_DOC });
    rig.status.start();
    expect(dataOf(await rig.status.get()).nextUpForMark).toHaveLength(3);

    rig.repo.write('status.md', SAMPLE_STATUS.replace('3. A short last item.', '3. A short last item.\n4. A new item.'));
    await rig.index.refresh(['status.md']);
    await waitFor(async () => dataOf(await rig.status.get()).nextUpForMark.length === 4, 'the new item');

    // Now the section is gone: the panel fails with the reason, and keeps the data of the last good load.
    rig.repo.write('status.md', '# Project\n\nNo section.\n');
    await rig.index.refresh(['status.md']);
    await waitFor(async () => !(await rig.status.get()).ok, 'the error panel');
    const failed = await rig.status.get();
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('status-section-missing');
    expect(failed.lastGood?.data.nextUpForMark).toHaveLength(4);
  });

  it('a missing status.md is an error panel that names the file', async () => {
    const rig = rigWith({ 'docs/engine/migration.md': MIGRATION_DOC });
    const panel = await rig.status.get();
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('status-missing');
    expect(panel.error.message).toContain('status.md');
  });

  it('a milestone table that is missing or has lost a column is an error panel that still carries the status', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': '# Migration\n\n| Milestone | Touches |\n|---|---|\n| **M1** x | y |\n' });
    rig.status.start();

    // The error is the panel's, so the page shows it. The status is not lost: it is in lastGood, with no milestones.
    const broken = await rig.status.get();
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.code).toBe('milestones-table-missing');
    expect(broken.error.message).toContain('"One-line scope"');
    expect(broken.lastGood?.data.updated).toBe('2026-01-02');
    expect(broken.lastGood?.data.nextUpForMark).toHaveLength(3);
    expect(broken.lastGood?.data.milestones).toEqual([]);

    // The file is mended: the panel is good again.
    rig.repo.write('docs/engine/migration.md', MIGRATION_DOC);
    await rig.index.refresh(['docs/engine/migration.md']);
    await waitFor(async () => (await rig.status.get()).ok, 'the mended panel');
    expect(dataOf(await rig.status.get()).milestones).toHaveLength(5);

    // No migration.md at all is the same kind of problem.
    rig.repo.remove('docs/engine/migration.md');
    await rig.index.refresh(['docs/engine/migration.md']);
    await waitFor(async () => !(await rig.status.get()).ok, 'the panel without the doc');
    const gone = await rig.status.get();
    expect(gone.ok ? '' : gone.error.code).toBe('milestones-doc-missing');
    expect(gone.ok ? [] : gone.lastGood?.data.nextUpForMark).toHaveLength(3);
  });

  it('answers GET /api/status with the panel', async () => {
    const rig = rigWith({ 'status.md': SAMPLE_STATUS, 'docs/engine/migration.md': MIGRATION_DOC });
    const { app } = makeApp({ config: rig.repo.config });
    registerStatusRoutes(app, rig.status);

    const res = await getFrom(app, '/api/status', rig.repo.config);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Panel<StatusInfo>;
    expect(body.ok).toBe(true);
    expect(body.ok && body.data.updated).toBe('2026-01-02');
  });
});
