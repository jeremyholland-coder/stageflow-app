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

// ============================================================================
// [StageFlow][AI][DIAGNOSTICS] COLD-START ENVIRONMENT CHECK
// This runs ONCE when the module loads to verify environment config
// ============================================================================
if (process.env.NODE_ENV !== 'production' || process.env.AI_PROVIDER_DIAGNOSTICS === 'true') {
  console.log("[StageFlow][AI][DIAGNOSTICS][provider-registry]", {
    // NOTE: AI provider keys are NOT env vars - they're stored encrypted in DB
    // These checks confirm they're NOT being read from env (which is correct)
    OPENAI_KEY_PRESENT: !!process.env.OPENAI_API_KEY,       // Should be FALSE
    ANTHROPIC_KEY_PRESENT: !!process.env.ANTHROPIC_API_KEY, // Should be FALSE
    GEMINI_KEY_PRESENT: !!process.env.GEMINI_API_KEY,       // Should be FALSE
    // These are the ACTUAL required env vars for AI functionality:
    ENCRYPTION_KEY_PRESENT: !!process.env.ENCRYPTION_KEY,   // CRITICAL - must be TRUE
    SUPABASE_URL_PRESENT: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
    SUPABASE_SERVICE_KEY_PRESENT: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
    BUILD_TIMESTAMP: new Date().toISOString()
  });
}

/**
 * ALLOWED_PROVIDERS: The only supported AI provider types
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
  active?: boolean; // Newer column name in our schema
  model?: string;
  // Legacy support: some environments still use is_active
  is_active?: boolean;
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

    // M4 HARDENING: Filter to allowed providers only AND require an encrypted key
    const filteredProviders = (allProviders || []).filter((p: AIProvider) => {
      const allowed = ALLOWED_PROVIDERS.includes(p.provider_type as AllowedProviderType);
      const hasKey = !!p.api_key_encrypted;
      return allowed && hasKey;
    });

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
  // Support environments that may or may not have the legacy is_active column.
  // Try the superset select first; if the column is missing, fall back without it.
  const selectColumns = 'id, organization_id, provider_type, api_key_encrypted, model, active, is_active, created_at, updated_at';

  let data;
  let error;

  ({ data, error } = await supabase
    .from('ai_providers')
    .select(selectColumns)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true }));

  if (error && error.message?.includes('column ai_providers.is_active does not exist')) {
    // Fallback for schemas without the legacy column
    ({ data, error } = await supabase
      .from('ai_providers')
      .select('id, organization_id, provider_type, api_key_encrypted, model, active, created_at, updated_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true }));
  }

  if (error) {
    throw new ProviderFetchError(`Database error: ${error.message}`, 'DB_ERROR');
  }

  // Normalize the active flag to handle either column name
  const normalized = (data || []).filter((p: any) => {
    const isActive = typeof p.active === 'boolean' ? p.active : p.is_active;
    return isActive === true;
  });

  return normalized as AIProvider[];
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

/**
 * DIAGNOSTICS 2025-12-04: Verify provider environment configuration
 *
 * This function checks for missing environment variables that are ACTUALLY
 * required for AI provider functionality.
 *
 * IMPORTANT: AI provider API keys (OpenAI, Anthropic, Gemini) are NOT
 * environment variables! They are stored encrypted in the database.
 *
 * The critical env vars are:
 * - ENCRYPTION_KEY: Required to decrypt stored API keys
 * - SUPABASE_URL or VITE_SUPABASE_URL: Database connectivity
 * - SUPABASE_SERVICE_ROLE_KEY: Database access
 *
 * @returns Array of problem descriptions (empty = all good)
 */
export function verifyProviderEnvironment(): string[] {
  const problems: string[] = [];

  // Check ENCRYPTION_KEY - CRITICAL for decrypting stored API keys
  if (!process.env.ENCRYPTION_KEY) {
    problems.push("ENCRYPTION_KEY missing - cannot decrypt stored API keys");
  }

  // Check Supabase URL
  if (!process.env.VITE_SUPABASE_URL && !process.env.SUPABASE_URL) {
    problems.push("SUPABASE_URL (or VITE_SUPABASE_URL) missing - cannot connect to database");
  }

  // Check Supabase service role key
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY missing - cannot access database");
  }

  // Informational: Check if someone mistakenly set API keys as env vars
  // (This is NOT how StageFlow works - keys are in the database)
  if (process.env.OPENAI_API_KEY) {
    problems.push("WARNING: OPENAI_API_KEY is set as env var but StageFlow uses database-stored keys");
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push("WARNING: ANTHROPIC_API_KEY is set as env var but StageFlow uses database-stored keys");
  }
  if (process.env.GEMINI_API_KEY) {
    problems.push("WARNING: GEMINI_API_KEY is set as env var but StageFlow uses database-stored keys");
  }

  return problems;
}

export default {
  ALLOWED_PROVIDERS,
  getConnectedProviders,
  isAllowedProvider,
  getProviderDisplayName,
  verifyProviderEnvironment,
  PROVIDER_DISPLAY_NAMES
};
