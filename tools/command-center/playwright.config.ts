import { defineConfig } from '@playwright/test';

// The end-to-end tests run against e2e/server.ts: the real server with a fixture config and a
// fake gh, on port 3010 (the game uses 3007 and 3008, the command center itself 3009).
// Playwright starts that server for the run, and never reuses one that is already running.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3010',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // Edge locally (Windows), the bundled Chromium on CI: the same choice as the game's own tests.
    { name: 'chromium', use: { channel: process.env.CI ? undefined : 'msedge' } },
  ],
  webServer: {
    // Build the page, then start the server. Both run as node scripts, so no .cmd shim is involved.
    command: 'node node_modules/vite/bin/vite.js build && node --import tsx e2e/server.ts',
    url: 'http://127.0.0.1:3010/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CC_NO_OPEN: '1' },
  },
});
