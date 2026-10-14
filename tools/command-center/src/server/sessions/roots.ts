import type { Config } from '../config';
import { type Exec, execProcess } from '../runner';

// The folders in which a session counts as Shadow Jog's: the roots of the config, and every git worktree of the repo. A session that works in a
// sibling worktree (`projects/shadow-jog-cc-milestones`, `.claude/worktrees/x`) works on Shadow Jog, and the config cannot list folders that a
// session makes later. So the worktrees come from `git worktree list --porcelain`, and a worktree made while the server runs is found within a short time.

/** How long a list of worktrees is kept before git is asked again. */
export const ROOTS_CACHE_MS = 30_000;

/** `git worktree list` is quick; a git that hangs must not hold up the list of sessions. */
const GIT_TIMEOUT_MS = 5_000;

/** The paths in the output of `git worktree list --porcelain`: the lines that start with `worktree `. */
export function parseWorktrees(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter((path) => path !== '');
}

export type RootsDeps = {
  config: Pick<Config, 'repoRoot' | 'roots'>;
  /** The clock, in milliseconds since 1970. */
  now: () => number;
  /** Runs git without a shell. The tests set it, so no test needs a real git. */
  exec?: Exec;
};

/**
 * A function that gives the effective roots: `config.roots` and the worktrees of `config.repoRoot`, kept for 30 seconds. When git fails (it is not
 * installed, the folder is not a repo, it ran too long) the answer is `config.roots`, with no error: this only adds folders to a list that works without it.
 */
export function createRootsResolver(deps: RootsDeps): () => Promise<string[]> {
  const { config, now } = deps;
  const exec = deps.exec ?? execProcess;
  let kept: { at: number; roots: string[] } | null = null;
  let pending: Promise<string[]> | null = null;

  async function look(): Promise<string[]> {
    let worktrees: string[] = [];
    try {
      const result = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: config.repoRoot, timeoutMs: GIT_TIMEOUT_MS });
      if (result.code === 0) worktrees = parseWorktrees(result.stdout);
    } catch {
      worktrees = [];
    }
    const roots = [...config.roots, ...worktrees];
    kept = { at: now(), roots };
    return roots;
  }

  return async () => {
    if (kept !== null && now() - kept.at < ROOTS_CACHE_MS) return kept.roots;
    // Two looks at once (the sessions module and the agents module do not share a resolver, but one module can be asked twice) share one git run.
    pending ??= look().finally(() => {
      pending = null;
    });
    return pending;
  };
}
