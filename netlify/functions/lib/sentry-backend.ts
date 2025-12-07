/**
 * Sentry Backend Configuration for Netlify Functions
 * Phase 1 - Observability
 *
 * Provides error tracking and performance monitoring for serverless functions.
 * Only active when SENTRY_DSN and SENTRY_ENABLED are configured.
 *
 * NO PII is logged - only:
 * - correlationId
 * - endpoint + method
 * - status code / error code
 * - high-level event names
 */

// Note: Using dynamic import to avoid build issues if @sentry/node is not installed
// In production, this will use console.error as fallback if Sentry is unavailable

interface SentryBackendConfig {
  dsn: string | undefined;
  enabled: boolean;
  environment: string;
}

const config: SentryBackendConfig = {
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.SENTRY_ENABLED !== 'false' && !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
};

// Sentry instance (lazy-loaded)
let sentryInstance: any = null;
let sentryInitialized = false;

/**
 * Initialize Sentry for backend (Netlify Functions)
 * Call once at function cold-start
 */
export const initSentryBackend = async (): Promise<boolean> => {
  if (sentryInitialized) return !!sentryInstance;

  if (!config.enabled || !config.dsn) {
    console.log('[Sentry-Backend] Disabled (no DSN or SENTRY_ENABLED=false)');
    sentryInitialized = true;
    return false;
  }

  try {
    // Dynamic import to handle cases where @sentry/node might not be installed
    const Sentry = await import('@sentry/node');

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,

      // Performance monitoring (sample 10% of transactions)
      tracesSampleRate: 0.1,

      // Only send errors, not debug/info
      beforeSend(event) {
        // Filter out non-error events in production
        if (config.environment === 'production' && event.level === 'info') {
          return null;
        }
        return event;
      },

      // Sanitize sensitive data
      beforeBreadcrumb(breadcrumb) {
        // Remove any potential PII from breadcrumbs
        if (breadcrumb.data) {
          // Keep only safe fields
          const safeData: Record<string, any> = {};
          const safeFields = ['correlationId', 'endpoint', 'method', 'statusCode', 'durationMs', 'errorCode', 'eventName'];

          for (const field of safeFields) {
            if (breadcrumb.data[field] !== undefined) {
              safeData[field] = breadcrumb.data[field];
            }
          }

          breadcrumb.data = safeData;
        }
        return breadcrumb;
      },
    });

    sentryInstance = Sentry;
    sentryInitialized = true;
    console.log('[Sentry-Backend] Initialized successfully');
    return true;
  } catch (error) {
    console.warn('[Sentry-Backend] Failed to initialize (falling back to console):', error);
    sentryInitialized = true;
    return false;
  }
};

/**
 * Capture an error with context
 * Only sends: error type, message (sanitized), correlationId, endpoint
 */
export const captureBackendError = (
  error: Error,
  context: {
    correlationId?: string;
    endpoint?: string;
    method?: string;
    errorCode?: string;
  } = {}
): void => {
  // Always log to console (Netlify captures these)
  console.error('[Sentry-Backend] Error:', {
    name: error.name,
    message: error.message?.substring(0, 200), // Truncate message
    ...context,
  });

  if (sentryInstance) {
    sentryInstance.withScope((scope: any) => {
      if (context.correlationId) {
        scope.setTag('correlationId', context.correlationId);
      }
      if (context.endpoint) {
        scope.setTag('endpoint', context.endpoint);
      }
      if (context.method) {
        scope.setTag('method', context.method);
      }
      if (context.errorCode) {
        scope.setTag('errorCode', context.errorCode);
      }

      // Set safe extra context (no PII)
      scope.setExtra('context', {
        correlationId: context.correlationId,
        endpoint: context.endpoint,
        method: context.method,
        errorCode: context.errorCode,
      });

      sentryInstance.captureException(error);
    });
  }
};

/**
 * Capture a message/event
 * Only for high-level events (no PII)
 */
export const captureBackendMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context: Record<string, string | number | undefined> = {}
): void => {
  if (sentryInstance) {
    sentryInstance.withScope((scope: any) => {
      // Set tags from context
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) {
          scope.setTag(key, String(value));
        }
      }

      sentryInstance.captureMessage(message, level);
    });
  }
};

/**
 * Set correlation ID for the current scope
 */
export const setBackendCorrelationId = (correlationId: string): void => {
  if (sentryInstance) {
    sentryInstance.setTag('correlationId', correlationId);
  }
};

/**
 * Add breadcrumb for debugging context
 * Only safe data (no PII)
 */
export const addBackendBreadcrumb = (
  message: string,
  data: Record<string, string | number | undefined> = {}
): void => {
  if (sentryInstance) {
    sentryInstance.addBreadcrumb({
      message,
      data,
      level: 'info',
    });
  }
};

export default {
  init: initSentryBackend,
  captureError: captureBackendError,
  captureMessage: captureBackendMessage,
  setCorrelationId: setBackendCorrelationId,
  addBreadcrumb: addBackendBreadcrumb,
};
