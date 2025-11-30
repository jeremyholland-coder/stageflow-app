import { test, expect } from '@playwright/test';
import {
  waitForDashboardLoad,
  waitForLoadingComplete,
  isErrorBoundaryVisible,
  hasReactErrorOverlay
} from './fixtures/test-helpers';

/**
 * Dashboard UI E2E Tests
 *
 * Verifies:
 * - Dashboard loads without errors
 * - No global error boundary is visible
 * - Top metric cards are present
 * - AI Analytics section renders correctly
 * - Kanban board displays properly
 */

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    await waitForDashboardLoad(page);
  });

  test('should load dashboard without errors', async ({ page }) => {
    // Verify no error boundary is visible
    const hasErrorBoundary = await isErrorBoundaryVisible(page);
    expect(hasErrorBoundary).toBe(false);

    // Verify no React error overlay
    const hasReactError = await hasReactErrorOverlay(page);
    expect(hasReactError).toBe(false);

    // Verify Pipeline heading is visible
    await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();
  });

  test('should display metric cards', async ({ page }) => {
    await waitForLoadingComplete(page);

    // The dashboard should have metric cards showing:
    // - Total Deals / Open Pipeline Value
    // - Won Revenue
    // - Win Rate / other metrics
    // Look for card-like containers with numbers

    // Check for metric values (should have at least some numerical content)
    const metricCards = page.locator('[class*="rounded"], [class*="card"]').filter({
      has: page.locator('[class*="text-2xl"], [class*="text-3xl"], [class*="font-bold"]')
    });

    const cardCount = await metricCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('should display Kanban board with columns', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Look for Kanban column headers (stage names like Lead, Quote, Won, etc.)
    const stageNames = ['Lead', 'Quote', 'Proposal', 'Negotiation', 'Won', 'Lost'];

    // At least one stage should be visible
    let visibleStages = 0;
    for (const stage of stageNames) {
      const stageHeader = page.locator(`text="${stage}"`).first();
      if (await stageHeader.isVisible().catch(() => false)) {
        visibleStages++;
      }
    }

    expect(visibleStages).toBeGreaterThanOrEqual(1);
  });

  test('should show AI section or Power Up prompt', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Either AI Insights widget is visible (if AI provider connected)
    // Or "Power Up with AI" prompt is visible (if no AI provider)
    const aiInsights = page.locator('text=/AI Insights|AI Analytics/i');
    const powerUpPrompt = page.locator('text=/Power Up with AI|Connect AI Provider/i');

    const hasAISection = await aiInsights.isVisible().catch(() => false);
    const hasPowerUp = await powerUpPrompt.isVisible().catch(() => false);

    // One of these should be visible
    expect(hasAISection || hasPowerUp).toBe(true);
  });

  test('should not show loading spinner after initial load', async ({ page }) => {
    // Wait for any spinners to clear
    await waitForLoadingComplete(page);

    // After load completes, main content spinner should be gone
    const mainSpinner = page.locator('.min-h-screen').locator('.animate-spin').first();
    const isSpinnerVisible = await mainSpinner.isVisible().catch(() => false);

    expect(isSpinnerVisible).toBe(false);
  });

  test('should have accessible navigation', async ({ page }) => {
    // Check for navigation elements
    const nav = page.locator('nav, [role="navigation"]').first();
    await expect(nav).toBeVisible();

    // Navigation should contain main app sections
    const navText = await nav.textContent();
    expect(navText).toBeTruthy();
  });

  test('should respond to window resize without breaking', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Resize to tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);

    let hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);

    hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);

    // Back to desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });

  test('should handle filter buttons', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Look for filter buttons (All, Active, Won, Lost, etc.)
    const filterButtons = ['All', 'Active', 'Won', 'Lost'];

    for (const filter of filterButtons) {
      const button = page.locator(`button:has-text("${filter}")`).first();
      if (await button.isVisible().catch(() => false)) {
        // Click the filter
        await button.click();
        await page.waitForTimeout(300);

        // Should not show error
        const hasError = await isErrorBoundaryVisible(page);
        expect(hasError).toBe(false);
      }
    }
  });
});

test.describe('Dashboard Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
  });

  test('should have a search input', async ({ page }) => {
    await waitForLoadingComplete(page);

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], [role="searchbox"]');
    await expect(searchInput.first()).toBeVisible();
  });

  test('should filter deals on search', async ({ page }) => {
    await waitForLoadingComplete(page);

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();

    if (await searchInput.isVisible()) {
      // Type a search query
      await searchInput.fill('test');
      await page.waitForTimeout(500); // Debounce

      // Should not throw error
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(500);

      const hasErrorAfterClear = await isErrorBoundaryVisible(page);
      expect(hasErrorAfterClear).toBe(false);
    }
  });
});

test.describe('Dashboard Performance', () => {
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await waitForDashboardLoad(page);

    const loadTime = Date.now() - startTime;

    // Dashboard should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);

    console.log(`Dashboard load time: ${loadTime}ms`);
  });

  test('should not have memory leaks on navigation', async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);

    // Get initial memory usage if available
    const initialMetrics = await page.evaluate(() => {
      // @ts-ignore
      if (window.performance && window.performance.memory) {
        // @ts-ignore
        return window.performance.memory.usedJSHeapSize;
      }
      return null;
    });

    // Navigate away and back multiple times
    for (let i = 0; i < 3; i++) {
      // Navigate to settings
      await page.click('text=Settings');
      await page.waitForLoadState('networkidle');

      // Navigate back to dashboard
      await page.click('button:has-text("Dashboard")');
      await waitForDashboardLoad(page);
    }

    // Check final memory
    const finalMetrics = await page.evaluate(() => {
      // @ts-ignore
      if (window.performance && window.performance.memory) {
        // @ts-ignore
        return window.performance.memory.usedJSHeapSize;
      }
      return null;
    });

    if (initialMetrics && finalMetrics) {
      // Memory should not grow more than 50% (allowing for normal fluctuation)
      const growthRatio = finalMetrics / initialMetrics;
      expect(growthRatio).toBeLessThan(1.5);
      console.log(`Memory growth ratio: ${growthRatio.toFixed(2)}`);
    }
  });
});
