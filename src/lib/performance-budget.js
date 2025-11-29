/**
 * Performance Budget Enforcement System
 * Monitors and enforces performance budgets to prevent regression
 *
 * Features:
 * - Bundle size monitoring
 * - Core Web Vitals budget enforcement
 * - Resource timing budgets
 * - Automatic alerts and warnings
 * - Build-time validation
 *
 * Performance Impact:
 * - Prevents performance regression
 * - Ensures app stays fast as features are added
 * - Provides early warning system
 *
 * @author StageFlow Engineering
 * @date November 14, 2025
 */
import { logger } from './logger';

/**
 * Performance budgets configuration
 */
export const PERFORMANCE_BUDGETS = {
  // Bundle size budgets (KB)
  bundleSize: {
    main: 250,        // Main bundle max 250 KB
    vendor: 200,      // Vendor chunks max 200 KB
    total: 600,       // Total initial load max 600 KB
    chunk: 100,       // Individual chunks max 100 KB
  },

  // Core Web Vitals budgets
  vitals: {
    lcp: 2500,        // Largest Contentful Paint (ms) - Good: <2500ms
    fid: 100,         // First Input Delay (ms) - Good: <100ms
    cls: 0.1,         // Cumulative Layout Shift - Good: <0.1
    fcp: 1800,        // First Contentful Paint (ms) - Good: <1800ms
    ttfb: 800,        // Time to First Byte (ms) - Good: <800ms
  },

  // Resource timing budgets
  resources: {
    images: {
      maxSize: 500,    // Max image size (KB)
      maxCount: 50,    // Max images per page
      maxDuration: 1000, // Max load time (ms)
    },
    fonts: {
      maxSize: 200,    // Max font size (KB)
      maxCount: 4,     // Max fonts loaded
    },
    scripts: {
      maxSize: 100,    // Max individual script (KB)
      maxDuration: 500, // Max script load time (ms)
    },
  },

  // Performance score budget
  score: {
    minimum: 80,      // Minimum performance score (0-100)
    target: 90,       // Target performance score
  },
};

/**
 * Budget violation severity levels
 */
export const Severity = {
  INFO: 'info',           // FYI, no action needed
  WARNING: 'warning',     // Approaching limit
  ERROR: 'error',         // Budget exceeded
  CRITICAL: 'critical',   // Critical violation, fail build
};

/**
 * Performance budget monitor
 */
class PerformanceBudgetMonitor {
  constructor(budgets = PERFORMANCE_BUDGETS) {
    this.budgets = budgets;
    this.violations = [];
    this.warnings = [];
    this.lastCheck = null;
  }

  /**
   * Check all budgets
   */
  checkAll() {
    this.violations = [];
    this.warnings = [];
    this.lastCheck = Date.now();

    logger.log('[PerformanceBudget] 🔍 Running budget checks...');

    this.checkBundleSize();
    this.checkCoreWebVitals();
    this.checkResources();
    this.checkPerformanceScore();

    return this.getReport();
  }

  /**
   * Check bundle size budgets
   */
  checkBundleSize() {
    if (!performance || !performance.getEntriesByType) return;

    const scripts = performance
      .getEntriesByType('resource')
      .filter((r) => r.name.includes('.js'));

    // Calculate total size
    const totalSize = scripts.reduce((sum, s) => sum + (s.transferSize || 0), 0) / 1024;

    logger.log(`[PerformanceBudget] Total JS bundle: ${totalSize.toFixed(2)} KB / ${this.budgets.bundleSize.total} KB`);

    // Check total budget
    if (totalSize > this.budgets.bundleSize.total) {
      this.addViolation({
        category: 'bundleSize',
        metric: 'total',
        actual: totalSize,
        budget: this.budgets.bundleSize.total,
        severity: Severity.ERROR,
        message: `Total bundle size (${totalSize.toFixed(2)} KB) exceeds budget (${this.budgets.bundleSize.total} KB)`,
      });
    } else if (totalSize > this.budgets.bundleSize.total * 0.9) {
      this.addWarning({
        category: 'bundleSize',
        metric: 'total',
        actual: totalSize,
        budget: this.budgets.bundleSize.total,
        severity: Severity.WARNING,
        message: `Total bundle size (${totalSize.toFixed(2)} KB) is approaching budget (${this.budgets.bundleSize.total} KB)`,
      });
    }

    // Check individual chunks
    scripts.forEach((script) => {
      const size = (script.transferSize || 0) / 1024;
      if (size > this.budgets.bundleSize.chunk) {
        const name = script.name.split('/').pop();
        this.addViolation({
          category: 'bundleSize',
          metric: 'chunk',
          actual: size,
          budget: this.budgets.bundleSize.chunk,
          severity: Severity.WARNING,
          message: `Chunk ${name} (${size.toFixed(2)} KB) exceeds budget (${this.budgets.bundleSize.chunk} KB)`,
        });
      }
    });
  }

  /**
   * Check Core Web Vitals budgets
   */
  checkCoreWebVitals() {
    // Get vitals from performance monitor
    const vitals = this.getCoreWebVitals();

    if (!vitals) return;

    // Check LCP
    if (vitals.lcp && vitals.lcp > this.budgets.vitals.lcp) {
      this.addViolation({
        category: 'vitals',
        metric: 'lcp',
        actual: vitals.lcp,
        budget: this.budgets.vitals.lcp,
        severity: vitals.lcp > 4000 ? Severity.ERROR : Severity.WARNING,
        message: `LCP (${vitals.lcp}ms) exceeds budget (${this.budgets.vitals.lcp}ms)`,
      });
    }

    // Check FID
    if (vitals.fid && vitals.fid > this.budgets.vitals.fid) {
      this.addViolation({
        category: 'vitals',
        metric: 'fid',
        actual: vitals.fid,
        budget: this.budgets.vitals.fid,
        severity: vitals.fid > 300 ? Severity.ERROR : Severity.WARNING,
        message: `FID (${vitals.fid}ms) exceeds budget (${this.budgets.vitals.fid}ms)`,
      });
    }

    // Check CLS
    if (vitals.cls && vitals.cls > this.budgets.vitals.cls) {
      this.addViolation({
        category: 'vitals',
        metric: 'cls',
        actual: vitals.cls,
        budget: this.budgets.vitals.cls,
        severity: vitals.cls > 0.25 ? Severity.ERROR : Severity.WARNING,
        message: `CLS (${vitals.cls}) exceeds budget (${this.budgets.vitals.cls})`,
      });
    }

    logger.log('[PerformanceBudget] Core Web Vitals:', vitals);
  }

  /**
   * Check resource budgets
   */
  checkResources() {
    if (!performance || !performance.getEntriesByType) return;

    const resources = performance.getEntriesByType('resource');

    // Check images
    const images = resources.filter((r) => r.initiatorType === 'img');
    if (images.length > this.budgets.resources.images.maxCount) {
      this.addWarning({
        category: 'resources',
        metric: 'imageCount',
        actual: images.length,
        budget: this.budgets.resources.images.maxCount,
        severity: Severity.WARNING,
        message: `Image count (${images.length}) exceeds budget (${this.budgets.resources.images.maxCount})`,
      });
    }

    // Check slow images
    const slowImages = images.filter((img) => img.duration > this.budgets.resources.images.maxDuration);
    if (slowImages.length > 0) {
      slowImages.forEach((img) => {
        const name = img.name.split('/').pop();
        this.addWarning({
          category: 'resources',
          metric: 'imageLoadTime',
          actual: img.duration,
          budget: this.budgets.resources.images.maxDuration,
          severity: Severity.WARNING,
          message: `Image ${name} took ${Math.round(img.duration)}ms to load (budget: ${this.budgets.resources.images.maxDuration}ms)`,
        });
      });
    }

    // Check fonts
    const fonts = resources.filter((r) => r.initiatorType === 'css' && r.name.includes('font'));
    if (fonts.length > this.budgets.resources.fonts.maxCount) {
      this.addWarning({
        category: 'resources',
        metric: 'fontCount',
        actual: fonts.length,
        budget: this.budgets.resources.fonts.maxCount,
        severity: Severity.WARNING,
        message: `Font count (${fonts.length}) exceeds budget (${this.budgets.resources.fonts.maxCount})`,
      });
    }

    logger.log('[PerformanceBudget] Resources checked:', {
      images: images.length,
      fonts: fonts.length,
      slowImages: slowImages.length,
    });
  }

  /**
   * Check performance score
   */
  checkPerformanceScore() {
    const score = this.calculatePerformanceScore();

    logger.log(`[PerformanceBudget] Performance Score: ${score} / ${this.budgets.score.target}`);

    if (score < this.budgets.score.minimum) {
      this.addViolation({
        category: 'score',
        metric: 'overall',
        actual: score,
        budget: this.budgets.score.minimum,
        severity: Severity.ERROR,
        message: `Performance score (${score}) is below minimum (${this.budgets.score.minimum})`,
      });
    } else if (score < this.budgets.score.target) {
      this.addWarning({
        category: 'score',
        metric: 'overall',
        actual: score,
        budget: this.budgets.score.target,
        severity: Severity.INFO,
        message: `Performance score (${score}) is below target (${this.budgets.score.target})`,
      });
    }
  }

  /**
   * Get Core Web Vitals (from performance monitor if available)
   */
  getCoreWebVitals() {
    // Try to get from performance monitor
    if (window.performanceMonitor && window.performanceMonitor.vitals) {
      return window.performanceMonitor.vitals;
    }

    // Fallback: basic measurement
    if (!performance || !performance.timing) return null;

    const timing = performance.timing;
    return {
      lcp: null, // Requires PerformanceObserver
      fid: null, // Requires PerformanceObserver
      cls: null, // Requires PerformanceObserver
      fcp: timing.domContentLoadedEventEnd - timing.navigationStart,
      ttfb: timing.responseStart - timing.requestStart,
    };
  }

  /**
   * Calculate performance score (0-100)
   */
  calculatePerformanceScore() {
    // Use performance monitor score if available
    if (window.performanceMonitor && window.performanceMonitor.getScore) {
      return window.performanceMonitor.getScore();
    }

    // Fallback: simple calculation
    let score = 100;

    const vitals = this.getCoreWebVitals();
    if (vitals) {
      if (vitals.lcp && vitals.lcp > 2500) score -= 20;
      if (vitals.fid && vitals.fid > 100) score -= 15;
      if (vitals.cls && vitals.cls > 0.1) score -= 15;
      if (vitals.fcp && vitals.fcp > 1800) score -= 10;
      if (vitals.ttfb && vitals.ttfb > 800) score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Add violation
   */
  addViolation(violation) {
    this.violations.push(violation);

    if (violation.severity === Severity.ERROR || violation.severity === Severity.CRITICAL) {
      console.error(`[PerformanceBudget] ❌ ${violation.message}`);
    } else {
      console.warn(`[PerformanceBudget] ⚠️  ${violation.message}`);
    }
  }

  /**
   * Add warning
   */
  addWarning(warning) {
    this.warnings.push(warning);
    console.warn(`[PerformanceBudget] ⚠️  ${warning.message}`);
  }

  /**
   * Get budget report
   */
  getReport() {
    const hasCritical = this.violations.some((v) => v.severity === Severity.CRITICAL);
    const hasErrors = this.violations.some((v) => v.severity === Severity.ERROR);
    const hasWarnings = this.warnings.length > 0 || this.violations.some((v) => v.severity === Severity.WARNING);

    const status = hasCritical
      ? 'CRITICAL'
      : hasErrors
      ? 'FAILED'
      : hasWarnings
      ? 'WARNING'
      : 'PASSED';

    return {
      status,
      passed: status === 'PASSED',
      violations: this.violations,
      warnings: this.warnings,
      summary: {
        critical: this.violations.filter((v) => v.severity === Severity.CRITICAL).length,
        errors: this.violations.filter((v) => v.severity === Severity.ERROR).length,
        warnings: this.warnings.length + this.violations.filter((v) => v.severity === Severity.WARNING).length,
      },
      timestamp: this.lastCheck,
    };
  }

  /**
   * Print report to console
   */
  printReport() {
    const report = this.getReport();

    logger.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.log('  📊 PERFORMANCE BUDGET REPORT');
    logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    logger.log(`Status: ${report.status}`);
    logger.log(`Critical: ${report.summary.critical}`);
    logger.log(`Errors: ${report.summary.errors}`);
    logger.log(`Warnings: ${report.summary.warnings}\n`);

    if (report.violations.length > 0) {
      logger.log('❌ Violations:');
      report.violations.forEach((v, i) => {
        logger.log(`  ${i + 1}. [${v.severity.toUpperCase()}] ${v.message}`);
      });
      logger.log('');
    }

    if (report.warnings.length > 0) {
      logger.log('⚠️  Warnings:');
      report.warnings.forEach((w, i) => {
        logger.log(`  ${i + 1}. ${w.message}`);
      });
      logger.log('');
    }

    if (report.passed) {
      logger.log('✅ All performance budgets passed!\n');
    }

    logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return report;
  }

  /**
   * Reset violations and warnings
   */
  reset() {
    this.violations = [];
    this.warnings = [];
    this.lastCheck = null;
    logger.log('[PerformanceBudget] Reset');
  }
}

// Export singleton
export const performanceBudget = new PerformanceBudgetMonitor();

// CRITICAL FIX #14: Lazy initialization to prevent TDZ errors in production
let autoCheckInitialized = false;

/**
 * Initialize auto-check on load
 * MUST be called from App.jsx after modules load to prevent TDZ errors
 */
export function initPerformanceBudget() {
  if (autoCheckInitialized || typeof window === 'undefined') return;
  autoCheckInitialized = true;

  // Auto-check on load (after some delay to let metrics settle)
  window.addEventListener('load', () => {
    setTimeout(() => {
      performanceBudget.checkAll();
    }, 3000); // Wait 3 seconds for metrics to be collected
  });
}

/**
 * React hook for performance budget monitoring
 */
export function usePerformanceBudget() {
  const checkBudgets = () => {
    return performanceBudget.checkAll();
  };

  const getReport = () => {
    return performanceBudget.getReport();
  };

  const printReport = () => {
    return performanceBudget.printReport();
  };

  return {
    checkBudgets,
    getReport,
    printReport,
    budgets: PERFORMANCE_BUDGETS,
  };
}

/**
 * Build-time budget checker (for CI/CD)
 */
export function checkBuildBudgets(distPath) {
  const fs = require('fs');
  const path = require('path');

  logger.log('[PerformanceBudget] 🏗️  Checking build budgets...');

  // Get all JS files in dist
  const jsFiles = fs
    .readdirSync(distPath)
    .filter((f) => f.endsWith('.js'));

  let totalSize = 0;
  const violations = [];

  jsFiles.forEach((file) => {
    const filePath = path.join(distPath, file);
    const stats = fs.statSync(filePath);
    const sizeKB = stats.size / 1024;

    totalSize += sizeKB;

    // Check individual chunk budget
    if (sizeKB > PERFORMANCE_BUDGETS.bundleSize.chunk) {
      violations.push({
        file,
        size: sizeKB,
        budget: PERFORMANCE_BUDGETS.bundleSize.chunk,
        message: `${file} (${sizeKB.toFixed(2)} KB) exceeds chunk budget (${PERFORMANCE_BUDGETS.bundleSize.chunk} KB)`,
      });
    }
  });

  // Check total budget
  if (totalSize > PERFORMANCE_BUDGETS.bundleSize.total) {
    violations.push({
      file: 'TOTAL',
      size: totalSize,
      budget: PERFORMANCE_BUDGETS.bundleSize.total,
      message: `Total bundle size (${totalSize.toFixed(2)} KB) exceeds budget (${PERFORMANCE_BUDGETS.bundleSize.total} KB)`,
    });
  }

  // Print report
  logger.log(`\n📦 Total bundle size: ${totalSize.toFixed(2)} KB / ${PERFORMANCE_BUDGETS.bundleSize.total} KB`);

  if (violations.length > 0) {
    console.error('\n❌ Budget violations:');
    violations.forEach((v) => {
      console.error(`  - ${v.message}`);
    });
    logger.log('');
    return false;
  } else {
    logger.log('✅ All build budgets passed!\n');
    return true;
  }
}

export default performanceBudget;
