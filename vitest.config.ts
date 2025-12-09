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
      concurrent: false,
    },
    // P0 FIX 2025-12-07: Removed global setupFiles
    // E2E tests now define their own setup via globalSetup or in-file imports
    // Unit tests should run without requiring SUPABASE_* environment variables
    // Report format
    reporters: ['verbose'],
    // Don't watch by default
    watch: false,
  },
});
