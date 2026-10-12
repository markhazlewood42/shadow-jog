import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, resolve } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';
import open from 'open';
import { isMainModule } from '../../scripts/is-main.mjs';
import { compose } from './compose';
import type { ReporterOptions } from './publish/module';
import { ConfigError, DEFAULT_CONFIG_FILE, PACKAGE_DIR, loadConfig } from './config';
import { clearLive } from './publish/clear-live';
import { DEFAULT_ENV_FILE, loadSettings } from './publish/env-file';
import { EXIT } from './publish/reporter';
import { createRunner } from './runner';

/** The port is taken by another program. The message is the one line main prints before it exits. */
export class PortBusyError extends Error {
  constructor(port: number) {
    super(`Port ${port} is already in use, so the command center did not start. Stop the program that uses it, or change "port" in command-center.config.json.`);
    this.name = 'PortBusyError';
  }
}

/**
 * Starts the HTTP server for `app` on 127.0.0.1 and nowhere else. Binding to the loopback address
 * (not to "all addresses") is what keeps every other computer on the network from reaching it.
 * Rejects with a PortBusyError when the port is taken. It never stops the program that holds it.
 */
export function startServer(app: Hono, port: number): Promise<Server> {
  return new Promise((resolveServer, reject) => {
    // overrideGlobalObjects off: the adapter would otherwise replace the global Request and Response.
    const server = createServer(getRequestListener(app.fetch, { overrideGlobalObjects: false }));
    const onStartError = (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE' ? new PortBusyError(port) : error);
    server.once('error', onStartError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onStartError);
      // An error after the start (too many open files, say) is reported, and does not crash the server.
      server.on('error', (error) => console.error('The HTTP server reported an error:', error));
      resolveServer(server);
    });
  });
}

/** Reads the command line: `--config <file>`, `--dev`, `--reporter` and `--clear-live`. Anything else is an error, so a typo is not ignored. */
function readArgs(argv: string[]): { configFile: string; dev: boolean; reporter: boolean; clearLive: boolean } {
  let configFile = DEFAULT_CONFIG_FILE;
  let dev = false;
  let reporter = false;
  let clearLiveKey = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--dev') {
      dev = true;
    } else if (arg === '--reporter') {
      reporter = true;
    } else if (arg === '--clear-live') {
      clearLiveKey = true;
    } else if (arg === '--config') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new ConfigError('--config needs the path of a config file after it.');
      configFile = resolve(value);
    } else {
      throw new ConfigError(`Unknown option ${arg}. The options are --config <file>, --dev, --reporter and --clear-live.`);
    }
  }
  return { configFile, dev, reporter, clearLive: clearLiveKey };
}

/** Keeps the built page up to date while Vite watches the page's source (for `npm run dev`). */
async function watchPage(): Promise<void> {
  // Loaded here and not at the top, so a normal run does not load the whole build tool.
  const { build } = await import('vite');
  // Polling, because Vite's own file events are unreliable on this machine (see the game's vite.config.ts).
  await build({ configFile: join(PACKAGE_DIR, 'vite.config.ts'), build: { watch: { watcher: { usePolling: true, pollInterval: 500 } } } });
}

/** The most time that a stop waits for the modules (the reporter removes its key in 3 s at most). */
const STOP_WAIT_MS = 6000;

async function main(argv: string[]): Promise<void> {
  let stop: (code?: number) => void = (code = 0) => process.exit(code);
  const { configFile, dev, reporter, clearLive: clearKey } = readArgs(argv);

  // `--clear-live`: remove the live key and end (the launcher runs this after --stop). No server starts.
  if (clearKey) {
    const settings = loadSettings();
    if (!settings.ok) {
      console.error(`${new Date().toISOString()} reporter: cannot remove the live key, because ${settings.detail}.`);
      process.exit(EXIT.notConfigured);
    }
    const removed = await clearLive(settings.settings, (message) => console.log(`${new Date().toISOString()} reporter: ${message}`));
    process.exit(removed ? 0 : 1);
  }

  const config = loadConfig(configFile);

  // A reporter run publishes the live state to the store (src/server/publish). Without its settings file it does not start: one clear line, and exit code 4.
  let reporterOptions: ReporterOptions | undefined;
  if (reporter) {
    const settings = loadSettings();
    if (!settings.ok) {
      console.error(`${new Date().toISOString()} reporter: not publishing, because ${settings.detail}. Create ${DEFAULT_ENV_FILE} (see the Reporter section of tools/command-center/README.md).`);
      process.exit(EXIT.notConfigured);
    }
    // The server is not started yet at this point, so the callback reaches `stop` through a variable that is set below.
    reporterOptions = { settings: settings.settings, onExit: (code) => stop(code) };
  }

  const composed = compose({ config, runner: createRunner(config), ...(reporterOptions === undefined ? {} : { reporter: reporterOptions }) });

  // Take the port first, so a busy port is reported before anything else starts.
  const server = await startServer(composed.app, config.port);
  await composed.start();
  if (dev) await watchPage();

  let stopping = false;
  stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      // The modules stop first: the reporter removes its live key (best effort, a few seconds at most). A timer bounds the wait, so exit is never blocked.
      await Promise.race([composed.stop().catch(() => {}), new Promise((done) => setTimeout(done, STOP_WAIT_MS))]);
      server.close();
      server.closeAllConnections(); // the open event streams would otherwise keep the server up
      process.exit(code);
    })();
  };
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());

  const address = `http://localhost:${config.port}`;
  console.log(`Shadow Jog Command Center: ${address}`);

  // Tests and automatic runs set CC_NO_OPEN=1: a browser tab opening on its own is for a person starting it.
  if (process.env.CC_NO_OPEN === '1' || reporter) {
    console.log('CC_NO_OPEN=1: not opening a browser tab.');
    return;
  }
  try {
    await open(address);
  } catch (error) {
    console.error(`Could not open a browser tab (${error instanceof Error ? error.message : String(error)}). Open ${address} yourself.`);
  }
}

// Run only when this file is the program that was started, not when a test or the end-to-end server imports it.
// (Not `import.meta.main`: it exists only from Node 24.2.)
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // A busy port and a bad config are the user's to fix: one line, no stack trace.
    if (error instanceof PortBusyError || error instanceof ConfigError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
