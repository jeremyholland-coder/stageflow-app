/**
 * AI SPINE - Backend Mirror
 *
 * Backend-compatible version of src/domain/ai.ts for Netlify functions.
 * This mirrors the frontend AI domain spine for consistent error handling.
 *
 * @module lib/ai-spine
 * @since Engine Rebuild Phase 5
 */

// =============================================================================
// TYPES
// =============================================================================

export type AIProviderStatus = 'OK' | 'DEGRADED' | 'DOWN' | 'MISCONFIGURED' | 'UNKNOWN';

export type AIErrorCode =
  | 'PROVIDER_DOWN'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'MISCONFIGURED'
  | 'INVALID_API_KEY'
  | 'ENCRYPTION_FAILED'
  | 'SESSION_INVALID'
  | 'NO_PROVIDERS'
  | 'ALL_PROVIDERS_FAILED'
  | 'INVALID_RESPONSE'
  | 'EMPTY_RESPONSE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface AIErrorInfo {
  code: AIErrorCode;
  message: string;
  provider?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  dashboardUrl?: string;
}

export interface NormalizedAIResponse {
  content: string;
  provider: string;
  timestamp: string;
  meta?: {
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
}

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

const PROVIDER_DASHBOARDS: Record<string, string> = {
  openai: 'https://platform.openai.com/usage',
  anthropic: 'https://console.anthropic.com/settings/plans',
  google: 'https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas',
};

/**
 * Classify a raw error into a normalized AIErrorInfo.
 */
export function classifyAIError(err: unknown, provider?: string): AIErrorInfo {
  if (!err) {
    return {
      code: 'UNKNOWN',
      message: 'An unknown error occurred. Please try again.',
      retryable: true,
    };
  }

  const error = err as Record<string, unknown>;
  const message = String(error.message || error.error || '').toLowerCase();
  const status = Number(error.status || error.statusCode || 0);
  const code = String(error.code || '');

  // Encryption/decryption errors → MISCONFIGURED
  if (message.includes('decrypt') || message.includes('encryption') ||
      message.includes('invalid key') || code === 'ERR_OSSL_EVP_BAD_DECRYPT') {
    return {
      code: 'ENCRYPTION_FAILED',
      message: 'AI provider configuration is invalid. Please re-enter your API key in Settings.',
      provider,
      retryable: false,
      dashboardUrl: provider ? PROVIDER_DASHBOARDS[provider] : undefined,
    };
  }

  // Invalid API key
  if (status === 401 || message.includes('invalid api key') ||
      message.includes('incorrect api key') || message.includes('authentication')) {
    return {
      code: 'INVALID_API_KEY',
      message: 'Your AI provider API key is invalid or expired. Please update it in Settings.',
      provider,
      retryable: false,
      dashboardUrl: provider ? PROVIDER_DASHBOARDS[provider] : undefined,
    };
  }

  // Rate limited
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'AI provider rate limit reached. Please wait a moment and try again.',
      provider,
      retryable: true,
      retryAfterSeconds: 60,
      dashboardUrl: provider ? PROVIDER_DASHBOARDS[provider] : undefined,
    };
  }

  // Quota exceeded (billing)
  if (message.includes('quota') || message.includes('billing') ||
      message.includes('exceeded') || message.includes('insufficient_quota')) {
    return {
      code: 'PROVIDER_QUOTA_EXCEEDED',
      message: 'AI provider quota exceeded. Check your billing and usage limits.',
      provider,
      retryable: false,
      dashboardUrl: provider ? PROVIDER_DASHBOARDS[provider] : undefined,
    };
  }

  // Timeout
  if (message.includes('timeout') || message.includes('timed out') ||
      code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return {
      code: 'PROVIDER_TIMEOUT',
      message: 'AI provider is taking too long to respond. Please try again.',
      provider,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  // Network error
  if (message.includes('network') || message.includes('fetch') ||
      message.includes('econnrefused') || message.includes('enotfound') ||
      code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      code: 'NETWORK_ERROR',
      message: 'Unable to reach AI provider. Check your connection and try again.',
      provider,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  // Provider down (5xx errors)
  if (status >= 500 && status < 600) {
    return {
      code: 'PROVIDER_DOWN',
      message: 'AI provider is temporarily unavailable. Please try again in a few moments.',
      provider,
      retryable: true,
      retryAfterSeconds: 30,
    };
  }

  // Session/auth errors
  if (message.includes('session') || message.includes('unauthorized') ||
      message.includes('not authenticated') || status === 403) {
    return {
      code: 'SESSION_INVALID',
      message: 'Your session has expired. Please refresh the page.',
      retryable: false,
    };
  }

  // No providers configured
  if (message.includes('no provider') || message.includes('no ai provider') ||
      code === 'NO_PROVIDERS') {
    return {
      code: 'NO_PROVIDERS',
      message: 'No AI provider is connected. Go to Settings → AI Providers to connect one.',
      retryable: false,
    };
  }

  // All providers failed
  if (code === 'ALL_PROVIDERS_FAILED' || message.includes('all providers failed')) {
    return {
      code: 'ALL_PROVIDERS_FAILED',
      message: 'All AI providers failed. Please check your API keys in Settings.',
      provider,
      retryable: true,
      retryAfterSeconds: 30,
    };
  }

  // Default: unknown error
  return {
    code: 'UNKNOWN',
    message: 'AI request failed. Please try again.',
    provider,
    retryable: true,
    retryAfterSeconds: 5,
  };
}

// =============================================================================
// RESPONSE NORMALIZATION
// =============================================================================

/**
 * Normalize a raw AI response into a clean, renderable format.
 * Returns null if response is invalid or empty.
 */
export function normalizeAIResponse(raw: unknown, provider?: string): NormalizedAIResponse | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  // Try to extract content from various response formats
  let content: string | null = null;

  // Standard response format: { response: "..." }
  if (typeof obj.response === 'string') {
    content = obj.response;
  }
  // OpenAI format: { choices: [{ message: { content: "..." } }] }
  else if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    content = String(obj.choices[0].message.content);
  }
  // Anthropic format: { content: [{ text: "..." }] }
  else if (Array.isArray(obj.content) && obj.content[0]?.text) {
    content = String(obj.content[0].text);
  }
  // Direct content: { content: "..." }
  else if (typeof obj.content === 'string') {
    content = obj.content;
  }
  // Text field: { text: "..." }
  else if (typeof obj.text === 'string') {
    content = obj.text;
  }

  // Validate content - must be non-empty string
  if (!content || typeof content !== 'string') return null;
  content = content.trim();
  if (content.length === 0) return null;

  return {
    content,
    provider: String(obj.provider || provider || 'Unknown'),
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
    meta: {
      model: typeof obj.model === 'string' ? obj.model : undefined,
      tokensUsed: typeof obj.usage?.total_tokens === 'number' ? obj.usage.total_tokens : undefined,
    },
  };
}

/**
 * Check if an AI response indicates an error condition.
 */
export function isAIErrorResponse(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const obj = raw as Record<string, unknown>;
  if (obj.ok === false) return true;
  if (obj.error) return true;
  if (obj.code && typeof obj.code === 'string' && obj.code.includes('ERROR')) return true;
  return false;
}

/**
 * Build a normalized error response for the frontend.
 */
export function buildAIErrorResponse(
  errorInfo: AIErrorInfo,
  corsHeaders: Record<string, string>
): Response {
  const status = errorInfo.code === 'SESSION_INVALID' ? 401 :
                 errorInfo.code === 'INVALID_API_KEY' || errorInfo.code === 'MISCONFIGURED' ? 400 :
                 errorInfo.code === 'NO_PROVIDERS' ? 404 :
                 errorInfo.retryable ? 503 : 500;

  return new Response(
    JSON.stringify({
      ok: false,
      error: errorInfo,
      response: errorInfo.message, // Fallback for legacy consumers
      suggestions: [],
    }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

/**
 * Build a normalized success response for the frontend.
 */
export function buildAISuccessResponse(
  normalized: NormalizedAIResponse,
  additionalData: Record<string, unknown>,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      response: normalized.content,
      provider: normalized.provider,
      timestamp: normalized.timestamp,
      meta: normalized.meta,
      ...additionalData,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

export default {
  classifyAIError,
  normalizeAIResponse,
  isAIErrorResponse,
  buildAIErrorResponse,
  buildAISuccessResponse,
};
