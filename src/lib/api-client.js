/**
 * Centralized API Client with Enforced Retry Logic & Deduplication
 *
 * NEXT-LEVEL FIX: All API calls automatically use retry logic, timeouts, and consistent error handling
 * Prevents the common mistake of using raw fetch() without resilience
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Network-aware retry strategy (adjusts based on connection quality)
 * - Configurable timeouts per request
 * - Automatic auth header injection
 * - Consistent error handling
 * - Request deduplication (optional via dedupeKey)
 * - Request/response logging in development
 *
 * Network-Aware Retry Strategy:
 * - Excellent (5G/Fast WiFi): 3 retries, 500ms initial delay
 * - Good (4G/WiFi): 3 retries, 1s initial delay
 * - Fair (3G): 4 retries, 2s initial delay (more patient on unstable connections)
 * - Poor (Slow 3G): 5 retries, 3s initial delay (very patient)
 * - Offline: 0 retries (fail immediately)
 *
 * Usage Examples:
 * ```javascript
 * import { api } from './lib/api-client';
 *
 * // Simple GET request (automatically uses network-aware retries)
 * const { data } = await api.get('/endpoint');
 *
 * // POST with deduplication (prevents duplicate concurrent requests)
 * const { data } = await api.post('/save', { value: 123 }, {
 *   dedupeKey: 'save-settings' // Reuses in-flight request if called again
 * });
 *
 * // AI request (automatic 30s timeout, network-aware retries)
 * const { data } = await api.ai('/ai-endpoint', { message: 'Hello' });
 *
 * // Payment request (20s timeout, 1 retry max for safety)
 * const { data } = await api.payment('/checkout', { plan: 'pro' });
 * ```
 */

import { fetchWithRetry } from './retry-logic';
import { supabase, ensureValidSession, handleSessionInvalid } from './supabase';
import { parseSupabaseError } from './error-handler';
import { requestDeduplicator } from './request-deduplicator';
import { getNetworkAwareRetryConfig, getCurrentNetworkQuality } from './network-quality';
import {
  generateCorrelationId,
  trackRequestStart,
  trackRequestEnd,
  trackEvent,
  setCorrelationId,
} from './sentry';
// P0 FIX 2025-12-08: Invariant validation to prevent false success responses
import { normalizeDealResponse, isValidSuccessResponse } from './invariants';

/**
 * Default timeout values for different operation types
 */
const DEFAULT_TIMEOUTS = {
  default: 15000,      // 15 seconds for most operations
  ai: 30000,           // 30 seconds for AI operations
  payment: 20000,      // 20 seconds for Stripe/payment operations
  upload: 60000,       // 60 seconds for file uploads
  query: 10000,        // 10 seconds for database queries
};

/**
 * APIClient class - Centralized HTTP client with retry logic
 */
export class APIClient {
  constructor(options = {}) {
    this.baseURL = options.baseURL || '/.netlify/functions';
    this.defaultTimeout = options.timeout || DEFAULT_TIMEOUTS.default;
    this.defaultHeaders = options.headers || {};
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  }

  /**
   * Build complete URL from endpoint
   */
  buildURL(endpoint) {
    // If endpoint is absolute URL, use as-is
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return endpoint;
    }

    // If endpoint starts with /, remove it (baseURL already has it)
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;

    return `${this.baseURL}/${cleanEndpoint}`;
  }

  /**
   * Prepare request options with auth, timeout, and headers
   *
   * PHASE 4 FIX (2025-11-30): Always send Authorization header
   * Cross-origin cookies are unreliable due to SameSite/Domain restrictions.
   * Authorization header is the most reliable auth method for cross-origin requests.
   */
  async prepareRequest(options = {}) {
    const {
      headers = {},
      timeout = this.defaultTimeout,
      includeAuth = true,
      signal,
      ...restOptions
    } = options;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Merge headers
    // FIX: Don't set Content-Type for FormData - browser must set it with multipart boundary
    // This fixes "Content-Type was not one of 'multipart/form-data'" error for avatar uploads
    const isFormData = restOptions.body instanceof FormData;
    const finalHeaders = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...this.defaultHeaders,
      ...headers,
    };

    // FIX 2025-12-03: Always inject Authorization header if we have a session
    // With persistSession: false, getSession() returns null unless we refresh from cookies first
    // ensureValidSession() fetches session from auth-session endpoint and sets it in the client
    // CRITICAL HOTFIX: Actually check the result from ensureValidSession and handle failures
    let sessionValidationFailed = false;
    let sessionErrorCode = null;

    if (includeAuth && !finalHeaders['Authorization']) {
      try {
        // CRITICAL: Must call ensureValidSession() first to populate the client session
        // from HttpOnly cookies (Phase 3 Cookie-Only Auth has persistSession: false)
        // FIX 2025-12-06: Add logging to track pre-request session validation
        console.log('[APIClient] Starting session validation...');
        let sessionResult = await ensureValidSession();
        console.log('[APIClient] Session validation result:', {
          valid: sessionResult?.valid,
          code: sessionResult?.code,
          hasError: !!sessionResult?.error
        });

        // FIX 2025-12-03: HARD STOP on session errors - don't proceed with API calls
        // This prevents cascading 500 errors and misleading "AI providers unavailable" messages
        // P1 FIX 2025-12-04: Add single retry for TRANSIENT session errors before hard-stopping
        if (sessionResult && !sessionResult.valid) {
          // Truly fatal codes - no retry, fail immediately
          const isFatalSessionError = [
            'SESSION_INVALID',
            'SESSION_ROTATED'
          ].includes(sessionResult.code);

          // Potentially transient codes - retry once before giving up
          const isTransientSessionError = [
            'NO_SESSION',
            'REFRESH_ERROR'
          ].includes(sessionResult.code);

          if (isFatalSessionError) {
            console.warn('[APIClient] FATAL SESSION ERROR - stopping API call:', sessionResult.code);

            // Sign out and redirect to login
            setTimeout(() => handleSessionInvalid(), 0);

            const sessionError = new Error('Your session has expired. Please sign in again.');
            sessionError.code = 'SESSION_ERROR';
            sessionError.status = 401;
            sessionError.userMessage = 'Your session has expired. Please sign in again.';
            throw sessionError;
          }

          // P0 FIX 2025-12-08: ALL session validation failures are now fatal
          // Previously, 'THROTTLED' and other unexpected codes would fall through
          // and allow requests to proceed with stale/no session, causing 500 errors
          //
          // The only exception is transient errors which get ONE retry
          if (isTransientSessionError) {
            // P1 FIX: Single retry for transient errors (network glitch, race condition)
            console.warn('[APIClient] Transient session error, retrying once:', sessionResult.code);

            // Brief delay before retry (500ms)
            await new Promise(resolve => setTimeout(resolve, 500));

            sessionResult = await ensureValidSession();

            // If still invalid after retry, treat as fatal
            if (sessionResult && !sessionResult.valid) {
              console.warn('[APIClient] Session still invalid after retry - stopping API call:', sessionResult.code);

              setTimeout(() => handleSessionInvalid(), 0);

              const sessionError = new Error('Your session has expired. Please sign in again.');
              sessionError.code = 'SESSION_ERROR';
              sessionError.status = 401;
              sessionError.userMessage = 'Your session has expired. Please sign in again.';
              throw sessionError;
            }
            // If retry succeeded, continue normally
            console.warn('[APIClient] Session retry succeeded');
          } else {
            // P0 FIX 2025-12-08: ALL other validation failures (THROTTLED, INTERNAL_ERROR, etc.)
            // must ALSO fail immediately - do NOT proceed with stale session
            // This was the root cause of 500 errors: requests proceeded with invalid tokens
            console.error('[APIClient] Session validation failed with code:', sessionResult.code, '- stopping API call');

            // Don't redirect to login for throttle errors - user is still authenticated
            // but we can't validate the session right now
            const isThrottled = sessionResult.code === 'THROTTLED';

            if (!isThrottled) {
              setTimeout(() => handleSessionInvalid(), 0);
            }

            const sessionError = new Error(
              isThrottled
                ? 'Too many requests. Please wait a moment and try again.'
                : 'Your session has expired. Please sign in again.'
            );
            sessionError.code = isThrottled ? 'RATE_LIMITED' : 'SESSION_ERROR';
            sessionError.status = isThrottled ? 429 : 401;
            sessionError.userMessage = sessionError.message;
            throw sessionError;
          }
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          finalHeaders['Authorization'] = `Bearer ${session.access_token}`;
          if (import.meta.env.DEV) {
            console.debug('[APIClient] Injected Authorization header');
          }
        } else {
          // FIX 2025-12-03: No session after validation passed means hard failure
          console.error('[APIClient] No session available after ensureValidSession succeeded - treating as SESSION_ERROR');

          setTimeout(() => handleSessionInvalid(), 0);

          const sessionError = new Error('Your session has expired. Please sign in again.');
          sessionError.code = 'SESSION_ERROR';
          sessionError.status = 401;
          sessionError.userMessage = 'Your session has expired. Please sign in again.';
          throw sessionError;
        }
      } catch (authError) {
        // FIX 2025-12-03: If it's already a SESSION_ERROR, re-throw it
        if (authError.code === 'SESSION_ERROR') {
          throw authError;
        }

        // For other auth errors, treat as session failure
        console.error('[APIClient] Auth error during session validation:', authError.message);

        setTimeout(() => handleSessionInvalid(), 0);

        const sessionError = new Error('Your session has expired. Please sign in again.');
        sessionError.code = 'SESSION_ERROR';
        sessionError.status = 401;
        sessionError.userMessage = 'Your session has expired. Please sign in again.';
        throw sessionError;
      }
    }

    return {
      ...restOptions,
      headers: finalHeaders,
      credentials: 'include', // Keep cookies as fallback
      signal: signal || controller.signal,
      _timeoutId: timeoutId, // Store for cleanup
      _controller: controller,
      // FIX 2025-12-03: Track session validation status for better error handling
      _sessionValidationFailed: sessionValidationFailed,
      _sessionErrorCode: sessionErrorCode,
    };
  }

  /**
   * Execute request with retry logic, error handling, and optional deduplication
   *
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @param {string} options.dedupeKey - Optional deduplication key (prevents concurrent duplicate requests)
   */
  async request(endpoint, options = {}) {
    const url = this.buildURL(endpoint);
    const { dedupeKey, ...requestOpts } = options;

    // NEXT-LEVEL: Deduplicate identical concurrent requests
    // If dedupeKey provided, reuse in-flight request instead of creating duplicate
    if (dedupeKey) {
      return requestDeduplicator.deduplicate(dedupeKey, () => this._executeRequest(url, requestOpts));
    }

    return this._executeRequest(url, requestOpts);
  }

  /**
   * Internal method: Execute the actual request
   * @private
   */
  async _executeRequest(url, options = {}) {
    // Phase 1 Telemetry: Generate correlation ID for request tracing
    const correlationId = generateCorrelationId();
    const method = options.method || 'GET';
    const endpoint = url.replace(this.baseURL, ''); // Extract endpoint for logging
    const startTime = Date.now();

    // Set correlation ID in Sentry scope for this request
    setCorrelationId(correlationId);

    // Track request start (NO PII, only correlationId + endpoint + method)
    trackRequestStart(correlationId, endpoint, method);

    const requestOptions = await this.prepareRequest({
      ...options,
      headers: {
        ...options.headers,
        'X-Correlation-ID': correlationId,
        'X-Request-Start': String(startTime),
      },
    });

    // Extract cleanup items and session validation status
    // FIX 2025-12-03: Extract session validation flags for better error handling
    const {
      _timeoutId,
      _controller,
      _sessionValidationFailed,
      _sessionErrorCode,
      ...fetchOptions
    } = requestOptions;

    // NEXT-LEVEL: Use network-aware retry configuration
    // Automatically adjusts retry counts and delays based on connection quality
    const networkConfig = getNetworkAwareRetryConfig();
    const maxRetries = options.maxRetries !== undefined
      ? options.maxRetries
      : networkConfig.maxRetries;

    try {
      // Log request in development (with network quality)
      if (import.meta.env.DEV) {
        const quality = getCurrentNetworkQuality();
        console.debug(`[APIClient] ${method} ${url} [${correlationId}] (network: ${quality}, retries: ${maxRetries})`);
      }

      // Execute with network-aware retry logic
      const response = await fetchWithRetry(url, {
        ...fetchOptions,
        maxRetries,
        initialDelay: networkConfig.initialDelay,
        maxDelay: networkConfig.maxDelay,
      });

      // Clear timeout
      clearTimeout(_timeoutId);

      // Parse response
      const contentType = response.headers.get('content-type');
      let data;

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else if (contentType?.includes('text/')) {
        data = await response.text();
      } else {
        data = await response.blob();
      }

      // Phase 1 Telemetry: Track successful response (NO PII, only status + duration)
      const durationMs = Date.now() - startTime;
      trackRequestEnd(correlationId, endpoint, response.status, durationMs);

      // Log response in development
      if (import.meta.env.DEV) {
        console.debug(`[APIClient] Response from ${url} [${correlationId}]:`, { status: response.status, durationMs });
      }

      return { data, response, correlationId };

    } catch (error) {
      // Clear timeout
      clearTimeout(_timeoutId);

      // Calculate duration for failed request
      const durationMs = Date.now() - startTime;

      // Handle timeout errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${options.timeout || this.defaultTimeout}ms`);
        timeoutError.code = 'TIMEOUT';
        timeoutError.status = 408;
        timeoutError.correlationId = correlationId;

        // Track timeout as failed request
        trackRequestEnd(correlationId, endpoint, 408, durationMs);
        trackEvent('api_request_timeout', { correlationId, endpoint, method });

        throw timeoutError;
      }

      // Parse and enhance error
      const enhancedError = this.parseError(error, url);
      enhancedError.correlationId = correlationId;

      // FIX 2025-12-03: If session validation failed and we got an auth error, provide clearer error code
      // This helps the frontend distinguish "session expired" from "invalid credentials"
      if (_sessionValidationFailed && (enhancedError.status === 401 || enhancedError.status === 403)) {
        enhancedError.code = _sessionErrorCode || 'SESSION_ERROR';
        enhancedError.userMessage = 'Your session has expired. Please sign in again.';
        console.warn('[APIClient] Auth error with known session validation failure - marked as SESSION_ERROR');
      }

      // Phase 1 Telemetry: Track failed request (NO PII, only status + error code)
      trackRequestEnd(correlationId, endpoint, enhancedError.status || 0, durationMs);
      trackEvent('api_request_failed', {
        correlationId,
        endpoint,
        method,
        statusCode: enhancedError.status,
        errorCode: enhancedError.code,
      });

      // Log error (production-safe: no response bodies)
      console.error(`[APIClient] Request failed [${correlationId}]:`, {
        endpoint,
        method,
        status: enhancedError.status,
        code: enhancedError.code,
      });

      throw enhancedError;
    }
  }

  /**
   * Parse and enhance error with context
   */
  parseError(error, url) {
    // If it's already an enhanced error, return as-is
    if (error.isEnhanced) {
      return error;
    }

    const enhancedError = new Error(error.message || 'Request failed');
    enhancedError.originalError = error;
    enhancedError.url = url;
    enhancedError.status = error.status;
    enhancedError.code = error.code || 'UNKNOWN_ERROR';
    enhancedError.isEnhanced = true;

    // Add user-friendly message
    if (error.status >= 500) {
      enhancedError.userMessage = 'Server error. Please try again later.';
    } else if (error.status === 404) {
      enhancedError.userMessage = 'Resource not found.';
    } else if (error.status === 401 || error.status === 403) {
      enhancedError.userMessage = 'Authentication required. Please log in.';
    } else if (error.status === 429) {
      enhancedError.userMessage = 'Too many requests. Please wait a moment.';
    } else if (error.code === 'TIMEOUT') {
      enhancedError.userMessage = 'Request timed out. Please check your connection.';
    } else if (error.code === 'INVALID_JSON' || error.status === 400) {
      // FIX 2025-12-09: Show user-friendly message for validation errors
      enhancedError.userMessage = error.message || 'Invalid request. Please check your data.';
    } else {
      enhancedError.userMessage = error.message || 'An error occurred.';
    }

    return enhancedError;
  }

  /**
   * Convenience methods for common HTTP verbs
   */

  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'GET',
    });
  }

  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'DELETE',
    });
  }

  /**
   * Specialized methods for common operations
   */

  /**
   * AI Request with offline detection
   * Area 3 - Offline Mode: AI requests fail immediately when offline
   * (AI cannot be queued - it requires real-time server processing)
   */
  async aiRequest(endpoint, data, options = {}) {
    // Check offline status BEFORE attempting request
    // AI requests cannot be queued - they need real-time server processing
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineError = new Error('You\'re currently offline. Try again when your connection is back.');
      offlineError.code = 'OFFLINE';
      offlineError.status = 0;
      offlineError.isOffline = true;
      offlineError.userMessage = 'You\'re currently offline. Try again when your connection is back.';
      offlineError.retryable = true;

      // Log for observability
      console.warn('[APIClient] AI request blocked - offline', { endpoint });

      throw offlineError;
    }

    return this.post(endpoint, data, {
      ...options,
      timeout: options.timeout || DEFAULT_TIMEOUTS.ai,
    });
  }

  async paymentRequest(endpoint, data, options = {}) {
    return this.post(endpoint, data, {
      ...options,
      timeout: options.timeout || DEFAULT_TIMEOUTS.payment,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 1, // Be cautious with payments
    });
  }

  async uploadRequest(endpoint, formData, options = {}) {
    // Don't set Content-Type for FormData (browser will set with boundary)
    const headers = { ...options.headers };
    delete headers['Content-Type'];

    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
      headers,
      timeout: options.timeout || DEFAULT_TIMEOUTS.upload,
    });
  }

  /**
   * P0 FIX 2025-12-08: Deal Request with Invariant Validation
   *
   * This method is specifically for deal CRUD operations (create, update, delete).
   * It enforces invariants to prevent false success conditions:
   * - Response MUST have success: true/false
   * - If success: true, deal object MUST be present and valid
   * - If success: false, error and code MUST be present
   *
   * @param {string} endpoint - API endpoint (e.g., 'update-deal', 'create-deal')
   * @param {object} data - Request payload
   * @param {object} options - Request options
   * @returns {Promise<{data: object, response: Response, correlationId: string}>}
   */
  async dealRequest(endpoint, data, options = {}) {
    const result = await this.post(endpoint, data, options);

    // P0 FIX: Validate response using invariant module
    // This ensures we NEVER return success: true without a valid deal
    const normalizedData = normalizeDealResponse(result.data, `dealRequest:${endpoint}`);

    // Track invalid responses for monitoring
    if (result.data?.success === true && !isValidSuccessResponse(result.data)) {
      console.error('[APIClient] INVARIANT VIOLATION: success:true without valid deal', {
        endpoint,
        responseKeys: Object.keys(result.data || {}),
        hasDeal: !!result.data?.deal
      });

      // Track this as a telemetry event
      trackEvent('invariant_violation', {
        endpoint,
        type: 'false_success',
        hasSuccess: result.data?.success,
        hasDeal: !!result.data?.deal
      });
    }

    return {
      ...result,
      data: normalizedData
    };
  }
}

/**
 * Singleton instance for application-wide use
 */
export const apiClient = new APIClient();

/**
 * Export convenience functions for direct use
 */
export const api = {
  get: (endpoint, options) => apiClient.get(endpoint, options),
  post: (endpoint, data, options) => apiClient.post(endpoint, data, options),
  put: (endpoint, data, options) => apiClient.put(endpoint, data, options),
  patch: (endpoint, data, options) => apiClient.patch(endpoint, data, options),
  delete: (endpoint, options) => apiClient.delete(endpoint, options),

  // Specialized methods
  ai: (endpoint, data, options) => apiClient.aiRequest(endpoint, data, options),
  payment: (endpoint, data, options) => apiClient.paymentRequest(endpoint, data, options),
  upload: (endpoint, formData, options) => apiClient.uploadRequest(endpoint, formData, options),

  // P0 FIX 2025-12-08: Deal operations with invariant validation
  deal: (endpoint, data, options) => apiClient.dealRequest(endpoint, data, options),
};

export default apiClient;
