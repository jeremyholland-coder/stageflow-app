/**
 * useLoadingTimeout Hook
 *
 * Prevents infinite loading states by automatically clearing them after a timeout.
 * This is a critical UX safeguard against network failures that don't trigger error handlers.
 *
 * NEXT-LEVEL FIX: Prevents stuck loading spinners that frustrate users
 *
 * Usage:
 * ```javascript
 * const [isLoading, setIsLoading] = useState(false);
 * useLoadingTimeout(isLoading, () => setIsLoading(false), 30000); // 30s max
 *
 * // Or use the convenience hook:
 * const [isLoading, setIsLoading, resetLoading] = useLoadingState(false, { timeout: 15000 });
 * ```
 */

import { useEffect, useRef } from 'react';

/**
 * Hook that automatically clears a loading state after a timeout
 *
 * @param {boolean} isLoading - Current loading state
 * @param {Function} onTimeout - Callback to clear loading state
 * @param {number} timeout - Timeout in milliseconds (default: 30000 = 30s)
 * @param {object} options - Additional options
 * @param {boolean} options.warnOnTimeout - Log warning when timeout occurs (default: true)
 * @param {string} options.operation - Operation name for logging (default: 'Operation')
 */
export function useLoadingTimeout(isLoading, onTimeout, timeout = 30000, options = {}) {
  const { warnOnTimeout = true, operation = 'Operation' } = options;
  const timeoutIdRef = useRef(null);

  useEffect(() => {
    // Only set timeout if loading is true
    if (!isLoading) {
      // Clear any existing timeout when loading stops
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      return;
    }

    // Set timeout to clear loading state
    timeoutIdRef.current = setTimeout(() => {
      if (warnOnTimeout) {
        console.warn(`[LoadingTimeout] ${operation} exceeded timeout of ${timeout}ms. Clearing loading state.`);
      }

      // Call the timeout callback
      if (onTimeout && typeof onTimeout === 'function') {
        onTimeout();
      }
    }, timeout);

    // Cleanup
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [isLoading, onTimeout, timeout, warnOnTimeout, operation]);
}

/**
 * Convenience hook that combines useState with automatic timeout protection
 *
 * @param {boolean} initialState - Initial loading state
 * @param {object} options - Configuration options
 * @param {number} options.timeout - Timeout in milliseconds (default: 30000)
 * @param {string} options.operation - Operation name for logging
 * @param {boolean} options.warnOnTimeout - Log warning on timeout
 * @returns {[boolean, Function, Function]} - [isLoading, setIsLoading, forceReset]
 *
 * @example
 * const [isLoading, setIsLoading, resetLoading] = useLoadingState(false, { timeout: 15000 });
 *
 * const handleSubmit = async () => {
 *   setIsLoading(true);
 *   try {
 *     await api.post('/endpoint', data);
 *   } catch (error) {
 *     console.error(error);
 *   } finally {
 *     setIsLoading(false); // Normal completion
 *   }
 *   // If error occurs without finally block, timeout will clear loading state after 15s
 * };
 */
import { useState, useCallback } from 'react';

export function useLoadingState(initialState = false, options = {}) {
  const { timeout = 30000, operation, warnOnTimeout = true } = options;
  const [isLoading, setIsLoading] = useState(initialState);

  // Force reset function that can be called manually
  const forceReset = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Attach automatic timeout protection
  useLoadingTimeout(isLoading, forceReset, timeout, { warnOnTimeout, operation });

  return [isLoading, setIsLoading, forceReset];
}

/**
 * Hook for async operations with automatic loading state management
 *
 * @param {Function} asyncFn - Async function to execute
 * @param {object} options - Configuration options
 * @returns {object} - { isLoading, error, execute, reset }
 *
 * @example
 * const { isLoading, error, execute } = useAsyncOperation(
 *   async () => await api.post('/endpoint', data),
 *   { timeout: 20000, operation: 'Save settings' }
 * );
 *
 * <button onClick={execute} disabled={isLoading}>
 *   {isLoading ? 'Saving...' : 'Save'}
 * </button>
 */
export function useAsyncOperation(asyncFn, options = {}) {
  const { timeout = 30000, operation, warnOnTimeout = true } = options;
  const [isLoading, setIsLoading, forceReset] = useLoadingState(false, { timeout, operation, warnOnTimeout });
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await asyncFn(...args);
      setIsLoading(false);
      return result;
    } catch (err) {
      setError(err);
      setIsLoading(false);
      throw err;
    }
  }, [asyncFn]);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    execute,
    reset,
  };
}

export default useLoadingTimeout;
