import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node (no browser). A few of them start a real server or a child
// process, so the time limit is longer than the 5 s default.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
