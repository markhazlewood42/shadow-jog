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
    // Edge locally (Windows); the bundled Chromium on CI.
    channel: process.env.CI ? undefined : 'msedge',
    viewport: { width: 960, height: 540 },
  },
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:3007', reuseExistingServer: true, timeout: 60_000 },
    // The shipped bundle, for e2e/prod.spec.ts.
    { command: 'npm run build && npm run preview', url: 'http://localhost:3008', reuseExistingServer: true, timeout: 180_000 },
  ],
});
