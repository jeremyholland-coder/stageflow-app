/**
 * H6-E HARDENING 2025-12-04: Unified Retry Strategy for Critical Actions
 *
 * Central module for retry logic across StageFlow.
 * Use this for any unreliable operations: AI calls, network requests, auth refresh.
 *
 * @example
 * import { withRetry, isRetryableError } from '../lib/retry';
 *
 * // Basic usage - wraps async function with retry
 * const result = await withRetry(
 *   () => api.post('my-endpoint', data),
 *   { maxAttempts: 3 }
 * );
 *
 * if (result.success) {
 *   // Handle result.data
 * } else {
 *   // Handle result.error (all retries failed)
 * }
 *
 * @example
 * // With onRetry callback for user feedback
 * const result = await withRetry(
 *   () => fetchDeals(orgId),
 *   {
 *     maxAttempts: 3,
 *     onRetry: (attempt, error, delay) => {
 *       addNotification(`Retrying... (attempt ${attempt})`, 'info');
 *     }
 *   }
 * );
 *
 * @see src/lib/ai-retry.js for full implementation
 */

// Re-export from ai-retry.js which has the canonical implementation
export {
  withRetry,
  isRetryableError,
  createRetryWrapper,
  createRetryState
} from './ai-retry';

// Also re-export error-handler's retry for backwards compatibility
export { retryOperation } from './error-handler';
