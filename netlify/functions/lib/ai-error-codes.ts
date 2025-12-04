/**
 * AI ERROR CODES
 *
 * M3 HARDENING 2025-12-04: Standardized error contract for all AI endpoints
 *
 * This file defines the canonical error codes used by:
 * - ai-assistant.mts
 * - ai-assistant-stream.mts
 * - ai-insights.mts
 *
 * Frontend getErrorGuidance() branches on these codes instead of string-matching messages.
 *
 * @author StageFlow Engineering
 */

/**
 * Standard AI error codes
 * These codes should be used in the `code` field of all AI error responses
 */
export const AI_ERROR_CODES = {
  // Provider configuration errors
  NO_PROVIDERS: 'NO_PROVIDERS',                     // No AI providers configured for this org
  PROVIDER_FETCH_ERROR: 'PROVIDER_FETCH_ERROR',     // Failed to load provider configuration from DB
  ALL_PROVIDERS_FAILED: 'ALL_PROVIDERS_FAILED',     // All connected providers returned errors

  // Authentication/session errors
  SESSION_ERROR: 'SESSION_ERROR',                   // User session expired or invalid
  AUTH_REQUIRED: 'AUTH_REQUIRED',                   // No authentication provided

  // Usage limit errors
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',             // Monthly AI request limit exceeded

  // Provider-specific errors
  PROVIDER_SOFT_FAILURE: 'PROVIDER_SOFT_FAILURE',   // Provider returned 200 but with error message content
  INVALID_API_KEY: 'INVALID_API_KEY',               // Provider rejected API key
  RATE_LIMITED: 'RATE_LIMITED',                     // Provider rate limit hit (429)
  PROVIDER_ERROR: 'PROVIDER_ERROR',                 // Generic provider error
  TIMEOUT: 'TIMEOUT',                               // Request timed out
  KEY_DECRYPT_FAILED: 'KEY_DECRYPT_FAILED',         // Failed to decrypt stored API key
} as const;

export type AIErrorCode = typeof AI_ERROR_CODES[keyof typeof AI_ERROR_CODES];

/**
 * Standard AI error response shape
 * All AI endpoints should return errors in this format
 */
export interface AIErrorResponse {
  // Required fields
  code: AIErrorCode;
  message: string;

  // Optional fields
  error?: string;                                    // Legacy field for backwards compatibility
  provider?: 'openai' | 'anthropic' | 'google';     // Which provider caused the error
  isSoftFailure?: boolean;                          // True if provider returned 200 but error content
  used?: number;                                    // For AI_LIMIT_REACHED: requests used
  limit?: number;                                   // For AI_LIMIT_REACHED: request limit
  providersAttempted?: string[];                    // For ALL_PROVIDERS_FAILED: which providers were tried
  errors?: Array<{                                  // For ALL_PROVIDERS_FAILED: per-provider errors
    provider: string;
    errorType: string;
    message?: string;
  }>;
}

/**
 * Create a standardized AI error response
 *
 * @param code - One of AI_ERROR_CODES
 * @param message - Human-readable error message
 * @param extras - Additional fields (provider, isSoftFailure, etc.)
 * @returns AIErrorResponse object
 */
export function createAIErrorResponse(
  code: AIErrorCode,
  message: string,
  extras?: Partial<Omit<AIErrorResponse, 'code' | 'message'>>
): AIErrorResponse {
  return {
    code,
    message,
    error: code, // Legacy field for backwards compatibility
    ...extras
  };
}

/**
 * Map HTTP status code to appropriate AI error code
 */
export function getErrorCodeFromStatus(status: number, errorMessage?: string): AIErrorCode {
  if (status === 401 || status === 403) {
    // Check if it's an auth error or an API key error
    if (errorMessage?.toLowerCase().includes('api key')) {
      return AI_ERROR_CODES.INVALID_API_KEY;
    }
    return AI_ERROR_CODES.SESSION_ERROR;
  }
  if (status === 429) {
    return AI_ERROR_CODES.RATE_LIMITED;
  }
  if (status === 504 || errorMessage?.toLowerCase().includes('timeout')) {
    return AI_ERROR_CODES.TIMEOUT;
  }
  return AI_ERROR_CODES.PROVIDER_ERROR;
}

export default {
  AI_ERROR_CODES,
  createAIErrorResponse,
  getErrorCodeFromStatus
};
