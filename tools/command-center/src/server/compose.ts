import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from './app';
import { type Config, PACKAGE_DIR } from './config';
import { makeToken } from './guard';
import { createHub } from './hub';
import type { Runner } from './runner';

/** What compose needs. `webRoot` is only for tests: it points at a folder that stands in for the built page. */
export type ComposeDeps = {
  config: Config;
  runner: Runner;
  webRoot?: string;
};

export type Composed = {
  app: Hono;
  /** Starts the modules (their first load, their watchers and timers). Call it once, after the app is listening. */
  start(): Promise<void>;
  /** Stops them. */
  stop(): void;
};

/** A part of the server that has something to start and stop. A PanelSource is one. */
type Startable = { start(): void | Promise<void>; stop(): void };

/**
 * The one place where the parts are put together: the hub, the run's token, the HTTP app and the
 * modules. A module is built from `deps.config` and `deps.runner` (the runner is the only way to
 * run git and gh), listens to the hub and publishes on it, adds its routes to `app`, and is
 * added to `modules` so that start() and stop() reach it. Each later task adds its module here.
 */
export function compose(deps: ComposeDeps): Composed {
  const { config } = deps;
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

  return {
    app,
    async start() {
      for (const module of modules) await module.start();
    },
    stop() {
      for (const module of modules) module.stop();
    },
  };
}

/** The tool's own version: the one place it is written is package.json. */
function readVersion(): string {
  const { version } = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string };
  return version;
}
