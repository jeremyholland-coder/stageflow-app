import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

/**
 * Authentication Setup for Playwright UI Tests
 *
 * This setup authenticates directly via Supabase API and injects the session
 * into the browser, bypassing the UI login flow completely.
 *
 * This approach is more reliable for E2E testing because:
 * 1. It doesn't depend on the login UI working perfectly
 * 2. It's faster (no need to fill forms and wait for navigation)
 * 3. It tests the actual protected pages, not the login flow
 */

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test user credentials (same as Vitest API tests)
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'stageflow.test+qa@example.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://wogloqkryhasahoiajvt.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvZ2xvcWtyeWhhc2Fob2lhanZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxODU2NTEsImV4cCI6MjA3NTc2MTY1MX0.2O9Ot0OCShISVuDAiEoR2sx1V61rozhQEslpyNflCl8';

// Path to store authenticated state
const authFile = path.join(__dirname, '../../test-results/.auth/user.json');

// Generate a CSRF token
function generateCsrfToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

setup('authenticate', async ({ page, context }) => {
  console.log('=== Playwright Auth Setup ===');
  console.log('Strategy: Direct Supabase authentication + session injection');

  // Step 1: Authenticate directly via Supabase
  console.log(`\n1. Authenticating via Supabase as: ${TEST_USER_EMAIL}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD
  });

  if (error) {
    console.error(`✗ Supabase auth failed: ${error.message}`);
    throw new Error(`Authentication failed: ${error.message}`);
  }

  if (!data.session) {
    throw new Error('No session returned from Supabase');
  }

  console.log(`✓ Got session for user: ${data.user?.email}`);
  console.log(`✓ Access token: ${data.session.access_token.substring(0, 20)}...`);

  // Step 2: Navigate to the app
  console.log('\n2. Navigating to app...');
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Step 3: Set up cookies and localStorage with the session
  console.log('\n3. Injecting session into browser...');

  const baseUrl = new URL(page.url());
  const csrfToken = generateCsrfToken();

  // Set auth cookies (these simulate what auth-login sets)
  await context.addCookies([
    {
      name: 'sb-access-token',
      value: data.session.access_token,
      domain: baseUrl.hostname,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax'
    },
    {
      name: 'sb-refresh-token',
      value: data.session.refresh_token,
      domain: baseUrl.hostname,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax'
    },
    {
      name: 'csrf_token',
      value: csrfToken,
      domain: baseUrl.hostname,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'Strict'
    }
  ]);

  // Also set in localStorage for the Supabase client
  await page.evaluate(({ accessToken, refreshToken, expiresAt, user }) => {
    // Set Supabase auth storage
    const storageKey = 'sb-wogloqkryhasahoiajvt-auth-token';
    const authData = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      user: user
    };
    localStorage.setItem(storageKey, JSON.stringify(authData));
  }, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: data.user
  });

  console.log('✓ Session injected into cookies and localStorage');

  // Step 4: Reload to pick up the session
  console.log('\n4. Reloading page to apply session...');
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Step 5: Verify we're authenticated
  console.log('\n5. Verifying authentication...');

  // Wait for page to fully load
  await page.waitForTimeout(3000);

  // Check multiple indicators of successful authentication
  const hasNewDealButton = await page.locator('button:has-text("New Deal")').isVisible().catch(() => false);
  const hasLeadStage = await page.locator('text=Lead Captured').isVisible().catch(() => false);
  const hasLoginForm = await page.locator('input[type="email"]').isVisible().catch(() => false);
  const hasDashboardNav = await page.locator('button:has-text("Dashboard")').isVisible().catch(() => false);

  console.log(`New Deal button: ${hasNewDealButton}`);
  console.log(`Lead Captured stage: ${hasLeadStage}`);
  console.log(`Dashboard nav: ${hasDashboardNav}`);
  console.log(`Login form: ${hasLoginForm}`);

  const isAuthenticated = hasNewDealButton || hasLeadStage || hasDashboardNav;

  if (isAuthenticated && !hasLoginForm) {
    console.log('✓ Dashboard visible - authentication successful!');
  } else if (hasLoginForm) {
    console.error('✗ Still showing login form - session injection may have failed');
    console.log('Attempting to log in via UI as fallback...');

    // Fallback: try UI login
    await page.fill('input[type="email"]', TEST_USER_EMAIL);
    await page.fill('input[type="password"]', TEST_USER_PASSWORD);
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(5000);

    const dashboardNow = await page.locator('button:has-text("New Deal")').isVisible().catch(() => false);
    if (!dashboardNow) {
      throw new Error('Both session injection and UI login failed');
    }
    console.log('✓ Fallback UI login succeeded');
  } else {
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    console.log(`Page title: ${pageTitle}`);
    throw new Error(`Unexpected page state after auth`);
  }

  // Step 6: Store the authenticated state
  console.log('\n6. Storing auth state...');
  await page.context().storageState({ path: authFile });
  console.log(`✓ Stored auth state to: ${authFile}`);

  console.log('\n=== Auth Setup Complete ===');
});
