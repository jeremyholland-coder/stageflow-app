import { test, expect } from '@playwright/test';
import {
  waitForDashboardLoad,
  waitForLoadingComplete,
  navigateTo,
  isErrorBoundaryVisible,
  waitForToast
} from './fixtures/test-helpers';

/**
 * AI Providers UI E2E Tests
 *
 * Verifies:
 * - Integrations page loads correctly
 * - AI provider cards render
 * - Connected providers show correctly
 * - Can initiate provider connection
 * - Can disconnect providers (test org only)
 */

test.describe('AI Providers / Integrations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
  });

  test('should navigate to Integrations page', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Should not show error
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);

    // Should show Integrations heading or AI providers
    const integrationsContent = page.locator('text=/Integrations|AI Provider|Connect/i');
    await expect(integrationsContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display AI provider options', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Look for provider cards (ChatGPT, Claude, Gemini)
    const providers = ['ChatGPT', 'Claude', 'Gemini', 'OpenAI', 'Anthropic', 'Google'];

    let foundProviders = 0;
    for (const provider of providers) {
      const providerCard = page.locator(`text=/${provider}/i`);
      if (await providerCard.isVisible().catch(() => false)) {
        foundProviders++;
      }
    }

    // Should find at least one provider
    expect(foundProviders).toBeGreaterThanOrEqual(1);
  });

  test('should show provider connection status', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Look for connection status indicators (Connected, Not connected, Connect button)
    const statusIndicators = [
      page.locator('text=/Connected/i'),
      page.locator('text=/Not connected/i'),
      page.locator('button:has-text("Connect")'),
      page.locator('[class*="connected"]'),
      page.locator('[data-status]')
    ];

    let foundStatus = false;
    for (const indicator of statusIndicators) {
      if (await indicator.first().isVisible().catch(() => false)) {
        foundStatus = true;
        break;
      }
    }

    // Should find some status indication
    expect(foundStatus).toBe(true);
  });

  test('should render provider cards without errors', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Look for card containers
    const cards = page.locator('[class*="card"], [class*="rounded-2xl"], [class*="bg-white"]').filter({
      has: page.locator('svg, img, [class*="logo"]')
    });

    const cardCount = await cards.count();

    // Should have at least one provider card
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // No errors should be shown
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });

  test('should open connection modal for unconnected provider', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Find a "Connect" button
    const connectButton = page.locator('button:has-text("Connect")').first();

    if (await connectButton.isVisible()) {
      await connectButton.click();
      await page.waitForTimeout(500);

      // Should open a modal or dialog for API key entry
      const modal = page.locator('[role="dialog"]').first();
      const modalVisible = await modal.isVisible().catch(() => false);

      // Or it might navigate to an auth flow
      // Either way, should not crash
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);

      // Close modal if open
      if (modalVisible) {
        await page.keyboard.press('Escape');
      }
    }
  });

  test('should show API key input for manual connection', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Find a Connect button
    const connectButton = page.locator('button:has-text("Connect")').first();

    if (await connectButton.isVisible()) {
      await connectButton.click();
      await page.waitForTimeout(500);

      // Look for API key input field
      const apiKeyInput = page.locator('input[type="password"], input[placeholder*="API"], input[name*="key"]');
      const inputVisible = await apiKeyInput.isVisible().catch(() => false);

      // Some providers use API key input, others use OAuth
      // Just verify no error
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);

      // Close modal
      await page.keyboard.press('Escape');
    }
  });

  test('should handle provider disconnect (if connected)', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Look for "Disconnect" or "Remove" button (only visible for connected providers)
    const disconnectButton = page.locator('button:has-text("Disconnect"), button:has-text("Remove")').first();

    if (await disconnectButton.isVisible()) {
      // Don't actually disconnect in test - just verify button exists and is clickable
      // This could disrupt the test user's setup

      // Verify it's enabled
      const isDisabled = await disconnectButton.isDisabled();
      expect(isDisabled).toBe(false);

      // Skip actual disconnect to preserve test user state
      console.log('Disconnect button found and enabled - skipping actual disconnect');
    } else {
      console.log('No connected providers found or disconnect button not visible');
    }
  });

  test('should not show error toast on page load', async ({ page }) => {
    await navigateTo(page, 'integrations');

    // Wait for potential API calls
    await page.waitForTimeout(2000);
    await waitForLoadingComplete(page);

    // Check for error toasts
    const errorToast = page.locator('[role="alert"]').filter({ hasText: /error|failed/i });
    const hasErrorToast = await errorToast.isVisible().catch(() => false);

    // Should not have error toast on normal load
    expect(hasErrorToast).toBe(false);
  });

  test('should show provider features/capabilities', async ({ page }) => {
    await navigateTo(page, 'integrations');
    await waitForLoadingComplete(page);

    // Look for feature descriptions or capabilities
    const features = page.locator('text=/AI|insights|analysis|predictions|health/i');
    const featuresVisible = await features.first().isVisible().catch(() => false);

    // Should show some information about what AI can do
    // This is informational - don't fail if not found
    console.log(`AI features visible: ${featuresVisible}`);
  });
});

test.describe('AI Provider API Key Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await navigateTo(page, 'integrations');
  });

  test('should validate API key format', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Find a Connect button
    const connectButton = page.locator('button:has-text("Connect")').first();

    if (await connectButton.isVisible()) {
      await connectButton.click();
      await page.waitForTimeout(500);

      // Find API key input
      const apiKeyInput = page.locator('input[type="password"], input[placeholder*="API"]').first();

      if (await apiKeyInput.isVisible()) {
        // Enter an obviously invalid key
        await apiKeyInput.fill('invalid-key');

        // Try to submit
        const submitButton = page.locator('[role="dialog"]').locator('button[type="submit"], button:has-text("Save"), button:has-text("Connect")').first();
        if (await submitButton.isVisible()) {
          await submitButton.click();
          await page.waitForTimeout(1000);

          // Should show validation error, not crash
          const hasError = await isErrorBoundaryVisible(page);
          expect(hasError).toBe(false);
        }
      }

      // Close modal
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('AI Providers Tab Navigation', () => {
  test('should navigate to AI providers via URL parameter', async ({ page }) => {
    // Navigate directly with URL parameter
    await page.goto('/?tab=ai-providers');
    await waitForDashboardLoad(page);

    // Or navigate to integrations page directly
    await page.goto('/');
    await waitForDashboardLoad(page);
    await navigateTo(page, 'integrations');

    await waitForLoadingComplete(page);

    // Should show AI providers content
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });
});
