/**
 * PROVIDER REGISTRY
 *
 * M4 HARDENING 2025-12-04: Single source of truth for AI provider fetching
 *
 * This module centralizes provider fetch and filter logic for all AI endpoints:
 * - ai-assistant.mts
 * - ai-assistant-stream.mts
 * - ai-insights.mts
 *
 * Having a single utility prevents logic drift between endpoints
 * (e.g., "AI works in Insights but not in Plan My Day")
 *
 * @author StageFlow Engineering
 */

import { getProvidersWithCache, ProviderFetchError } from './provider-cache';

/**
 * ALLOWED_PROVIDERS: The only supported AI provider types
 * FIX 2025-12-04: Removed xAI/Grok - deprecated provider
 *
 * Adding a new provider? Update this list AND the provider UI components.
 */
export const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type AllowedProviderType = typeof ALLOWED_PROVIDERS[number];

/**
 * Provider configuration from database
 */
export interface AIProvider {
  id: string;
  organization_id: string;
  provider_type: AllowedProviderType | string;
  api_key_encrypted: string;
  model?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * Options for getConnectedProviders
 */
export interface GetProvidersOptions {
  /**
   * Whether to use the provider cache (default: true)
   * Set to false to force a fresh database query
   */
  useCache?: boolean;
}

/**
 * Result from getConnectedProviders
 */
export interface GetProvidersResult {
  /**
   * List of connected, active providers (filtered to ALLOWED_PROVIDERS)
   */
  providers: AIProvider[];

  /**
   * Whether a provider fetch error occurred
   */
  fetchError: boolean;

  /**
   * Error message if fetchError is true
   */
  errorMessage?: string;
}

/**
 * Get connected AI providers for an organization
 *
 * This is the SINGLE SOURCE OF TRUTH for provider fetching.
 * All AI endpoints should use this function.
 *
 * @param supabase - Supabase client instance
 * @param orgId - Organization ID
 * @param opts - Options (useCache, etc.)
 * @returns GetProvidersResult with providers array and error state
 *
 * @example
 * ```typescript
 * const { providers, fetchError, errorMessage } = await getConnectedProviders(supabase, orgId);
 * if (fetchError) {
 *   return errorResponse(503, { code: 'PROVIDER_FETCH_ERROR', message: errorMessage });
 * }
 * if (providers.length === 0) {
 *   return errorResponse(422, { code: 'NO_PROVIDERS', message: 'No AI provider connected' });
 * }
 * // Use providers...
 * ```
 */
export async function getConnectedProviders(
  supabase: any,
  orgId: string,
  opts: GetProvidersOptions = {}
): Promise<GetProvidersResult> {
  const { useCache = true } = opts;

  try {
    // Fetch providers (cached by default for 60s)
    const allProviders = useCache
      ? await getProvidersWithCache(supabase, orgId)
      : await fetchProvidersDirect(supabase, orgId);

    // M4 HARDENING: Filter to allowed providers only
    // This prevents zombie providers (e.g., deprecated xAI/Grok) from being used
    const filteredProviders = (allProviders || []).filter(
      (p: AIProvider) => ALLOWED_PROVIDERS.includes(p.provider_type as AllowedProviderType)
    );

    return {
      providers: filteredProviders,
      fetchError: false
    };
  } catch (error: any) {
    // M4 HARDENING: Return structured error instead of throwing
    // This allows callers to distinguish fetch errors from "no providers"
    console.error('[StageFlow][AI][ERROR] Provider fetch failed:', error);

    return {
      providers: [],
      fetchError: true,
      errorMessage: error instanceof ProviderFetchError
        ? error.message
        : 'Unable to load AI provider configuration. Please retry in a few moments.'
    };
  }
}

/**
 * Direct database query for providers (bypasses cache)
 * Used when useCache: false is specified
 */
async function fetchProvidersDirect(supabase: any, orgId: string): Promise<AIProvider[]> {
  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: true }); // First connected = first in fallback chain

  if (error) {
    throw new ProviderFetchError(`Database error: ${error.message}`, 'DB_ERROR');
  }

  return data || [];
}

/**
 * Check if a provider type is allowed
 */
export function isAllowedProvider(providerType: string): providerType is AllowedProviderType {
  return ALLOWED_PROVIDERS.includes(providerType as AllowedProviderType);
}

/**
 * Get human-readable provider name
 */
export const PROVIDER_DISPLAY_NAMES: Record<AllowedProviderType, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini'
};

export function getProviderDisplayName(providerType: string): string {
  return PROVIDER_DISPLAY_NAMES[providerType as AllowedProviderType] || providerType;
}

export default {
  ALLOWED_PROVIDERS,
  getConnectedProviders,
  isAllowedProvider,
  getProviderDisplayName,
  PROVIDER_DISPLAY_NAMES
};
