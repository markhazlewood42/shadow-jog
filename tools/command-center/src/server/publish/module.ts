import type { AgentsLive, Panel, SessionsInfo } from '../../shared/types';
import type { Config } from '../config';
import { createRunner } from '../runner';
import type { PanelSource } from '../source';
import type { ReporterSettings } from './env-file';
import { type HttpClient, fetchClient } from './http';
import { type LiveBody, type WorktreeFacts, buildLiveBody } from './map';
import { createReporter } from './reporter';
import { createLiveStore } from './upstash';
import { type GitIn, readWorktrees } from './worktrees';

// The reporter as a module of the server (compose.ts adds it only in a reporter run). It joins the pieces:
// the sessions and agents sources give the data, `readWorktrees` adds the checkouts, `buildLiveBody` picks the allowed fields,
// and the reporter loop (reporter.ts) decides when and whether to write.

/**
 * What the module needs. `http`, `now`, `log` and `git` are for tests. `onExit` is called when the reporter must end the process
 * (30 minutes with no session, or a page that is not protected): main.ts stops the server and exits with the code.
 */
export type ReporterOptions = {
  settings: ReporterSettings;
  onExit: (code: number) => void;
  http?: HttpClient;
  now?: () => number;
  log?: (message: string) => void;
  git?: GitIn;
};

/** Worktrees change rarely and `git status` in each is the costly read, so they are read again after this long. */
export const WORKTREE_REFRESH_MS = 5000;

/** The data of a panel: the fresh data, else the last good data, else null (the source has never loaded). */
function dataOf<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : (panel.lastGood?.data ?? null);
}

export function createReporterModule(
  options: ReporterOptions,
  sources: { config: Config; sessions: PanelSource<SessionsInfo>; agents: PanelSource<AgentsLive> },
): { start(): void; stop(): void } {
  const { config, sessions, agents } = sources;
  const now = options.now ?? Date.now;
  const http = options.http ?? fetchClient;
  const log = options.log ?? ((message: string) => console.log(`${new Date().toISOString()} reporter: ${message}`));

  /**
   * The real git: the runner with the folder of the checkout added to its roots. The folders come from `git worktree list` of this repo, so they are
   * this repo's own checkouts, and the runner still refuses every command that is not on its list (runner.ts).
   */
  const git: GitIn = options.git ?? ((args, cwd) => createRunner({ ...config, roots: [...config.roots, cwd] })('git', args, { cwd }));

  let worktrees: { at: number; rows: WorktreeFacts[] } | null = null;
  async function worktreeRows(): Promise<WorktreeFacts[]> {
    const at = now();
    if (worktrees !== null && at - worktrees.at < WORKTREE_REFRESH_MS) return worktrees.rows;
    const read = await readWorktrees(git, config.repoRoot, (message) => log(message));
    if (read.ok) worktrees = { at, rows: read.worktrees };
    else {
      log(`could not read the worktrees (${read.reason}). The last list stays.`);
      worktrees = { at, rows: worktrees?.rows ?? [] };
    }
    return worktrees.rows;
  }

  async function collect(): Promise<LiveBody | null> {
    const [live, info] = await Promise.all([agents.get(), sessions.get()]);
    const liveData = dataOf(live);
    // The agents source has never loaded: there is no truth to publish. (An empty list is a truth: no session runs.)
    if (liveData === null) return null;
    const facts = dataOf(info)?.sessions ?? [];
    return buildLiveBody({ sessions: liveData.sessions, facts, worktrees: await worktreeRows() });
  }

  const reporter = createReporter({
    hostedUrl: options.settings.hostedUrl,
    store: createLiveStore({ url: options.settings.upstashUrl, token: options.settings.token, http }),
    http,
    now,
    log,
    collect,
    onExit: options.onExit,
  });

  return {
    start: () => reporter.start(),
    stop: () => reporter.stop(),
  };
}
