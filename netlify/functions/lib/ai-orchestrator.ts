/**
 * AI Orchestrator - Connected Providers Only
 *
 * Central module for AI provider selection and fallback.
 * Uses ONLY connected providers, in CONNECTION ORDER (first connected = first tried).
 *
 * NO hardcoded provider order. NO assumptions about which provider exists.
 * Only uses what the organization has actually connected.
 *
 * @author StageFlow Engineering
 * @date 2025-12-02
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decrypt, isLegacyEncryption, decryptLegacy } from './encryption';

// Provider types supported by StageFlow
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'xai';

// Provider display names for user-facing messages
export const PROVIDER_DISPLAY_NAMES: Record<ProviderType, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok'
};

// Connected provider from database
export interface ConnectedProvider {
  id: string;
  provider_type: ProviderType;
  model: string | null;
  display_name: string | null;
  api_key_encrypted: string;
  created_at: string; // Used for ordering (first connected = first tried)
}

// Error info for logging/debugging
export interface ProviderAttemptError {
  provider: ProviderType;
  displayName: string;
  errorType: string;
  message: string;
  statusCode?: number;
  timestamp: string;
}

// Result from orchestrated AI call
export interface OrchestrationResult<T> {
  success: boolean;
  providerUsed?: ProviderType;
  providerDisplayName?: string;
  result?: T;
  errors: ProviderAttemptError[];
}

// Specific error when no providers are connected
export class NoProvidersConnectedError extends Error {
  constructor() {
    super('No AI providers are connected for this organization. Please connect at least one provider in Settings.');
    this.name = 'NoProvidersConnectedError';
  }
}

// Specific error when all connected providers fail
export class AllConnectedProvidersFailedError extends Error {
  public readonly errors: ProviderAttemptError[];
  public readonly providersAttempted: string[];

  constructor(errors: ProviderAttemptError[]) {
    const names = errors.map(e => e.displayName).join(', ');
    super(`All connected AI providers failed: ${names}. Please check your API keys or try again later.`);
    this.name = 'AllConnectedProvidersFailedError';
    this.errors = errors;
    this.providersAttempted = errors.map(e => e.provider);
  }
}

// Create Supabase client (service role for backend operations)
// CRITICAL: Backend MUST use SUPABASE_URL, NOT VITE_SUPABASE_URL
// VITE_* vars are for frontend only and may not exist in Netlify Functions
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('[AI Orchestrator] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Fetch all connected providers for an organization
 *
 * Returns providers sorted by created_at ASCENDING:
 * - First provider connected = index 0 (tried first)
 * - Most recently connected = last index (tried last)
 *
 * Only returns providers that are:
 * - active = true
 * - have a non-null, non-empty api_key_encrypted
 */
export async function getConnectedProvidersForOrg(orgId: string): Promise<ConnectedProvider[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('ai_providers')
    .select('id, provider_type, model, display_name, api_key_encrypted, created_at')
    .eq('organization_id', orgId)
    .eq('active', true)
    .not('api_key_encrypted', 'is', null)
    .order('created_at', { ascending: true }); // First connected = first in array

  if (error) {
    console.error('[ai-orchestrator] Error fetching providers:', error);
    return [];
  }

  // Filter out any with empty api_key_encrypted (extra safety)
  // FIX 2025-12-04: Also filter out xAI/Grok - deprecated provider
  const validProviders = (data || []).filter(
    p => p.api_key_encrypted && p.api_key_encrypted.trim() !== '' && p.provider_type !== 'xai'
  );

  console.log(`[ai-orchestrator] Org ${orgId} has ${validProviders.length} connected provider(s):`,
    validProviders.map(p => p.provider_type).join(', ') || '(none)');

  return validProviders as ConnectedProvider[];
}

/**
 * Decrypt an API key from the database
 */
export function decryptApiKey(encryptedKey: string): string {
  if (isLegacyEncryption(encryptedKey)) {
    return decryptLegacy(encryptedKey);
  }
  return decrypt(encryptedKey);
}

/**
 * Classify an error to determine if we should try the next provider
 */
function shouldFallbackOnError(error: any, statusCode?: number): { shouldFallback: boolean; errorType: string } {
  const message = error?.message?.toLowerCase() || '';

  // Network errors - always try next provider
  if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
    return { shouldFallback: true, errorType: 'NETWORK_ERROR' };
  }

  // Timeout - always try next provider
  if (message.includes('timeout') || message.includes('timed out')) {
    return { shouldFallback: true, errorType: 'TIMEOUT' };
  }

  // HTTP status codes
  if (statusCode) {
    // 5xx server errors - try next provider
    if (statusCode >= 500) {
      return { shouldFallback: true, errorType: 'SERVER_ERROR' };
    }

    // 429 rate limit - try next provider
    if (statusCode === 429) {
      return { shouldFallback: true, errorType: 'RATE_LIMIT' };
    }

    // 401/403 - key issues, try next provider
    if (statusCode === 401 || statusCode === 403) {
      return { shouldFallback: true, errorType: 'AUTH_ERROR' };
    }

    // 400 - usually user input issues, DON'T try next provider
    if (statusCode === 400) {
      if (message.includes('too long') || message.includes('token')) {
        return { shouldFallback: false, errorType: 'PROMPT_TOO_LONG' };
      }
      if (message.includes('content') && message.includes('policy')) {
        return { shouldFallback: false, errorType: 'CONTENT_POLICY' };
      }
    }
  }

  // Provider-specific patterns
  if (message.includes('rate limit') || message.includes('quota')) {
    return { shouldFallback: true, errorType: 'RATE_LIMIT' };
  }

  if (message.includes('overloaded') || message.includes('capacity')) {
    return { shouldFallback: true, errorType: 'OVERLOADED' };
  }

  if (message.includes('invalid') && message.includes('key')) {
    return { shouldFallback: true, errorType: 'INVALID_KEY' };
  }

  if (message.includes('decryption') || message.includes('decrypt')) {
    return { shouldFallback: true, errorType: 'DECRYPTION_ERROR' };
  }

  // Default: assume infrastructure error, try next provider
  return { shouldFallback: true, errorType: 'UNKNOWN_ERROR' };
}

/**
 * Log a provider attempt for debugging
 */
function logAttempt(
  operation: string,
  provider: ProviderType,
  status: 'attempting' | 'success' | 'failed',
  error?: string
): void {
  const timestamp = new Date().toISOString();
  const sanitizedError = error
    ? error.replace(/sk-[a-zA-Z0-9]+/g, 'sk-***').replace(/Bearer [a-zA-Z0-9]+/g, 'Bearer ***').slice(0, 100)
    : undefined;

  const parts = [`AI_ORCHESTRATOR`, operation, `provider=${provider}`, `status=${status}`];
  if (sanitizedError) parts.push(`error=${sanitizedError}`);

  console.log(`[${timestamp}] ${parts.join(' ')}`);
}

/**
 * Run an AI operation using connected providers with automatic fallback
 *
 * Behavior:
 * - If 0 providers connected → throws NoProvidersConnectedError
 * - If 1 provider connected → uses that one
 * - If multiple connected → tries them in CONNECTION ORDER (first connected first)
 * - If a provider fails with a retryable error → tries next provider
 * - If a provider fails with a non-retryable error (e.g., prompt too long) → stops immediately
 * - If all providers fail → throws AllConnectedProvidersFailedError
 *
 * @param operation - Name of the operation (for logging)
 * @param orgId - Organization ID to fetch providers for
 * @param callProvider - Function that calls a specific provider (receives decrypted API key)
 */
export async function runWithConnectedProviders<T>(
  operation: string,
  orgId: string,
  callProvider: (provider: ConnectedProvider, apiKey: string) => Promise<T>
): Promise<OrchestrationResult<T>> {
  // Step 1: Get connected providers in connection order
  const providers = await getConnectedProvidersForOrg(orgId);

  // Step 2: Handle no providers connected
  if (providers.length === 0) {
    console.error(`[ai-orchestrator] No providers connected for org ${orgId}`);
    throw new NoProvidersConnectedError();
  }

  const errors: ProviderAttemptError[] = [];

  // Step 3: Try each provider in connection order
  for (const provider of providers) {
    logAttempt(operation, provider.provider_type, 'attempting');

    try {
      // Decrypt the API key
      const apiKey = decryptApiKey(provider.api_key_encrypted);

      // Call the provider
      const result = await callProvider(provider, apiKey);

      logAttempt(operation, provider.provider_type, 'success');

      return {
        success: true,
        providerUsed: provider.provider_type,
        providerDisplayName: PROVIDER_DISPLAY_NAMES[provider.provider_type],
        result,
        errors
      };

    } catch (error: any) {
      const statusCode = error?.status || error?.statusCode;
      const { shouldFallback, errorType } = shouldFallbackOnError(error, statusCode);

      const attemptError: ProviderAttemptError = {
        provider: provider.provider_type,
        displayName: PROVIDER_DISPLAY_NAMES[provider.provider_type],
        errorType,
        message: error?.message || 'Unknown error',
        statusCode,
        timestamp: new Date().toISOString()
      };

      errors.push(attemptError);
      logAttempt(operation, provider.provider_type, 'failed', errorType);

      // If this is a user error (not provider error), stop immediately
      if (!shouldFallback) {
        console.log(`[ai-orchestrator] Not trying next provider - user error: ${errorType}`);
        return {
          success: false,
          errors
        };
      }

      // Continue to next provider
      console.log(`[ai-orchestrator] Provider ${provider.provider_type} failed, trying next...`);
    }
  }

  // Step 4: All providers failed
  console.error(`[ai-orchestrator] All ${providers.length} connected providers failed for ${operation}`);
  throw new AllConnectedProvidersFailedError(errors);
}

/**
 * Helper: Get display name for a provider type
 */
export function getProviderDisplayName(providerType: ProviderType): string {
  return PROVIDER_DISPLAY_NAMES[providerType] || providerType;
}

export default {
  getConnectedProvidersForOrg,
  runWithConnectedProviders,
  getProviderDisplayName,
  decryptApiKey,
  NoProvidersConnectedError,
  AllConnectedProvidersFailedError,
  PROVIDER_DISPLAY_NAMES
};
