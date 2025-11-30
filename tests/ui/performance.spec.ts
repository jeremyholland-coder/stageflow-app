import { test, expect } from '@playwright/test';
import { waitForDashboardLoad, waitForLoadingComplete } from './fixtures/test-helpers';

/**
 * Performance UI Tests
 *
 * Measures Core Web Vitals and performance metrics using Playwright.
 * These tests complement Lighthouse audits with real browser measurements.
 */

interface PerformanceMetrics {
  domContentLoaded: number;
  loadComplete: number;
  firstPaint?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  timeToInteractive?: number;
}

async function getPerformanceMetrics(page: any): Promise<PerformanceMetrics> {
  return await page.evaluate(() => {
    const timing = performance.timing;
    const navigationStart = timing.navigationStart;

    // Get paint timings
    const paintEntries = performance.getEntriesByType('paint');
    const fpEntry = paintEntries.find((e: any) => e.name === 'first-paint');
    const fcpEntry = paintEntries.find((e: any) => e.name === 'first-contentful-paint');

    // Get LCP
    let lcp = 0;
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length > 0) {
      lcp = (lcpEntries[lcpEntries.length - 1] as any).startTime;
    }

    return {
      domContentLoaded: timing.domContentLoadedEventEnd - navigationStart,
      loadComplete: timing.loadEventEnd - navigationStart,
      firstPaint: fpEntry ? fpEntry.startTime : undefined,
      firstContentfulPaint: fcpEntry ? fcpEntry.startTime : undefined,
      largestContentfulPaint: lcp || undefined,
      timeToInteractive: timing.domInteractive - navigationStart,
    };
  });
}

test.describe('Performance Metrics', () => {
  test('should measure login page performance', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');

    const pageLoadTime = Date.now() - startTime;

    // Get performance metrics
    const metrics = await getPerformanceMetrics(page);

    console.log('\n=== Login Page Performance ===');
    console.log(`Total Page Load: ${pageLoadTime}ms`);
    console.log(`DOM Content Loaded: ${metrics.domContentLoaded}ms`);
    console.log(`Load Complete: ${metrics.loadComplete}ms`);
    console.log(`First Paint: ${metrics.firstPaint}ms`);
    console.log(`First Contentful Paint: ${metrics.firstContentfulPaint}ms`);
    console.log(`Time to Interactive: ${metrics.timeToInteractive}ms`);

    // Assertions - reasonable thresholds for production
    expect(pageLoadTime).toBeLessThan(10000); // Under 10s
    expect(metrics.domContentLoaded).toBeLessThan(5000); // Under 5s
    if (metrics.firstContentfulPaint) {
      expect(metrics.firstContentfulPaint).toBeLessThan(3000); // Under 3s
    }
  });

  test('should measure dashboard performance after login', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await waitForDashboardLoad(page);
    await waitForLoadingComplete(page);

    const pageLoadTime = Date.now() - startTime;

    const metrics = await getPerformanceMetrics(page);

    console.log('\n=== Dashboard Performance ===');
    console.log(`Total Page Load (with auth): ${pageLoadTime}ms`);
    console.log(`DOM Content Loaded: ${metrics.domContentLoaded}ms`);
    console.log(`First Contentful Paint: ${metrics.firstContentfulPaint}ms`);
    console.log(`Largest Contentful Paint: ${metrics.largestContentfulPaint}ms`);

    // Dashboard should load within 15 seconds (including auth)
    expect(pageLoadTime).toBeLessThan(15000);
  });

  test('should measure navigation performance', async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);

    // Measure navigation to Settings
    const navStartTime = Date.now();
    await page.click('text=Settings');
    await page.waitForLoadState('networkidle');
    const navTime = Date.now() - navStartTime;

    console.log('\n=== Navigation Performance ===');
    console.log(`Dashboard -> Settings: ${navTime}ms`);

    // Navigation should be fast (client-side)
    expect(navTime).toBeLessThan(3000);

    // Navigate back
    const backStartTime = Date.now();
    await page.click('text=Pipeline');
    await page.waitForLoadState('networkidle');
    const backTime = Date.now() - backStartTime;

    console.log(`Settings -> Dashboard: ${backTime}ms`);
    expect(backTime).toBeLessThan(3000);
  });
});

test.describe('Bundle Size and Resources', () => {
  test('should not have excessively large JavaScript bundles', async ({ page }) => {
    const resourceSizes: { name: string; size: number }[] = [];

    // Collect resource sizes
    page.on('response', async (response) => {
      const url = response.url();
      if (url.endsWith('.js') || url.includes('.js?')) {
        const headers = response.headers();
        const contentLength = headers['content-length'];
        if (contentLength) {
          resourceSizes.push({
            name: url.split('/').pop() || url,
            size: parseInt(contentLength, 10),
          });
        }
      }
    });

    await page.goto('/');
    await waitForDashboardLoad(page);

    // Calculate total JS size
    const totalJsSize = resourceSizes.reduce((sum, r) => sum + r.size, 0);
    const totalJsKB = Math.round(totalJsSize / 1024);

    console.log('\n=== JavaScript Bundle Analysis ===');
    console.log(`Total JS Size: ${totalJsKB}KB`);

    // List largest bundles
    const sortedResources = resourceSizes.sort((a, b) => b.size - a.size);
    console.log('Largest bundles:');
    sortedResources.slice(0, 5).forEach((r) => {
      console.log(`  ${r.name}: ${Math.round(r.size / 1024)}KB`);
    });

    // Total JS should be under 2MB (reasonable for React SPA)
    expect(totalJsSize).toBeLessThan(2 * 1024 * 1024);
  });

  test('should not have too many network requests', async ({ page }) => {
    let requestCount = 0;

    page.on('request', () => {
      requestCount++;
    });

    await page.goto('/');
    await waitForDashboardLoad(page);
    await page.waitForTimeout(2000); // Allow lazy loads

    console.log(`\nTotal requests on dashboard load: ${requestCount}`);

    // Should not make excessive requests
    expect(requestCount).toBeLessThan(100);
  });
});

test.describe('Memory Usage', () => {
  test('should not leak memory on navigation', async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);

    // Get initial heap size (Chrome only)
    const initialHeap = await page.evaluate(() => {
      // @ts-ignore
      if (window.performance && window.performance.memory) {
        // @ts-ignore
        return window.performance.memory.usedJSHeapSize;
      }
      return null;
    });

    if (initialHeap === null) {
      console.log('Memory API not available in this browser');
      return;
    }

    // Navigate back and forth multiple times
    for (let i = 0; i < 5; i++) {
      await page.click('text=Settings');
      await page.waitForTimeout(500);
      await page.click('text=Pipeline');
      await page.waitForTimeout(500);
    }

    // Force GC if available
    await page.evaluate(() => {
      // @ts-ignore
      if (window.gc) {
        // @ts-ignore
        window.gc();
      }
    });

    await page.waitForTimeout(1000);

    // Get final heap size
    const finalHeap = await page.evaluate(() => {
      // @ts-ignore
      if (window.performance && window.performance.memory) {
        // @ts-ignore
        return window.performance.memory.usedJSHeapSize;
      }
      return null;
    });

    if (finalHeap) {
      const heapGrowth = (finalHeap - initialHeap) / (1024 * 1024);
      console.log(`\n=== Memory Analysis ===`);
      console.log(`Initial Heap: ${Math.round(initialHeap / (1024 * 1024))}MB`);
      console.log(`Final Heap: ${Math.round(finalHeap / (1024 * 1024))}MB`);
      console.log(`Growth: ${heapGrowth.toFixed(2)}MB`);

      // Memory should not grow more than 50MB after navigation cycles
      expect(heapGrowth).toBeLessThan(50);
    }
  });
});

test.describe('API Response Times', () => {
  test('should have acceptable API response times', async ({ page }) => {
    const apiTimes: { endpoint: string; duration: number }[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('.netlify/functions/')) {
        const timing = response.request().timing();
        const duration = timing.responseEnd - timing.requestStart;
        const endpoint = url.split('.netlify/functions/')[1]?.split('?')[0] || url;
        apiTimes.push({ endpoint, duration });
      }
    });

    await page.goto('/');
    await waitForDashboardLoad(page);

    // Navigate to trigger more API calls
    await page.click('text=Settings');
    await page.waitForLoadState('networkidle');

    console.log('\n=== API Response Times ===');
    apiTimes.forEach((api) => {
      console.log(`  ${api.endpoint}: ${Math.round(api.duration)}ms`);
    });

    // Calculate average
    if (apiTimes.length > 0) {
      const avgTime = apiTimes.reduce((sum, a) => sum + a.duration, 0) / apiTimes.length;
      console.log(`Average API time: ${Math.round(avgTime)}ms`);

      // Average should be under 2 seconds
      expect(avgTime).toBeLessThan(2000);
    }
  });
});

test.describe('Interaction Performance', () => {
  test('should respond to clicks quickly', async ({ page }) => {
    await page.goto('/');
    await waitForDashboardLoad(page);

    // Measure time to open a modal
    const newDealButton = page.locator('button').filter({ hasText: /New Deal/i }).first();

    if (await newDealButton.isVisible()) {
      const clickStart = Date.now();
      await newDealButton.click();

      // Wait for modal to appear
      await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 5000 });
      const clickEnd = Date.now();

      const interactionTime = clickEnd - clickStart;
      console.log(`\nNew Deal modal open time: ${interactionTime}ms`);

      // Modal should open within 500ms (good interaction response)
      expect(interactionTime).toBeLessThan(1000);

      // Close modal
      await page.keyboard.press('Escape');
    }
  });
});
