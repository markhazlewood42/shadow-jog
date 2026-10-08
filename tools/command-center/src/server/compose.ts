import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createAgentsSource } from './agents/module';
import type { IsAlive } from './agents/process-list';
import { createApp } from './app';
import { type Config, PACKAGE_DIR } from './config';
import { createDecisionsSource } from './decisions/module';
import { createDocIndex } from './docs/index';
import { createEngineModule } from './engine/module';
import { createGitSource } from './git/module';
import { createGithubSource } from './github/module';
import { makeToken } from './guard';
import { createHub } from './hub';
import { registerAgentsRoutes } from './routes/agents';
import { registerDecisionsRoutes } from './routes/decisions';
import { registerDocsRoutes } from './routes/docs';
import { registerEngineRoutes } from './routes/engine';
import { registerGitRoutes } from './routes/git';
import { registerGithubRoutes } from './routes/github';
import { registerNowRoutes } from './routes/now';
import { registerSessionsRoutes } from './routes/sessions';
import { registerStatusRoutes } from './routes/status';
import type { Runner } from './runner';
import { createSessionsSource } from './sessions/sessions';
import { createStatusSource } from './status/module';

/**
 * What compose needs. `webRoot`, `navFile` and `refreshGapMs` are for tests and the end-to-end
 * server: `webRoot` points at a folder that stands in for the built page, `navFile` at a nav.json
 * other than the tool's own (the docs of a fixture repo are not the docs of the Shadow Jog repo), and
 * `refreshGapMs` sets the least time between two forced refreshes of a panel (10 s unless this says
 * another: the end-to-end server sets 0, so a test can change what the fake gh says and see it at once),
 * `now` is the clock of the sessions and agents modules (a test sets it to the moment its session files were made for),
 * and `isAlive` is the process check of the agents module (a test says which processes run, so it needs no real one).
 */
export type ComposeDeps = {
  config: Config;
  runner: Runner;
  webRoot?: string;
  navFile?: string;
  refreshGapMs?: number;
  now?: () => number;
  isAlive?: IsAlive;
};

export type Composed = {
  app: Hono;
  /** Starts the modules (their first load, their watchers and timers). Call it once, after the app is listening. */
  start(): Promise<void>;
  /** Stops them, and says when they are stopped (a file watcher takes a moment to close). */
  stop(): Promise<void>;
};

/** A part of the server that has something to start and stop. A PanelSource is one. */
type Startable = { start(): void | Promise<void>; stop(): void | Promise<void> };

/**
 * The one place where the parts are put together: the hub, the run's token, the HTTP app and the
 * modules. A module is built from `deps.config` and `deps.runner` (the runner is the only way to
 * run git and gh), listens to the hub and publishes on it, adds its routes to `app`, and is
 * added to `modules` so that start() and stop() reach it. Each later task adds its module here.
 */
export function compose(deps: ComposeDeps): Composed {
  const { config, runner } = deps;
  const hub = createHub();
  const token = makeToken();

  const app = createApp({
    config,
    hub,
    token,
    startedAt: new Date().toISOString(),
    version: readVersion(),
    webRoot: deps.webRoot ?? join(PACKAGE_DIR, 'dist'),
  });

  const modules: Startable[] = [];

  // The docs: every doc of the repo, read once, kept up to date by a file watcher, and served
  // under /api/docs, /api/search and /files. Its first scan is part of start().
  const docs = createDocIndex({ config, runner, hub }, deps.navFile === undefined ? {} : { navFile: deps.navFile });
  // The decisions: the decision issues of the repository, read with gh. The docs routes ask it which open decisions link to a doc (for the
  // banners), so it is made before they are registered; its own routes (below) need the token, and are registered with the other panels.
  const decisions = createDecisionsSource({ config, runner, docs, hub });
  registerDocsRoutes(app, docs, decisions);
  modules.push({ start: () => docs.ready(), stop: () => docs.close() });

  // The engine review: every decision of the engine docs with its status, under /api/engine. It reads
  // the headings of three docs from the doc index, and loads again when the index says that one of them changed.
  const engine = createEngineModule({ config, runner, docs, hub });
  registerEngineRoutes(app, engine);
  modules.push(engine);

  // The three panels that look at the project's state, each under its own path. They share the rule
  // for a forced refresh (`?refresh=1`, at most one in 10 s: see routes/panel.ts).
  const panelRoutes = deps.refreshGapMs === undefined ? {} : { minGapMs: deps.refreshGapMs };

  // The decision inbox: the open decisions and the recent answers under /api/decisions, one decision with its doc sections, and the one
  // write route of the server: Mark's answer, which accepts only a request that carries this run's token (see routes/decisions.ts).
  registerDecisionsRoutes(app, { config, runner, docs, decisions, token, ...panelRoutes });
  modules.push(decisions);

  // The project status: the current "Right now" section and "Next up for Mark" list of status.md, and the
  // milestones of the engine migration plan, under /api/status. The doc index renders the markdown.
  const status = createStatusSource({ config, docs, hub });
  registerStatusRoutes(app, status, panelRoutes);
  modules.push(status);

  // git: the checked-out branch and how far it is from its upstream, the branches and the newest commits, under /api/git.
  const git = createGitSource({ runner, hub });
  registerGitRoutes(app, git, panelRoutes);
  modules.push(git);

  // GitHub: the open pull requests and the ones merged in the last week, read with `gh`, under /api/github.
  const github = createGithubSource({ runner, hub });
  registerGithubRoutes(app, github, panelRoutes);
  modules.push(github);

  // The Claude sessions about Shadow Jog, with their agents and workflows, read from the session files of the folders that
  // the config names (and only those), under /api/sessions. It looks every 10 s, and reads a file again only when it changed.
  const sessions = createSessionsSource({ config, hub, ...(deps.now === undefined ? {} : { now: deps.now }) });
  registerSessionsRoutes(app, sessions, panelRoutes);
  modules.push(sessions);

  // The live agents: the Claude sessions that run now, with their agents and workflows as a tree, under /api/agents. It starts from the process
  // list of Claude Code and reads only the files of those sessions, so it can look every 3 s (config `agents.pollMs`).
  const agents = createAgentsSource({ config, hub, ...(deps.now === undefined ? {} : { now: deps.now }), ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }) });
  registerAgentsRoutes(app, agents, panelRoutes);
  modules.push(agents);

  // The Now page: its list "Your move" is made from five of the sources above, under /api/now/your-move. It has no module of its own to start or stop.
  registerNowRoutes(app, { decisions, sessions, status, github, engine });

  return {
    app,
    async start() {
      for (const module of modules) await module.start();
    },
    async stop() {
      await Promise.all(modules.map((module) => module.stop()));
    },
  };
}

/** The tool's own version: the one place it is written is package.json. */
function readVersion(): string {
  const { version } = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string };
  return version;
}
