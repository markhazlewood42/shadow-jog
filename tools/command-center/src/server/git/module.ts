import type { GitInfo } from '../../shared/types';
import { firstLine } from '../first-line';
import type { Hub } from '../hub';
import type { RunResult, Runner } from '../runner';
import { POLL_EVERY_MS, PanelError, type PanelSource, createPanelSource } from '../source';
import { BRANCH_FORMAT, COMMIT_FORMAT, RECENT_COMMITS, aheadBehindOf, parseBranches, parseCommits } from './git';

// The git module: where the checked-out branch stands against its upstream, the local branches and
// the newest commits. It runs three read commands of the runner's list (for-each-ref, rev-parse and
// log) and nothing that changes the repo: it never fetches, so "ahead" and "behind" are as of the
// last time that Mark (or an agent) ran `git fetch`.

export type GitModuleDeps = {
  /** The only way to run git, in the repo. Its allow-list holds the three commands that this module runs. */
  runner: Runner;
  hub: Hub;
};

/** A git command that did not do what was asked, as an error of the panel that says what it was doing. */
function failed(doing: string, result: RunResult): PanelError {
  return new PanelError('git-failed', `git could not ${doing}: ${firstLine(result.stderr) || `exit code ${result.code}`}`);
}

/**
 * The git module, as a source of a Panel of GitInfo. git has no way to tell the module that something
 * changed, so it looks again every 60 seconds, and when a page asks for it (see routes/panel.ts).
 */
export function createGitSource(deps: GitModuleDeps): PanelSource<GitInfo> {
  const { runner, hub } = deps;

  return createPanelSource<GitInfo>({
    name: 'git',
    async load() {
      // The three commands do not depend on each other, so they run together. Each runs in the repo (the runner's default folder).
      const [branches, head, log] = await Promise.all([
        runner('git', ['for-each-ref', '--sort=-committerdate', `--format=${BRANCH_FORMAT}`, 'refs/heads']),
        // Exit code 0 when HEAD names a commit and 1 when it does not yet (a repo with no commit). `log` fails then, which is no error here.
        runner('git', ['rev-parse', '--verify', '--quiet', 'HEAD']),
        runner('git', ['log', `--max-count=${RECENT_COMMITS}`, '--no-show-signature', `--format=${COMMIT_FORMAT}`, 'HEAD', '--']),
      ]);

      // The runner reports a program that is not installed as code 127.
      if ([branches, head, log].some((result) => result.code === 127)) {
        throw new PanelError('git-missing', 'git is not installed (or it is not on the PATH), so the branches and commits cannot be shown.');
      }
      if (branches.code !== 0) throw failed('read the branches', branches);
      if (head.code !== 0 && head.code !== 1) throw failed('look at HEAD', head);
      const hasCommits = head.code === 0;
      if (hasCommits && log.code !== 0) throw failed('read the commits', log);

      const { current, branches: list } = parseBranches(branches.stdout);
      return {
        current,
        ...aheadBehindOf(list.find((branch) => branch.name === current)),
        branches: list,
        commits: hasCommits ? parseCommits(log.stdout) : [],
      };
    },
    hub,
    everyMs: POLL_EVERY_MS,
  });
}
