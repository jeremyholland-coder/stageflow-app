/**
 * Production Logger Utility
 *
 * Provides conditional logging based on environment
 * - Development: Full console logging
 * - Production: Only errors and critical warnings
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DEBUG = process.env.DEBUG === 'true';

export const logger = {
  /**
   * Log debug information (only in development or debug mode)
   */
  debug: (...args: any[]) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
    }
  },

  /**
   * Log informational messages (only in development)
   */
  info: (...args: any[]) => {
    if (!IS_PRODUCTION) {
    }
  },

  /**
   * Log warnings (always logged)
   */
  warn: (...args: any[]) => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Log errors (always logged)
   */
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Log success messages (only in development)
   */
  success: (...args: any[]) => {
    if (!IS_PRODUCTION) {
    }
  },

  /**
   * Log performance metrics (only in development or debug mode)
   */
  perf: (label: string, startTime: number) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      const duration = Date.now() - startTime;
    }
  }
};

export default logger;
