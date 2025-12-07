/**
 * Production Logger Utility
 *
 * Provides conditional logging based on environment
 * - Development: Full console logging
 * - Production: Only errors and critical warnings
 *
 * Phase 1 Enhancement: Correlation ID support for request tracing
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DEBUG = process.env.DEBUG === 'true';

/**
 * Format log prefix with optional correlation ID
 * Production format: [TAG][correlationId] message
 */
const formatPrefix = (tag: string, correlationId?: string): string => {
  if (correlationId) {
    return `[${tag}][${correlationId}]`;
  }
  return `[${tag}]`;
};

export const logger = {
  /**
   * Log debug information (only in development or debug mode)
   */
  debug: (...args: any[]) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      console.debug('[DEBUG]', ...args);
    }
  },

  /**
   * Log informational messages (only in development)
   */
  info: (...args: any[]) => {
    if (!IS_PRODUCTION) {
      console.info('[INFO]', ...args);
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
      console.log('[SUCCESS]', ...args);
    }
  },

  /**
   * Log performance metrics (only in development or debug mode)
   */
  perf: (label: string, startTime: number) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      const duration = Date.now() - startTime;
      console.log('[PERF]', label, `${duration}ms`);
    }
  },

  /**
   * Phase 1: Create a logger instance with correlation ID context
   * All logs from this instance will include the correlation ID
   *
   * Usage:
   *   const log = logger.withCorrelation(correlationId);
   *   log.info('Processing request');
   *   log.error('Request failed', { errorCode: 'TIMEOUT' });
   */
  withCorrelation: (correlationId: string) => ({
    debug: (...args: any[]) => {
      if (!IS_PRODUCTION || IS_DEBUG) {
        console.debug(formatPrefix('DEBUG', correlationId), ...args);
      }
    },

    info: (...args: any[]) => {
      if (!IS_PRODUCTION) {
        console.info(formatPrefix('INFO', correlationId), ...args);
      }
    },

    warn: (...args: any[]) => {
      console.warn(formatPrefix('WARN', correlationId), ...args);
    },

    error: (...args: any[]) => {
      console.error(formatPrefix('ERROR', correlationId), ...args);
    },

    /**
     * Log telemetry event (always logged in production)
     * Only for high-level events, no PII
     */
    telemetry: (eventName: string, metadata: Record<string, any> = {}) => {
      console.log(formatPrefix('TELEMETRY', correlationId), eventName, {
        ...metadata,
        timestamp: Date.now(),
      });
    },

    /**
     * Log request lifecycle events
     * Only: endpoint, method, status, duration (no PII)
     */
    request: (phase: 'start' | 'end' | 'error', details: {
      endpoint: string;
      method?: string;
      statusCode?: number;
      durationMs?: number;
      errorCode?: string;
    }) => {
      console.log(formatPrefix('REQUEST', correlationId), phase.toUpperCase(), details);
    },
  }),
};

export default logger;
