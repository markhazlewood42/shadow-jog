import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The e2e shards in .github/workflows/ci.yml are named spec lists. A spec file that is in no list never runs in CI, and nobody sees it. This test keeps the lists true:
 *  (a) every e2e/*.spec.ts is in a shard list or on NOT_IN_CI below, with a reason;
 *  (b) no spec is in two shards (it would run twice);
 *  (c) every listed spec file exists (a rename would otherwise make the shard fail only in CI);
 *  (d) NOT_IN_CI holds no spec that is also in a shard, and no file that does not exist.
 * To add a spec: put it in the shard with the smallest total (see the comment in ci.yml), or add it to NOT_IN_CI with a reason. See docs/CI.md.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The specs that CI does not run on purpose, each with the reason. */
const NOT_IN_CI: Readonly<Record<string, string>> = {
  'e2e/perf.spec.ts': 'perf: frame timing needs a real GPU (npm run perf); a software renderer says nothing about it',
  'e2e/sje-bench.spec.ts': 'sje-bench: times a GPU with 1,000 objects (npm run perf); local only',
  'e2e/shots.spec.ts': 'shots: regenerates the files in docs/screenshots/ (npm run shots); it makes pictures and judges nothing',
  'e2e/audio-evidence.spec.ts': 'audio-evidence: renders every song and writes reports under docs/quality/evidence/audio/; it makes files and judges nothing',
  'e2e/playtest.spec.ts': 'playtest: the real-speed hands-off playtest; it has its own workflow, playtest.yml, which runs after a push to main',
  'e2e/sje-pictures.spec.ts': 'sje-pictures: the pictures for the M3 look review; local only, does nothing unless M3_PICTURES=1',
  'e2e/m8-ui-pictures.spec.ts': 'm8-ui-pictures: the pictures for the M8b look review; local only, does nothing unless M8_PICTURES=1',
};

/** The shards of a ci.yml text: shard name -> spec files. A small regex, because the repo has no YAML parser. A shard is a matrix entry `- shard: '1/6'` followed by `specs: >-` and the indented spec paths. */
function parseShards(ci: string): Map<string, string[]> {
  const shards = new Map<string, string[]>();
  // `- shard: 'N/M'`, a newline, `specs: >-`, then every following line that holds only indented e2e/<name>.spec.ts paths.
  const entry = /- shard: '([^']+)'[ \t]*\r?\n[ \t]*specs: >-[ \t]*\r?\n((?:[ \t]+e2e\/[\w-]+\.spec\.ts(?:[ \t]+e2e\/[\w-]+\.spec\.ts)*[ \t]*\r?\n?)+)/g;
  for (const m of ci.matchAll(entry)) {
    shards.set(m[1] ?? '', (m[2] ?? '').match(/e2e\/[\w-]+\.spec\.ts/g) ?? []);
  }
  // Fail loudly on a layout the pattern does not understand: every `- shard:` line must have produced an entry, or its specs would be dropped without a word.
  const declared = (ci.match(/^[ \t]*- shard:/gm) ?? []).length;
  if (declared !== shards.size) {
    throw new Error(`ci.yml has ${declared} "- shard:" entries but the parser understood ${shards.size}: each one must be "- shard: 'N/M'", then "specs: >-", then indented e2e/<name>.spec.ts paths and nothing else (no bullets, no comments inside the block)`);
  }
  return shards;
}

/** The problems of a ci.yml text against the spec files on disk (`existing`) and the NOT_IN_CI list. An empty array means that everything is true. */
function checkShards(ci: string, existing: readonly string[], notInCi: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const shards = parseShards(ci);
  if (shards.size === 0) problems.push('no shard was found in ci.yml (the parser or the matrix format changed)');
  const where = new Map<string, string[]>();
  for (const [shard, specs] of shards) {
    for (const spec of specs) where.set(spec, [...(where.get(spec) ?? []), shard]);
  }
  for (const [spec, inShards] of where) {
    if (inShards.length > 1) problems.push(`${spec} is in more than one shard: ${inShards.join(', ')}`);
    if (!existing.includes(spec)) problems.push(`${spec} is listed in shard ${inShards.join(', ')} but the file does not exist`);
    if (spec in notInCi) problems.push(`${spec} is in a shard and also on NOT_IN_CI`);
  }
  for (const spec of existing) {
    if (!where.has(spec) && !(spec in notInCi)) problems.push(`${spec} is in no shard and not on NOT_IN_CI (add it to a shard in ci.yml, or to NOT_IN_CI with a reason)`);
  }
  for (const [spec, reason] of Object.entries(notInCi)) {
    if (!existing.includes(spec)) problems.push(`${spec} is on NOT_IN_CI but the file does not exist`);
    if (reason.trim() === '') problems.push(`${spec} is on NOT_IN_CI with no reason`);
  }
  return problems;
}

const specsOnDisk = readdirSync(join(ROOT, 'e2e'))
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => `e2e/${f}`)
  .sort();
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('ci.yml e2e shards', () => {
  it('every spec runs in exactly one shard or is on NOT_IN_CI with a reason, and every listed spec exists', () => {
    expect(checkShards(ci, specsOnDisk, NOT_IN_CI)).toEqual([]);
  });

  it('the shards are named 1/N to N/N with no gap, and each one has specs', () => {
    const shards = parseShards(ci);
    const n = shards.size;
    expect(n).toBeGreaterThan(0);
    expect([...shards.keys()]).toEqual(Array.from({ length: n }, (_, i) => `${i + 1}/${n}`));
    expect([...shards.values()].every((specs) => specs.length > 0)).toBe(true);
  });

  // Negative controls: the check function must be able to fail.
  const SYNTHETIC = `
        include:
          - shard: '1/2'
            specs: >-
              e2e/a.spec.ts e2e/b.spec.ts
          - shard: '2/2'
            specs: >-
              e2e/c.spec.ts
`;
  it('control: a clean synthetic ci.yml passes', () => {
    expect(checkShards(SYNTHETIC, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts'], {})).toEqual([]);
  });

  it('control: a spec that is in no shard and not on NOT_IN_CI fails', () => {
    const problems = checkShards(SYNTHETIC, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts', 'e2e/missing.spec.ts'], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('e2e/missing.spec.ts is in no shard');
  });

  it('control: a spec on NOT_IN_CI passes', () => {
    expect(checkShards(SYNTHETIC, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts', 'e2e/x.spec.ts'], { 'e2e/x.spec.ts': 'local only' })).toEqual([]);
  });

  it('control: a spec in two shards fails', () => {
    const twice = SYNTHETIC.replace('e2e/c.spec.ts', 'e2e/c.spec.ts e2e/a.spec.ts');
    expect(checkShards(twice, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts'], {}).join('\n')).toContain('e2e/a.spec.ts is in more than one shard');
  });

  it('control: a listed spec file that does not exist fails', () => {
    expect(checkShards(SYNTHETIC, ['e2e/a.spec.ts', 'e2e/b.spec.ts'], {}).join('\n')).toContain('e2e/c.spec.ts is listed in shard 2/2 but the file does not exist');
  });

  it('control: a shard entry in a layout the parser does not understand throws', () => {
    const bullets = SYNTHETIC.replace('e2e/a.spec.ts e2e/b.spec.ts', '- e2e/a.spec.ts\n              - e2e/b.spec.ts');
    expect(() => parseShards(bullets)).toThrow(/parser understood/);
  });

  it('control: a ci.yml with no shard fails', () => {
    expect(checkShards('jobs: {}', ['e2e/a.spec.ts'], {}).length).toBeGreaterThan(0);
  });
});
