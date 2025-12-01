/**
 * AI Provider Fallback Chain
 *
 * Implements automatic failover between AI providers when one fails.
 * Providers are tried in a fixed order: openai → anthropic → google → xai
 *
 * @author StageFlow Engineering
 */

// Fixed fallback order as specified
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
 * Classify an error to determine if fallback should trigger
 */
export function classifyError(error: any, statusCode?: number): { shouldFallback: boolean; errorType: string } {
  const message = error?.message?.toLowerCase() || '';

  // Network errors - always fallback
  if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.NETWORK_ERROR };
  }

  // Timeout - always fallback
  if (message.includes('timeout') || message.includes('timed out')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.TIMEOUT };
  }

  // HTTP status-based classification
  if (statusCode) {
    // 5xx server errors - fallback
    if (statusCode >= 500) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PROVIDER_5XX };
    }

    // 429 rate limit - fallback
    if (statusCode === 429) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.RATE_LIMIT };
    }

    // 401/403 - key issues, skip provider but continue to next
    if (statusCode === 401 || statusCode === 403) {
      return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.PERMISSION_DENIED };
    }

    // 400 - usually user input issues, don't fallback
    if (statusCode === 400) {
      if (message.includes('too long') || message.includes('token')) {
        return { shouldFallback: false, errorType: NO_FALLBACK_ERRORS.PROMPT_TOO_LONG };
      }
      if (message.includes('content') && message.includes('policy')) {
        return { shouldFallback: false, errorType: NO_FALLBACK_ERRORS.CONTENT_POLICY };
      }
    }
  }

  // Provider-specific error patterns
  if (message.includes('rate limit') || message.includes('quota')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.RATE_LIMIT };
  }

  if (message.includes('overloaded') || message.includes('capacity')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.MODEL_OVERLOADED };
  }

  if (message.includes('invalid') && message.includes('key')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  if (message.includes('decryption') || message.includes('decrypt')) {
    return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INVALID_KEY };
  }

  // Default: assume it's an infrastructure error, fallback
  return { shouldFallback: true, errorType: FALLBACK_TRIGGERS.INTERNAL_ERROR };
}

/**
 * Sort providers into the correct fallback order
 * Returns providers in order: openai → anthropic → google → xai
 * Only includes providers that are available
 */
export function sortProvidersForFallback<T extends { provider_type: string }>(
  providers: T[],
  preferredProvider?: string
): T[] {
  // Create a map for O(1) lookup
  const providerMap = new Map<string, T>();
  for (const p of providers) {
    providerMap.set(p.provider_type, p);
  }

  const sorted: T[] = [];

  // If there's a preferred provider, put it first
  if (preferredProvider && providerMap.has(preferredProvider)) {
    sorted.push(providerMap.get(preferredProvider)!);
    providerMap.delete(preferredProvider);
  }

  // Add remaining providers in fallback order
  for (const providerType of PROVIDER_FALLBACK_ORDER) {
    if (providerMap.has(providerType)) {
      sorted.push(providerMap.get(providerType)!);
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

  return {
    success: false,
    errors
  };
}
