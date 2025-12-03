/**
 * AI Provider Fallback Chain
 *
 * Implements automatic failover between AI providers when one fails.
 *
 * NOTE: For task-aware provider SELECTION (not fallback), use lib/select-provider.ts
 * This file handles FALLBACK logic (what to do when a provider fails).
 * The canonical provider selection algorithm is in select-provider.ts.
 *
 * @author StageFlow Engineering
 */

// DEPRECATED: This constant is kept for backwards compatibility only.
// New code should use buildFallbackChain from lib/select-provider.ts
export const PROVIDER_FALLBACK_ORDER = ['openai', 'anthropic', 'google', 'xai'] as const;
export type ProviderType = typeof PROVIDER_FALLBACK_ORDER[number];

// Provider display names for logging/UI
export const PROVIDER_NAMES: Record<ProviderType, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok'
};

// Error types that should trigger fallback
export const FALLBACK_TRIGGERS = {
  // Network/infrastructure errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  // Provider API errors
  PROVIDER_5XX: 'PROVIDER_5XX',
  RATE_LIMIT: 'RATE_LIMIT',
  MODEL_OVERLOADED: 'MODEL_OVERLOADED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Key issues (skip provider immediately)
  INVALID_KEY: 'INVALID_KEY',
  NO_KEY: 'NO_KEY',
  KEY_EXPIRED: 'KEY_EXPIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

// Error types that should NOT trigger fallback
export const NO_FALLBACK_ERRORS = {
  // User validation errors
  PROMPT_TOO_LONG: 'PROMPT_TOO_LONG',
  INVALID_INPUT: 'INVALID_INPUT',
  CONTENT_POLICY: 'CONTENT_POLICY',
} as const;

export interface ProviderError {
  provider: ProviderType;
  errorType: string;
  message: string;
  statusCode?: number;
  timestamp: string;
}

export interface FallbackResult<T> {
  success: boolean;
  providerUsed?: ProviderType;
  result?: T;
  errors: ProviderError[];
}

/**
 * Extract HTTP status code from error message
 * FIX 2025-12-03: Better status code extraction for Anthropic/Google errors
 *
 * Patterns handled:
 * - "OpenAI API error: 429"
 * - "Anthropic API error: 401"
 * - "Gemini API error: 403"
 * - "Grok API error: 500"
 * - "Error: 429 Too Many Requests"
 * - HTTP status code in error.status or error.statusCode
 */
function extractStatusCode(error: any, providedStatusCode?: number): number | undefined {
  // Use provided status code first
  if (providedStatusCode) return providedStatusCode;

  // Check error object properties
  if (error?.status) return error.status;
  if (error?.statusCode) return error.statusCode;
  if (error?.response?.status) return error.response.status;

  // Extract from error message patterns
  const message = error?.message || '';

  // Pattern: "API error: 429" or "error: 401"
  const apiErrorMatch = message.match(/(?:api\s*)?error:\s*(\d{3})/i);
  if (apiErrorMatch) return parseInt(apiErrorMatch[1], 10);

  // Pattern: "status 429" or "status: 429"
  const statusMatch = message.match(/status[:\s]+(\d{3})/i);
  if (statusMatch) return parseInt(statusMatch[1], 10);

  // Pattern: "429 Too Many Requests" or "401 Unauthorized"
  const httpStatusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  if (httpStatusMatch) return parseInt(httpStatusMatch[1], 10);

  return undefined;
}

/**
 * Classify an error to determine if fallback should trigger
 * FIX 2025-12-03: Enhanced error classification for Anthropic & Google
 */
export function classifyError(error: any, statusCode?: number): { shouldFallback: boolean; errorType: string } {
  const message = error?.message?.toLowerCase() || '';

  // FIX 2025-12-03: Extract status code from error message if not provided
  const extractedStatusCode = extractStatusCode(error, statusCode);

  // Network errors - always fallback
  if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused') || message.includes('enotfound')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.NETWORK_ERROR };
  }

  // Timeout - always fallback
  if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.TIMEOUT };
  }

  // HTTP status-based classification (now using extracted status code)
  if (extractedStatusCode) {
    // 5xx server errors - fallback
    if (extractedStatusCode >= 500) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PROVIDER_5XX };
    }

    // 429 rate limit - fallback
    if (extractedStatusCode === 429) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.RATE_LIMIT };
    }

    // 401/403 - key issues, skip provider but continue to next
    if (extractedStatusCode === 401 || extractedStatusCode === 403) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PERMISSION_DENIED };
    }

    // 400 - usually user input issues, don't fallback (except for some cases)
    if (extractedStatusCode === 400) {
      if (message.includes('too long') || message.includes('token') || message.includes('context_length')) {
        return { shouldFallback: false, errorType: NO_FALLBACK_ERRORS.PROMPT_TOO_LONG };
      }
      if (message.includes('content') && message.includes('policy')) {
        return { shouldFallback: false, errorType: NO_FALLBACK_ERRORS.CONTENT_POLICY };
      }
      // FIX 2025-12-03: For other 400 errors, try fallback (could be provider-specific format issue)
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INTERNAL_ERROR };
    }
  }

  // Provider-specific error patterns (message-based)
  if (message.includes('rate limit') || message.includes('quota') || message.includes('too many requests')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.RATE_LIMIT };
  }

  if (message.includes('overloaded') || message.includes('capacity') || message.includes('busy')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.MODEL_OVERLOADED };
  }

  // FIX 2025-12-03: Anthropic-specific error patterns
  if (message.includes('invalid x-api-key') || message.includes('invalid api key') || message.includes('authentication')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  // FIX 2025-12-03: Google/Gemini-specific error patterns
  if (message.includes('api key not valid') || message.includes('api_key_invalid')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  if (message.includes('invalid') && message.includes('key')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  if (message.includes('decryption') || message.includes('decrypt')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  // FIX 2025-12-03: Permission/billing errors
  if (message.includes('permission denied') || message.includes('forbidden') || message.includes('not authorized')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PERMISSION_DENIED };
  }

  if (message.includes('billing') || message.includes('payment') || message.includes('insufficient')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PERMISSION_DENIED };
  }

  // Default: assume it's an infrastructure error, fallback
  return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INTERNAL_ERROR };
}

/**
 * Sort providers for fallback execution
 *
 * FIX 2025-12-02: Now respects CONNECTION ORDER (first connected = first tried)
 * Previously used hardcoded order (openai → anthropic → google → xai)
 * Now keeps providers in their original order from the database (sorted by created_at)
 *
 * @param providers - Providers array (should be pre-sorted by created_at ascending)
 * @param preferredProvider - Optional provider to try first (user's explicit choice)
 */
export function sortProvidersForFallback<T extends { provider_type: string }>(
  providers: T[],
  preferredProvider?: string
): T[] {
  // If no preferred provider, return providers in their original (connection) order
  if (!preferredProvider) {
    return [...providers];
  }

  // Find preferred provider
  const preferredIndex = providers.findIndex(p => p.provider_type === preferredProvider);

  // If not found, return original order
  if (preferredIndex === -1) {
    return [...providers];
  }

  // Move preferred provider to front, keep others in original order
  const sorted: T[] = [providers[preferredIndex]];
  for (let i = 0; i < providers.length; i++) {
    if (i !== preferredIndex) {
      sorted.push(providers[i]);
    }
  }

  return sorted;
}

/**
 * Log AI provider attempt (structured logging)
 */
export function logProviderAttempt(
  operation: string,
  provider: string,
  status: 'attempting' | 'success' | 'failed',
  error?: string
): void {
  const timestamp = new Date().toISOString();
  const logParts = [
    `AI_RUN`,
    operation,
    `provider=${provider}`,
    `status=${status}`
  ];

  if (error) {
    // Sanitize error message (no secrets, truncate)
    const sanitizedError = error
      .replace(/sk-[a-zA-Z0-9]+/g, 'sk-***')
      .replace(/Bearer [a-zA-Z0-9]+/g, 'Bearer ***')
      .slice(0, 100);
    logParts.push(`error=${sanitizedError}`);
  }

  console.log(`[${timestamp}] ${logParts.join(' ')}`);
}

/**
 * Custom error class for when all providers fail
 */
export class AllProvidersFailedError extends Error {
  public readonly errors: ProviderError[];
  public readonly providersAttempted: string[];

  constructor(errors: ProviderError[]) {
    const providerNames = errors.map(e => PROVIDER_NAMES[e.provider] || e.provider);
    super(`All AI providers failed: ${providerNames.join(', ')}`);
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
    this.providersAttempted = errors.map(e => e.provider);
  }
}

/**
 * Run an operation with automatic fallback through providers
 *
 * @param operation - Name of the operation (for logging)
 * @param providers - Array of provider objects with provider_type field
 * @param callProvider - Function that calls a specific provider
 * @param preferredProvider - Optional preferred provider to try first
 */
export async function runWithFallback<T, P extends { provider_type: string }>(
  operation: string,
  providers: P[],
  callProvider: (provider: P) => Promise<T>,
  preferredProvider?: string
): Promise<FallbackResult<T>> {
  const errors: ProviderError[] = [];

  // Sort providers into fallback order
  const sortedProviders = sortProvidersForFallback(providers, preferredProvider);

  if (sortedProviders.length === 0) {
    return {
      success: false,
      errors: [{
        provider: 'none' as ProviderType,
        errorType: FALLBACK_TRIGGERS.NO_KEY,
        message: 'No AI providers configured',
        timestamp: new Date().toISOString()
      }]
    };
  }

  for (const provider of sortedProviders) {
    const providerType = provider.provider_type as ProviderType;

    logProviderAttempt(operation, providerType, 'attempting');

    try {
      const result = await callProvider(provider);

      logProviderAttempt(operation, providerType, 'success');

      return {
        success: true,
        providerUsed: providerType,
        result,
        errors
      };

    } catch (error: any) {
      const statusCode = error?.status || error?.statusCode;
      const { shouldFallback, errorType } = classifyError(error, statusCode);

      const providerError: ProviderError = {
        provider: providerType,
        errorType,
        message: error?.message || 'Unknown error',
        statusCode,
        timestamp: new Date().toISOString()
      };

      errors.push(providerError);
      logProviderAttempt(operation, providerType, 'failed', errorType);

      // If this is a user error (not provider error), don't fallback
      if (!shouldFallback) {
        console.log(`[ai-fallback] Not falling back - user error: ${errorType}`);
        return {
          success: false,
          errors
        };
      }

      // Continue to next provider
      console.log(`[ai-fallback] Falling back from ${providerType} due to ${errorType}`);
    }
  }

  // All providers failed
  console.error(`[ai-fallback] All providers failed for ${operation}:`,
    errors.map(e => `${e.provider}: ${e.errorType}`).join(', '));

  // DIAGNOSTIC LOG C: Fallback result summary (no secrets)
  console.log('[AI][FallbackResult]', {
    operation,
    totalProvidersTried: errors.length,
    triedProviders: errors.map(e => ({
      providerType: e.provider,
      errorType: e.errorType,
      httpStatus: e.statusCode ?? null,
      errorMessage: e.message?.substring(0, 100) // Truncated, no secrets
    }))
  });

  return {
    success: false,
    errors
  };
}
