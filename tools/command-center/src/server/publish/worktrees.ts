import type { WorktreeFacts } from './map';
import { GIT_STATUS, type RunResult } from '../runner';

// The checkouts of the repo (the main folder and every worktree) with the number of files that differ from the last commit.
// Two reads: `git worktree list --porcelain` once, and `git status --porcelain=v1` in each checkout. Both are on the runner's list (runner.ts).

/** Runs git in a folder. The real one is the runner of the server, with the worktree folders added to its roots (see compose.ts). */
export type GitIn = (args: string[], cwd: string) => Promise<RunResult>;

/**
 * Reads the output of `git worktree list --porcelain`: blocks split by an empty line, each with `worktree <path>`, `HEAD <id>`, and either
 * `branch refs/heads/<name>` or `detached`. A bare repository and a checkout that git marks `prunable` (its folder is gone) are left out.
 */
export function parseWorktreeList(stdout: string): { path: string; branch: string | null }[] {
  const found: { path: string; branch: string | null }[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    let path: string | null = null;
    let branch: string | null = null;
    let skip = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'bare' || line.startsWith('prunable')) skip = true;
    }
    if (path !== null && path !== '' && !skip) found.push({ path, branch });
  }
  return found;
}

/** The number of changed, new or removed files in the output of the status read: one line for each. */
export function countDirty(stdout: string): number {
  return stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length;
}

export type WorktreeRead = { ok: true; worktrees: WorktreeFacts[] } | { ok: false; reason: string };

/** Reads all checkouts. A checkout whose status fails is left out (a made-up "clean" would mislead), and the reason goes to `onSkip`. */
export async function readWorktrees(git: GitIn, repoRoot: string, onSkip: (message: string) => void = () => {}): Promise<WorktreeRead> {
  const listed = await git(['worktree', 'list', '--porcelain'], repoRoot);
  if (listed.code !== 0) return { ok: false, reason: `git worktree list failed with code ${listed.code}` };
  const entries = parseWorktreeList(listed.stdout);
  const rows = await Promise.all(
    entries.map(async (entry): Promise<WorktreeFacts | null> => {
      const status = await git([...GIT_STATUS], entry.path);
      if (status.code !== 0) {
        onSkip(`git status failed with code ${status.code} in a worktree, so the worktree is left out`);
        return null;
      }
      return { path: entry.path, branch: entry.branch, dirty: countDirty(status.stdout) };
    }),
  );
  return { ok: true, worktrees: rows.filter((row): row is WorktreeFacts => row !== null) };
}
