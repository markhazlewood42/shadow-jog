import type { AgentsLive, Panel, SessionsInfo } from '../../shared/types';
import type { Config } from '../config';
import { type Runner, createRunner } from '../runner';
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
  /** False: the reporter does not exit after 30 minutes with no session (a start by hand). The default is true. */
  idleExit?: boolean;
  /** Makes a runner for a config. Tests count the calls; the real one is `createRunner`. */
  makeRunner?: (config: Config) => Runner;
};

/** Worktrees change rarely and `git status` in each is the costly read, so they are read again after this long. */
export const WORKTREE_REFRESH_MS = 5000;

/** The data of a panel: the fresh data, else the last good data, else null (the source has never loaded). Only for facts that do not say what runs NOW. */
function dataOrLastGood<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : (panel.lastGood?.data ?? null);
}

export function createReporterModule(
  options: ReporterOptions,
  sources: { config: Config; sessions: PanelSource<SessionsInfo>; agents: PanelSource<AgentsLive> },
): { start(): void; stop(): Promise<void> } {
  const { config, sessions, agents } = sources;
  const now = options.now ?? Date.now;
  const http = options.http ?? fetchClient;
  const log = options.log ?? ((message: string) => console.log(`${new Date().toISOString()} reporter: ${message}`));

  /**
   * The real git: a runner with the folder of the checkout added to its roots. The folders come from `git worktree list` of this repo, so they are
   * this repo's own checkouts, and the runner still refuses every command that is not on its list (runner.ts).
   * One runner is made for each folder and kept, because the list is read every 5 s for every worktree.
   */
  const makeRunner = options.makeRunner ?? createRunner;
  const runners = new Map<string, Runner>();
  const runnerFor = (cwd: string): Runner => {
    let runner = runners.get(cwd);
    if (runner === undefined) {
      runner = makeRunner({ ...config, roots: [...config.roots, cwd] });
      runners.set(cwd, runner);
    }
    return runner;
  };
  const git: GitIn = options.git ?? ((args, cwd) => runnerFor(cwd)('git', args, { cwd }));

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

  let agentsFailing = false;
  async function collect(): Promise<LiveBody | null> {
    const [live, info] = await Promise.all([agents.get(), sessions.get()]);
    // Only FRESH data says which sessions run now. When the agents source fails, its last good data is old: publishing it would show ended sessions as
    // live for as long as the failure lasts, and would reset the idle exit. So nothing is published (null): the write is skipped, the stored value goes
    // stale on the page ("offline"), and the idle exit counts the time. The same for a source that has never loaded. (An empty list is a truth: no session runs.)
    if (!live.ok) {
      if (!agentsFailing) log('the agents source does not work, so nothing is published until it does. The sessions on the page go stale.');
      agentsFailing = true;
      return null;
    }
    if (agentsFailing) log('the agents source works again');
    agentsFailing = false;
    // The branch and folder of a session change rarely, so the last good list of the sessions module is fine for them.
    const facts = dataOrLastGood(info)?.sessions ?? [];
    return buildLiveBody({ sessions: live.data.sessions, facts, worktrees: await worktreeRows() });
  }

  const reporter = createReporter({
    hostedUrl: options.settings.hostedUrl,
    store: createLiveStore({ url: options.settings.upstashUrl, token: options.settings.token, http }),
    http,
    now,
    log,
    collect,
    onExit: options.onExit,
    ...(options.idleExit === undefined ? {} : { idleExit: options.idleExit }),
  });

  return {
    start: () => reporter.start(),
    /** Stops the loop and removes the live key (best effort, at most a few seconds). */
    stop: () => reporter.stop(),
  };
}
