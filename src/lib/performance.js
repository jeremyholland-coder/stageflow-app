/**
 * Performance Monitoring Utilities
 * Tracks Core Web Vitals and custom performance metrics
 */
import { logger } from './logger';

// Track performance metrics
const metrics = {
  FCP: null, // First Contentful Paint
  LCP: null, // Largest Contentful Paint
  FID: null, // First Input Delay
  CLS: null, // Cumulative Layout Shift
  TTFB: null // Time to First Byte
};

/**
 * Report Core Web Vital to analytics
 */
const reportMetric = (metric) => {
  metrics[metric.name] = metric.value;

  // Log in development
  if (import.meta.env.DEV) {
    logger.log(`[Performance] ${metric.name}:`, metric.value.toFixed(2), metric.rating);
  }

  // Send to analytics in production (when gtag is available)
  if (import.meta.env.PROD && window.gtag) {
    window.gtag('event', metric.name, {
      value: Math.round(metric.value),
      metric_id: metric.id,
      metric_value: metric.value,
      metric_delta: metric.delta
    });
  }
};

/**
 * Initialize Web Vitals tracking
 * Import and call this in your main app entry point
 */
export const initPerformanceMonitoring = () => {
  if (typeof window === 'undefined') return;

  // Track page load time
  window.addEventListener('load', () => {
    const loadTime = performance.now();
    logger.log('[Performance] Page load:', loadTime.toFixed(2), 'ms');
  });

  // Track Navigation Timing
  if (performance.navigation) {
    logger.log('[Performance] Navigation type:', performance.navigation.type);
  }
};

/**
 * Track custom performance mark
 */
export const markPerformance = (name) => {
  if (window.performance && performance.mark) {
    performance.mark(name);
  }
};

/**
 * Measure performance between two marks
 */
export const measurePerformance = (name, startMark, endMark) => {
  if (window.performance && performance.measure) {
    try {
      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name)[0];

      if (import.meta.env.DEV) {
        logger.log(`[Performance] ${name}:`, measure.duration.toFixed(2), 'ms');
      }

      return measure.duration;
    } catch (error) {
      console.warn('[Performance] Measure failed:', error);
    }
  }
  return null;
};

/**
 * Get current metrics
 */
export const getMetrics = () => ({ ...metrics });
