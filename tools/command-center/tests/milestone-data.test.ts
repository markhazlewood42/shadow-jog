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

  it('the ET row comes before the M8a row, because ET started and finished before M8a', () => {
    expect(ids).toContain('ET');
    expect(ids).toContain('M8a');
    expect(ids.indexOf('ET')).toBeLessThan(ids.indexOf('M8a'));
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
    // The strip has squares, and every done item of the roadmap has one (the sets of ids are equal), so the strip is never blank.
    expect(milestones.length).toBeGreaterThan(0);
    const doneIds = milestones.filter((milestone) => milestone.done).map((milestone) => milestone.id);
    expect(doneIds.length).toBeGreaterThan(0);
    for (const id of doneIds) expect(ids, `done id ${id} is a row of the table`).toContain(id);
    expect(doneIds.slice().sort()).toEqual(expected.slice().sort());
    // A done milestone is drawn done unless the key makes it current.
    states.forEach((state, index) => {
      if (milestones[index]?.done && index !== current) expect(state, milestones[index]?.id).toBe('done');
    });
    // Milestones that are finished and merged stay done (a milestone never goes back), so a status file that says `none` still draws them.
    for (const id of ['Phase 0', 'Pre-M0', 'M0', 'M1', 'M1b', 'M2', 'M3', 'M5', 'M6', 'M7', 'ET']) {
      expect(milestones.find((milestone) => milestone.id === id)?.done, `${id} is done in roadmap.json`).toBe(true);
    }
    // M4 is optional and M8a to M8d and Editors have not finished: they are not done.
    for (const id of ['M4', 'M8a', 'M8b', 'M8c', 'M8d', 'Editors']) expect(milestones.find((milestone) => milestone.id === id)?.done, `${id} is not done`).toBe(false);
    // With the key on `none` there is no current square.
    if (key.current === null) expect(states).not.toContain('current');
    expect(states).toContain('done');
  });
});
