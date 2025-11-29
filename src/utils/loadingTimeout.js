/**
 * Loading Timeout Utility
 *
 * Helps detect and handle stuck loading states that could cause infinite loading spinners.
 * This is critical for preventing users from seeing endless loading circles during signup/login.
 */

import { logger } from '../lib/logger';

/**
 * Creates a timeout wrapper for loading states
 * @param {Function} setLoadingState - State setter for loading indicator
 * @param {number} timeoutMs - Timeout in milliseconds (default: 15000 = 15 seconds)
 * @param {Function} onTimeout - Optional callback when timeout occurs
 * @returns {Object} - Object with start and cancel functions
 */
export function createLoadingTimeout(setLoadingState, timeoutMs = 15000, onTimeout) {
  let timeoutId = null;
  let startTime = null;

  const start = (loadingMessage = 'Loading...') => {
    startTime = Date.now();

    timeoutId = setTimeout(() => {
      console.error(`⏱️ Loading timeout after ${timeoutMs}ms: ${loadingMessage}`);

      // Reset loading state
      setLoadingState(false);

      // Call timeout callback if provided
      if (onTimeout) {
        onTimeout({
          duration: timeoutMs,
          message: loadingMessage,
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    return timeoutId;
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);

      if (startTime) {
        const duration = Date.now() - startTime;
        logger.log(`✅ Loading completed in ${duration}ms`);
      }

      timeoutId = null;
      startTime = null;
    }
  };

  return { start, cancel };
}

/**
 * Hook-like function to track loading performance
 * @param {string} operationName - Name of the operation being tracked
 */
export function trackLoadingPerformance(operationName) {
  const startTime = performance.now();

  return {
    finish: () => {
      const duration = performance.now() - startTime;

      // Log slow operations
      if (duration > 3000) {
        console.warn(`⚠️ Slow operation: ${operationName} took ${duration.toFixed(0)}ms`);
      } else if (duration > 1000) {
        logger.log(`⏱️ ${operationName} took ${duration.toFixed(0)}ms`);
      }

      return duration;
    }
  };
}

/**
 * Wraps an async operation with timeout protection
 * @param {Promise} promise - The async operation to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for error messages
 * @returns {Promise} - Promise that rejects on timeout
 */
export async function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Creates a fetch wrapper with automatic timeout
 * @param {number} defaultTimeout - Default timeout in milliseconds
 * @returns {Function} - Wrapped fetch function
 */
export function createTimeoutFetch(defaultTimeout = 10000) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutMs = options.timeout || defaultTimeout;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      }

      throw error;
    }
  };
}
