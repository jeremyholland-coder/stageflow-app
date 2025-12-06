import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only
    include: ['tests/unit/**/*.test.{js,jsx,ts,tsx}'],
    // Environment setup
    environment: 'node',
    // Timeout
    testTimeout: 10000,
    // Hook timeout
    hookTimeout: 10000,
    // Run tests in parallel
    sequence: {
      concurrent: true
    },
    // No setup file needed for unit tests
    // Report format
    reporters: ['verbose'],
    // Don't watch by default
    watch: false
  }
});
