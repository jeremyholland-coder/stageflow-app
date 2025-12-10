import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, ensureValidSession } from '../lib/supabase';

// Safe storage helpers to avoid crashes when localStorage is blocked (e.g., Safari Private Mode)
const getStorage = () => (typeof window !== 'undefined' ? window.localStorage : null);
const safeGetItem = (key) => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (err) {
    console.warn('[useRevenueHealth] localStorage getItem unavailable:', err?.message || err);
    return null;
  }
};
const safeSetItem = (key, value) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn('[useRevenueHealth] localStorage setItem unavailable:', err?.message || err);
  }
};

/**
 * REVENUE AGENT: Revenue Health Hook
 *
 * Fetches continuous revenue projections and AI coach interpretation from
 * the ai-revenue-health endpoint.
 *
 * Features:
 * - LocalStorage caching with 60-minute TTL (hourly refresh)
 * - Opportunistic evaluation on mount (calls endpoint if cache is stale)
 * - Graceful degradation on errors
 * - AbortController for proper cleanup
 *
 * The endpoint:
 * 1. Runs deterministic revenue calculations (no AI)
 * 2. Calls AI once to interpret as "Revenue Coach"
 * 3. Logs as AI usage
 *
 * @param {Object} user - Current user object
 * @param {Object} organization - Current organization object
 * @param {boolean} hasAIProvider - Whether AI provider is configured (from useAIProviderStatus)
 * @param {Object} options - Configuration options
 * @param {number} options.cacheTTL - Cache time-to-live in ms (default: 60 minutes)
 * @param {string} options.mode - 'hourly' | 'daily' | 'weekly' | 'monthly' (default: 'hourly')
 * @returns {Object} { projection, coach, loading, error, refresh, lastUpdated }
 */
export function useRevenueHealth(user, organization, hasAIProvider = false, options = {}) {
  const { cacheTTL = 60 * 60 * 1000, mode = 'hourly' } = options; // 60 minutes default

  const [projection, setProjection] = useState(null);
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Track if we've made a request this session to avoid duplicate calls
  const hasFetchedRef = useRef(false);

  const fetchRevenueHealth = useCallback(async (abortSignal, forceRefresh = false) => {
    if (!user?.id || !organization?.id) {
      setLoading(false);
      return;
    }

    // Check cache first (unless force refresh)
    const cacheKey = `revenue_health_${organization.id}_${user.id}`;
    if (!forceRefresh) {
      const cached = safeGetItem(cacheKey);
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          const age = Date.now() - timestamp;

          if (age < cacheTTL) {
            // Cache hit - use cached data
            setProjection(data.projection);
            setCoach(data.coach);
            setLastUpdated(new Date(timestamp));
            setLoading(false);
            setError(null);
            console.info('[useRevenueHealth] Cache hit:', { age: Math.round(age / 1000) + 's' });
            return;
          }
        } catch (err) {
          console.debug('[useRevenueHealth] Corrupted cache, fetching fresh');
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      if (abortSignal?.aborted) return;

      // Ensure valid session for auth
      await ensureValidSession();
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/.netlify/functions/ai-revenue-health', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organization.id,
          user_id: user.id,
          mode,
        }),
        signal: abortSignal,
      });

      if (abortSignal?.aborted) return;

      if (!response.ok) {
        // Handle auth errors gracefully
        if (response.status === 401 || response.status === 403) {
          console.warn('[useRevenueHealth] Auth error, using cache if available');
          // Try to use stale cache
          const cached = safeGetItem(cacheKey);
          if (cached) {
            try {
              const { data } = JSON.parse(cached);
              setProjection(data.projection);
              setCoach(data.coach);
              setError('Session expired - showing cached data');
            } catch (e) {
              // Can't recover
            }
          }
          setLoading(false);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (!result.ok) {
        // Backend returned error
        throw new Error(result.error || result.message || 'Revenue health fetch failed');
      }

      // Update state with fresh data
      setProjection(result.projection);
      setCoach(result.coach);
      setLastUpdated(new Date());
      setError(null);

      // Cache the result (best-effort)
      safeSetItem(cacheKey, JSON.stringify({
        data: {
          projection: result.projection,
          coach: result.coach,
        },
        timestamp: Date.now(),
      }));

      console.info('[useRevenueHealth] Fresh data fetched:', {
        hasProjection: !!result.projection,
        hasCoach: !!result.coach,
        aiAvailable: result.ai_available,
      });

    } catch (err) {
      if (abortSignal?.aborted) return;

      console.error('[useRevenueHealth] Fetch error:', err);

      // Try to use stale cache on error
      const cached = safeGetItem(cacheKey);
      if (cached) {
        try {
          const { data } = JSON.parse(cached);
          setProjection(data.projection);
          setCoach(data.coach);
          setError('Could not refresh - showing cached data');
        } catch (e) {
          setError(err.message || 'Failed to fetch revenue health');
        }
      } else {
        setError(err.message || 'Failed to fetch revenue health');
      }
    } finally {
      if (!abortSignal?.aborted) {
        setLoading(false);
        hasFetchedRef.current = true;
      }
    }
  }, [user?.id, organization?.id, mode, cacheTTL]);

  // Initial fetch on mount
  useEffect(() => {
    if (!user?.id || !organization?.id) {
      setProjection(null);
      setCoach(null);
      setLoading(false);
      setError(null);
      hasFetchedRef.current = false;
      return;
    }

    const abortController = new AbortController();

    // Check cache immediately for instant UI
    const cacheKey = `revenue_health_${organization.id}_${user.id}`;
    const cached = safeGetItem(cacheKey);

    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        // Show cached data immediately
        setProjection(data.projection);
        setCoach(data.coach);
        setLastUpdated(new Date(timestamp));
        setLoading(false);

        // If cache is fresh (< 60 min), skip API call
        if (age < cacheTTL) {
          console.info('[useRevenueHealth] Using fresh cache, skipping API call');
          return;
        }

        // Cache is stale - trigger background refresh
        console.info('[useRevenueHealth] Cache stale, background refresh');
        setTimeout(() => {
          if (!abortController.signal.aborted) {
            fetchRevenueHealth(abortController.signal);
          }
        }, 2000); // 2s delay for background refresh

        return;
      } catch (err) {
        // Corrupted cache - fetch fresh
      }
    }

    // No cache - fetch fresh with small delay
    setTimeout(() => {
      if (!abortController.signal.aborted) {
        fetchRevenueHealth(abortController.signal);
      }
    }, 500);

    return () => {
      abortController.abort();
    };
  }, [user?.id, organization?.id, cacheTTL, fetchRevenueHealth]);

  // Manual refresh function
  const refresh = useCallback(() => {
    if (!user?.id || !organization?.id) return Promise.resolve();

    const abortController = new AbortController();
    return fetchRevenueHealth(abortController.signal, true);
  }, [user?.id, organization?.id, fetchRevenueHealth]);

  return {
    // Projection data (always available if deals exist)
    projection,
    // AI coach interpretation (may be null if AI unavailable)
    coach,
    // Loading state
    loading,
    // Error message (null if no error)
    error,
    // Manual refresh function
    refresh,
    // Last successful update time
    lastUpdated,
    // Computed convenience properties
    monthPctToGoal: projection?.month_pct_to_goal ?? null,
    quarterPctToGoal: projection?.quarter_pct_to_goal ?? null,
    yearPctToGoal: projection?.year_pct_to_goal ?? null,
    riskFlags: projection?.risk_flags ?? [],
    isOnTrack: projection?.pace_month !== null ? projection.pace_month >= 0.9 : null,
  };
}
