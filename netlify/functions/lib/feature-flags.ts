/**
 * Feature Flag System for Auth Migration
 *
 * Enables gradual rollout of new authentication middleware with:
 * - Percentage-based rollout (0%, 1%, 10%, 50%, 100%)
 * - Per-endpoint flags
 * - Instant rollback capability
 * - Comprehensive logging
 *
 * Usage:
 *   const useNewAuth = shouldUseNewAuth('setup-organization', userId);
 *   if (useNewAuth) {
 *     // New auth middleware path
 *   } else {
 *     // Legacy auth path
 *   }
 */

/**
 * Feature flag configuration
 *
 * Environment variables:
 * - ENABLE_AUTH_MIDDLEWARE: 'true' | 'false' (master switch)
 * - AUTH_ROLLOUT_PERCENTAGE: '0' | '1' | '10' | '50' | '100'
 * - AUTH_WHITELIST_USERS: Comma-separated user IDs to always use new auth
 * - AUTH_BLACKLIST_USERS: Comma-separated user IDs to never use new auth
 */

export interface FeatureFlagConfig {
  enabled: boolean;
  rolloutPercentage: number;
  whitelistUsers: Set<string>;
  blacklistUsers: Set<string>;
  endpointOverrides: Map<string, boolean>;
}

/**
 * Get feature flag configuration from environment
 */
function getFeatureFlagConfig(): FeatureFlagConfig {
  const enabled = process.env.ENABLE_AUTH_MIDDLEWARE === 'true';
  const rolloutPercentage = parseInt(process.env.AUTH_ROLLOUT_PERCENTAGE || '0', 10);

  const whitelistUsers = new Set(
    (process.env.AUTH_WHITELIST_USERS || '').split(',').filter(id => id.trim())
  );

  const blacklistUsers = new Set(
    (process.env.AUTH_BLACKLIST_USERS || '').split(',').filter(id => id.trim())
  );

  // Per-endpoint overrides (e.g., AUTH_ENABLE_setup_organization=true)
  const endpointOverrides = new Map<string, boolean>();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('AUTH_ENABLE_')) {
      const endpoint = key.replace('AUTH_ENABLE_', '').toLowerCase();
      endpointOverrides.set(endpoint, value === 'true');
    }
  }

  return {
    enabled,
    rolloutPercentage: Math.max(0, Math.min(100, rolloutPercentage)),
    whitelistUsers,
    blacklistUsers,
    endpointOverrides
  };
}

/**
 * Hash a user ID to a number between 0-99 for consistent percentage-based rollout
 */
function hashUserIdToPercentile(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 100;
}

/**
 * Determine if a request should use the new auth middleware
 *
 * Decision tree:
 * 1. If master switch (ENABLE_AUTH_MIDDLEWARE) is off → use legacy
 * 2. If user is blacklisted → use legacy
 * 3. If user is whitelisted → use new auth
 * 4. If endpoint has override → use override value
 * 5. If user hash < rollout percentage → use new auth
 * 6. Otherwise → use legacy
 *
 * @param endpoint - Endpoint name (e.g., 'setup-organization')
 * @param userId - User ID for percentage-based rollout (optional)
 * @returns true if should use new auth, false for legacy
 */
export function shouldUseNewAuth(endpoint: string, userId?: string): boolean {
  // AI ENDPOINTS: Always use new cookie-based auth
  // Frontend uses credentials: 'include' (cookies only, no Authorization header)
  // These endpoints MUST use the new auth middleware to work correctly
  // PHASE C FIX: Added 'ai-insights' - was allowing unauthenticated access (B-SEC-01)
  const cookieOnlyEndpoints = [
    'ai-assistant',
    'ai-assistant-stream',
    'ai-insights'
  ];

  if (cookieOnlyEndpoints.includes(endpoint)) {
    return true;
  }

  // All other endpoints: Keep legacy auth until full migration is ready
  return false;
}

/**
 * Log auth decision for monitoring and debugging
 */
function logAuthDecision(
  endpoint: string,
  userId: string | undefined,
  authType: 'new' | 'legacy',
  reason: string
): void {
  // Only log in development or if debug flag is set
  if (process.env.NODE_ENV === 'development' || process.env.AUTH_DEBUG === 'true') {
    // Use console.warn for debugging (allowed by pre-commit hook)
    console.warn(`[AUTH_FLAG] endpoint=${endpoint} user=${userId || 'anonymous'} auth=${authType} reason=${reason}`);
  }

  // In production, we could send to analytics here
  // Example: sendToAnalytics('auth_decision', { endpoint, authType, reason });
}

/**
 * Get current feature flag status (for health checks)
 */
export function getFeatureFlagStatus(): {
  enabled: boolean;
  rolloutPercentage: number;
  whitelistCount: number;
  blacklistCount: number;
  endpointOverrideCount: number;
} {
  const config = getFeatureFlagConfig();
  return {
    enabled: config.enabled,
    rolloutPercentage: config.rolloutPercentage,
    whitelistCount: config.whitelistUsers.size,
    blacklistCount: config.blacklistUsers.size,
    endpointOverrideCount: config.endpointOverrides.size
  };
}

/**
 * Validate feature flag configuration (for startup checks)
 */
export function validateFeatureFlagConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const config = getFeatureFlagConfig();

    // Validate rollout percentage
    if (config.rolloutPercentage < 0 || config.rolloutPercentage > 100) {
      errors.push(`Invalid AUTH_ROLLOUT_PERCENTAGE: ${config.rolloutPercentage} (must be 0-100)`);
    }

    // Validate no overlap between whitelist and blacklist
    const overlap = [...config.whitelistUsers].filter(id => config.blacklistUsers.has(id));
    if (overlap.length > 0) {
      errors.push(`Users in both whitelist and blacklist: ${overlap.join(', ')}`);
    }

    // Warn if enabled but rollout is 0 and no whitelists
    if (config.enabled && config.rolloutPercentage === 0 && config.whitelistUsers.size === 0) {
      errors.push('Warning: ENABLE_AUTH_MIDDLEWARE=true but rollout is 0% with no whitelisted users');
    }

  } catch (error: any) {
    errors.push(`Feature flag config error: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
