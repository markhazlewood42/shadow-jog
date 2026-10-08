/// <reference types="node" />
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3007',
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
    { command: 'npm run dev', url: 'http://localhost:3007', reuseExistingServer: true, timeout: 60_000 },
    // The shipped bundle, for e2e/prod.spec.ts. Always built fresh: a reused preview server
    // would silently test a stale bundle.
    { command: 'npm run build && npm run preview', url: 'http://localhost:3008', reuseExistingServer: false, timeout: 180_000 },
  ],
});
