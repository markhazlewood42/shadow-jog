// A decisions module, its routes and the docs routes, built over a fake gh that remembers its issues. This file has no
// tests of its own: the test runner only loads files that end in .test.ts or .test.tsx.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { type GhCall, type GhIssueStore, createFakeGh, readGhCalls, readGhIssues, resetGh, setGhIssues, setGhMode } from '../e2e/fake-gh';
import { createDecisionsSource } from '../src/server/decisions/module';
import type { Config } from '../src/server/config';
import type { DocIndex } from '../src/server/docs/index';
import type { Hub } from '../src/server/hub';
import { registerDecisionsRoutes } from '../src/server/routes/decisions';
import { registerDocsRoutes } from '../src/server/routes/docs';
import { type Exec, type Runner, createRunner } from '../src/server/runner';
import type { PanelSource } from '../src/server/source';
import type { DecisionsInfo } from '../src/shared/types';
import { type DocsRepo, makeDocsRepo, makeIndex } from './doc-index-helpers';
import { PACKAGE_DIR, getFrom, makeApp } from './helpers';

/** The clock of the fixtures (fixtures/gh/issues.json): the answers of "the last week" are counted from this moment. */
export const FIXTURE_NOW = Date.parse('2026-10-06T12:00:00Z');

/** The made-up issues of the fixture: see fixtures/gh/issues.json (40 answered long ago, 41 open, 42 a stranger's, 43 forged comment, 44 answered, 45 forged label, 46 no template, 47 markup). */
export const SEED = JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'gh', 'issues.json'), 'utf8')) as GhIssueStore;

/** The doc that issue 41 links to: it has the headings "Storage" and "First run", and no heading named "no such heading". */
export const SETUP_DOC = '# Setup guide\n\n## Installing\n\nInstall it.\n\n## First run\n\nThe first run builds the index.\n\n## Storage\n\nBurrow keeps its data in one folder.\n\n### Cache\n\nThe cache can grow.\n\n## Upgrading\n\nUnpack the new archive.\n';

export type DecisionsRig = {
  config: Config;
  app: Hono;
  /** The doc index of the temp docs folder (no watcher: a test calls `index.refresh()` after it edits a doc). */
  index: DocIndex;
  repo: DocsRepo;
  hub: Hub;
  decisions: PanelSource<DecisionsInfo>;
  /** The write token of the app: what a page of this run holds. */
  token: string;
  /** The folder of the fake gh's files. */
  ghDir: string;
  /** The runner that the module and the routes use (the real allow-list over the fake gh). */
  runner: Runner;
  /** A POST to the answer route with everything right (host, same origin, token, JSON); `headers` changes or removes one (undefined removes). */
  post(number: number | string, body: unknown, headers?: Record<string, string | undefined>): Promise<Response>;
  get(path: string): Promise<Response>;
  /** Every call that the fake gh got since the last clear. */
  calls(): GhCall[];
  /** The calls that wrote: `issue comment`, `issue edit` and `issue close`, as their first two words. */
  writes(): string[];
  /** The issues of the fake repository as they are now. */
  issues(): GhIssueStore;
  close(): void;
};

export type RigOptions = {
  /** The issues of the fake repository. The fixture seed unless this says another. */
  store?: GhIssueStore;
  /** The docs of the temp folder, by repo path. A doc that the issues link to is in the default. */
  docs?: Record<string, string>;
  /** Puts something around the fake gh (delays a call, or counts them). */
  wrapExec?: (fake: Exec) => Exec;
  /** The clock of the decisions module. The clock of the fixtures unless this says another. */
  now?: () => number;
  /** The least time between two forced refreshes of a panel. 0 unless this says another, as on the end-to-end server. */
  minGapMs?: number;
  /** How long a doc page waits for the decisions before it goes on without banners. A short time unless this says another. */
  decisionsWaitMs?: number;
};

export function makeDecisionsRig(options: RigOptions = {}): DecisionsRig {
  const ghDir = mkdtempSync(join(tmpdir(), 'cc-decisions-'));
  resetGh(ghDir);
  setGhIssues(options.store ?? SEED, ghDir);

  const repo = makeDocsRepo(options.docs ?? { 'docs/guides/setup.md': SETUP_DOC });
  const { config } = repo;
  const fake = createFakeGh(ghDir);
  const exec: Exec = options.wrapExec?.(fake) ?? fake;
  const runner = createRunner(config, (cmd, args, o) => (cmd === 'gh' ? exec(cmd, args, o) : Promise.reject(new Error('git is not faked in this rig'))));

  const { index, hub } = makeIndex(repo);
  const decisions = createDecisionsSource({ config, runner, docs: index, hub, now: options.now ?? (() => FIXTURE_NOW) });
  const { app, deps } = makeApp({ config, hub });
  registerDocsRoutes(app, index, decisions, { decisionsWaitMs: options.decisionsWaitMs ?? 1000 });
  registerDecisionsRoutes(app, { config, runner, docs: index, decisions, token: deps.token, minGapMs: options.minGapMs ?? 0 });

  const host = `localhost:${config.port}`;
  return {
    config,
    app,
    index,
    repo,
    hub,
    decisions,
    token: deps.token,
    ghDir,
    runner,
    post(number, body, headers = {}) {
      const all: Record<string, string | undefined> = {
        host,
        origin: `http://${host}`,
        'content-type': 'application/json',
        'x-cc-token': deps.token,
        ...headers,
      };
      const sent = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
      return Promise.resolve(app.request(`/api/decisions/${number}/answer`, { method: 'POST', headers: sent, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    },
    get: (path) => getFrom(app, path, config),
    calls: () => readGhCalls(ghDir),
    writes: () => readGhCalls(ghDir).map((call) => call.args.slice(0, 2).join(' ')).filter((words) => /^issue (comment|edit|close)$/.test(words)),
    issues() {
      const store = readGhIssues(ghDir);
      if (store === null) throw new Error('the rig has no issues');
      return store;
    },
    close() {
      repo.close();
      rmSync(ghDir, { recursive: true, force: true });
    },
  };
}

/** Sets what the fake gh does (a failing write, a signed-out account) in the rig's folder. */
export const setRigMode = (rig: DecisionsRig, mode: Parameters<typeof setGhMode>[0]): void => setGhMode(mode, rig.ghDir);
