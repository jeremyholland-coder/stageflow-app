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
import { supabase, ensureValidSession } from './supabase';
import { parseSupabaseError } from './error-handler';
import { requestDeduplicator } from './request-deduplicator';
import { getNetworkAwareRetryConfig, getCurrentNetworkQuality } from './network-quality';

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
        const sessionResult = await ensureValidSession();

        // FIX 2025-12-03: Check if session is valid before proceeding
        // Track session validation status for better error handling downstream
        if (sessionResult && !sessionResult.valid) {
          sessionValidationFailed = true;
          sessionErrorCode = sessionResult.code;
          console.warn('[APIClient] Session invalid:', sessionResult.error, sessionResult.code);
          // If session is invalid but not retryable, log warning but continue
          // The request might still work with cookies as fallback
          // But if the code indicates session was rotated, we should signal this
          if (sessionResult.code === 'SESSION_ROTATED' || sessionResult.code === 'SESSION_INVALID') {
            console.warn('[APIClient] Session expired/rotated - request may fail. User may need to refresh page.');
          }
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          finalHeaders['Authorization'] = `Bearer ${session.access_token}`;
          if (import.meta.env.DEV) {
            console.debug('[APIClient] Injected Authorization header');
          }
        } else {
          // FIX 2025-12-03: More specific warning about missing session
          console.warn('[APIClient] No session available for Authorization header. Session result:', {
            valid: sessionResult?.valid,
            error: sessionResult?.error,
            code: sessionResult?.code
          });
          // Cookies will be used as fallback, but this may fail for cross-origin requests
        }
      } catch (authError) {
        // Log but don't fail - cookies might still work as fallback
        sessionValidationFailed = true;
        sessionErrorCode = 'SESSION_ERROR';
        console.warn('[APIClient] Failed to get session for Authorization header:', authError.message);
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
    const requestOptions = await this.prepareRequest(options);

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
        console.debug(`[APIClient] ${fetchOptions.method || 'GET'} ${url} (network: ${quality}, retries: ${maxRetries})`);
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

      // Log response in development
      if (import.meta.env.DEV) {
        console.debug(`[APIClient] Response from ${url}:`, data);
      }

      return { data, response };

    } catch (error) {
      // Clear timeout
      clearTimeout(_timeoutId);

      // Handle timeout errors
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${options.timeout || this.defaultTimeout}ms`);
        timeoutError.code = 'TIMEOUT';
        timeoutError.status = 408;
        throw timeoutError;
      }

      // Parse and enhance error
      const enhancedError = this.parseError(error, url);

      // FIX 2025-12-03: If session validation failed and we got an auth error, provide clearer error code
      // This helps the frontend distinguish "session expired" from "invalid credentials"
      if (_sessionValidationFailed && (enhancedError.status === 401 || enhancedError.status === 403)) {
        enhancedError.code = _sessionErrorCode || 'SESSION_ERROR';
        enhancedError.userMessage = 'Your session has expired. Please sign in again.';
        console.warn('[APIClient] Auth error with known session validation failure - marked as SESSION_ERROR');
      }

      // Log error
      console.error(`[APIClient] Request failed for ${url}:`, enhancedError);

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

  async aiRequest(endpoint, data, options = {}) {
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
};

export default apiClient;
