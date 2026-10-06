import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A small git repo made for a test. */
export type TempRepo = {
  /** The folder of the repo. */
  dir: string;
  /** The two commit ids, the first one first. */
  commits: string[];
  /** Deletes the repo. */
  remove(): void;
};

/**
 * Makes a git repo in the OS temp folder (or in `options.dir`) with two commits, so a test can
 * run git against a real history without touching the Shadow Jog repo:
 *
 * 1. "Add the first doc": README.md and docs/first.md.
 * 2. "Add the second doc": docs/first.md changed and docs/second.md added, so a test can tell a
 *    changed file from an added one.
 *
 * The commit dates are fixed (2026-01-01 and 2026-01-02), so a test can rely on them. The author
 * is a made-up one, so this works on a machine with no git identity set.
 */
export function makeTempRepo(options: { dir?: string } = {}): TempRepo {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'cc-fixture-repo-'));
  mkdirSync(dir, { recursive: true });

  const git = (args: string[], date?: string): string =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@fixture.example',
        GIT_COMMITTER_NAME: 'Fixture Author',
        GIT_COMMITTER_EMAIL: 'author@fixture.example',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    }).trim();

  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };

  git(['init', '--quiet', '--initial-branch=main']);

  write('README.md', '# Fixture repo\n\nA repo for tests.\n');
  write('docs/first.md', '# First doc\n\nThe first version.\n');
  git(['add', '--all']);
  git(['commit', '--quiet', '--no-verify', '-m', 'Add the first doc'], '2026-01-01T00:00:00Z');
  const first = git(['rev-parse', 'HEAD']);

  write('docs/first.md', '# First doc\n\nThe second version.\n');
  write('docs/second.md', '# Second doc\n\nAdded in the second commit.\n');
  git(['add', '--all']);
  git(['commit', '--quiet', '--no-verify', '-m', 'Add the second doc'], '2026-01-02T00:00:00Z');
  const second = git(['rev-parse', 'HEAD']);

  return {
    dir,
    commits: [first, second],
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
