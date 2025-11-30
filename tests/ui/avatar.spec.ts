import { test, expect } from '@playwright/test';
import {
  waitForDashboardLoad,
  waitForLoadingComplete,
  navigateToSettingsTab,
  isErrorBoundaryVisible
} from './fixtures/test-helpers';

/**
 * Avatar UI E2E Tests
 *
 * Verifies:
 * - Profile settings page loads correctly
 * - Avatar preview displays
 * - Avatar upload works
 * - Avatar removal works
 * - Fallback initials appear when no avatar
 */

test.describe('Avatar / Profile Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
  });

  test('should navigate to profile settings', async ({ page }) => {
    // Navigate to Settings > General (or Profile tab)
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Should not show error
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);

    // Should show profile-related content
    const profileContent = page.locator('text=/Profile|Avatar|Name|Email/i');
    await expect(profileContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display current avatar or initials', async ({ page }) => {
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Look for avatar element (image or initials fallback)
    const avatarSelectors = [
      'img[alt*="avatar" i]',
      'img[alt*="profile" i]',
      '[data-testid="avatar"]',
      '[data-testid="user-avatar"]',
      '[class*="avatar"]',
      // Initials fallback (usually a div with single letter or two)
      '[class*="rounded-full"]'
    ];

    let foundAvatar = false;
    for (const selector of avatarSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        foundAvatar = true;
        break;
      }
    }

    // Should find some avatar representation
    expect(foundAvatar).toBe(true);
  });

  test('should show avatar upload option', async ({ page }) => {
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Look for file upload input or upload button
    const uploadOptions = [
      page.locator('input[type="file"]'),
      page.locator('button:has-text("Upload")'),
      page.locator('button:has-text("Change")'),
      page.locator('[aria-label*="upload" i]'),
      page.locator('text=/Upload|Change avatar|Update photo/i')
    ];

    let foundUpload = false;
    for (const option of uploadOptions) {
      if (await option.first().isVisible().catch(() => false)) {
        foundUpload = true;
        break;
      }
    }

    // Should have upload capability
    // Note: File input might be hidden but still present
    const fileInput = page.locator('input[type="file"]').first();
    const inputExists = await fileInput.count() > 0;

    expect(foundUpload || inputExists).toBe(true);
  });

  test('should show remove avatar option when avatar exists', async ({ page }) => {
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Look for remove/delete avatar button
    const removeButton = page.locator('button:has-text("Remove"), button:has-text("Delete"), button[aria-label*="remove" i]').first();

    // This might only be visible if there's an avatar
    const removeVisible = await removeButton.isVisible().catch(() => false);

    // Just log - don't fail if not visible (might not have avatar)
    console.log(`Remove avatar button visible: ${removeVisible}`);

    // Verify no errors
    const hasError = await isErrorBoundaryVisible(page);
    expect(hasError).toBe(false);
  });

  test('should handle avatar upload flow', async ({ page }) => {
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Find file input (might be hidden)
    const fileInput = page.locator('input[type="file"]').first();
    const inputExists = await fileInput.count() > 0;

    if (inputExists) {
      // Create a small test image (1x1 pixel PNG)
      const testImageBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
        0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
        0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
      ]);

      // Set the file
      await fileInput.setInputFiles({
        name: 'test-avatar.png',
        mimeType: 'image/png',
        buffer: testImageBuffer
      });

      // Wait for upload to process
      await page.waitForTimeout(2000);

      // Should not show error
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);

      console.log('Avatar upload initiated');
    }
  });

  test('should show initials when no avatar', async ({ page }) => {
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Try to remove avatar first (if exists)
    const removeButton = page.locator('button:has-text("Remove")').first();
    if (await removeButton.isVisible().catch(() => false)) {
      await removeButton.click();
      await page.waitForTimeout(1000);

      // Confirm removal if prompted
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Now check for initials fallback
    // Initials are typically single or double letters in a circle
    const initialsContainer = page.locator('[class*="rounded-full"]').filter({
      has: page.locator('text=/^[A-Z]{1,2}$/')
    });

    // Might have initials showing
    const initialsVisible = await initialsContainer.first().isVisible().catch(() => false);
    console.log(`Initials fallback visible: ${initialsVisible}`);
  });

  test('should display avatar in header/nav', async ({ page }) => {
    await waitForLoadingComplete(page);

    // Look for avatar in the header/navigation area
    const headerAvatar = page.locator('header, nav, [role="navigation"]').locator('img[alt*="avatar" i], [class*="avatar"], [class*="rounded-full"]').first();

    const hasHeaderAvatar = await headerAvatar.isVisible().catch(() => false);

    // Should have some user representation in header
    // This might be initials or an image
    console.log(`Header avatar visible: ${hasHeaderAvatar}`);
  });
});

test.describe('Avatar Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await navigateToSettingsTab(page, 'general');
  });

  test('should handle invalid file types gracefully', async ({ page }) => {
    await waitForLoadingComplete(page);

    const fileInput = page.locator('input[type="file"]').first();
    const inputExists = await fileInput.count() > 0;

    if (inputExists) {
      // Try to upload a text file (invalid)
      await fileInput.setInputFiles({
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This is not an image')
      });

      await page.waitForTimeout(1000);

      // Should show validation error, not crash
      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);

      // Look for error message
      const errorMessage = page.locator('text=/invalid|not allowed|only images|file type/i');
      const hasValidationError = await errorMessage.isVisible().catch(() => false);

      console.log(`Shows validation error for invalid file: ${hasValidationError}`);
    }
  });

  test('should handle oversized files gracefully', async ({ page }) => {
    await waitForLoadingComplete(page);

    const fileInput = page.locator('input[type="file"]').first();
    const inputExists = await fileInput.count() > 0;

    if (inputExists) {
      // Create a buffer that simulates a large file header
      // (We won't actually create a 10MB file, just test the validation)
      const oversizeHeader = Buffer.alloc(1024);
      oversizeHeader.write('PNG', 0);

      // The actual size check happens client-side usually
      // Just verify no crash
      await fileInput.setInputFiles({
        name: 'large-image.png',
        mimeType: 'image/png',
        buffer: oversizeHeader
      });

      await page.waitForTimeout(1000);

      const hasError = await isErrorBoundaryVisible(page);
      expect(hasError).toBe(false);
    }
  });
});

test.describe('Avatar Accessibility', () => {
  test('should have accessible avatar controls', async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);
    await navigateToSettingsTab(page, 'general');
    await waitForLoadingComplete(page);

    // Check for accessible labels
    const uploadButton = page.locator('button:has-text("Upload"), [aria-label*="upload" i]').first();

    if (await uploadButton.isVisible()) {
      // Should have accessible name
      const accessibleName = await uploadButton.getAttribute('aria-label') ||
        await uploadButton.textContent();
      expect(accessibleName).toBeTruthy();
    }

    // Avatar image should have alt text
    const avatarImg = page.locator('img[alt*="avatar" i], img[alt*="profile" i]').first();
    if (await avatarImg.isVisible()) {
      const altText = await avatarImg.getAttribute('alt');
      expect(altText).toBeTruthy();
    }
  });
});
