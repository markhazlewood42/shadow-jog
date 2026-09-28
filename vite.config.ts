import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 3007, watch: { usePolling: true } },
  // The chunk warning matches the CI budget (scripts/bundle-budget.mjs).
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: true, chunkSizeWarningLimit: 560 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
