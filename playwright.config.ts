import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Playwright Configuration for StageFlow UI E2E Tests
 *
 * Runs browser-based tests to verify:
 * - React UI correctly calls Netlify functions
 * - Modals, toasts, Kanban columns, settings panels work as expected
 * - No regression on critical "Founder flows" in real browsers
 */
export default defineConfig({
  // Test directory for UI tests
  testDir: './tests/ui',

  // Run tests in parallel within files
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests on CI
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'test-results/playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/playwright-results.json' }]
  ],

  // Shared settings for all projects
  use: {
    // Base URL - production by default, easy to switch to localhost
    baseURL: process.env.TEST_BASE_URL || 'https://stageflow.startupstage.com',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'on-first-retry',

    // Viewport for consistent testing
    viewport: { width: 1280, height: 720 },

    // Default timeout for actions
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Output folder for test artifacts
  outputDir: 'test-results/artifacts',

  // Configure projects for cross-browser testing
  projects: [
    // Setup project - authenticates and stores state
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Chromium tests
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use stored auth state
        storageState: 'test-results/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // WebKit (Safari-like) tests
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        // Use stored auth state
        storageState: 'test-results/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Firefox tests (optional - uncomment to enable)
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: 'test-results/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // Mobile Chrome tests (optional)
    // {
    //   name: 'mobile-chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //     storageState: 'test-results/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // Mobile Safari tests (optional)
    // {
    //   name: 'mobile-safari',
    //   use: {
    //     ...devices['iPhone 12'],
    //     storageState: 'test-results/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  // Global setup - runs once before all tests
  // globalSetup: require.resolve('./tests/ui/global-setup.ts'),

  // Global teardown - runs once after all tests
  // globalTeardown: require.resolve('./tests/ui/global-teardown.ts'),
});
