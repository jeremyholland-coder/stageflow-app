/**
 * Debug Mode Hook
 *
 * SECTION F: Provides diagnostic information when ?debug=1 is in the URL.
 * This helps founders and support debug issues without console access.
 *
 * Usage:
 * - Add ?debug=1 to any URL to show diagnostic panel
 * - Shows: auth state, provider status, deals count, API errors, etc.
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to check if debug mode is enabled via URL parameter
 * @returns {boolean} True if ?debug=1 is in the URL
 */
export function useDebugMode() {
  const [isDebugMode, setIsDebugMode] = useState(false);

  useEffect(() => {
    // Check URL for debug parameter
    const checkDebugParam = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const debugValue = urlParams.get('debug');
      setIsDebugMode(debugValue === '1' || debugValue === 'true');
    };

    // Check on mount
    checkDebugParam();

    // Listen for URL changes (e.g., popstate)
    window.addEventListener('popstate', checkDebugParam);

    return () => {
      window.removeEventListener('popstate', checkDebugParam);
    };
  }, []);

  return isDebugMode;
}

/**
 * Hook to collect diagnostic information
 * @param {Object} params - Dependencies for diagnostics
 * @param {Object} params.user - Current user object
 * @param {Object} params.organization - Current organization object
 * @param {boolean} params.hasProvider - AI provider status
 * @param {boolean} params.providerFetchError - Provider fetch error
 * @param {Array} params.deals - Deals array
 * @param {boolean} params.isOnline - Network status
 * @returns {Object} Diagnostic information object
 */
export function useDiagnosticInfo({
  user,
  organization,
  hasProvider,
  providerFetchError,
  providersLoaded,
  deals,
  isOnline = true
} = {}) {
  const [sessionInfo, setSessionInfo] = useState({
    hasSession: false,
    sessionChecked: false
  });

  // Check session status
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        setSessionInfo({
          hasSession: !!session?.access_token,
          sessionChecked: true,
          expiresAt: session?.expires_at
            ? new Date(session.expires_at * 1000).toISOString()
            : null
        });
      } catch (e) {
        setSessionInfo({
          hasSession: false,
          sessionChecked: true,
          error: e.message
        });
      }
    };
    checkSession();
  }, [user?.id]);

  return {
    timestamp: new Date().toISOString(),
    version: '1.7.93+',

    // Auth state
    auth: {
      hasUser: !!user,
      userId: user?.id ? `${user.id.substring(0, 8)}...` : null,
      hasOrg: !!organization,
      orgId: organization?.id ? `${organization.id.substring(0, 8)}...` : null,
      ...sessionInfo
    },

    // AI provider state
    ai: {
      providersLoaded,
      hasProvider,
      providerFetchError: providerFetchError || null,
      cacheKey: organization?.id ? `ai_provider_${organization.id.substring(0, 8)}...` : null,
      cachedValue: (() => {
        if (!organization?.id) return null;
        try {
          const cached = localStorage.getItem(`ai_provider_${organization.id}`);
          if (cached) {
            const { hasProvider: cv, timestamp } = JSON.parse(cached);
            return {
              hasProvider: cv,
              age: `${Math.round((Date.now() - timestamp) / 1000)}s`
            };
          }
        } catch (e) {}
        return null;
      })()
    },

    // Deals state
    deals: {
      count: deals?.length || 0,
      isArray: Array.isArray(deals),
      hasNull: deals?.some(d => d == null) || false
    },

    // Network state
    network: {
      isOnline,
      userAgent: navigator.userAgent.substring(0, 50) + '...'
    },

    // Environment
    env: {
      mode: import.meta.env.MODE,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL ? 'SET' : 'MISSING',
      supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY ? 'SET' : 'MISSING'
    }
  };
}

export default {
  useDebugMode,
  useDiagnosticInfo
};
