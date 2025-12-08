/**
 * AI Error Classification
 *
 * Shared error codes and classification logic for AI-related errors.
 * Used by both frontend (CustomQueryView, streaming consumers) and
 * informs backend error responses.
 *
 * TASK 2 & 3: Centralized error classification for consistent UX.
 * Phase 3: Integrated with unified error system for Apple-grade messaging.
 *
 * @author StageFlow Engineering
 */

// Phase 3: Import unified error system for Apple-grade messaging
import {
  normalizeError,
  UNIFIED_ERROR_CODES,
  ERROR_SEVERITY as UNIFIED_SEVERITY,
  ERROR_MESSAGES,
  isRetryable,
  getAction as getUnifiedAction
} from './unified-errors';

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

  // P0 FIX 2025-12-08: Auth errors - check SESSION_INVALID explicitly
  // Backend now returns code: 'SESSION_INVALID' for all auth failures
  if (
    status === 401 ||
    status === 403 ||
    errorCode === AI_ERROR_CODES.UNAUTHORIZED ||
    errorCode === AI_ERROR_CODES.SESSION_ERROR ||
    errorCode === 'SESSION_INVALID' ||
    errorCode === 'SESSION_ROTATED' ||
    errorCode === 'NO_SESSION' ||
    errorCode === 'AUTH_REQUIRED' ||
    errorMessage.includes('session') ||
    errorMessage.includes('sign in again') ||
    errorMessage.includes('expired')
  ) {
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

  // P0 FIX 2025-12-08: Better session/auth detection from messages
  if (
    lowerMessage.includes('session') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('sign in') ||
    lowerMessage.includes('expired') ||
    lowerMessage.includes('authentication')
  ) {
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
      // Area 7: Check for upgrade prompt from backend (plan-based limits)
      if (context.upgradePrompt) {
        return context.upgradePrompt;
      }
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
 * @param {Object} context - Additional context (e.g., { planId })
 * @returns {{ label: string, type: 'retry' | 'settings' | 'none' }}
 */
export function getErrorAction(code, retryable, context = {}) {
  switch (code) {
    case AI_ERROR_CODES.INVALID_API_KEY:
      return { label: 'Update in Settings', type: 'settings' };

    case AI_ERROR_CODES.NO_PROVIDERS:
      return { label: 'Add Provider', type: 'settings' };

    case AI_ERROR_CODES.AI_LIMIT_REACHED:
      return { label: 'Upgrade Plan', type: 'settings' };

    case AI_ERROR_CODES.RATE_LIMITED:
      // Area 7: If free plan, suggest upgrade
      if (context?.planId === 'free') {
        return { label: 'Upgrade Plan', type: 'settings' };
      }
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

// ============================================================================
// Phase 3: UNIFIED ERROR INTEGRATION
// ============================================================================

/**
 * AI Error Code to Unified Error Code mapping
 * Ensures consistent messaging across the application
 */
const AI_TO_UNIFIED_MAP = {
  [AI_ERROR_CODES.INVALID_API_KEY]: UNIFIED_ERROR_CODES.INVALID_API_KEY,
  [AI_ERROR_CODES.NO_PROVIDERS]: UNIFIED_ERROR_CODES.NO_PROVIDERS,
  [AI_ERROR_CODES.AI_LIMIT_REACHED]: UNIFIED_ERROR_CODES.AI_LIMIT_REACHED,
  [AI_ERROR_CODES.SESSION_ERROR]: UNIFIED_ERROR_CODES.SESSION_EXPIRED,
  [AI_ERROR_CODES.UNAUTHORIZED]: UNIFIED_ERROR_CODES.UNAUTHORIZED,
  [AI_ERROR_CODES.RATE_LIMITED]: UNIFIED_ERROR_CODES.RATE_LIMITED,
  [AI_ERROR_CODES.ALL_PROVIDERS_FAILED]: UNIFIED_ERROR_CODES.ALL_PROVIDERS_FAILED,
  [AI_ERROR_CODES.PROVIDER_ERROR]: UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
  [AI_ERROR_CODES.TIMEOUT]: UNIFIED_ERROR_CODES.TIMEOUT,
  [AI_ERROR_CODES.NETWORK_ERROR]: UNIFIED_ERROR_CODES.NETWORK_ERROR,
  [AI_ERROR_CODES.STREAM_ERROR]: UNIFIED_ERROR_CODES.STREAM_ERROR,
  [AI_ERROR_CODES.OFFLINE]: UNIFIED_ERROR_CODES.OFFLINE,
  [AI_ERROR_CODES.UNKNOWN]: UNIFIED_ERROR_CODES.UNKNOWN_ERROR,
};

/**
 * Phase 3: Normalize AI error to unified format
 *
 * Converts AI-specific errors to the unified error format with
 * Apple-grade messaging, recovery guidance, and action buttons.
 *
 * @param {Error|Object|string} error - The error to normalize
 * @param {string} context - Context identifier for logging
 * @returns {Object} Normalized error with unified format:
 *   - code: Unified error code
 *   - title: Apple-grade error title
 *   - message: User-friendly message
 *   - recovery: Recovery guidance
 *   - severity: Error severity level
 *   - retryable: Whether error is retryable
 *   - action: Suggested action { label, type, path }
 *   - aiCode: Original AI-specific error code
 *   - raw: Original error object
 */
export function normalizeAIError(error, context = 'AIAssistant') {
  // First classify the error to get the AI-specific code
  const classification = classifyError(error);
  const aiCode = classification.code;

  // Map to unified code
  const unifiedCode = AI_TO_UNIFIED_MAP[aiCode] || UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR;

  // Get unified error details
  const unifiedError = normalizeError({ code: unifiedCode }, context);

  // Merge with AI-specific context
  return {
    ...unifiedError,
    code: unifiedCode,
    aiCode: aiCode,
    // Use AI-specific message if available (may have more context)
    message: unifiedError.message,
    // Preserve AI error classification for internal use
    classification: classification,
    // Enhance action with AI-specific paths
    action: enhanceActionForAI(unifiedError.action, aiCode),
  };
}

/**
 * Enhance unified action with AI-specific navigation paths
 */
function enhanceActionForAI(action, aiCode) {
  // Customize action paths for AI-specific errors
  if (aiCode === AI_ERROR_CODES.INVALID_API_KEY || aiCode === AI_ERROR_CODES.NO_PROVIDERS) {
    return {
      ...action,
      label: action.label || 'Open Settings',
      type: 'navigate',
      path: '/settings?tab=ai',
    };
  }

  if (aiCode === AI_ERROR_CODES.AI_LIMIT_REACHED) {
    return {
      ...action,
      label: 'Upgrade Plan',
      type: 'navigate',
      path: '/settings?tab=billing',
    };
  }

  return action;
}

/**
 * Phase 3: Check if user is offline
 *
 * Used by AI flows to fail fast when offline instead of
 * waiting for timeout.
 *
 * @returns {boolean} True if offline
 */
export function isOffline() {
  // Use Navigator.onLine API
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    return !navigator.onLine;
  }
  // Default to online if API not available
  return false;
}

/**
 * Phase 3: Create offline error
 *
 * Returns a pre-formatted offline error for immediate display.
 *
 * @param {string} context - Context identifier
 * @returns {Object} Normalized offline error
 */
export function createOfflineError(context = 'AIAssistant') {
  return normalizeAIError(
    { code: AI_ERROR_CODES.OFFLINE, message: 'You are currently offline' },
    context
  );
}

/**
 * Phase 3: Determine if an AI request should proceed
 *
 * Pre-flight check before making AI requests. Returns an error
 * object if the request should not proceed, or null if OK.
 *
 * @param {Object} options - Check options
 * @param {boolean} options.requireOnline - Whether to require online status
 * @returns {Object|null} Error object if should not proceed, null if OK
 */
export function shouldBlockAIRequest(options = {}) {
  const { requireOnline = true } = options;

  // Check offline status
  if (requireOnline && isOffline()) {
    return createOfflineError('pre-flight');
  }

  return null;
}

export default {
  AI_ERROR_CODES,
  ERROR_SEVERITY,
  classifyError,
  getErrorMessage,
  getErrorAction,
  // Phase 3 exports
  normalizeAIError,
  isOffline,
  createOfflineError,
  shouldBlockAIRequest,
};
