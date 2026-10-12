import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// The end-to-end tests of the HOSTED page (src/web/hosted). They run against the built page alone, served by `vite preview` on port 3010 (the same port as the
// local tests, so the two configs run one after the other and never together). There is no Command Center server: each test answers /api/snapshot, /api/live and
// /api/docs/<path> itself with page.route(), the way the Vercel functions would. `npm run e2e` runs both configs.
//
// The page is built with VITE_HOSTED=1 into `dist-hosted/`, so the local build in `dist/` is not touched.
const OUT_DIR = join(import.meta.dirname, 'dist-hosted');

export default defineConfig({
  testDir: 'e2e/hosted',
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
    // Edge locally (Windows), the bundled Chromium on CI: the same choice as the local tests.
    { name: 'chromium', use: { channel: process.env.CI ? undefined : 'msedge' } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 3010 --strictPort',
    url: 'http://127.0.0.1:3010/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_HOSTED: '1', CC_OUT_DIR: OUT_DIR },
  },
});
