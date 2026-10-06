import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocIndex } from '../src/server/docs/index';
import { registerStatusRoutes } from '../src/server/routes/status';
import { PanelError } from '../src/server/source';
import { createStatusSource } from '../src/server/status/module';
import { parseMilestones, parseStatus } from '../src/server/status/status';
import type { Panel, StatusInfo } from '../src/shared/types';
import { type DocsRepo, makeDocsRepo, makeIndex, waitFor } from './doc-index-helpers';
import { FIXTURE_REPO } from './doc-helpers';
import { REPO_DIR, getFrom, makeApp } from './helpers';

// The status module: the "Right now" section and the "Next up for Mark" list of status.md, and the
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

    expect(info.rightNow.heading).toBe('Right now (2026-01-02)');
    expect(info.nextUpForMark.map((item) => item.text)).toEqual(['Answer the first question.', 'Look at the second picture.']);
    // Nothing of the history section, or of the list of the agents, is in what the page gets.
    expect(JSON.stringify(info)).not.toContain('OLD-ITEM');
    expect(info.nextUpForMark.map((item) => item.text).join(' ')).not.toContain('Agent job');
    expect(info.updated).toBe('2026-01-02');

    // The sample status.md of the fixtures has the same two lists, and its history list is left out too.
    const fixture = parseStatus(readFileSync(join(FIXTURE_REPO, 'status.md'), 'utf8'), show);
    expect(fixture.rightNow.heading).toBe('Right now (2026-01-02)');
    expect(fixture.nextUpForMark.map((item) => item.text)).toEqual([
      'Review the widget pictures: the round one, the square one, and the long one, which wraps onto a second line with an indent.',
      'Pick the gadget colour. The choices are in the setup guide, and this item wraps onto a second line with no indent.',
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

  it('hands the section body, and nothing else, to the renderer, and gives back what it returns', () => {
    const handed: string[] = [];
    const info = parseStatus(statusDoc('Body line one.\n\nBody line two with `code`.', 'OLD body.'), (markdown) => {
      handed.push(markdown);
      return `<p>${handed.length}</p>`;
    });
    // First the section (no heading, no history), then the items (none here).
    expect(handed).toEqual(['Body line one.\n\nBody line two with `code`.']);
    expect(info.rightNow.html).toBe('<p>1</p>');
  });

  it('the section ends at the next heading of its own level or a higher one, and a lower heading stays inside', () => {
    const md = `## Top

### Right now (2026-01-02)

Before.

#### A part

Inside the part.

### The next section

AFTER-TEXT
`;
    const info = parseStatus(md, show);
    expect(info.rightNow.html).toBe('[[Before.\n\n#### A part\n\nInside the part.]]');
    expect(info.rightNow.html).not.toContain('AFTER-TEXT');
  });

  it('does not take a heading in a code block, and takes "Right now" at any heading level', () => {
    const md = `# Project

\`\`\`
### Right now (2026-09-09)
\`\`\`

## Right now

The real one.
`;
    const info = parseStatus(md, show);
    expect(info.rightNow.heading).toBe('Right now');
    expect(info.rightNow.html).toBe('[[The real one.]]');
  });

  it('takes the words of the heading as plain text, and the date of the frontmatter as it is written, or null', () => {
    expect(parseStatus('### Right now `now` (2026-01-02)\n\ntext\n', show).rightNow.heading).toBe('Right now now (2026-01-02)');
    expect(parseStatus('### Right now\n\ntext\n', show).updated).toBeNull();
    expect(parseStatus('---\nupdated: 2026-10-05\n---\n### Right now\n\ntext\n', show).updated).toBe('2026-10-05');
    // A frontmatter that cannot be read leaves the date out, and the section is still found.
    const broken = parseStatus('---\nupdated: [oops\n---\n### Right now\n\ntext\n', show);
    expect(broken.updated).toBeNull();
    expect(broken.rightNow.heading).toBe('Right now');
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

describe('parseMilestones', () => {
  it('milestone ids such as "Phase 0" and "M1b" parse', () => {
    expect(parseMilestones(MIGRATION_DOC)).toEqual([
      { id: 'Phase 0', name: 'Platform spike', scope: 'A spike branch that closed the unknowns (section 3). Done.' },
      { id: 'Pre-M0', name: '640x360 move', scope: 'Move the game to 640x360 on its own branch.' },
      { id: 'M0', name: 'Prepare', scope: 'Size module, bundle gate, canary suite' },
      { id: 'M1b', name: '3D proof (parallel with M2)', scope: 'A spinning cube in a Scene3D, with the hand-off tests' },
      { id: 'M4', name: 'UI scenes (optional)', scope: 'NineSlice windows, a | in a cell' },
    ]);
  });

  it('finds the columns by their header names, in any order, and ignores another table that also has a "Milestone" column', () => {
    const shuffled = `## The milestones

| Touches | one-line SCOPE | Milestone |
|---|---|---|
| files | What it does | **M9** Last step |
`;
    expect(parseMilestones(shuffled)).toEqual([{ id: 'M9', name: 'Last step', scope: 'What it does' }]);
    // The table of the content moves has a "Milestone" column, and it is not the milestones. It is not taken after them ...
    expect(parseMilestones(MIGRATION_DOC).map((milestone) => milestone.id)).not.toContain('M3');
    // ... and it is not taken when it comes first, either.
    const decoyFirst = '| Content | Milestone |\n|---|---|\n| Enemies | M3 |\n\n| Milestone | One-line scope |\n|---|---|\n| **M2** Effects | Particles |\n';
    expect(parseMilestones(decoyFirst)).toEqual([{ id: 'M2', name: 'Effects', scope: 'Particles' }]);
  });

  it('a first cell with no bold id takes its first word as the id, and a row with no name text is still listed', () => {
    const doc = `| Milestone | One-line scope |
|---|---|
| M7 Plain row | Scope text |
| **M8** | Only an id |
| | An empty first cell |
`;
    expect(parseMilestones(doc)).toEqual([
      { id: 'M7', name: 'Plain row', scope: 'Scope text' },
      { id: 'M8', name: '', scope: 'Only an id' },
    ]);
  });

  it('a doc with no such table, or a table that lost a column, is an error that names the columns', () => {
    for (const doc of ['# Nothing\n', '| Milestone | Touches |\n|---|---|\n| **M1** x | y |\n', '| Name | One-line scope |\n|---|---|\n| **M1** x | y |\n']) {
      const error = thrown(() => parseMilestones(doc));
      expect(error).toBeInstanceOf(PanelError);
      expect((error as PanelError).code).toBe('milestones-table-missing');
      expect((error as PanelError).message).toContain('"Milestone"');
      expect((error as PanelError).message).toContain('"One-line scope"');
    }
  });

  it('reads the real docs/engine/migration.md: the milestones from Phase 0 to M8, each with a name and a scope', () => {
    const milestones = parseMilestones(readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8'));
    const ids = milestones.map((milestone) => milestone.id);
    for (const id of ['Phase 0', 'Pre-M0', 'M0', 'M1', 'M1b', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) expect(ids).toContain(id);
    for (const milestone of milestones) {
      expect(milestone.name, milestone.id).not.toBe('');
      expect(milestone.scope, milestone.id).not.toBe('');
      expect(milestone.id, 'no markdown in an id').not.toMatch(/[*_`]/);
    }
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
    expect(info.rightNow.heading).toBe('Right now (2026-01-02)');
    // A link to a doc of the repo is a link of the site, and the markdown is html (not text).
    expect(info.rightNow.html).toContain('<a href="/docs/second">second doc</a>');
    expect(info.rightNow.html).toContain('<strong>The widget is done.</strong>');
    expect(info.rightNow.html).not.toContain('OLD');
    expect(info.nextUpForMark).toHaveLength(3);
    expect(info.nextUpForMark[1]?.html).toContain('<a href="/docs/guides/setup">setup guide</a>');
    expect(info.milestones.map((milestone) => milestone.id)).toEqual(['Phase 0', 'Pre-M0', 'M0', 'M1b', 'M4']);
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
    expect(broken.lastGood?.data.rightNow.heading).toBe('Right now (2026-01-02)');
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
    expect(body.ok && body.data.rightNow.heading).toBe('Right now (2026-01-02)');
  });
});
