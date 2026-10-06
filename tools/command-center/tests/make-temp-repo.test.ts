import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type TempRepo, makeTempRepo } from '../fixtures/make-temp-repo';

const made: TempRepo[] = [];
afterAll(() => {
  for (const repo of made) repo.remove();
});

function git(repo: TempRepo, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo.dir, encoding: 'utf8' }).trim();
}

describe('makeTempRepo', () => {
  it('makes a git repo in the OS temp folder with exactly two commits', () => {
    const repo = makeTempRepo();
    made.push(repo);

    expect(repo.dir.toLowerCase().startsWith(tmpdir().toLowerCase())).toBe(true);
    expect(existsSync(join(repo.dir, '.git'))).toBe(true);
    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(git(repo, 'log', '--format=%s')).toBe('Add the second doc\nAdd the first doc');
    expect(git(repo, 'branch', '--show-current')).toBe('main');

    // repo.commits holds the two commit ids, oldest first.
    expect(repo.commits).toHaveLength(2);
    expect(git(repo, 'rev-parse', 'HEAD~1')).toBe(repo.commits[0]);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(repo.commits[1]);

    // The second commit changes a file of the first and adds another, so a test can tell "changed" from "added".
    expect(git(repo, 'diff', '--name-status', repo.commits[0] as string, repo.commits[1] as string).split(/\r?\n/).sort()).toEqual(['A\tdocs/second.md', 'M\tdocs/first.md']);
    expect(git(repo, 'show', `${repo.commits[0]}:docs/first.md`)).not.toBe(git(repo, 'show', `${repo.commits[1]}:docs/first.md`));

    // Nothing is left uncommitted, and the commit dates are fixed, so a test can rely on them.
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'log', '--format=%cI')).toBe('2026-01-02T00:00:00+00:00\n2026-01-01T00:00:00+00:00');
  });

  it('can be made in a folder the caller picks, and remove() deletes it', () => {
    const parent = mkdtempSync(join(tmpdir(), 'cc-repo-parent-'));
    try {
      const dir = join(parent, 'nested', 'repo');
      const repo = makeTempRepo({ dir });
      expect(repo.dir).toBe(dir);
      expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
      expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('Fixture repo');
      repo.remove();
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('copies a seed folder into the repo before the first commit, so there are still two commits', () => {
    const seed = mkdtempSync(join(tmpdir(), 'cc-seed-'));
    try {
      mkdirSync(join(seed, 'docs', 'deep'), { recursive: true });
      writeFileSync(join(seed, 'docs', 'deep', 'seeded.md'), '# Seeded\n');
      const repo = makeTempRepo({ seed });
      made.push(repo);

      expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
      // The seeded file is in the first commit (and so has the date of the first commit), next to the repo's own files.
      expect(git(repo, 'ls-tree', '-r', '--name-only', repo.commits[0] as string).split(/\r?\n/).sort()).toEqual(['README.md', 'docs/deep/seeded.md', 'docs/first.md']);
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expect(git(repo, 'log', '-1', '--format=%as', '--', 'docs/deep/seeded.md')).toBe('2026-01-01');
    } finally {
      rmSync(seed, { recursive: true, force: true });
    }
  });

  it('makes a separate repo each time', () => {
    const [a, b] = [makeTempRepo(), makeTempRepo()];
    made.push(a, b);
    expect(a.dir).not.toBe(b.dir);
  });
});
