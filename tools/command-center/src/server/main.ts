import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';
import open from 'open';
import { compose } from './compose';
import { ConfigError, DEFAULT_CONFIG_FILE, PACKAGE_DIR, loadConfig } from './config';
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

/** Reads the command line: `--config <file>` and `--dev`. */
function readArgs(argv: string[]): { configFile: string; dev: boolean } {
  const at = argv.indexOf('--config');
  const value = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && (value === undefined || value.startsWith('--'))) throw new ConfigError('--config needs the path of a config file after it.');
  return { configFile: value ?? DEFAULT_CONFIG_FILE, dev: argv.includes('--dev') };
}

/** Keeps the built page up to date while Vite watches the page's source (for `npm run dev`). */
async function watchPage(): Promise<void> {
  // Loaded here and not at the top, so a normal run does not load the whole build tool.
  const { build } = await import('vite');
  // Polling, because Vite's own file events are unreliable on this machine (see the game's vite.config.ts).
  await build({ configFile: join(PACKAGE_DIR, 'vite.config.ts'), build: { watch: { watcher: { usePolling: true, pollInterval: 500 } } } });
}

async function main(argv: string[]): Promise<void> {
  const { configFile, dev } = readArgs(argv);
  const config = loadConfig(configFile);
  const composed = compose({ config, runner: createRunner(config) });

  // Take the port first, so a busy port is reported before anything else starts.
  const server = await startServer(composed.app, config.port);
  await composed.start();
  if (dev) await watchPage();

  const stop = () => {
    composed.stop();
    server.close();
    server.closeAllConnections(); // the open event streams would otherwise keep the server up
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const address = `http://localhost:${config.port}`;
  console.log(`Shadow Jog Command Center: ${address}`);

  // Tests and automatic runs set CC_NO_OPEN=1: a browser tab opening on its own is for a person starting it.
  if (process.env.CC_NO_OPEN === '1') {
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
if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // A busy port and a bad config are the user's to fix: one line, no stack trace.
    if (error instanceof PortBusyError || error instanceof ConfigError) console.error(error.message);
    else console.error(error);
    process.exit(1);
  });
}
