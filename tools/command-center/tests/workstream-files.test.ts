import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWorkstream } from '../src/shared/workstream';

// The real workstream files of this repo must pass the validator. A session that writes a bad
// file fails CI here, before the Command Center shows a red row for it.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(REPO, 'docs', 'workstreams');

/** Every .md file under docs/workstreams (folders hold the branches with a slash), except the README. */
function workstreamFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...workstreamFiles(full));
    else if (entry.name.endsWith('.md') && !(dir === DIR && entry.name === 'README.md')) out.push(full);
  }
  return out;
}

const roadmap = JSON.parse(readFileSync(join(REPO, 'docs', 'roadmap', 'roadmap.json'), 'utf8')) as {
  items: { id: string }[];
};
const roadmapIds = new Set(roadmap.items.map((item) => item.id));

describe('docs/workstreams/*.md', () => {
  const files = workstreamFiles(DIR);

  it('has the file of this branch', () => {
    expect(files.map((f) => relative(REPO, f).replace(/\\/g, '/'))).toContain('docs/workstreams/workstream-contract.md');
  });

  for (const full of files) {
    const path = relative(REPO, full).replace(/\\/g, '/');
    it(`${path} passes the validator, and its roadmap id exists`, () => {
      const result = parseWorkstream(path, readFileSync(full, 'utf8'));
      // The text of the red row is the failure message, so a bad file says what is wrong.
      expect(result.ok ? 'ok' : result.message).toBe('ok');
      if (result.ok) expect([...roadmapIds], `roadmap id "${result.workstream.roadmap}"`).toContain(result.workstream.roadmap);
    });
  }
});
