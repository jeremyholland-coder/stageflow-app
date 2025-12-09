/**
 * AI Feature Flags Hook
 *
 * Apple-Grade Engineering: Frontend hook for AI feature flag management.
 * Allows instant disable of AI features via backend configuration.
 *
 * Usage:
 *   const { isEnabled, flags, status } = useAIFeatureFlags();
 *   if (!isEnabled('PLAN_MY_DAY')) return <FallbackComponent />;
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Default flag values (all enabled by default)
 * These are overridden by backend response if available
 */
const DEFAULT_FLAGS = {
  AI_ENABLED: true,
  OPENAI_ENABLED: true,
  ANTHROPIC_ENABLED: true,
  GOOGLE_ENABLED: true,
  PLAN_MY_DAY: true,
  STREAMING: true,
  FALLBACK_CHAIN: true,
};

/**
 * Cache key for localStorage
 */
const CACHE_KEY = 'sf_ai_feature_flags';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached flags from localStorage
 */
function getCachedFlags() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { flags, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return flags;
      }
    }
  } catch (e) {
    // Ignore cache errors
  }
  return null;
}

/**
 * Cache flags to localStorage
 */
function setCachedFlags(flags) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      flags,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // Ignore cache errors
  }
}

/**
 * Hook to manage AI feature flags
 *
 * @returns {Object} - { isEnabled, flags, status, refresh }
 */
export function useAIFeatureFlags() {
  const [flags, setFlags] = useState(() => getCachedFlags() || DEFAULT_FLAGS);
  const [status, setStatus] = useState('idle'); // idle, loading, loaded, error
  const [error, setError] = useState(null);

  /**
   * Fetch flags from synthetic check endpoint
   */
  const fetchFlags = useCallback(async () => {
    setStatus('loading');

    try {
      const response = await fetch('/.netlify/functions/ai-synthetic-check', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Extract feature flags from response
      const newFlags = {
        ...DEFAULT_FLAGS,
        AI_ENABLED: data.status !== 'critical',
        // Extract from checks if available
        ...(data.checks?.featureFlags?.details || {}),
      };

      setFlags(newFlags);
      setCachedFlags(newFlags);
      setStatus('loaded');
      setError(null);
    } catch (err) {
      console.warn('[useAIFeatureFlags] Failed to fetch flags:', err.message);
      setStatus('error');
      setError(err.message);
      // Keep using cached/default flags
    }
  }, []);

  /**
   * Check if a specific flag is enabled
   */
  const isEnabled = useCallback((flagName) => {
    // Master kill switch
    if (flagName !== 'AI_ENABLED' && !flags.AI_ENABLED) {
      return false;
    }

    return flags[flagName] ?? DEFAULT_FLAGS[flagName] ?? true;
  }, [flags]);

  /**
   * Check if a provider is enabled
   */
  const isProviderEnabled = useCallback((providerType) => {
    const providerFlags = {
      openai: 'OPENAI_ENABLED',
      anthropic: 'ANTHROPIC_ENABLED',
      google: 'GOOGLE_ENABLED',
    };

    const flagName = providerFlags[providerType.toLowerCase()];
    return flagName ? isEnabled(flagName) : true;
  }, [isEnabled]);

  /**
   * Get overall AI status
   */
  const aiStatus = useMemo(() => {
    if (!flags.AI_ENABLED) return 'disabled';
    if (status === 'error') return 'degraded';
    return 'healthy';
  }, [flags, status]);

  // Fetch flags on mount
  useEffect(() => {
    // Only fetch if we don't have cached flags
    const cached = getCachedFlags();
    if (!cached) {
      fetchFlags();
    }

    // Refresh in background regardless
    const timeoutId = setTimeout(fetchFlags, 1000);
    return () => clearTimeout(timeoutId);
  }, [fetchFlags]);

  // Refresh periodically
  useEffect(() => {
    const interval = setInterval(fetchFlags, CACHE_TTL);
    return () => clearInterval(interval);
  }, [fetchFlags]);

  return {
    /**
     * Check if a feature flag is enabled
     * @param {string} flagName - The flag to check
     * @returns {boolean}
     */
    isEnabled,

    /**
     * Check if a provider is enabled
     * @param {string} providerType - 'openai' | 'anthropic' | 'google'
     * @returns {boolean}
     */
    isProviderEnabled,

    /**
     * Current flag values
     */
    flags,

    /**
     * Overall AI status: 'healthy' | 'degraded' | 'disabled'
     */
    aiStatus,

    /**
     * Loading status: 'idle' | 'loading' | 'loaded' | 'error'
     */
    status,

    /**
     * Error message if any
     */
    error,

    /**
     * Manually refresh flags
     */
    refresh: fetchFlags,
  };
}

/**
 * Simple wrapper to check if AI is available
 * Use this in components that need quick check without full hook
 */
export function useAIAvailable() {
  const { isEnabled, aiStatus } = useAIFeatureFlags();
  return {
    isAvailable: isEnabled('AI_ENABLED'),
    status: aiStatus,
  };
}

export default useAIFeatureFlags;
