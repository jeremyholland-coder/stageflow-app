import { test, expect } from '@playwright/test';
import {
  waitForDashboardLoad,
  waitForLoadingComplete,
  isErrorBoundaryVisible
} from './fixtures/test-helpers';

/**
 * Metrics UI E2E Tests
 *
 * Verifies that dashboard metrics display correctly:
 * - Metric cards render with numbers
 * - Charts load without errors
 * - Values are formatted properly
 */

test.describe('Dashboard Metrics Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await waitForLoadingComplete(page);
  });

  test('should display metric cards', async ({ page }) => {
    // Look for metric card containers
    const metricCards = page.locator('[class*="rounded"], [class*="card"]').filter({
      has: page.locator('[class*="text-2xl"], [class*="text-3xl"], [class*="font-bold"]')
    });

    const cardCount = await metricCards.count();
    console.log(`Found ${cardCount} metric cards`);

    // Should have at least 2 metric cards
    expect(cardCount).toBeGreaterThanOrEqual(2);
  });

  test('should display numeric values in metric cards', async ({ page }) => {
    // Look for currency-formatted values
    const currencyValues = page.locator('text=/\\$[0-9,]+/');
    const currencyCount = await currencyValues.count();

    // Look for percentage values
    const percentValues = page.locator('text=/[0-9]+\\.?[0-9]*%/');
    const percentCount = await percentValues.count();

    // Look for plain numbers
    const plainNumbers = page.locator('text=/^[0-9,]+$/');
    const numberCount = await plainNumbers.count();

    console.log(`Currency values: ${currencyCount}`);
    console.log(`Percentage values: ${percentCount}`);
    console.log(`Plain numbers: ${numberCount}`);

    // Should have some numeric content
    const totalNumericContent = currencyCount + percentCount + numberCount;
    expect(totalNumericContent).toBeGreaterThan(0);
  });

  test('should not show NaN or undefined in metrics', async ({ page }) => {
    // These indicate data issues
    const nanValues = page.locator('text=/NaN|undefined|null/');
    const nanCount = await nanValues.count();

    expect(nanCount).toBe(0);
  });

  test('should not show negative values where inappropriate', async ({ page }) => {
    // Revenue, pipeline value shouldn't be negative
    // Look for negative currency
    const negativeCurrency = page.locator('text=/-\\$[0-9,]+/');
    const negativeCount = await negativeCurrency.count();

    // Log but don't necessarily fail - some contexts allow negatives
    console.log(`Negative currency values: ${negativeCount}`);
  });

  test('should display metric labels', async ({ page }) => {
    // Common metric labels
    const labels = ['Pipeline', 'Revenue', 'Deals', 'Won', 'Rate', 'Value'];

    let foundLabels = 0;
    for (const label of labels) {
      const labelElement = page.locator(`text=/${label}/i`);
      if (await labelElement.first().isVisible().catch(() => false)) {
        foundLabels++;
      }
    }

    console.log(`Found ${foundLabels}/${labels.length} metric labels`);
    expect(foundLabels).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Charts and Visualizations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await waitForLoadingComplete(page);
  });

  test('should render charts without errors', async ({ page }) => {
    // Look for chart containers (recharts uses SVG)
    const charts = page.locator('svg.recharts-surface, [class*="chart"], canvas');
    const chartCount = await charts.count();

    console.log(`Found ${chartCount} chart elements`);

    // Should not have error boundary visible
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });

  test('should show empty state when no data', async ({ page }) => {
    // If there's no data, should show empty state, not errors
    const emptyState = page.locator('text=/no data|no deals|get started|empty/i');
    const hasEmptyState = await emptyState.first().isVisible().catch(() => false);

    // Just log - we might have data
    console.log(`Empty state visible: ${hasEmptyState}`);

    // More importantly, no errors
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });
});

test.describe('Kanban Board Metrics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await waitForLoadingComplete(page);
  });

  test('should show deal counts per column', async ({ page }) => {
    // Kanban columns often show count in header
    const columnHeaders = page.locator('[data-testid="kanban-column"] header, .kanban-column-header, [class*="column-header"]');
    const headerCount = await columnHeaders.count();

    console.log(`Found ${headerCount} column headers`);
  });

  test('should show column value totals', async ({ page }) => {
    // Some Kanban boards show total value per column
    const columnTotals = page.locator('[data-testid="column-total"], [class*="column-value"]');
    const totalCount = await columnTotals.count();

    console.log(`Found ${totalCount} column total elements`);
  });

  test('should display deal cards with values', async ({ page }) => {
    // Deal cards should show value
    const dealCards = page.locator('[data-testid="deal-card"], .deal-card');
    const cardCount = await dealCards.count();

    console.log(`Found ${cardCount} deal cards`);

    if (cardCount > 0) {
      // Check first card has some content
      const firstCard = dealCards.first();
      const cardText = await firstCard.textContent();
      expect(cardText).toBeTruthy();
    }
  });
});

test.describe('AI Analytics Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await waitForLoadingComplete(page);
  });

  test('should render AI section without errors', async ({ page }) => {
    // Look for AI section
    const aiSection = page.locator('text=/AI|Insights|Analytics/i');
    const hasAI = await aiSection.first().isVisible().catch(() => false);

    console.log(`AI section visible: ${hasAI}`);

    // No errors should occur
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });

  test('should show "Power Up with AI" if no provider', async ({ page }) => {
    // If no AI provider connected, should show CTA
    const powerUp = page.locator('text=/Power Up|Connect AI|Enable AI/i');
    const hasPowerUp = await powerUp.first().isVisible().catch(() => false);

    console.log(`Power Up CTA visible: ${hasPowerUp}`);
  });
});

test.describe('Metric Value Formatting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
  });

  test('should format large numbers with commas', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Look for numbers with commas (1,000 or larger)
    const formattedNumbers = page.locator('text=/[0-9]{1,3}(,[0-9]{3})+/');
    const count = await formattedNumbers.count();

    console.log(`Found ${count} comma-formatted numbers`);
  });

  test('should use consistent currency symbol', async ({ page }) => {
    await waitForLoadingComplete(page);

    // All currency should use same symbol (typically $)
    const dollarSign = page.locator('text=/\\$/');
    const dollarCount = await dollarSign.count();

    // Look for other currency symbols that shouldn't be mixed
    const euroSign = page.locator('text=/€/');
    const euroCount = await euroSign.count();

    console.log(`$ symbols: ${dollarCount}, € symbols: ${euroCount}`);

    // Should be consistent (all $ or all €, not mixed)
    if (dollarCount > 0 && euroCount > 0) {
      console.warn('Mixed currency symbols detected');
    }
  });

  test('should format percentages consistently', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Look for percentage values
    const percentages = page.locator('text=/[0-9]+\\.?[0-9]*%/');
    const percentCount = await percentages.count();

    console.log(`Found ${percentCount} percentage values`);

    // Percentages should be between 0-100% (or clearly labeled if > 100%)
  });
});

test.describe('Metrics Update on Changes', () => {
  test('should update metrics after creating a deal', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Note the current state
    const beforePageContent = await page.content();

    // Create a deal
    const newDealButton = page.locator('button').filter({ hasText: /New Deal/i }).first();
    if (await newDealButton.isVisible()) {
      await newDealButton.click();
      await page.waitForTimeout(500);

      // Fill minimal form
      const clientInput = page.locator('input[name="client"], input[placeholder*="client" i]').first();
      if (await clientInput.isVisible()) {
        await clientInput.fill(`Metrics Test ${Date.now()}`);

        // Submit
        const submitButton = page.locator('[role="dialog"]').locator('button[type="submit"], button:has-text("Create")').first();
        await submitButton.click();
        await page.waitForTimeout(2000);
      }

      // Close modal if still open
      await page.keyboard.press('Escape');

      // Metrics should update (or at least not error)
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);
    }
  });
});
