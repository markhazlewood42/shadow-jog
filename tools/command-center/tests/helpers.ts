// Shared helpers for the unit tests. This file has no tests of its own (the test runner only
// loads files that end in .test.ts or .test.tsx).
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Hono } from 'hono';
import { type AppDeps, createApp } from '../src/server/app';
import type { Config } from '../src/server/config';
import { createHub } from '../src/server/hub';
import type { Runner } from '../src/server/runner';

/** The tool's own folder (tools/command-center), where package.json lives. */
export const PACKAGE_DIR = resolve(import.meta.dirname, '..');

/** The repo root (the shadow-jog repo that holds tools/command-center). */
export const REPO_DIR = resolve(PACKAGE_DIR, '..', '..');

/**
 * A config for tests. Every path points into the OS temp folder, and no test creates those
 * folders, so nothing real is touched.
 */
export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  const base = join(tmpdir(), 'cc-test-paths');
  return {
    port: 3009,
    repoRoot: join(base, 'repo'),
    roots: [join(base, 'repo'), join(base, 'repo-phaser')],
    githubRepo: 'octo-owner/octo-repo',
    approvalRef: 'abc1234',
    gameUrl: 'http://localhost:3007',
    links: [{ label: 'Game', url: 'http://localhost:3007' }],
    claude: {
      projectsRoot: join(base, 'claude-projects'),
      folders: ['folder-a'],
      cwdMatchFolders: ['folder-b'],
      includeSdk: false,
      recentSeconds: 604800,
      workingSeconds: 300,
      waitingSeconds: 14400,
    },
    ...overrides,
  };
}

/** A runner that never starts a process. */
export const noopRunner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });

/** The Host header a browser sends when it opens this config's own address. */
export function ownHost(config: Config): string {
  return `localhost:${config.port}`;
}

/** A port that nothing listens on right now (the OS picks it; it is free again when this returns). */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

/** The app and the hub it listens to, built with test settings. `overrides` replaces any dependency. */
export function makeApp(overrides: Partial<AppDeps> = {}): { app: Hono; deps: AppDeps } {
  const deps: AppDeps = {
    config: makeTestConfig(),
    hub: createHub(),
    token: 'test-token-0123456789abcdef0123456789abcdef',
    startedAt: '2026-10-05T10:00:00.000Z',
    version: '9.9.9',
    // The source page (with the token placeholder) stands in for a built one, so no test needs a Vite build.
    webRoot: join(PACKAGE_DIR, 'src', 'web'),
    ...overrides,
  };
  return { app: createApp(deps), deps };
}

/** A GET to the app with the Host header a browser would send (an own-host default, `host` overrides it). */
export function getFrom(app: Hono, path: string, config: Config = makeTestConfig(), init: RequestInit & { host?: string } = {}): Promise<Response> {
  const { host, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('host', host ?? ownHost(config));
  return Promise.resolve(app.request(path, { ...rest, headers }));
}

/** One server-sent event: its `event:` name and its `data:` text. */
export type SseFrame = { event: string; data: string };

/**
 * Reads a text/event-stream response frame by frame. A frame is the lines up to a blank line.
 * `next()` gives up after `timeoutMs`, so a test that waits for an event that never comes fails
 * with a message instead of hanging.
 */
export class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(body: ReadableStream<Uint8Array> | null) {
    if (!body) throw new Error('the response has no body');
    this.reader = body.getReader();
  }

  async next(timeoutMs = 3000): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end >= 0) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        const frame = parseFrame(raw);
        if (frame) return frame;
        continue; // a comment-only block (a keep-alive) is not an event
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no server-sent event within ${timeoutMs} ms`);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no server-sent event within ${timeoutMs} ms`)), left);
      });
      try {
        const chunk = await Promise.race([this.reader.read(), timeout]);
        if (chunk.done) throw new Error('the event stream ended');
        this.buffer += this.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel();
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  let sawField = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      sawField = true;
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
      sawField = true;
    }
  }
  return sawField ? { event, data: data.join('\n') } : null;
}
