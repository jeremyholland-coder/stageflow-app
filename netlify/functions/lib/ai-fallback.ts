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
// FIX 2025-12-04: Only 3 providers (removed xAI/Grok)
export const PROVIDER_FALLBACK_ORDER = ['openai', 'anthropic', 'google'] as const;
export type ProviderType = typeof PROVIDER_FALLBACK_ORDER[number];

// Provider display names for logging/UI
export const PROVIDER_NAMES: Record<ProviderType, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini'
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

// FIX 2025-12-04: Soft failure patterns for streaming parity
// These patterns indicate a "soft failure" - the API returned 200 but the content is an error message
// P3 FIX 2025-12-04: Added more patterns for provider-side temporary errors
export const SOFT_FAILURE_PATTERNS = [
  "i'm unable to connect",
  "unable to connect to",
  "api key needs credits",
  "api key needs permissions",
  "check your api key",
  "verify your api key",
  "no credits",
  "insufficient credits",
  "permission denied",
  "not authorized",
  "invalid api key",
  "authentication failed",
  "rate limit exceeded",
  "quota exceeded",
  // P3 FIX: Additional patterns for provider-side temporary issues
  "model is currently overloaded",
  "currently experiencing high demand",
  "please try again later",
  "service temporarily unavailable",
  "server is busy",
  "capacity limit"
] as const;

// FIX 2025-12-04: Task-aware fallback order affinity scores
// For planning tasks: ChatGPT(5) → Claude(4) → Gemini(2)
// Higher score = tried earlier in fallback chain
// FIX 2025-12-04: Removed xAI/Grok - only 3 providers supported
export const TASK_FALLBACK_AFFINITY: Record<string, Record<ProviderType, number>> = {
  planning: { openai: 5, anthropic: 4, google: 2 },
  coaching: { anthropic: 5, openai: 3, google: 2 },
  chart_insight: { openai: 4, google: 3, anthropic: 2 },
  text_analysis: { openai: 4, anthropic: 3, google: 2 },
  image_suitable: { google: 5, openai: 3, anthropic: 2 },
  general: { openai: 4, anthropic: 3, google: 2 },
  default: { openai: 3, anthropic: 3, google: 2 }
};

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
 * FIX 2025-12-04: Detect soft failures in AI response content
 *
 * A "soft failure" is when the provider returns HTTP 200 but the response
 * content is an error message (e.g., "I can't connect right now").
 *
 * This is used by both streaming and non-streaming paths for consistency.
 *
 * @param responseText - The text content of the AI response
 * @returns { isSoftFailure: boolean, pattern: string | null }
 */
export function detectSoftFailure(responseText: string | null | undefined): { isSoftFailure: boolean; pattern: string | null } {
  if (!responseText || typeof responseText !== 'string') {
    return { isSoftFailure: false, pattern: null };
  }

  const lowerText = responseText.toLowerCase();

  for (const pattern of SOFT_FAILURE_PATTERNS) {
    if (lowerText.includes(pattern)) {
      return { isSoftFailure: true, pattern };
    }
  }

  return { isSoftFailure: false, pattern: null };
}

/**
 * Sort providers for fallback execution
 *
 * FIX 2025-12-04: Task-aware fallback ordering
 * For planning tasks: ChatGPT → Claude → Gemini (by affinity score)
 * Falls back to connection order only when no taskType is specified.
 *
 * @param providers - Providers array (should be pre-sorted by created_at ascending)
 * @param preferredProvider - Optional provider to try first (user's explicit choice)
 * @param taskType - Optional task type for affinity-based ordering
 */
export function sortProvidersForFallback<T extends { provider_type: string }>(
  providers: T[],
  preferredProvider?: string,
  taskType?: string
): T[] {
  // FIX 2025-12-04: If taskType is provided, sort by affinity score (task-aware ordering)
  if (taskType) {
    const affinityMap = TASK_FALLBACK_AFFINITY[taskType] || TASK_FALLBACK_AFFINITY.default;

    // Sort by affinity score (higher = first), then by original index as tiebreaker
    const sorted = [...providers].sort((a, b) => {
      const aAffinity = affinityMap[a.provider_type as ProviderType] || 0;
      const bAffinity = affinityMap[b.provider_type as ProviderType] || 0;

      // Higher affinity first
      if (bAffinity !== aAffinity) {
        return bAffinity - aAffinity;
      }

      // Tiebreaker: original array order (connection order)
      return providers.indexOf(a) - providers.indexOf(b);
    });

    // If preferred provider specified, move it to front (overrides affinity)
    if (preferredProvider) {
      const preferredIndex = sorted.findIndex(p => p.provider_type === preferredProvider);
      if (preferredIndex > 0) {
        const [preferred] = sorted.splice(preferredIndex, 1);
        sorted.unshift(preferred);
      }
    }

    return sorted;
  }

  // Legacy behavior: connection order with preferred provider first
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
 * FIX 2025-12-04: Summarize provider errors into user-friendly message
 *
 * Analyzes the error types and messages to provide actionable guidance:
 * - Quota/billing issues → "Check your API billing status"
 * - Rate limiting → "Rate limited - try again in a moment"
 * - Invalid keys → "Check your API key configuration"
 * - Model issues → "Model configuration issue"
 * - Default → "Service temporarily unavailable"
 *
 * @param errors - Array of provider errors from fallback attempts
 * @returns User-friendly summary message
 */
export function summarizeProviderErrors(errors: ProviderError[]): string {
  if (!errors || errors.length === 0) {
    return 'AI service temporarily unavailable. Please try again.';
  }

  // Categorize errors
  let hasQuotaIssue = false;
  let hasBillingIssue = false;
  let hasRateLimitIssue = false;
  let hasKeyIssue = false;
  let hasModelIssue = false;
  let hasNetworkIssue = false;
  let hasTimeoutIssue = false;

  for (const error of errors) {
    const msgLower = (error.message || '').toLowerCase();
    const errorType = error.errorType || '';

    // Quota issues
    if (msgLower.includes('quota') ||
        msgLower.includes('insufficient_quota') ||
        msgLower.includes('exceeded your current quota') ||
        msgLower.includes('rate_limit_exceeded')) {
      hasQuotaIssue = true;
    }

    // Billing/credit issues
    if (msgLower.includes('billing') ||
        msgLower.includes('credit') ||
        msgLower.includes('payment') ||
        msgLower.includes('credits') ||
        msgLower.includes('insufficient funds') ||
        msgLower.includes('balance is too low')) {
      hasBillingIssue = true;
    }

    // Rate limiting
    if (error.statusCode === 429 ||
        errorType === FALLBACK_TRIGGERS.RATE_LIMIT ||
        msgLower.includes('rate limit') ||
        msgLower.includes('too many requests')) {
      hasRateLimitIssue = true;
    }

    // Key issues
    if (errorType === FALLBACK_TRIGGERS.INVALID_KEY ||
        errorType === FALLBACK_TRIGGERS.NO_KEY ||
        errorType === FALLBACK_TRIGGERS.KEY_EXPIRED ||
        errorType === FALLBACK_TRIGGERS.PERMISSION_DENIED ||
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        msgLower.includes('invalid api key') ||
        msgLower.includes('api key not valid') ||
        msgLower.includes('unauthorized') ||
        msgLower.includes('authentication')) {
      hasKeyIssue = true;
    }

    // Model issues (404 or model not found)
    if (error.statusCode === 404 ||
        msgLower.includes('model not found') ||
        msgLower.includes('model_not_found') ||
        msgLower.includes('does not exist') ||
        msgLower.includes('invalid model')) {
      hasModelIssue = true;
    }

    // Network issues
    if (errorType === FALLBACK_TRIGGERS.NETWORK_ERROR ||
        msgLower.includes('network') ||
        msgLower.includes('econnrefused') ||
        msgLower.includes('enotfound')) {
      hasNetworkIssue = true;
    }

    // Timeout issues
    if (errorType === FALLBACK_TRIGGERS.TIMEOUT ||
        msgLower.includes('timeout') ||
        msgLower.includes('timed out')) {
      hasTimeoutIssue = true;
    }
  }

  // Build summary based on categories (most specific first)
  const issues: string[] = [];

  if (hasBillingIssue || hasQuotaIssue) {
    issues.push('API quota/billing issue detected');
  }
  if (hasKeyIssue) {
    issues.push('API key issue detected');
  }
  if (hasModelIssue) {
    issues.push('model configuration issue');
  }
  if (hasRateLimitIssue && !hasQuotaIssue) {
    issues.push('rate limited');
  }
  if (hasNetworkIssue) {
    issues.push('network connectivity issue');
  }
  if (hasTimeoutIssue) {
    issues.push('request timed out');
  }

  if (issues.length === 0) {
    return 'AI providers temporarily unavailable. Please try again.';
  }

  // Provide actionable guidance based on issues
  const providerNames = errors.map(e => PROVIDER_NAMES[e.provider] || e.provider);
  const uniqueProviders = [...new Set(providerNames)].join(', ');

  if (hasBillingIssue || hasQuotaIssue) {
    return `AI request failed (${uniqueProviders}): ${issues[0]}. Please check your API billing status in Settings → AI Providers.`;
  }

  if (hasKeyIssue) {
    return `AI request failed (${uniqueProviders}): ${issues[0]}. Please verify your API keys in Settings → AI Providers.`;
  }

  if (hasModelIssue) {
    return `AI request failed (${uniqueProviders}): ${issues[0]}. The selected model may have been deprecated or renamed.`;
  }

  if (hasRateLimitIssue) {
    return `AI request failed (${uniqueProviders}): ${issues[0]}. Please wait a moment and try again.`;
  }

  return `AI request failed (${uniqueProviders}): ${issues.join(', ')}. Please try again.`;
}

/**
 * Custom error class for when all providers fail
 *
 * FIX 2025-12-04: Now includes intelligent error summarization
 * that provides actionable guidance based on error types.
 */
export class AllProvidersFailedError extends Error {
  public readonly errors: ProviderError[];
  public readonly providersAttempted: string[];
  public readonly userFriendlyMessage: string;

  constructor(errors: ProviderError[]) {
    const userMessage = summarizeProviderErrors(errors);
    super(userMessage);
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
    this.providersAttempted = errors.map(e => e.provider);
    this.userFriendlyMessage = userMessage;
  }
}

/**
 * Run an operation with automatic fallback through providers
 *
 * @param operation - Name of the operation (for logging)
 * @param providers - Array of provider objects with provider_type field
 * @param callProvider - Function that calls a specific provider
 * @param preferredProvider - Optional preferred provider to try first
 * @param taskType - Optional task type for task-aware fallback ordering
 */
export async function runWithFallback<T, P extends { provider_type: string }>(
  operation: string,
  providers: P[],
  callProvider: (provider: P) => Promise<T>,
  preferredProvider?: string,
  taskType?: string // FIX 2025-12-04: Task-aware fallback ordering
): Promise<FallbackResult<T>> {
  const errors: ProviderError[] = [];

  // Sort providers into fallback order
  // FIX 2025-12-04: Pass taskType for task-aware ordering (ChatGPT → Claude → Gemini for planning)
  const sortedProviders = sortProvidersForFallback(providers, preferredProvider, taskType);

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
