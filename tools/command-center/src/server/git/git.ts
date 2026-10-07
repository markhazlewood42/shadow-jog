import type { GitBranch, GitCommit, GitInfo } from '../../shared/types';
import { PanelError } from '../source';

// The parsers of the git module. They read the text that two git commands print, in a format that
// this file asks for, so the format and its parser sit together. git prints for people and for
// programs; these are the program formats (a field separator that cannot be in a branch name or a
// subject, and times as numbers), which do not change with git's version or settings.

/** How many commits the module lists. The Now page shows this many. */
export const RECENT_COMMITS = 5;

/**
 * The format of `git for-each-ref refs/heads`, one line for each local branch, fields split by a
 * tab (`%09`): the HEAD marker (`*` for the branch that is checked out here), the name, the time
 * of its newest commit in seconds, the upstream (`origin/main`), how far it is from the upstream
 * (`[ahead 2, behind 1]`, `[gone]`, or nothing), and the working folder where it is checked out.
 * The last field is last because a folder name may hold anything, a tab too. A branch name cannot hold
 * a tab or a line break, so the other fields are safe. `lstrip=2` cuts `refs/heads/` and
 * `refs/remotes/`: `short` could print `heads/main` when a tag has the same name.
 */
export const BRANCH_FORMAT = '%(HEAD)%09%(refname:lstrip=2)%09%(committerdate:unix)%09%(upstream:lstrip=2)%09%(upstream:track)%09%(worktreepath)';

/**
 * The format of `git log`, one line for each commit, fields split by the unit separator character
 * (`%x1f`): the full id, the time in seconds, the author's name and the subject (the first line of
 * the message, which has no line break by definition).
 */
export const COMMIT_FORMAT = '%H%x1f%ct%x1f%an%x1f%s';

const badOutput = (command: string, line: string) =>
  new PanelError('git-bad-output', `${command} printed a line that this page cannot read: "${line.length > 80 ? `${line.slice(0, 80)}...` : line}". A new version of git may have changed its output.`);

/** A time in seconds since 1970 as an ISO time, or null when it is not a number. */
function isoOf(seconds: string): string | null {
  const value = Number(seconds);
  return seconds.trim() !== '' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

/** The lines of some output, without line ends and without empty lines. */
const linesOf = (stdout: string): string[] => stdout.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line !== '');

/**
 * Reads the output of `git for-each-ref` in BRANCH_FORMAT: the branches in the order git printed
 * them, and the name of the one that is checked out here (null for a detached HEAD, and when
 * there is no branch). The track is kept as git words it, without the brackets: `ahead 2, behind 1`
 * or `gone`.
 */
export function parseBranches(stdout: string): { current: string | null; branches: GitBranch[] } {
  let current: string | null = null;
  const branches: GitBranch[] = [];
  for (const line of linesOf(stdout)) {
    const fields = line.split('\t');
    const [head, name, seconds, upstream, track] = fields;
    const date = isoOf(seconds ?? '');
    if (fields.length < 6 || name === undefined || name === '' || date === null) throw badOutput('git for-each-ref', line);
    // The folder is the rest of the line: a tab inside the folder name is part of the name.
    const worktree = fields.slice(5).join('\t');
    if (head === '*') current = name;
    branches.push({
      name,
      date,
      upstream: upstream === '' || upstream === undefined ? null : upstream,
      track: track === undefined || track === '' ? null : track.replace(/^\[|\]$/g, ''),
      worktree: worktree === '' ? null : worktree,
    });
  }
  return { current, branches };
}

/**
 * How far a branch is from its upstream: how many commits it has that the upstream lacks, and how many
 * it lacks. Null and null when it has no upstream, when the upstream is gone, and when the track says
 * something that is not known (a count that is not known must not be shown as 0). 0 and 0 when it has an
 * upstream and the track is empty, which is what git prints for a branch that is level with it.
 */
export function aheadBehindOf(branch: GitBranch | undefined): Pick<GitInfo, 'ahead' | 'behind'> {
  const unknown = { ahead: null, behind: null };
  if (branch === undefined || branch.upstream === null) return unknown;
  if (branch.track === null) return { ahead: 0, behind: 0 };
  const ahead = /\bahead (\d+)/.exec(branch.track)?.[1];
  const behind = /\bbehind (\d+)/.exec(branch.track)?.[1];
  if (ahead === undefined && behind === undefined) return unknown; // "gone", or words that this does not know
  return { ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
}

/** Reads the output of `git log` in COMMIT_FORMAT, in the order git printed it. */
export function parseCommits(stdout: string): GitCommit[] {
  return linesOf(stdout).map((line) => {
    // The subject is the rest of the line, so a unit separator inside it (it cannot be typed, but a script could write it) does not cut it short.
    const [sha, seconds, author, ...subject] = line.split('\x1f');
    const date = isoOf(seconds ?? '');
    if (sha === undefined || sha === '' || author === undefined || date === null) throw badOutput('git log', line);
    return { sha, date, author, subject: subject.join('\x1f') };
  });
}
