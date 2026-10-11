/// <reference types="node" />
import { defineConfig } from '@playwright/test';

// PW_PORT=3011 runs the specs against a dev server on another port (a second worktree next to the first one: ports 3007 and 3008 may be taken). With it set, Playwright starts
// (or reuses) only that dev server, and no preview server: e2e/prod.spec.ts needs the preview, so run it without PW_PORT.
const PORT = Number(process.env.PW_PORT ?? 3007);

// The title and the Options screen draw the build's commit (`__BUILD_SHA__`, vite.config.ts buildSha()). Left alone, every commit would change those pixels and break the goldens
// of e2e/default-path.spec.ts. So the servers Playwright starts get a fixed stamp. A value already in the environment (the `SJ_BUILD_SHA=<label>` of a screenshot compare, DEVELOPING.md) wins.
// A dev server that is already running (reuseExistingServer) keeps its own stamp: stop it, or run on a spare PW_PORT, before you make or check the goldens.
const BUILD_ENV = { SJ_BUILD_SHA: process.env.SJ_BUILD_SHA ?? 'e2e' };

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 1280x720 is exactly 2x the game's 640x360, so every screenshot shows whole-pixel blocks.
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // Edge locally (Windows); the bundled Chromium on CI.
    // PW_NOGPU=1 reproduces CI's GPU-less software canvas locally (for perf work).
    {
      name: 'chromium',
      use: {
        channel: process.env.CI ? undefined : 'msedge',
        ...(process.env.PW_NOGPU ? { launchOptions: { args: ['--disable-gpu', '--disable-accelerated-2d-canvas'] } } : {}),
      },
    },
    // Safari's and Firefox's engines on CI (or PW_ALL_ENGINES=1 locally), for the flows most
    // likely to differ between engines: storage, the unload prompt, keyboard, audio unlock.
    ...(process.env.CI || process.env.PW_ALL_ENGINES
      ? (['webkit', 'firefox'] as const).map((b) => ({ name: b, use: { browserName: b }, testMatch: /(prod|gameover)\.spec\.ts/ }))
      : []),
  ],
  webServer: [
    { command: PORT === 3007 ? 'npm run dev' : `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000, env: BUILD_ENV },
    // The shipped bundle, for e2e/prod.spec.ts. Always built fresh: a reused preview server
    // would silently test a stale bundle.
    ...(process.env.PW_PORT ? [] : [{ command: 'npm run build && npm run preview', url: 'http://localhost:3008', reuseExistingServer: false, timeout: 180_000, env: BUILD_ENV }]),
  ],
});
