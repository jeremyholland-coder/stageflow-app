/**
 * AI Feature Flags System
 *
 * Apple-Grade Engineering: Instant kill switches for AI features.
 * Toggle via Netlify environment variables for immediate effect.
 *
 * Usage:
 *   if (!isAIFeatureEnabled('AI_ENABLED')) return fallbackResponse;
 *
 * Environment Variables:
 *   AI_FLAG_AI_ENABLED=false          # Master kill switch
 *   AI_FLAG_OPENAI_ENABLED=false      # Disable OpenAI
 *   AI_FLAG_ANTHROPIC_ENABLED=false   # Disable Anthropic
 *   AI_FLAG_GOOGLE_ENABLED=false      # Disable Google/Gemini
 *   AI_FLAG_PLAN_MY_DAY=false         # Disable Plan My Day
 *   AI_FLAG_STREAMING=false           # Disable streaming (use non-streaming)
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

/**
 * AI Feature Flag Keys
 */
export const AI_FLAGS = {
  // Master kill switch - disables ALL AI features
  AI_ENABLED: 'AI_ENABLED',

  // Per-provider toggles (for outages/maintenance)
  OPENAI_ENABLED: 'OPENAI_ENABLED',
  ANTHROPIC_ENABLED: 'ANTHROPIC_ENABLED',
  GOOGLE_ENABLED: 'GOOGLE_ENABLED',

  // Feature toggles
  PLAN_MY_DAY: 'PLAN_MY_DAY',
  STREAMING: 'STREAMING',
  FALLBACK_CHAIN: 'FALLBACK_CHAIN',
  ADAPTIVE_PROFILE: 'ADAPTIVE_PROFILE',

  // Experimental
  CACHE_RESPONSES: 'CACHE_RESPONSES',
} as const;

export type AIFeatureFlag = keyof typeof AI_FLAGS;

/**
 * Default flag values (all enabled by default)
 */
const DEFAULT_VALUES: Record<AIFeatureFlag, boolean> = {
  AI_ENABLED: true,
  OPENAI_ENABLED: true,
  ANTHROPIC_ENABLED: true,
  GOOGLE_ENABLED: true,
  PLAN_MY_DAY: true,
  STREAMING: true,
  FALLBACK_CHAIN: true,
  ADAPTIVE_PROFILE: true,
  CACHE_RESPONSES: false, // Experimental - off by default
};

/**
 * Check if an AI feature is enabled
 *
 * Priority:
 * 1. Environment variable override (AI_FLAG_{name})
 * 2. Default value (usually true)
 *
 * @param flag - The feature flag to check
 * @returns boolean - Whether the feature is enabled
 */
export function isAIFeatureEnabled(flag: AIFeatureFlag): boolean {
  // Check master kill switch first
  if (flag !== 'AI_ENABLED') {
    const masterEnabled = isAIFeatureEnabled('AI_ENABLED');
    if (!masterEnabled) {
      return false;
    }
  }

  // Check environment variable override
  const envKey = `AI_FLAG_${flag}`;
  const envValue = process.env[envKey];

  if (envValue !== undefined) {
    // Explicit false disables, anything else enables
    return envValue.toLowerCase() !== 'false' && envValue !== '0';
  }

  // Return default value
  return DEFAULT_VALUES[flag] ?? true;
}

/**
 * Check if a specific provider is enabled
 *
 * @param providerType - 'openai' | 'anthropic' | 'google'
 * @returns boolean - Whether the provider is enabled
 */
export function isProviderEnabled(providerType: string): boolean {
  switch (providerType.toLowerCase()) {
    case 'openai':
      return isAIFeatureEnabled('OPENAI_ENABLED');
    case 'anthropic':
      return isAIFeatureEnabled('ANTHROPIC_ENABLED');
    case 'google':
      return isAIFeatureEnabled('GOOGLE_ENABLED');
    default:
      // Unknown providers default to enabled
      return true;
  }
}

/**
 * Filter providers list based on feature flags
 *
 * @param providers - Array of provider objects with provider_type
 * @returns Filtered array with only enabled providers
 */
export function filterEnabledProviders<T extends { provider_type: string }>(
  providers: T[]
): T[] {
  return providers.filter(p => isProviderEnabled(p.provider_type));
}

/**
 * Get current status of all AI feature flags
 * Useful for diagnostics and health checks
 */
export function getAIFeatureFlagStatus(): Record<AIFeatureFlag, { enabled: boolean; source: 'env' | 'default' }> {
  const status: Record<string, { enabled: boolean; source: 'env' | 'default' }> = {};

  for (const flag of Object.keys(AI_FLAGS) as AIFeatureFlag[]) {
    const envKey = `AI_FLAG_${flag}`;
    const envValue = process.env[envKey];
    const hasEnvOverride = envValue !== undefined;

    status[flag] = {
      enabled: isAIFeatureEnabled(flag),
      source: hasEnvOverride ? 'env' : 'default',
    };
  }

  return status as Record<AIFeatureFlag, { enabled: boolean; source: 'env' | 'default' }>;
}

/**
 * Log AI feature flag status (for cold-start diagnostics)
 */
export function logAIFeatureFlagStatus(): void {
  const status = getAIFeatureFlagStatus();
  console.log('[StageFlow][AI][FeatureFlags]', {
    AI_ENABLED: status.AI_ENABLED.enabled,
    OPENAI: status.OPENAI_ENABLED.enabled,
    ANTHROPIC: status.ANTHROPIC_ENABLED.enabled,
    GOOGLE: status.GOOGLE_ENABLED.enabled,
    STREAMING: status.STREAMING.enabled,
    PLAN_MY_DAY: status.PLAN_MY_DAY.enabled,
  });
}

export default {
  AI_FLAGS,
  isAIFeatureEnabled,
  isProviderEnabled,
  filterEnabledProviders,
  getAIFeatureFlagStatus,
  logAIFeatureFlagStatus,
};
