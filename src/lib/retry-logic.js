// src/lib/retry-logic.js
/**
 * Connection Retry Logic with Exponential Backoff
 * Handles transient network failures gracefully
 * 
 * CRITICAL FIX #2: Prevents permanent failures on temporary network issues
 */

export class RetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 10000; // 10 seconds
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.retryableErrors = options.retryableErrors || [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENOTFOUND',
      'EPIPE',
      'network_error',
      'timeout'
    ];
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error) {
    if (!error) return false;

    // Check error code
    if (error.code && this.retryableErrors.includes(error.code)) {
      return true;
    }

    // Check error message
    const message = (error.message || '').toLowerCase();
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('fetch failed')
    ) {
      return true;
    }

    // Check HTTP status codes (specific retryable errors only)
    // FIX 2025-12-06: Do NOT retry generic 500 errors - they may be structural failures
    // that will never succeed. Only retry transient server errors (502, 503, 504)
    if (error.status) {
      return (
        error.status === 408 || // Request Timeout - transient
        error.status === 429 || // Too Many Requests - transient (rate limit)
        error.status === 502 || // Bad Gateway - transient (upstream issue)
        error.status === 503 || // Service Unavailable - transient
        error.status === 504    // Gateway Timeout - transient
        // NOTE: 500 is intentionally NOT retried - it usually means a bug, not a transient failure
        // Retrying 500s wastes resources and delays showing the actual error to users
      );
    }

    return false;
  }

  /**
   * Calculate delay for retry attempt
   */
  getRetryDelay(attemptNumber) {
    const delay = Math.min(
      this.initialDelay * Math.pow(this.backoffMultiplier, attemptNumber),
      this.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute operation with retry logic
   * @param {Function} operation - Async function to execute
   * @param {Object} options - Override default options
   * @returns {Promise} Result of operation
   */
  async execute(operation, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const onRetry = options.onRetry || ((error, attempt) => {
      console.warn(`[Retry] Attempt ${attempt}/${maxRetries} after error:`, error.message);
    });

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't retry if this is the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Don't retry if error is not retryable
        if (!this.isRetryable(error)) {
          console.error('Error is not retryable:', error.message);
          throw error;
        }

        // Calculate delay and notify
        const delay = this.getRetryDelay(attempt);
        onRetry(error, attempt + 1);
        
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    throw new Error(
      `Operation failed after ${maxRetries} retries. Last error: ${lastError.message}`
    );
  }
}

// Singleton instance for application-wide use
export const retryHandler = new RetryHandler();

/**
 * Retry wrapper for Supabase operations
 */
export async function supabaseWithRetry(operation, options = {}) {
  const handler = new RetryHandler(options);
  return handler.execute(operation, options);
}

/**
 * Retry wrapper for fetch requests
 */
export async function fetchWithRetry(url, options = {}) {
  const handler = new RetryHandler({
    maxRetries: options.maxRetries || 3,
    onRetry: options.onRetry
  });

  return handler.execute(async () => {
    const response = await fetch(url, options);

    // FIX v1.7.61 (#1): Parse response body BEFORE throwing so caller can access error details
    // This fixes Stripe checkout "No sessionId" alert - error data is now available in catch blocks
    if (!response.ok) {
      let errorData;
      try {
        // Attempt to parse error body as JSON
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          errorData = await response.json();
        } else {
          errorData = { message: await response.text() };
        }
      } catch (parseError) {
        // If parsing fails, use status text as fallback
        errorData = { message: response.statusText };
      }

      const error = new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      error.status = response.status;
      error.response = response;
      error.data = errorData; // FIX: Include parsed error data for caller
      throw error;
    }

    return response;
  });
}

/**
 * Retry wrapper for async operations
 */
export function retryAsync(operation, options = {}) {
  const handler = new RetryHandler(options);
  return handler.execute(operation, options);
}

export default RetryHandler;
