/**
 * Sentry Error Monitoring Configuration
 *
 * Provides production error tracking, performance monitoring, and user feedback
 * Only active in production to avoid noise during development
 */

import * as Sentry from "@sentry/react";
import { logger } from './logger';

/**
 * Initialize Sentry error monitoring
 * Call this early in app initialization
 */
export const initSentry = () => {
  // Only initialize in production
  if (import.meta.env.MODE !== 'production') {
    logger.log('[Sentry] Skipping initialization in development mode');
    return;
  }

  // Only initialize if DSN is configured
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN not configured. Error monitoring disabled.');
    return;
  }

  Sentry.init({
    dsn,

    // Environment and release tracking
    environment: import.meta.env.MODE,

    // Performance monitoring
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Privacy: mask all text and images by default
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Performance Monitoring
    tracesSampleRate: 0.1, // Capture 10% of transactions for performance monitoring

    // Session Replay - only capture sessions with errors
    replaysSessionSampleRate: 0, // Don't capture normal sessions
    replaysOnErrorSampleRate: 1.0, // Capture 100% of sessions with errors

    // Filter out known noise
    beforeSend(event, hint) {
      // Don't send errors from browser extensions
      if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
        frame => frame.filename?.includes('extension://')
      )) {
        return null;
      }

      // Don't send network errors (user connection issues)
      if (event.exception?.values?.[0]?.type === 'NetworkError') {
        return null;
      }

      return event;
    },

    // Ignore known third-party errors
    ignoreErrors: [
      // Random plugins/extensions
      'top.GLOBALS',
      // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error.html
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      'http://tt.epicplay.com',
      "Can't find variable: ZiteReader",
      'jigsaw is not defined',
      'ComboSearch is not defined',
      'http://loading.retry.widdit.com/',
      'atomicFindClose',
      // Facebook borked
      'fb_xd_fragment',
      // ISP "optimizing" proxy - `Cache-Control: no-transform` seems to reduce this. (thanks @acdha)
      'bmi_SafeAddOnload',
      'EBCallBackMessageReceived',
      // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
      'conduitPage',
      // Generic error
      'Script error.',
      'Non-Error promise rejection captured',
    ],

    // Tag errors with user context
    initialScope: {
      tags: {
        'app.version': import.meta.env.VITE_APP_VERSION || 'unknown',
      },
    },
  });

  logger.log('[Sentry] Error monitoring initialized');
};

/**
 * Set user context for error tracking
 * Call after user logs in
 */
export const setSentryUser = (user) => {
  if (!user) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.user_metadata?.full_name || user.email,
  });
};

/**
 * Clear user context
 * Call on logout
 */
export const clearSentryUser = () => {
  Sentry.setUser(null);
};

/**
 * Manually capture an error
 */
export const captureError = (error, context = {}) => {
  Sentry.captureException(error, {
    extra: context,
  });
};

/**
 * Manually capture a message
 */
export const captureMessage = (message, level = 'info', context = {}) => {
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
};

/**
 * Add breadcrumb for debugging context
 */
export const addBreadcrumb = (message, data = {}) => {
  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
  });
};

// ============================================================================
// CORRELATION ID & REQUEST TELEMETRY (Phase 1 - Observability)
// ============================================================================

/**
 * Generate a random suffix for correlation IDs
 * Uses crypto.randomUUID() with fallback for older browsers/non-secure contexts
 */
const generateRandomSuffix = () => {
  try {
    // Prefer crypto.randomUUID() if available
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().split('-')[0];
    }
  } catch (e) {
    // Fall through to fallback
  }
  // Fallback: Math.random() based ID (less secure but works everywhere)
  return Math.random().toString(36).substring(2, 10);
};

/**
 * Generate a correlation ID for request tracing
 * Format: sf-{timestamp_base36}-{random_suffix}
 */
export const generateCorrelationId = () => {
  const timestamp = Date.now().toString(36);
  const randomSuffix = generateRandomSuffix();
  return `sf-${timestamp}-${randomSuffix}`;
};

/**
 * Safely call Sentry methods - guards against Sentry not being initialized
 * Returns true if Sentry call succeeded, false otherwise
 */
const safeSentryCall = (fn) => {
  try {
    fn();
    return true;
  } catch (e) {
    // Silently ignore Sentry errors - telemetry should never break the app
    return false;
  }
};

/**
 * Track API request start - adds breadcrumb for debugging
 * Only logs: correlationId, endpoint, method (NO PII, NO request bodies)
 */
export const trackRequestStart = (correlationId, endpoint, method) => {
  safeSentryCall(() => {
    Sentry.addBreadcrumb({
      category: 'api.request',
      message: `${method} ${endpoint}`,
      data: {
        correlationId,
        endpoint,
        method,
      },
      level: 'info',
    });
  });
};

/**
 * Track API request completion
 * Only logs: correlationId, endpoint, status code, duration (NO PII, NO response bodies)
 */
export const trackRequestEnd = (correlationId, endpoint, statusCode, durationMs) => {
  safeSentryCall(() => {
    Sentry.addBreadcrumb({
      category: 'api.response',
      message: `${statusCode} ${endpoint}`,
      data: {
        correlationId,
        endpoint,
        statusCode,
        durationMs,
      },
      level: statusCode >= 400 ? 'warning' : 'info',
    });
  });
};

/**
 * Track high-level telemetry events (for metrics aggregation)
 * Event names should be snake_case: ai_call_failed, deal_update_success, etc.
 * Only includes correlationId and event-specific metadata (NO PII)
 */
export const trackEvent = (eventName, metadata = {}) => {
  safeSentryCall(() => {
    Sentry.addBreadcrumb({
      category: 'telemetry',
      message: eventName,
      data: {
        ...metadata,
        timestamp: Date.now(),
      },
      level: 'info',
    });
  });
};

/**
 * Set correlation ID as Sentry tag for the current scope
 * Allows filtering all errors/events by correlationId in Sentry dashboard
 */
export const setCorrelationId = (correlationId) => {
  safeSentryCall(() => {
    Sentry.setTag('correlationId', correlationId);
  });
};
