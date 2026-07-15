import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Pure-function units only — no DB/network needed.
    testTimeout: 15_000,
  },
});
