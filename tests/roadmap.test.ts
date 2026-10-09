import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STATUSES, generate, readData, validate } from '../scripts/gen-roadmap.mjs';
import type { RoadmapData } from '../scripts/gen-roadmap.mjs';

/**
 * The roadmap (docs/roadmap/roadmap.json) is the one source of the chart. These tests keep it true:
 *  (a) its milestone items are the rows of the table in docs/engine/migration.md section 2, no more and no fewer;
 *  (b) the `milestone:` key of status.md names the item whose status is `active`;
 *  (c) roadmap.svg and the README on disk are what the generator writes now;
 *  (d) the data is sound: known statuses, real dependencies, no cycle.
 * Fix a failure by editing roadmap.json and running `npm run roadmap`.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const data = readData();

/** The ids of the milestone table: the bold word at the start of each row of the table in section 2 ("Phase 0", "Pre-M0", "M0" ... "M8"). */
function migrationIds(markdown: string): string[] {
  const start = markdown.indexOf('## 2. The milestones');
  if (start < 0) throw new Error('docs/engine/migration.md has no "## 2. The milestones" section.');
  const rest = markdown.slice(start + 3);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const ids = [...section.matchAll(/^\| \*\*([^*]+)\*\*/gm)].map((match) => (match[1] ?? '').trim());
  if (ids.length === 0) throw new Error('The table in section 2 of docs/engine/migration.md has no rows.');
  return ids;
}

/** The value of the `milestone:` key in the frontmatter of a status file, or null. */
function milestoneKey(markdown: string): string | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const line = front?.[1]?.match(/^milestone:\s*(.+?)\s*$/m);
  return line?.[1] ?? null;
}

/**
 * The rule for the key. `none` means that no milestone item is active. Any other value names a milestone item, and that item must be
 * `active`. One exception: `Pre-M0` may also be `done`, because status.md can keep it until M0 starts. Returns the problem, or null.
 */
function checkMilestoneKey(key: string | null, roadmap: RoadmapData): string | null {
  const milestones = roadmap.items.filter((item) => item.kind === 'milestone');
  if (key === null) return 'status.md has no `milestone:` key.';
  if (key === 'none') {
    const active = milestones.filter((item) => item.status === 'active');
    return active.length === 0 ? null : `status.md says milestone: none, but ${active.map((item) => item.id).join(', ')} is active in roadmap.json.`;
  }
  const item = milestones.find((candidate) => candidate.id === key);
  if (item === undefined) return `status.md says milestone: ${key}, which is not a milestone item in roadmap.json.`;
  if (item.status === 'active') return null;
  if (key === 'Pre-M0' && item.status === 'done') return null;
  return `status.md says milestone: ${key}, but that item is "${item.status}" in roadmap.json. Make the two agree.`;
}

describe('the roadmap data', () => {
  it('(a) has exactly the milestones of the table in docs/engine/migration.md', () => {
    const table = migrationIds(read('docs/engine/migration.md'));
    const items = data.items.filter((item) => item.kind === 'milestone').map((item) => item.id);
    expect(items.slice().sort(), 'Add or remove milestone items in roadmap.json to match the table.').toEqual(table.slice().sort());
    expect(table).toContain('Phase 0');
    expect(table).toContain('Pre-M0');
    expect(table).toContain('M1b');
    // A non-milestone item must not borrow a milestone id.
    for (const item of data.items) if (item.kind !== 'milestone') expect(table, `${item.id} uses a milestone id`).not.toContain(item.id);
  });

  it('(b) agrees with the milestone key of status.md', () => {
    expect(checkMilestoneKey(milestoneKey(read('status.md')), data)).toBeNull();
  });

  it('(b) the key rule can fail', () => {
    const item = (id: string, status: string): RoadmapData['items'][number] => ({ id, kind: 'milestone', label: id, lane: 'l', status, after: [], notes: 'n' });
    const sample: RoadmapData = {
      updated: '2026-01-01',
      lanes: [{ id: 'l', title: 'L' }],
      items: [item('Pre-M0', 'done'), item('M0', 'active'), item('M1', 'next'), item('M2', 'later')],
    };
    expect(checkMilestoneKey('M0', sample)).toBeNull();
    expect(checkMilestoneKey('Pre-M0', sample)).toBeNull(); // done is allowed for Pre-M0 only
    expect(checkMilestoneKey('M1', sample)).toMatch(/"next"/);
    expect(checkMilestoneKey('M2', sample)).toMatch(/"later"/);
    expect(checkMilestoneKey('none', sample)).toMatch(/M0/);
    expect(checkMilestoneKey('M9', sample)).toMatch(/not a milestone/);
    expect(checkMilestoneKey(null, sample)).toMatch(/no `milestone:` key/);
  });

  it('(c) roadmap.svg and the README are what the generator writes now', () => {
    const fresh = generate();
    const hint = 'The generated file is out of date. Run `npm run roadmap` and commit the result.';
    expect(read('docs/roadmap/roadmap.svg') === fresh.svg, `docs/roadmap/roadmap.svg: ${hint}`).toBe(true);
    expect(read('docs/roadmap/README.md') === fresh.readme, `docs/roadmap/README.md: ${hint}`).toBe(true);
  });

  it('(c) the svg has alt text, the not-time note and a bar for every item', () => {
    const svg = read('docs/roadmap/roadmap.svg');
    expect(svg).toContain('<title id="roadmap-title">');
    expect(svg).toContain('<desc id="roadmap-desc">');
    expect(svg).toContain('Order and dependency only. Bar length is not time.');
    for (const item of data.items) expect(svg, item.id).toContain(`id="item-${item.id.replace(/[^A-Za-z0-9]+/g, '-')}"`);
  });

  it('(d) is sound', () => {
    expect(validate(data)).toEqual([]);
    expect(data.items.every((item) => STATUSES.includes(item.status))).toBe(true);
  });

  it('(d) the checks can fail', () => {
    const copy = (): RoadmapData => structuredClone(data);
    const first = (roadmap: RoadmapData) => {
      const item = roadmap.items[0];
      if (item === undefined) throw new Error('no items');
      return item;
    };
    const badStatus = copy();
    first(badStatus).status = 'soon';
    expect(validate(badStatus).join('\n')).toMatch(/status "soon"/);

    const badDep = copy();
    first(badDep).after = ['M99'];
    expect(validate(badDep).join('\n')).toMatch(/"M99", which does not exist/);

    const cyclic = copy();
    first(cyclic).after = ['M8']; // Phase 0 after M8, and M8 depends back on it through the chain
    expect(validate(cyclic).join('\n')).toMatch(/cycle/);

    const badLane = copy();
    first(badLane).lane = 'nowhere';
    expect(validate(badLane).join('\n')).toMatch(/lane "nowhere"/);

    const clash = copy();
    first(clash).lane = 'engine';
    clash.items.push({ ...first(clash), id: 'twin' });
    expect(validate(clash).join('\n')).toMatch(/same lane and column/);

    const longLabel = copy();
    first(longLabel).label = 'A label that is far too long to fit';
    expect(validate(longLabel).join('\n')).toMatch(/does not fit/);
  });

  it('(d) an explicit column cannot sit before a dependency', () => {
    const early = structuredClone(data);
    const m1 = early.items.find((item) => item.id === 'M1');
    if (m1 === undefined) throw new Error('no M1');
    m1.column = 0;
    expect(validate(early).join('\n')).toMatch(/Item "M1" is in column 0/);
  });
});
