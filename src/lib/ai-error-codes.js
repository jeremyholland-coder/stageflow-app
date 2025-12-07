/**
 * AI Error Classification
 *
 * Shared error codes and classification logic for AI-related errors.
 * Used by both frontend (CustomQueryView, streaming consumers) and
 * informs backend error responses.
 *
 * TASK 2 & 3: Centralized error classification for consistent UX.
 *
 * @author StageFlow Engineering
 */

/**
 * Standard AI error codes
 * These match what the backend returns and what the frontend expects
 */
export const AI_ERROR_CODES = {
  // Auth/Config errors (non-retryable)
  INVALID_API_KEY: 'INVALID_API_KEY',
  NO_PROVIDERS: 'NO_PROVIDERS',
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',
  SESSION_ERROR: 'SESSION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Provider errors (may be retryable)
  RATE_LIMITED: 'RATE_LIMITED',
  ALL_PROVIDERS_FAILED: 'ALL_PROVIDERS_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',

  // Network/transient errors (retryable)
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  STREAM_ERROR: 'STREAM_ERROR',

  // Offline mode (Area 3 - retryable when back online)
  OFFLINE: 'OFFLINE',

  // Unknown
  UNKNOWN: 'UNKNOWN'
};

/**
 * Error severities for UI styling
 */
export const ERROR_SEVERITY = {
  ERROR: 'error',     // Red - requires user action
  WARNING: 'warning', // Yellow - may self-resolve or can retry
  INFO: 'info'        // Blue - informational
};

/**
 * Classify an error from various sources (fetch, streaming, backend response)
 *
 * @param {Error|Object|string} error - The error to classify
 * @returns {{ code: string, severity: string, retryable: boolean }}
 */
export function classifyError(error) {
  // Handle string errors
  if (typeof error === 'string') {
    return classifyErrorMessage(error);
  }

  // Extract error info from various formats
  const errorCode = error?.code || error?.data?.error || error?.error || '';
  const errorMessage = error?.message || error?.response || '';
  const status = error?.status || error?.statusCode || 0;

  // Check for specific error codes first
  if (errorCode === AI_ERROR_CODES.AI_LIMIT_REACHED || error?.limitReached) {
    return { code: AI_ERROR_CODES.AI_LIMIT_REACHED, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  if (errorCode === AI_ERROR_CODES.NO_PROVIDERS || errorMessage.includes('No AI provider')) {
    return { code: AI_ERROR_CODES.NO_PROVIDERS, severity: ERROR_SEVERITY.WARNING, retryable: false };
  }

  if (errorCode === AI_ERROR_CODES.INVALID_API_KEY || errorMessage.includes('Invalid API key')) {
    return { code: AI_ERROR_CODES.INVALID_API_KEY, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  // Auth errors
  if (status === 401 || errorCode === AI_ERROR_CODES.UNAUTHORIZED || errorMessage.includes('session')) {
    return { code: AI_ERROR_CODES.SESSION_ERROR, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  // Rate limiting (retryable)
  if (status === 429 || errorCode === AI_ERROR_CODES.RATE_LIMITED || errorMessage.includes('rate limit')) {
    return { code: AI_ERROR_CODES.RATE_LIMITED, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  // All providers failed (retryable)
  if (errorCode === AI_ERROR_CODES.ALL_PROVIDERS_FAILED || error?.isAllProvidersFailed) {
    return { code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  // Offline mode (Area 3 - retryable when back online)
  if (errorCode === AI_ERROR_CODES.OFFLINE || error?.isOffline || error?.code === 'OFFLINE') {
    return { code: AI_ERROR_CODES.OFFLINE, severity: ERROR_SEVERITY.INFO, retryable: true };
  }

  // Network/timeout errors (retryable)
  if (error?.name === 'AbortError' || errorMessage.includes('timeout')) {
    return { code: AI_ERROR_CODES.TIMEOUT, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
    return { code: AI_ERROR_CODES.NETWORK_ERROR, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  // Stream-specific errors
  if (errorMessage.includes('stream') || error?.isStreamError) {
    return { code: AI_ERROR_CODES.STREAM_ERROR, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  // Server errors (5xx) are usually transient
  if (status >= 500 && status < 600) {
    return { code: AI_ERROR_CODES.PROVIDER_ERROR, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  // Default: unknown error
  return { code: AI_ERROR_CODES.UNKNOWN, severity: ERROR_SEVERITY.ERROR, retryable: true };
}

/**
 * Classify error from just a message string
 */
function classifyErrorMessage(message) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('api key') || lowerMessage.includes('invalid key')) {
    return { code: AI_ERROR_CODES.INVALID_API_KEY, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  if (lowerMessage.includes('no ai provider') || lowerMessage.includes('no provider')) {
    return { code: AI_ERROR_CODES.NO_PROVIDERS, severity: ERROR_SEVERITY.WARNING, retryable: false };
  }

  if (lowerMessage.includes('limit reached') || lowerMessage.includes('limit exceeded')) {
    return { code: AI_ERROR_CODES.AI_LIMIT_REACHED, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
    return { code: AI_ERROR_CODES.RATE_LIMITED, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return { code: AI_ERROR_CODES.TIMEOUT, severity: ERROR_SEVERITY.WARNING, retryable: true };
  }

  if (lowerMessage.includes('session') || lowerMessage.includes('unauthorized')) {
    return { code: AI_ERROR_CODES.SESSION_ERROR, severity: ERROR_SEVERITY.ERROR, retryable: false };
  }

  // Offline mode (Area 3)
  if (lowerMessage.includes('offline') || lowerMessage.includes('no internet') || lowerMessage.includes('no connection')) {
    return { code: AI_ERROR_CODES.OFFLINE, severity: ERROR_SEVERITY.INFO, retryable: true };
  }

  return { code: AI_ERROR_CODES.UNKNOWN, severity: ERROR_SEVERITY.ERROR, retryable: true };
}

/**
 * Get user-friendly message for an error code
 *
 * @param {string} code - Error code from AI_ERROR_CODES
 * @param {Object} context - Additional context (e.g., { used, limit })
 * @returns {string} User-friendly message
 */
export function getErrorMessage(code, context = {}) {
  switch (code) {
    case AI_ERROR_CODES.INVALID_API_KEY:
      return 'Your AI provider key appears to be invalid or expired.';

    case AI_ERROR_CODES.NO_PROVIDERS:
      return 'No AI provider connected yet.';

    case AI_ERROR_CODES.AI_LIMIT_REACHED:
      const { used, limit } = context;
      if (used && limit) {
        return `Monthly AI limit reached (${used}/${limit} requests).`;
      }
      return 'Monthly AI request limit reached.';

    case AI_ERROR_CODES.SESSION_ERROR:
      return 'Your session has expired. Please sign in again.';

    case AI_ERROR_CODES.RATE_LIMITED:
      // Check if we have retryAfterSeconds context
      if (context.retryAfterSeconds) {
        const minutes = Math.ceil(context.retryAfterSeconds / 60);
        if (minutes > 60) {
          return 'You\'ve reached your daily AI limit. Try again tomorrow.';
        }
        return `You've reached the current limit. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
      }
      return 'AI request limit reached. Please wait a moment and try again.';

    case AI_ERROR_CODES.ALL_PROVIDERS_FAILED:
      return 'All AI providers are temporarily unavailable.';

    case AI_ERROR_CODES.TIMEOUT:
      return 'Request timed out. Please check your connection.';

    case AI_ERROR_CODES.NETWORK_ERROR:
      return 'Network error. Please check your connection.';

    case AI_ERROR_CODES.STREAM_ERROR:
      return 'Connection interrupted. Please try again.';

    case AI_ERROR_CODES.PROVIDER_ERROR:
      return 'AI provider encountered an error. Please try again.';

    case AI_ERROR_CODES.OFFLINE:
      return 'You\'re currently offline. Try again when your connection is back.';

    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Get action label for an error code
 *
 * @param {string} code - Error code
 * @param {boolean} retryable - Whether the error is retryable
 * @returns {{ label: string, type: 'retry' | 'settings' | 'none' }}
 */
export function getErrorAction(code, retryable) {
  switch (code) {
    case AI_ERROR_CODES.INVALID_API_KEY:
      return { label: 'Update in Settings', type: 'settings' };

    case AI_ERROR_CODES.NO_PROVIDERS:
      return { label: 'Add Provider', type: 'settings' };

    case AI_ERROR_CODES.AI_LIMIT_REACHED:
      return { label: 'Upgrade Plan', type: 'settings' };

    case AI_ERROR_CODES.RATE_LIMITED:
      // Rate limited but will be available again soon - don't show retry immediately
      return { label: 'Wait', type: 'none' };

    case AI_ERROR_CODES.SESSION_ERROR:
      return { label: '', type: 'none' }; // User needs to sign out/in manually

    case AI_ERROR_CODES.OFFLINE:
      // User is offline - show gentle message, auto-retry when back online
      return { label: 'Waiting for connection...', type: 'none' };

    default:
      if (retryable) {
        return { label: 'Try Again', type: 'retry' };
      }
      return { label: '', type: 'none' };
  }
}

export default {
  AI_ERROR_CODES,
  ERROR_SEVERITY,
  classifyError,
  getErrorMessage,
  getErrorAction
};
