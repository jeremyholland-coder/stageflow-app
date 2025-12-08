/**
 * PROVIDER ERROR CLASSIFIER
 *
 * Phase 1: Structured classification of AI provider errors
 *
 * This module provides fine-grained error classification for each AI provider,
 * extracting actionable information like error codes and dashboard URLs.
 *
 * Used by ai-assistant.mts and ai-assistant-stream.mts to provide
 * user-friendly error messages with direct links to fix the issues.
 *
 * @author StageFlow Engineering
 * @since 2025-12-04
 */

/**
 * Standardized provider error codes
 */
export type ProviderErrorCode =
  | 'INSUFFICIENT_QUOTA'
  | 'BILLING_REQUIRED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'AUTH_ERROR'
  | 'INVALID_KEY'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CONTENT_POLICY'
  | 'CONTEXT_LENGTH'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN';

/**
 * Provider types supported
 */
export type ProviderType = 'openai' | 'anthropic' | 'google';

/**
 * Classified provider error with actionable information
 */
export interface ClassifiedProviderError {
  provider: ProviderType;
  httpStatus: number | null;
  rawMessage: string;
  code: ProviderErrorCode;
  userMessage: string;
  providerDashboardUrl: string | null;
}

/**
 * Provider dashboard URLs for billing/configuration
 */
const PROVIDER_DASHBOARD_URLS: Record<ProviderType, Record<string, string>> = {
  openai: {
    billing: 'https://platform.openai.com/account/billing/overview',
    apiKeys: 'https://platform.openai.com/api-keys',
    usage: 'https://platform.openai.com/usage',
    models: 'https://platform.openai.com/docs/models'
  },
  anthropic: {
    billing: 'https://console.anthropic.com/settings/plans',
    apiKeys: 'https://console.anthropic.com/settings/keys',
    usage: 'https://console.anthropic.com/settings/usage'
  },
  google: {
    billing: 'https://aistudio.google.com/app/plan',
    apiKeys: 'https://aistudio.google.com/app/apikey',
    models: 'https://ai.google.dev/gemini-api/docs/models/gemini'
  }
};

/**
 * User-friendly messages for each error code
 */
const ERROR_MESSAGES: Record<ProviderErrorCode, Record<ProviderType, string>> = {
  INSUFFICIENT_QUOTA: {
    openai: 'Your OpenAI project has exceeded its quota or credits.',
    anthropic: 'Your Anthropic API credits are exhausted.',
    google: 'Your Google AI quota has been exceeded.'
  },
  BILLING_REQUIRED: {
    openai: 'OpenAI billing setup required. Add a payment method to continue.',
    anthropic: 'Your Anthropic credit balance is too low to access the API.',
    google: 'Google AI billing setup required.'
  },
  MODEL_NOT_FOUND: {
    openai: 'The configured OpenAI model is not available or deprecated.',
    anthropic: 'The configured Claude model is not available.',
    google: 'The configured Gemini model is not valid for the current API version.'
  },
  RATE_LIMIT: {
    openai: 'OpenAI rate limit reached. Please wait a moment.',
    anthropic: 'Anthropic rate limit reached. Please wait a moment.',
    google: 'Google AI rate limit reached. Please wait a moment.'
  },
  AUTH_ERROR: {
    openai: 'OpenAI authentication failed. Your API key may be invalid.',
    anthropic: 'Anthropic authentication failed. Your API key may be invalid.',
    google: 'Google AI authentication failed. Your API key may be invalid.'
  },
  INVALID_KEY: {
    openai: 'Your OpenAI API key is invalid or has been revoked.',
    anthropic: 'Your Anthropic API key is invalid or has been revoked.',
    google: 'Your Google AI API key is invalid or has been revoked.'
  },
  NETWORK_ERROR: {
    openai: 'Failed to connect to OpenAI. Please check your connection.',
    anthropic: 'Failed to connect to Anthropic. Please check your connection.',
    google: 'Failed to connect to Google AI. Please check your connection.'
  },
  TIMEOUT: {
    openai: 'OpenAI request timed out. Please try again.',
    anthropic: 'Anthropic request timed out. Please try again.',
    google: 'Google AI request timed out. Please try again.'
  },
  CONTENT_POLICY: {
    openai: 'Your request was rejected by OpenAI content policy.',
    anthropic: 'Your request was rejected by Anthropic content policy.',
    google: 'Your request was rejected by Google AI safety filters.'
  },
  CONTEXT_LENGTH: {
    openai: 'Message too long for OpenAI model context.',
    anthropic: 'Message too long for Claude model context.',
    google: 'Message too long for Gemini model context.'
  },
  SERVICE_UNAVAILABLE: {
    openai: 'OpenAI service is temporarily unavailable.',
    anthropic: 'Anthropic service is temporarily unavailable.',
    google: 'Google AI service is temporarily unavailable.'
  },
  UNKNOWN: {
    openai: 'An unexpected OpenAI error occurred.',
    anthropic: 'An unexpected Anthropic error occurred.',
    google: 'An unexpected Google AI error occurred.'
  }
};

/**
 * Classify an OpenAI error
 */
function classifyOpenAIError(httpStatus: number | null, errorBody: string): { code: ProviderErrorCode; dashboardUrl: string | null } {
  const lowerBody = errorBody.toLowerCase();

  // HTTP 429 with insufficient_quota
  if (httpStatus === 429) {
    if (lowerBody.includes('insufficient_quota') || lowerBody.includes('exceeded your current quota')) {
      return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.billing };
    }
    if (lowerBody.includes('rate_limit_exceeded') || lowerBody.includes('rate limit')) {
      return { code: 'RATE_LIMIT', dashboardUrl: null };
    }
    // Default 429 to rate limit
    return { code: 'RATE_LIMIT', dashboardUrl: null };
  }

  // HTTP 401/403 - Auth errors
  if (httpStatus === 401 || httpStatus === 403) {
    if (lowerBody.includes('invalid_api_key') || lowerBody.includes('invalid api key')) {
      return { code: 'INVALID_KEY', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.apiKeys };
    }
    return { code: 'AUTH_ERROR', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.apiKeys };
  }

  // HTTP 400 - Bad request (various reasons)
  if (httpStatus === 400) {
    if (lowerBody.includes('context_length') || lowerBody.includes('token') || lowerBody.includes('too long')) {
      return { code: 'CONTEXT_LENGTH', dashboardUrl: null };
    }
    if (lowerBody.includes('content_policy') || lowerBody.includes('content policy')) {
      return { code: 'CONTENT_POLICY', dashboardUrl: null };
    }
    if (lowerBody.includes('billing') || lowerBody.includes('payment')) {
      return { code: 'BILLING_REQUIRED', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.billing };
    }
  }

  // HTTP 404 - Model not found
  if (httpStatus === 404) {
    if (lowerBody.includes('model') || lowerBody.includes('not found')) {
      return { code: 'MODEL_NOT_FOUND', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.models };
    }
  }

  // HTTP 5xx - Service errors
  if (httpStatus && httpStatus >= 500) {
    return { code: 'SERVICE_UNAVAILABLE', dashboardUrl: null };
  }

  // Network/timeout patterns
  if (lowerBody.includes('timeout') || lowerBody.includes('timed out') || lowerBody.includes('etimedout')) {
    return { code: 'TIMEOUT', dashboardUrl: null };
  }
  if (lowerBody.includes('network') || lowerBody.includes('econnrefused') || lowerBody.includes('fetch')) {
    return { code: 'NETWORK_ERROR', dashboardUrl: null };
  }

  // Message-based classification (no HTTP status)
  if (lowerBody.includes('quota') || lowerBody.includes('insufficient')) {
    return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.billing };
  }
  if (lowerBody.includes('billing') || lowerBody.includes('payment')) {
    return { code: 'BILLING_REQUIRED', dashboardUrl: PROVIDER_DASHBOARD_URLS.openai.billing };
  }

  return { code: 'UNKNOWN', dashboardUrl: null };
}

/**
 * Classify an Anthropic error
 *
 * PHASE 11 2025-12-08: Added specific error type detection for:
 * - invalid_scope: API key lacks required permissions
 * - billing_quota_exceeded: Usage quota exceeded
 * - key_missing: No API key configured
 */
function classifyAnthropicError(httpStatus: number | null, errorBody: string): { code: ProviderErrorCode; dashboardUrl: string | null } {
  const lowerBody = errorBody.toLowerCase();

  // PHASE 11: Detect specific Anthropic error types (non-retryable billing/quota issues)
  // These should be surfaced to the user immediately, not retried
  if (lowerBody.includes('invalid_scope') || lowerBody.includes('invalid scope') || lowerBody.includes('permission')) {
    return { code: 'AUTH_ERROR', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.apiKeys };
  }
  if (lowerBody.includes('billing_quota_exceeded') || lowerBody.includes('quota exceeded') || lowerBody.includes('billing quota')) {
    return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.billing };
  }
  if (lowerBody.includes('key_missing') || lowerBody.includes('api key is missing') || lowerBody.includes('no api key')) {
    return { code: 'INVALID_KEY', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.apiKeys };
  }

  // HTTP 400 with credit balance
  if (httpStatus === 400) {
    if (lowerBody.includes('credit balance is too low') || lowerBody.includes('credit balance')) {
      return { code: 'BILLING_REQUIRED', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.billing };
    }
    if (lowerBody.includes('context_length') || lowerBody.includes('too long') || lowerBody.includes('tokens')) {
      return { code: 'CONTEXT_LENGTH', dashboardUrl: null };
    }
    if (lowerBody.includes('content') && lowerBody.includes('policy')) {
      return { code: 'CONTENT_POLICY', dashboardUrl: null };
    }
  }

  // HTTP 429 - Rate limit
  if (httpStatus === 429) {
    if (lowerBody.includes('quota') || lowerBody.includes('credit')) {
      return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.billing };
    }
    return { code: 'RATE_LIMIT', dashboardUrl: null };
  }

  // HTTP 401/403 - Auth errors
  if (httpStatus === 401 || httpStatus === 403) {
    if (lowerBody.includes('invalid') && lowerBody.includes('key')) {
      return { code: 'INVALID_KEY', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.apiKeys };
    }
    return { code: 'AUTH_ERROR', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.apiKeys };
  }

  // HTTP 404 - Model not found
  if (httpStatus === 404) {
    return { code: 'MODEL_NOT_FOUND', dashboardUrl: null };
  }

  // HTTP 5xx - Service errors
  if (httpStatus && httpStatus >= 500) {
    if (lowerBody.includes('overloaded') || lowerBody.includes('capacity')) {
      return { code: 'SERVICE_UNAVAILABLE', dashboardUrl: null };
    }
    return { code: 'SERVICE_UNAVAILABLE', dashboardUrl: null };
  }

  // Network/timeout patterns
  if (lowerBody.includes('timeout') || lowerBody.includes('timed out')) {
    return { code: 'TIMEOUT', dashboardUrl: null };
  }
  if (lowerBody.includes('network') || lowerBody.includes('econnrefused')) {
    return { code: 'NETWORK_ERROR', dashboardUrl: null };
  }

  // Message-based classification
  if (lowerBody.includes('credit') || lowerBody.includes('balance')) {
    return { code: 'BILLING_REQUIRED', dashboardUrl: PROVIDER_DASHBOARD_URLS.anthropic.billing };
  }

  return { code: 'UNKNOWN', dashboardUrl: null };
}

/**
 * Classify a Google/Gemini error
 */
function classifyGoogleError(httpStatus: number | null, errorBody: string): { code: ProviderErrorCode; dashboardUrl: string | null } {
  const lowerBody = errorBody.toLowerCase();

  // HTTP 404 with NOT_FOUND - Model configuration issue
  if (httpStatus === 404) {
    if (lowerBody.includes('not_found') || lowerBody.includes('not found') || lowerBody.includes('models/')) {
      return { code: 'MODEL_NOT_FOUND', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.models };
    }
  }

  // HTTP 400 - Bad request
  if (httpStatus === 400) {
    if (lowerBody.includes('api key not valid') || lowerBody.includes('api_key_invalid')) {
      return { code: 'INVALID_KEY', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.apiKeys };
    }
    if (lowerBody.includes('quota') || lowerBody.includes('billing')) {
      return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.billing };
    }
    if (lowerBody.includes('safety') || lowerBody.includes('blocked')) {
      return { code: 'CONTENT_POLICY', dashboardUrl: null };
    }
  }

  // HTTP 401/403 - Auth errors
  if (httpStatus === 401 || httpStatus === 403) {
    if (lowerBody.includes('api key') || lowerBody.includes('invalid')) {
      return { code: 'INVALID_KEY', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.apiKeys };
    }
    return { code: 'AUTH_ERROR', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.apiKeys };
  }

  // HTTP 429 - Rate limit / quota
  if (httpStatus === 429) {
    if (lowerBody.includes('quota') || lowerBody.includes('resource_exhausted')) {
      return { code: 'INSUFFICIENT_QUOTA', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.billing };
    }
    return { code: 'RATE_LIMIT', dashboardUrl: null };
  }

  // HTTP 5xx - Service errors
  if (httpStatus && httpStatus >= 500) {
    return { code: 'SERVICE_UNAVAILABLE', dashboardUrl: null };
  }

  // Network/timeout patterns
  if (lowerBody.includes('timeout') || lowerBody.includes('timed out')) {
    return { code: 'TIMEOUT', dashboardUrl: null };
  }
  if (lowerBody.includes('network') || lowerBody.includes('econnrefused')) {
    return { code: 'NETWORK_ERROR', dashboardUrl: null };
  }

  // Message-based classification for NOT_FOUND errors
  if (lowerBody.includes('not_found') || lowerBody.includes('does not exist')) {
    return { code: 'MODEL_NOT_FOUND', dashboardUrl: PROVIDER_DASHBOARD_URLS.google.models };
  }

  return { code: 'UNKNOWN', dashboardUrl: null };
}

/**
 * Classify a provider error into a structured format
 *
 * @param provider - The provider type (openai, anthropic, google)
 * @param httpStatus - HTTP status code (may be null)
 * @param errorMessage - Raw error message/body
 * @returns Classified error with actionable information
 */
export function classifyProviderError(
  provider: ProviderType | string,
  httpStatus: number | null,
  errorMessage: string
): ClassifiedProviderError {
  const normalizedProvider = provider as ProviderType;

  // Classify based on provider
  let classification: { code: ProviderErrorCode; dashboardUrl: string | null };

  switch (normalizedProvider) {
    case 'openai':
      classification = classifyOpenAIError(httpStatus, errorMessage);
      break;
    case 'anthropic':
      classification = classifyAnthropicError(httpStatus, errorMessage);
      break;
    case 'google':
      classification = classifyGoogleError(httpStatus, errorMessage);
      break;
    default:
      classification = { code: 'UNKNOWN', dashboardUrl: null };
  }

  // Get user-friendly message
  const userMessage = ERROR_MESSAGES[classification.code]?.[normalizedProvider] ||
                      `An error occurred with ${normalizedProvider}.`;

  return {
    provider: normalizedProvider,
    httpStatus,
    rawMessage: errorMessage.substring(0, 500), // Truncate for safety
    code: classification.code,
    userMessage,
    providerDashboardUrl: classification.dashboardUrl
  };
}

/**
 * Build a user-friendly summary from multiple classified errors
 * Prioritizes the most actionable errors first
 */
export function buildProviderErrorSummary(errors: ClassifiedProviderError[]): string {
  if (errors.length === 0) {
    return 'AI service temporarily unavailable. Please try again.';
  }

  // Priority order for error codes (most actionable first)
  const priorityOrder: ProviderErrorCode[] = [
    'BILLING_REQUIRED',
    'INSUFFICIENT_QUOTA',
    'INVALID_KEY',
    'AUTH_ERROR',
    'MODEL_NOT_FOUND',
    'RATE_LIMIT',
    'TIMEOUT',
    'SERVICE_UNAVAILABLE',
    'NETWORK_ERROR',
    'CONTENT_POLICY',
    'CONTEXT_LENGTH',
    'UNKNOWN'
  ];

  // Sort errors by priority
  const sortedErrors = [...errors].sort((a, b) => {
    const aIndex = priorityOrder.indexOf(a.code);
    const bIndex = priorityOrder.indexOf(b.code);
    return aIndex - bIndex;
  });

  // Return the highest priority error's message
  return sortedErrors[0].userMessage;
}

/**
 * Get provider dashboard URL for a specific error code
 */
export function getProviderDashboardUrl(provider: ProviderType, errorCode: ProviderErrorCode): string | null {
  const urls = PROVIDER_DASHBOARD_URLS[provider];
  if (!urls) return null;

  switch (errorCode) {
    case 'INSUFFICIENT_QUOTA':
    case 'BILLING_REQUIRED':
      return urls.billing;
    case 'INVALID_KEY':
    case 'AUTH_ERROR':
      return urls.apiKeys;
    case 'MODEL_NOT_FOUND':
      return urls.models || null;
    default:
      return null;
  }
}

export default {
  classifyProviderError,
  buildProviderErrorSummary,
  getProviderDashboardUrl,
  PROVIDER_DASHBOARD_URLS,
  ERROR_MESSAGES
};
