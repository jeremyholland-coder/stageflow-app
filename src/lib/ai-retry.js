/**
 * QA FIX #5: AI Request Retry with Backoff
 *
 * Provides automatic retry logic for transient AI failures.
 * Retries only on transient errors (network, rate limit, timeout).
 * Does NOT retry on auth errors or invalid API keys.
 *
 * @author StageFlow Engineering
 */

/**
 * Errors that should NOT be retried
 * FIX 2025-12-03: Added more session-related error codes
 */
const NON_RETRYABLE_ERRORS = [
  'INVALID_API_KEY',
  'NO_PROVIDERS',
  'AI_LIMIT_REACHED',
  'SESSION_ERROR',
  'SESSION_INVALID',
  'SESSION_EXPIRED',
  'NO_SESSION',
  'AUTH_REQUIRED',
  'unauthorized',
  'Unauthorized',
  'invalid api key',
  'session has expired',
  'Please sign in',
];

/**
 * Check if an error is retryable
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is transient and can be retried
 */
export function isRetryableError(error) {
  const errorCode = error?.code || error?.data?.error || '';
  const errorMessage = error?.message || '';
  const status = error?.status || error?.statusCode || 0;

  // Don't retry auth errors
  if (status === 401 || status === 403) {
    // Exception: provider-level auth errors (invalid key) should fallback, not retry
    // But user auth errors should not be retried
    if (!errorMessage.includes('key') && !errorMessage.includes('API')) {
      return false;
    }
  }

  // Don't retry non-retryable error codes
  for (const nonRetryable of NON_RETRYABLE_ERRORS) {
    if (errorCode.includes(nonRetryable) || errorMessage.includes(nonRetryable)) {
      return false;
    }
  }

  // Retry on rate limits
  if (status === 429 || errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
    return true;
  }

  // Retry on network/timeout errors
  if (
    error?.name === 'AbortError' ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND')
  ) {
    return true;
  }

  // Retry on server errors (500-599)
  if (status >= 500 && status < 600) {
    return true;
  }

  // Retry on provider failures (fallback exhausted but transient)
  if (error?.isAllProvidersFailed) {
    return true;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Execute a function with automatic retry and exponential backoff
 *
 * @param {Function} fn - The async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 2)
 * @param {number} options.initialDelayMs - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 5000)
 * @param {Function} options.onRetry - Callback called before each retry: (attempt, error, delayMs) => void
 * @param {Function} options.shouldRetry - Custom retry predicate: (error) => boolean
 * @returns {Promise<Object>} Result with { success, data?, error?, attempts }
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 2,
    initialDelayMs = 1000,
    maxDelayMs = 5000,
    onRetry = null,
    shouldRetry = isRetryableError
  } = options;

  let lastError = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const result = await fn();
      return {
        success: true,
        data: result,
        attempts
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempts >= maxAttempts || !shouldRetry(error)) {
        return {
          success: false,
          error,
          attempts,
          retryable: shouldRetry(error)
        };
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelayMs * Math.pow(2, attempts - 1),
        maxDelayMs
      );

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempts, error, delay);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: lastError,
    attempts,
    retryable: false
  };
}

/**
 * Create a retry wrapper with preset options
 *
 * @param {Object} options - Retry options (same as withRetry)
 * @returns {Function} A function that wraps any async function with retry logic
 */
export function createRetryWrapper(options = {}) {
  return (fn) => withRetry(fn, options);
}

/**
 * React hook-friendly retry state manager
 *
 * @param {Object} options - Retry options
 * @returns {Object} { execute, isRetrying, currentAttempt, error }
 */
export function createRetryState() {
  return {
    isRetrying: false,
    currentAttempt: 0,
    lastError: null,

    reset() {
      this.isRetrying = false;
      this.currentAttempt = 0;
      this.lastError = null;
    }
  };
}

export default {
  isRetryableError,
  withRetry,
  createRetryWrapper,
  createRetryState
};
