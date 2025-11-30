/**
 * E2E Test Setup
 *
 * This file runs before all tests.
 * It validates environment and sets up test context.
 */

import { beforeAll, afterAll } from 'vitest';

// Required environment variables
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

beforeAll(() => {
  console.log('\n=== E2E Test Suite Starting ===\n');

  // Validate environment
  const missing = REQUIRED_ENV.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Run tests with: netlify dev --command "npx vitest run tests/e2e"'
    );
  }

  console.log('✓ Environment variables validated');

  // Set production as default if not specified
  const testTarget = process.env.TEST_BASE_URL || 'https://stageflow.startupstage.com';
  console.log(`✓ Test target: ${testTarget}`);
});

afterAll(() => {
  console.log('\n=== E2E Test Suite Complete ===\n');
});
