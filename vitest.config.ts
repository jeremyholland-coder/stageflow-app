import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Include both E2E and unit tests
    include: ['tests/e2e/**/*.test.ts', 'tests/unit/**/*.test.{js,jsx,ts,tsx}'],
    // Environment setup
    environment: 'node',
    // Global timeout for tests (30 seconds)
    testTimeout: 30000,
    // Hook timeout
    hookTimeout: 30000,
    // Run tests sequentially (important for e2e with shared state)
    sequence: {
      concurrent: false
    },
    // Setup file (only for e2e tests that need it)
    // Note: Unit tests may not need this setup
    setupFiles: ['./tests/e2e/setup.ts'],
    // Report format
    reporters: ['verbose'],
    // Don't watch by default
    watch: false
  }
});
