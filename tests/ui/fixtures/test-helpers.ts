import { Page, expect, Locator } from '@playwright/test';

/**
 * UI Test Helper Functions
 *
 * Provides reusable utilities for Playwright UI tests
 */

/**
 * Wait for the dashboard to fully load
 * Checks for Pipeline heading and metric cards
 */
export async function waitForDashboardLoad(page: Page): Promise<void> {
  // Wait for specific dashboard elements - use exact match to avoid multiple element matches
  await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible({ timeout: 30000 });

  // Wait for network to settle
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for a toast notification to appear
 * @param page Playwright page
 * @param text Expected text in toast (partial match)
 * @param type Toast type: 'success' | 'error' | 'warning' | 'info'
 */
export async function waitForToast(
  page: Page,
  text: string,
  type?: 'success' | 'error' | 'warning' | 'info'
): Promise<Locator> {
  // Toast notifications typically have specific classes or data attributes
  // Look for toast container with matching text
  const toast = page.locator(`[role="alert"], .toast, [data-testid="toast"]`).filter({ hasText: text });
  await expect(toast).toBeVisible({ timeout: 10000 });
  return toast;
}

/**
 * Close any visible toasts
 */
export async function dismissToasts(page: Page): Promise<void> {
  const closeButtons = page.locator('[data-testid="toast-close"], .toast button[aria-label="Close"]');
  const count = await closeButtons.count();

  for (let i = 0; i < count; i++) {
    await closeButtons.nth(i).click().catch(() => {});
    await page.waitForTimeout(200);
  }
}

/**
 * Navigate to a specific view in the app
 * @param page Playwright page
 * @param view View name: 'dashboard' | 'settings' | 'integrations' | 'team'
 */
export async function navigateTo(page: Page, view: 'dashboard' | 'settings' | 'integrations' | 'team'): Promise<void> {
  const viewMap: Record<string, string> = {
    dashboard: 'Pipeline',
    settings: 'Settings',
    integrations: 'Integrations',
    team: 'Team'
  };

  // Click the navigation item
  const navItem = page.locator(`nav, [role="navigation"]`).locator(`text="${viewMap[view]}"`).first();
  await navItem.click();

  // Wait for navigation to complete
  await page.waitForLoadState('networkidle');
}

/**
 * Navigate to Settings and select a specific tab
 */
export async function navigateToSettingsTab(
  page: Page,
  tab: 'general' | 'notifications' | 'revenue-targets' | 'billing' | 'pipeline' | 'data'
): Promise<void> {
  // First go to settings
  await navigateTo(page, 'settings');

  // Find and click the tab
  const tabLabels: Record<string, string> = {
    'general': 'General',
    'notifications': 'Notifications',
    'revenue-targets': 'Revenue Targets',
    'billing': 'Billing',
    'pipeline': 'Pipeline',
    'data': 'Data'
  };

  const tabButton = page.locator(`button, [role="tab"]`).filter({ hasText: tabLabels[tab] }).first();
  await tabButton.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Open the New Deal modal
 */
export async function openNewDealModal(page: Page): Promise<void> {
  // Look for "New Deal" button
  const newDealButton = page.locator('button').filter({ hasText: /New Deal/i }).first();
  await newDealButton.click();

  // Wait for modal to appear
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
}

/**
 * Fill in the New Deal form
 */
export async function fillNewDealForm(
  page: Page,
  data: {
    client: string;
    email?: string;
    phone?: string;
    value?: number;
    stage?: string;
    notes?: string;
  }
): Promise<void> {
  // Fill client name (required)
  const clientInput = page.locator('input[name="client"], input[placeholder*="client" i], #client');
  await clientInput.fill(data.client);

  // Fill optional fields
  if (data.email) {
    const emailInput = page.locator('input[name="email"], input[type="email"], #email');
    await emailInput.fill(data.email);
  }

  if (data.phone) {
    const phoneInput = page.locator('input[name="phone"], input[type="tel"], #phone');
    await phoneInput.fill(data.phone);
  }

  if (data.value !== undefined) {
    const valueInput = page.locator('input[name="value"], #value');
    await valueInput.fill(String(data.value));
  }

  if (data.stage) {
    // Select stage from dropdown
    const stageSelect = page.locator('select[name="stage"], #stage');
    await stageSelect.selectOption(data.stage);
  }

  if (data.notes) {
    const notesInput = page.locator('textarea[name="notes"], #notes');
    await notesInput.fill(data.notes);
  }
}

/**
 * Submit the New Deal form
 */
export async function submitNewDealForm(page: Page): Promise<void> {
  const submitButton = page.locator('[role="dialog"]').locator('button[type="submit"], button:has-text("Create")').first();
  await submitButton.click();
}

/**
 * Get the count of deal cards in a specific Kanban column
 */
export async function getColumnDealCount(page: Page, stageName: string): Promise<number> {
  // Find the column by stage name
  const column = page.locator('[data-testid="kanban-column"], .kanban-column').filter({ hasText: stageName });
  const cards = column.locator('[data-testid="deal-card"], .deal-card');
  return await cards.count();
}

/**
 * Check if the global error boundary is visible
 */
export async function isErrorBoundaryVisible(page: Page): Promise<boolean> {
  // Error boundaries typically show "Oops" or "Something went wrong"
  const errorBoundary = page.locator('text=/Oops|Something went wrong|An error occurred/i');
  return await errorBoundary.isVisible().catch(() => false);
}

/**
 * Check if there's a React error overlay (dev mode)
 */
export async function hasReactErrorOverlay(page: Page): Promise<boolean> {
  const overlay = page.locator('#webpack-dev-server-client-overlay, .react-error-overlay');
  return await overlay.isVisible().catch(() => false);
}

/**
 * Wait for any loading spinners to disappear
 */
export async function waitForLoadingComplete(page: Page): Promise<void> {
  // Wait for common loading indicators to disappear
  const spinners = page.locator('.animate-spin, [role="progressbar"], [aria-busy="true"]');

  // Give a short delay for spinners to appear if they're going to
  await page.waitForTimeout(500);

  // Wait for all spinners to be hidden
  const count = await spinners.count();
  for (let i = 0; i < count; i++) {
    await spinners.nth(i).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }
}

/**
 * Take a screenshot with a descriptive name
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage: true
  });
}

/**
 * Clear browser storage (localStorage, sessionStorage, cookies)
 */
export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
}

/**
 * Simulate logout
 */
export async function logout(page: Page): Promise<void> {
  // Look for user menu or logout button
  const userMenu = page.locator('[aria-label="User menu"], [data-testid="user-menu"], button:has-text("Account")');

  if (await userMenu.isVisible()) {
    await userMenu.click();
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out")');
    await logoutButton.click();
  } else {
    // Try direct logout button
    const directLogout = page.locator('button:has-text("Logout"), button:has-text("Sign Out")');
    await directLogout.click();
  }

  // Wait for redirect to login page
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
}

/**
 * Get the current user's initials from the avatar
 */
export async function getUserInitials(page: Page): Promise<string | null> {
  const avatar = page.locator('[data-testid="user-avatar"], .avatar').first();
  if (await avatar.isVisible()) {
    return await avatar.textContent();
  }
  return null;
}
