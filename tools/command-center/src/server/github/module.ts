import type { GithubInfo } from '../../shared/types';
import type { Hub } from '../hub';
import type { Runner } from '../runner';
import { POLL_EVERY_MS, PanelError, type PanelSource, createPanelSource } from '../source';
import { classifyGhError } from './errors';
import { GH_PR_FIELDS, PR_LIMIT, parseGhPrs } from './github';

// The GitHub module: the open pull requests and the ones merged in the last week, with their review
// state and checks. It makes one `gh pr list` call, which only reads. The runner adds `--repo` and
// pins it to the configured repository, and its allow-list has no way to merge, close or comment
// through this call.

export type GithubModuleDeps = {
  /** The only way to run gh. */
  runner: Runner;
  hub: Hub;
};

/**
 * The GitHub module, as a source of a Panel of GithubInfo. It loads when it starts and then every 60
 * seconds. A page can ask for a fresh load with `?refresh=1` (see routes/panel.ts), which is limited to
 * one in 10 seconds. When gh fails (not signed in, not installed, no network, too slow), the panel
 * says which of these it is (see errors.ts) and keeps the last list that loaded.
 */
export function createGithubSource(deps: GithubModuleDeps): PanelSource<GithubInfo> {
  const { runner, hub } = deps;

  return createPanelSource<GithubInfo>({
    name: 'github',
    async load() {
      // --state all: a merged pull request is a closed one, so the default (open ones only) would not show it.
      const result = await runner('gh', ['pr', 'list', '--state', 'all', '--limit', String(PR_LIMIT), '--json', GH_PR_FIELDS]);
      if (result.code !== 0) {
        const { code, message } = classifyGhError(result.code, result.stderr);
        throw new PanelError(code, message);
      }
      // The week of "merged" is counted from now: a load that happens later has a later week.
      return parseGhPrs(result.stdout, new Date());
    },
    hub,
    everyMs: POLL_EVERY_MS,
  });
}
