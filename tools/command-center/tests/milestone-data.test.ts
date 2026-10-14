import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMilestoneKey, parseMilestones } from '../src/server/status/status';
import type { DocHeading } from '../src/shared/types';
import { REPO_DIR } from './helpers';

// The Milestone strip of the Status panel is drawn from two real files: the `milestone:` key of status.md and the
// table of docs/engine/migration.md. The strip fills the squares before the current one, so the row order is the
// order the milestones started. These tests read the real files, so a typo or a wrong row order fails here.

const NO_HEADINGS: readonly DocHeading[] = [];
const statusSource = readFileSync(join(REPO_DIR, 'status.md'), 'utf8');
const migrationSource = readFileSync(join(REPO_DIR, 'docs', 'engine', 'migration.md'), 'utf8');
const ids = parseMilestones(migrationSource, NO_HEADINGS).map((milestone) => milestone.id);

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
});
