import type { CiMain } from '../../shared/types';
import type { Hub } from '../hub';
import { GH_RUN_LIST, type Runner } from '../runner';
import { POLL_EVERY_MS, PanelError, type PanelSource, createPanelSource } from '../source';
import { parseGhRun } from './ci';
import { classifyGhError } from './errors';

// The CI source: the newest run of the workflow `ci.yml` on the branch `main`, for the row "CI on main" of the Status panel. It makes one `gh run list` call, which only reads. The
// runner adds `--repo` and allows this one exact command (GH_RUN_LIST) and no other `gh run` call, so there is no way to rerun, cancel or delete a run through it.

export type CiModuleDeps = {
  /** The only way to run gh. */
  runner: Runner;
  hub: Hub;
};

/**
 * The CI source, as a source of a Panel of CiMain. It loads when it starts and then every 60 seconds, as the pull request source does, and a page can ask for a fresh
 * load with `?refresh=1` (see routes/panel.ts, one in 10 seconds). When gh fails (not signed in, not installed, no network, too slow), the panel says which of these it
 * is (see errors.ts) and keeps the last run that loaded. It is a source of its own, and not a part of the pull request source, so that a failure of one does not hide the other.
 */
export function createCiSource(deps: CiModuleDeps): PanelSource<CiMain> {
  const { runner, hub } = deps;

  return createPanelSource<CiMain>({
    name: 'ci',
    async load() {
      const result = await runner('gh', ['run', 'list', ...GH_RUN_LIST]);
      if (result.code !== 0) {
        const { code, message } = classifyGhError(result.code, result.stderr);
        throw new PanelError(code, message);
      }
      return parseGhRun(result.stdout);
    },
    hub,
    everyMs: POLL_EVERY_MS,
  });
}
