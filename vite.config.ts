import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 3007, watch: { usePolling: true } },
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
