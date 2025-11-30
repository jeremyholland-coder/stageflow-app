import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E tests in tests/e2e/
    include: ['tests/e2e/**/*.test.ts'],
    // Environment setup
    environment: 'node',
    // Global timeout for e2e tests (30 seconds)
    testTimeout: 30000,
    // Hook timeout
    hookTimeout: 30000,
    // Run tests sequentially (important for e2e with shared state)
    sequence: {
      concurrent: false
    },
    // Setup file
    setupFiles: ['./tests/e2e/setup.ts'],
    // Report format
    reporters: ['verbose'],
    // Don't watch by default
    watch: false
  }
});
