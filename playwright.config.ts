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
    viewport: { width: 960, height: 540 },
  },
  projects: [
    // Edge locally (Windows); the bundled Chromium on CI.
    { name: 'chromium', use: { channel: process.env.CI ? undefined : 'msedge' } },
    // Safari's engine on CI, for the flows most likely to differ between engines: storage, the
    // unload prompt, keyboard, audio unlock. (Not installed locally.)
    ...(process.env.CI ? [{ name: 'webkit', use: { browserName: 'webkit' as const }, testMatch: /(prod|gameover)\.spec\.ts/ }] : []),
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:3007', reuseExistingServer: true, timeout: 60_000 },
    // The shipped bundle, for e2e/prod.spec.ts. Always built fresh: a reused preview server
    // would silently test a stale bundle.
    { command: 'npm run build && npm run preview', url: 'http://localhost:3008', reuseExistingServer: false, timeout: 180_000 },
  ],
});
