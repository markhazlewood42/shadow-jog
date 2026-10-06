import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from './app';
import { type Config, PACKAGE_DIR } from './config';
import { createDocIndex } from './docs/index';
import { makeToken } from './guard';
import { createHub } from './hub';
import { registerDocsRoutes } from './routes/docs';
import type { Runner } from './runner';

/**
 * What compose needs. `webRoot` and `navFile` are for tests and the end-to-end server: `webRoot`
 * points at a folder that stands in for the built page, and `navFile` at a nav.json other than the
 * tool's own (the docs of a fixture repo are not the docs of the Shadow Jog repo).
 */
export type ComposeDeps = {
  config: Config;
  runner: Runner;
  webRoot?: string;
  navFile?: string;
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
  registerDocsRoutes(app, docs);
  modules.push({ start: () => docs.ready(), stop: () => docs.close() });

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
