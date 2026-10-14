import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMilestoneKey, parseMilestones, parseRoadmapDone } from '../src/server/status/status';
import type { DocHeading } from '../src/shared/types';
import { squareStates } from '../src/web/now/StatusPanel';
import { REPO_DIR } from './helpers';

// The Milestone strip of the Status panel is drawn from three real files: the `milestone:` key of status.md (which square is current),
// the table of docs/engine/migration.md (the squares and their order) and docs/roadmap/roadmap.json (which milestones are done).
// These tests read the real files, so a typo or a wrong row order fails here.

const NO_HEADINGS: readonly DocHeading[] = [];
const statusSource = readFileSync(join(REPO_DIR, 'status.md'), 'utf8');
const migrationSource = readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8');
const roadmapSource = readFileSync(join(REPO_DIR, 'docs', 'roadmap', 'roadmap.json'), 'utf8');
const milestones = parseMilestones(migrationSource, NO_HEADINGS, parseRoadmapDone(roadmapSource));
const ids = milestones.map((milestone) => milestone.id);

describe('the real milestone data', () => {
  it('the milestone key of status.md is `none` or the id of a table row, with no problem', () => {
    const key = parseMilestoneKey(statusSource, ids);
    expect(key.problem).toBeNull();
    if (key.current !== null) expect(ids).toContain(key.current);
  });

  it('the ET row comes before the M8 row, because ET started and finished before M8', () => {
    expect(ids).toContain('ET');
    expect(ids).toContain('M8');
    expect(ids.indexOf('ET')).toBeLessThan(ids.indexOf('M8'));
  });

  it('the strip is never blank: the done squares are exactly the milestone items that roadmap.json marks done', () => {
    const roadmap = JSON.parse(roadmapSource) as { items: { id: string; kind?: string; status: string }[] };
    const expected = roadmap.items.filter((item) => item.kind === 'milestone' && item.status === 'done').map((item) => item.id);
    const key = parseMilestoneKey(statusSource, ids);
    const current = key.current === null ? null : ids.indexOf(key.current);
    const states = squareStates(
      milestones.map((milestone) => milestone.done),
      current,
    );
    // Every done item of the roadmap has a square (the id sets are equal), and it is drawn done unless the key makes it current.
    expect(milestones.filter((milestone) => milestone.done).map((milestone) => milestone.id).sort()).toEqual(expected.slice().sort());
    expect(states.map((state, index) => (state === 'done' || index === current ? milestones[index]?.id : null)).filter((id) => id !== null && expected.includes(id as string)).length).toBe(expected.length);
    // Milestones that are finished and merged stay done (a milestone never goes back), so a status file that says `none` still draws them.
    for (const id of ['Phase 0', 'Pre-M0', 'M0', 'M1', 'M1b', 'M2', 'M3', 'M5', 'M6', 'M7', 'ET']) {
      expect(milestones.find((milestone) => milestone.id === id)?.done, `${id} is done in roadmap.json`).toBe(true);
    }
    // M4 is optional and M8 and Editors have not finished: they are not done.
    for (const id of ['M4', 'M8', 'Editors']) expect(milestones.find((milestone) => milestone.id === id)?.done, `${id} is not done`).toBe(false);
    // With the key on `none` there is no current square.
    if (key.current === null) expect(states).not.toContain('current');
    expect(states).toContain('done');
  });
});
