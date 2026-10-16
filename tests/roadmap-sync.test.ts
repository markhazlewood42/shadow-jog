import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../scripts/gen-roadmap.mjs';
import type { RoadmapData, RoadmapItem } from '../scripts/gen-roadmap.mjs';
import { AUTH_FIX, labelFrom, syncRoadmap } from '../scripts/roadmap-sync.mjs';
import type { GhRunner } from '../scripts/roadmap-sync.mjs';

/**
 * The roadmap sync (scripts/roadmap-sync.mjs) with a fake gh runner and the fixtures in tests/fixtures/roadmap-sync/.
 * No network. Each test works on a fresh copy of the sample roadmap.json in a temp folder.
 * Cases: docs/command-center/roadmap-sync-brief.md section 7.
 */

const FIX = fileURLToPath(new URL('./fixtures/roadmap-sync/', import.meta.url));
const page1 = readFileSync(join(FIX, 'graphql-page1.json'), 'utf8');
const page2 = readFileSync(join(FIX, 'graphql-page2.json'), 'utf8');
const sample = () => JSON.parse(readFileSync(join(FIX, 'roadmap.json'), 'utf8')) as RoadmapData;
const TODAY = '2026-10-16';

/** A temp folder with a copy of the sample roadmap.json (and a way to read it back). */
function setup(edit?: (data: RoadmapData) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-sync-'));
  const data = sample();
  edit?.(data);
  const put = (value: RoadmapData) => writeFileSync(join(dir, 'roadmap.json'), `${JSON.stringify(value, null, 2)}\n`);
  put(data);
  return { dir, put, text: () => readFileSync(join(dir, 'roadmap.json'), 'utf8'), data: () => JSON.parse(readFileSync(join(dir, 'roadmap.json'), 'utf8')) as RoadmapData };
}

/** A runner that serves the two fixture pages by cursor, and records every call. */
function fakeGh(pages: [string, string] = [page1, page2]) {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args[0] !== 'api') throw new Error(`unexpected gh call: ${args.join(' ')}`);
    return args.includes('cursor=CURSOR1') ? pages[1] : pages[0];
  };
  return { gh, calls };
}

const item = (data: RoadmapData, id: string): RoadmapItem => {
  const found = data.items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const failing = (message: string): GhRunner => () => {
  throw new Error(message);
};

describe('roadmap sync', () => {
  it('writes a sound file, appends board-new items in issue order, pages by cursor and exits 0', () => {
    const { dir, data } = setup();
    const { gh, calls } = fakeGh();
    const result = syncRoadmap({ gh, dir, today: TODAY });
    expect(result.code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.includes('cursor=CURSOR1')).toBe(true);
    const out = data();
    expect(validate(out)).toEqual([]);
    expect(out.updated).toBe(TODAY);
    // The old order is unchanged. Then #84, #93, #97, #101, #105, #150, #151, sorted by issue number. The decisions (#127, #128) are not items.
    expect(out.items.map((i) => i.id)).toEqual(['M1', 'M2', 'P1', 'old-bug', 'gone', '#84', '#93', '#97', '#101', '#105', '#150', '#151']);
    expect(out.items.some((i) => i.issue === 127 || i.issue === 128)).toBe(false);
    // The chart files follow the data.
    expect(readdirSync(dir).sort()).toEqual(['README.md', 'roadmap.json', 'roadmap.svg']);
  });

  it('maps the board Status, and a closed issue with a non-Done Status becomes done with a warning', () => {
    const { dir, data } = setup((d) => {
      item(d, 'P1').issue = 101;
    });
    const result = syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const out = data();
    expect(item(out, '#84').status).toBe('later'); // Backlog
    expect(item(out, '#150').status).toBe('next'); // Next
    expect(item(out, 'P1').status).toBe('gated'); // Waiting on Mark
    expect(item(out, '#93').status).toBe('done'); // closed, Status Backlog
    expect(item(out, '#93').state).toBe('closed');
    expect(item(out, '#84').state).toBe('open');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/#93.*closed/);
  });

  it('never gives a board item kind milestone, even for a board Milestone', () => {
    const { dir, data } = setup((d) => {
      item(d, 'P1').issue = 101;
    });
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const out = data();
    const fromBoard = out.items.filter((i) => i.issue !== undefined);
    expect(fromBoard.length).toBeGreaterThan(5);
    expect(fromBoard.filter((i) => i.kind === 'milestone')).toEqual([]);
    expect(item(out, 'P1').boardKind).toBe('Milestone');
    // The hand-written milestones stay.
    expect(out.items.filter((i) => i.kind === 'milestone').map((i) => i.id)).toEqual(['M1', 'M2']);
  });

  it('adopts an item by issue: keeps every hand field and changes only the board fields', () => {
    const { dir, data } = setup((d) => {
      item(d, 'P1').issue = 101;
    });
    const before = structuredClone(item(data(), 'P1'));
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const after = item(data(), 'P1');
    for (const key of ['id', 'kind', 'label', 'lane', 'after', 'column', 'branch', 'notes'] as const) expect(after[key]).toEqual(before[key]);
    expect(after.status).toBe('gated');
    expect(after.title).toBe('Playthrough of Chapter 1 on the new engine, then release and deploy');
    expect(after.group).toBe('Shareable demo');
    expect(after.url).toBe('https://github.com/markhazlewood42/shadow-jog/issues/101');
    expect(after.state).toBe('open');
    // The keys the item already had keep their order.
    expect(Object.keys(after).slice(0, Object.keys(before).length)).toEqual(Object.keys(before));
    // An item with no issue is copied through unchanged.
    expect(item(data(), 'M2')).toEqual(item(sample(), 'M2'));
  });

  it('does not adopt an item that has no issue: the board item is added beside it', () => {
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    expect(item(data(), 'P1').status).toBe('next');
    expect(item(data(), '#84').issue).toBe(84);
  });

  it('sets label, lane, column, pr and notes once, then never again', () => {
    const { dir, put, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const edited = data();
    const bug = item(edited, '#93');
    expect(bug.pr).toBe('#98 (merged 2026-10-16)');
    bug.label = 'My label';
    bug.lane = 'side';
    bug.column = 7;
    bug.pr = 'hand PR';
    bug.notes = 'My note.';
    put(edited);
    syncRoadmap({ gh: fakeGh().gh, dir, today: '2026-10-20' });
    const again = item(data(), '#93');
    expect([again.label, again.lane, again.column, again.pr, again.notes]).toEqual(['My label', 'side', 7, 'hand PR', 'My note.']);
  });

  it('gives a new item default notes, a lane from its Kind and a fitting short label', () => {
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const out = data();
    expect(item(out, '#84').notes).toBe('Board item #84.');
    expect(item(out, '#84').lane).toBe('other'); // Task
    expect(item(out, '#97').lane).toBe('other'); // Bug
    expect(item(out, '#105').lane).toBe('engine'); // Epic
    expect(item(out, '#105').label).toBe('Engine docs'); // the prefix is cut
    expect(item(out, '#105').title).toBe('Epic E4: Engine docs'); // the full title stays
    expect(item(out, '#84').title).toBe('Re-create the trailer tooling on the new engine');
    expect(item(out, '#84').label).toBe('Re-create the trailer');
    expect(item(out, '#97').label).toBe('Flaky e2e: sje-hack-a');
    expect(item(out, '#150').label).toBe('Antidisestab'); // one word over 12 characters is cut
    expect(labelFrom('Decision: E1 D2: the Sprite Fusion credit cap')).toBe('the Sprite Fusion');
  });

  it('puts a Waiting on Mark board-new item in the gated lane', () => {
    const waiting = page2.replace(
      '"name":"Next","field":{"name":"Status"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Task"',
      '"name":"Waiting on Mark","field":{"name":"Status"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Task"',
    );
    expect(waiting).not.toBe(page2);
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh([page1, waiting]).gh, dir, today: TODAY });
    expect(item(data(), '#150').lane).toBe('gated');
    expect(item(data(), '#150').status).toBe('gated');
  });

  it('resolves a column clash and an item with no Step to the next free column of the lane', () => {
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const out = data();
    // #105 has Step 2 (column 1), which M2 holds in the engine lane, so it takes column 2.
    expect(item(out, '#105').column).toBe(2);
    // The other lane holds columns 0 and 1. No Step: the next free ones. Step 1 clashes with column 0, so it moves on.
    expect(['#84', '#93', '#97', '#150', '#151'].map((id) => item(out, id).column)).toEqual([2, 3, 4, 5, 6]);
    expect(validate(out)).toEqual([]);
  });

  it('counts the open decisions on each epic and does not make items of them', () => {
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    // #127 is open. #128 is Done and closed. So one decision is open.
    expect(item(data(), '#105').decisions).toBe(1);
    expect(item(data(), '#84').decisions).toBeUndefined();
  });

  it('is idempotent: a second run changes no byte and keeps "updated"', () => {
    const { dir, text } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const first = text();
    const second = syncRoadmap({ gh: fakeGh().gh, dir, today: '2027-01-01' });
    expect(second.code).toBe(0);
    expect(second.changed).toBe(false);
    expect(text()).toBe(first);
    expect(first.endsWith('}\n')).toBe(true);
    expect((JSON.parse(first) as RoadmapData).updated).toBe(TODAY);
  });

  it('moves "updated" only when other content changed', () => {
    const { dir, data } = setup();
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const changedPage = page2.replace('Re-create the trailer tooling on the new engine', 'Re-create the trailer tools');
    syncRoadmap({ gh: fakeGh([page1, changedPage]).gh, dir, today: '2026-11-01' });
    expect(data().updated).toBe('2026-11-01');
    expect(item(data(), '#84').title).toBe('Re-create the trailer tools');
  });

  it('reports a stale item and keeps it; --check exits 1 on it', () => {
    const { dir, data } = setup();
    const result = syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    expect(result.code).toBe(0);
    expect(result.stale).toEqual(['gone (#999)']);
    expect(result.lines.some((l) => l.includes('Stale') && l.includes('#999'))).toBe(true);
    expect(data().items.some((i) => i.id === 'gone')).toBe(true);
    expect(syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY, check: true }).code).toBe(1);
  });

  it('--check exits 0 when current and 1 when not, ignores "updated" and writes nothing', () => {
    const { dir, put, text, data } = setup((d) => {
      d.items = d.items.filter((i) => i.id !== 'gone'); // no stale item
    });
    const before = text();
    expect(syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY, check: true }).code).toBe(1); // the file lacks the board items
    expect(text()).toBe(before);
    expect(readdirSync(dir)).toEqual(['roadmap.json']);
    syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const edited = data();
    edited.updated = '2020-01-01'; // only "updated" differs
    put(edited);
    const synced = text();
    expect(syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY, check: true }).code).toBe(0);
    expect(text()).toBe(synced); // --check wrote nothing
    expect(data().updated).toBe('2020-01-01');
  });

  it('on a missing login or scope prints the fix and exits 1 with no write', () => {
    const { dir, text } = setup();
    const before = text();
    const result = syncRoadmap({ gh: failing('error: your authentication token is missing required scopes [read:project]'), dir, today: TODAY });
    expect(result.code).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain(AUTH_FIX);
    expect(text()).toBe(before);
    expect(readdirSync(dir)).toEqual(['roadmap.json']);
  });

  it('on bad JSON from gh exits 1 and leaves the file unchanged', () => {
    const { dir, text } = setup();
    const before = text();
    const result = syncRoadmap({ gh: () => '{ not json', dir, today: TODAY });
    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('not valid JSON');
    expect(text()).toBe(before);
    expect(readdirSync(dir)).toEqual(['roadmap.json']);
  });

  it('on a result that fails validate() exits 1 and leaves the file unchanged', () => {
    // M2 comes after M1 (column 0), so a hand column of 0 is too early.
    const { dir, text } = setup((d) => {
      item(d, 'M2').column = 0;
    });
    const before = text();
    const result = syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('not sound');
    expect(text()).toBe(before);
  });

  it('falls back to gh project item-list when the GraphQL call fails, and errors at 100 items', () => {
    const entry = (n: number) => ({ content: { number: n, title: `Item ${n}`, url: `https://github.com/markhazlewood42/shadow-jog/issues/${n}` }, kind: 'Task', status: 'Backlog' });
    const serve =
      (count: number): GhRunner =>
      (args) => {
        if (args[0] === 'api') throw new Error('GraphQL: something broke');
        return JSON.stringify({ items: Array.from({ length: count }, (_, i) => entry(i + 1)) });
      };
    const { dir, data } = setup();
    const result = syncRoadmap({ gh: serve(2), dir, today: TODAY });
    expect(result.code).toBe(0);
    expect(item(data(), '#1').state).toBeUndefined(); // the fallback cannot know the state
    const { dir: dir2, text } = setup();
    const before = text();
    const big = syncRoadmap({ gh: serve(100), dir: dir2, today: TODAY });
    expect(big.code).toBe(1);
    expect(text()).toBe(before);
  });

  it('leaks no token or private board URL into the output or the file', () => {
    const { dir, text } = setup();
    const result = syncRoadmap({ gh: fakeGh().gh, dir, today: TODAY });
    const all = `${result.lines.join('\n')}\n${text()}`;
    expect(all).not.toMatch(/github\.com\/users\/|\/projects\/2|PVT_|ghp_|gho_|github_pat_/);
  });
});
