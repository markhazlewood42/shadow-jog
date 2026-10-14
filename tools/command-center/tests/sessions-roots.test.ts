import { describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../src/server/runner';
import { ROOTS_CACHE_MS, createRootsResolver, parseWorktrees } from '../src/server/sessions/roots';

// The roots in which a session counts as Shadow Jog's: the config's roots plus the git worktrees of the repo. Git is injected, so no test needs a real one.

const PORCELAIN = [
  'worktree C:/Users/markh/home-base/projects/shadow-jog',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree C:/Users/markh/home-base/projects/shadow-jog-cc-milestones',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/cc-milestone-tracker',
  '',
  'worktree C:/Users/markh/home-base/projects/shadow-jog/.claude/worktrees/x y',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  '',
].join('\n');

const config = { repoRoot: '/fixture/repo', roots: ['/fixture/repo', '/fixture/repo-phaser'] };
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

describe('parseWorktrees', () => {
  it('reads the paths of the worktree lines, a path with a space included', () => {
    expect(parseWorktrees(PORCELAIN)).toEqual([
      'C:/Users/markh/home-base/projects/shadow-jog',
      'C:/Users/markh/home-base/projects/shadow-jog-cc-milestones',
      'C:/Users/markh/home-base/projects/shadow-jog/.claude/worktrees/x y',
    ]);
    expect(parseWorktrees('')).toEqual([]);
    expect(parseWorktrees('worktree \r\nHEAD abc\r\nworktree /a/b\r\n')).toEqual(['/a/b']);
  });
});

describe('createRootsResolver', () => {
  it('gives the config roots and the worktrees of the repo, and runs git in the repo without a shell', async () => {
    const exec = vi.fn(async () => ok(PORCELAIN));
    const roots = await createRootsResolver({ config, now: () => 0, exec })();
    expect(roots).toEqual([...config.roots, ...parseWorktrees(PORCELAIN)]);
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args, options] = exec.mock.calls[0] as unknown as [string, string[], { cwd: string; timeoutMs: number }];
    expect([file, args]).toEqual(['git', ['worktree', 'list', '--porcelain']]);
    expect(options.cwd).toBe(config.repoRoot);
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it('falls back to the config roots, with no error, when git fails, is missing, times out or throws', async () => {
    const failures = [
      async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }),
      async () => ({ code: 127, stdout: '', stderr: 'git not found' }),
      async () => ({ code: 124, stdout: 'worktree /late', stderr: '' }),
      async () => Promise.reject(new Error('boom')),
    ];
    for (const exec of failures) {
      expect(await createRootsResolver({ config, now: () => 0, exec })()).toEqual(config.roots);
    }
  });

  it('keeps the answer for 30 seconds and then asks git again, so a new worktree is found', async () => {
    let time = 1_000;
    let out = PORCELAIN;
    const exec = vi.fn(async () => ok(out));
    const roots = createRootsResolver({ config, now: () => time, exec });
    expect(ROOTS_CACHE_MS).toBe(30_000);
    expect(await roots()).toContain('C:/Users/markh/home-base/projects/shadow-jog-cc-milestones');

    out = `${PORCELAIN}\nworktree /new/worktree\nHEAD 4444444444444444444444444444444444444444\n`;
    time += 29_999;
    expect(await roots()).not.toContain('/new/worktree'); // still the kept answer
    expect(exec).toHaveBeenCalledTimes(1);

    time += 1; // 30 s since the look
    expect(await roots()).toContain('/new/worktree');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('a failed look is kept for 30 seconds too, and git that works again is used after that', async () => {
    let time = 0;
    let fail = true;
    const exec = vi.fn(async () => (fail ? { code: 1, stdout: '', stderr: 'no' } : ok(PORCELAIN)));
    const roots = createRootsResolver({ config, now: () => time, exec });
    expect(await roots()).toEqual(config.roots);
    fail = false;
    time = 10_000;
    expect(await roots()).toEqual(config.roots);
    expect(exec).toHaveBeenCalledTimes(1);
    time = 30_000;
    expect(await roots()).toEqual([...config.roots, ...parseWorktrees(PORCELAIN)]);
  });

  it('two asks at once share one git run', async () => {
    const exec = vi.fn(async () => ok(PORCELAIN));
    const roots = createRootsResolver({ config, now: () => 0, exec });
    await Promise.all([roots(), roots()]);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
