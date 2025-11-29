/**
 * Production-safe logger utility
 *
 * Automatically strips console logs in production builds for:
 * - Better performance (no string interpolation overhead)
 * - Security (no accidental PII logging)
 * - Cleaner production console
 *
 * Usage:
 *   import { logger } from '../lib/logger';
 *   logger.log('Debug info:', data);    // Only in development
 *   logger.error('Error:', err);         // Always logs (important for debugging)
 */

const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },

  warn: (...args) => {
    if (isDev) console.warn(...args);
  },

  error: (...args) => {
    // Always log errors, even in production (for error tracking)
    console.error(...args);
  },

  info: (...args) => {
    if (isDev) console.info(...args);
  },

  debug: (...args) => {
    if (isDev) console.debug(...args);
  }
};

// For backwards compatibility with existing code
export default logger;
