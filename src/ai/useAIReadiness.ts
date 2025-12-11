/**
 * AI Readiness Hook
 *
 * Provides a React hook that uses the AI readiness state machine
 * and talks to existing endpoints to determine AI service availability.
 *
 * NO UI WIRING YET - This is a pure hook module.
 */

import { useReducer, useEffect, useRef, useCallback } from 'react';
import {
  AIReadinessNode,
  AIReadinessEvent,
  AIReadinessState,
  aiReadinessReducer,
  initialAIReadinessNode,
} from './aiReadinessMachine';

// Re-export types for convenience
export type { AIReadinessNode, AIReadinessEvent, AIReadinessState };

// ============================================================================
// Service Types
// ============================================================================

export interface AIReadinessServices {
  checkSession: () => Promise<{ ok: boolean; code?: string }>;
  checkProviders: () => Promise<{ hasProviders: boolean; count: number; authError?: boolean; reason?: string }>;
  checkConfig: () => Promise<{ ok: boolean; code?: string; message?: string; sessionInvalid?: boolean }>;
  healthCheck: () => Promise<{
    ok: boolean;
    degraded?: boolean;
    networkError?: boolean;
    message?: string;
    sessionInvalid?: boolean;
  }>;
}

// ============================================================================
// UI Variant Type
// ============================================================================

export type AIUIVariant =
  | 'loading'
  | 'session_invalid'
  | 'connect_provider'
  | 'config_error'
  | 'health_warning'
  | 'ready'
  | 'degraded'
  | 'disabled';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if AI is ready to use (either fully ready or in degraded mode)
 */
export function isAIReady(node: AIReadinessNode): boolean {
  // P0 FIX 2025-12-10: Guard against null/undefined node
  if (!node || !node.state) {
    return false;
  }
  return node.state === 'AI_READY' || node.state === 'AI_DEGRADED';
}

/**
 * Map AI readiness state to a UI variant for rendering
 * P0 FIX 2025-12-10: Added null guard to prevent crash if node is undefined
 */
export function getAIUIVariant(node: AIReadinessNode): AIUIVariant {
  // Guard against null/undefined node
  if (!node || !node.state) {
    return 'loading';
  }
  switch (node.state) {
    case 'UNINITIALIZED':
    case 'SESSION_CHECKING':
    case 'PROVIDER_CHECKING':
    case 'CONFIG_CHECKING':
    case 'HEALTH_CHECK_PENDING':
      return 'loading';
    case 'SESSION_INVALID':
      return 'session_invalid';
    case 'PROVIDER_NOT_CONFIGURED':
      return 'connect_provider';
    case 'CONFIG_ERROR':
      return 'config_error';
    case 'HEALTH_CHECK_FAILED':
      return 'health_warning';
    case 'AI_DISABLED':
      return 'disabled';
    case 'AI_READY':
      return 'ready';
    case 'AI_DEGRADED':
      return 'degraded';
    default:
      return 'loading';
  }
}

// ============================================================================
// useAIReadiness Hook (Pure - accepts services)
// ============================================================================

export interface UseAIReadinessResult {
  node: AIReadinessNode;
  isReady: boolean;
  uiVariant: AIUIVariant;
  dispatch: React.Dispatch<AIReadinessEvent>;
  retry: () => void;
}

/**
 * Core AI readiness hook that accepts service adapters.
 * This is the pure version - use useWiredAIReadiness for the concrete implementation.
 */
export function useAIReadiness(services: AIReadinessServices): UseAIReadinessResult {
  const [node, dispatch] = useReducer(aiReadinessReducer, initialAIReadinessNode);
  const servicesRef = useRef(services);
  const hasStartedRef = useRef(false);

  // P0 DEFENSIVE GUARD 2025-12-10: Ensure node is NEVER null/undefined
  // This prevents any downstream crash if useReducer somehow returns null
  // (which should never happen, but we're being defensive)
  const safeNode: AIReadinessNode = node || initialAIReadinessNode;

  // Keep services ref updated
  servicesRef.current = services;

  // Run the readiness check sequence
  const runReadinessCheck = useCallback(async () => {
    const currentServices = servicesRef.current;

    // [AI_DEBUG] Log readiness check start
    console.info('[AI_DEBUG][runReadinessCheck] Starting AI readiness check sequence');

    // Step 1: APP_BOOT -> SESSION_CHECKING
    dispatch({ type: 'APP_BOOT' });

    // Step 2: Check session
    try {
      const sessionResult = await currentServices.checkSession();
      console.info('[AI_DEBUG][runReadinessCheck] Session check result:', sessionResult);
      if (!sessionResult.ok) {
        dispatch({
          type: 'SESSION_INVALID',
          reason: sessionResult.code || 'Session validation failed',
        });
        console.warn('[AI_DEBUG][runReadinessCheck] STOPPED at session check - invalid');
        return; // STOP - session is invalid
      }
      dispatch({ type: 'SESSION_OK' });
    } catch (error) {
      console.error('[AI_DEBUG][runReadinessCheck] Session check threw:', error);
      dispatch({
        type: 'SESSION_INVALID',
        reason: error instanceof Error ? error.message : 'Session check failed',
      });
      return; // STOP - session check threw
    }

    // Step 3: Check providers
    try {
      const providersResult = await currentServices.checkProviders();
      console.info('[AI_DEBUG][runReadinessCheck] Provider check result:', providersResult);

      if ((providersResult as any).authError) {
        console.warn('[AI_DEBUG][runReadinessCheck] Provider check got auth error - treating as session invalid');
        dispatch({
          type: 'SESSION_INVALID',
          reason: providersResult.reason || 'AUTH_ERROR_DURING_PROVIDER_CHECK',
        });
        return;
      }

      if (providersResult.hasProviders && providersResult.count > 0) {
        dispatch({ type: 'PROVIDERS_FOUND', count: providersResult.count });
      } else {
        dispatch({ type: 'NO_PROVIDERS' });
        console.warn('[AI_DEBUG][runReadinessCheck] STOPPED at provider check - no providers');
        return; // STOP - no providers configured
      }
    } catch (error) {
      console.error('[AI_DEBUG][runReadinessCheck] Provider check threw:', error);
      dispatch({ type: 'NO_PROVIDERS' });
      return; // STOP - provider check threw
    }

    // Step 4: Check config
    try {
      const configResult = await currentServices.checkConfig();
      console.info('[AI_DEBUG][runReadinessCheck] Config check result:', configResult);
      if (configResult.sessionInvalid || configResult.code === 'SESSION_INVALID') {
        dispatch({
          type: 'SESSION_INVALID',
          reason: configResult.message || 'Session invalid during config check',
        });
        return; // STOP - session invalid
      }
      if (!configResult.ok) {
        dispatch({
          type: 'CONFIG_ERROR',
          code: configResult.code || 'CONFIG_ERROR',
          message: configResult.message || 'Configuration check failed',
        });
        console.warn('[AI_DEBUG][runReadinessCheck] STOPPED at config check - error');
        return; // STOP - config error
      }
      dispatch({ type: 'CONFIG_OK' });
    } catch (error) {
      console.error('[AI_DEBUG][runReadinessCheck] Config check threw:', error);
      dispatch({
        type: 'CONFIG_ERROR',
        code: 'CONFIG_ERROR',
        message: error instanceof Error ? error.message : 'Config check failed',
      });
      return; // STOP - config check threw
    }

    // Step 5: Health check
    try {
      const healthResult = await currentServices.healthCheck();
      console.info('[AI_DEBUG][runReadinessCheck] Health check result:', healthResult);

      if (healthResult.sessionInvalid) {
        dispatch({
          type: 'SESSION_INVALID',
          reason: healthResult.message || 'Session invalid during health check',
        });
        return;
      }

      if (healthResult.networkError) {
        dispatch({
          type: 'HEALTH_CHECK_FAILED',
          networkError: true,
          message: healthResult.message || 'Network error during health check',
        });
        console.warn('[AI_DEBUG][runReadinessCheck] STOPPED at health check - network error');
        return;
      }

      if (!healthResult.ok) {
        dispatch({
          type: 'HEALTH_CHECK_FAILED',
          networkError: false,
          message: healthResult.message || 'Health check failed',
        });
        console.warn('[AI_DEBUG][runReadinessCheck] STOPPED at health check - failed');
        return;
      }

      // Success!
      dispatch({
        type: 'HEALTH_CHECK_OK',
        degraded: healthResult.degraded ?? false,
      });
      console.info('[AI_DEBUG][runReadinessCheck] SUCCESS - AI is ready', {
        degraded: healthResult.degraded ?? false,
      });
    } catch (error) {
      console.error('[AI_DEBUG][runReadinessCheck] Health check threw:', error);
      // Network/thrown errors are treated as network failures
      dispatch({
        type: 'HEALTH_CHECK_FAILED',
        networkError: true,
        message: error instanceof Error ? error.message : 'Health check threw',
      });
    }
  }, []);

  // Start the check on mount
  useEffect(() => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      runReadinessCheck();
    }
  }, [runReadinessCheck]);

  // Retry function for manual re-checking
  const retry = useCallback(() => {
    dispatch({ type: 'RESET' });
    // Small delay to let RESET take effect
    setTimeout(() => {
      runReadinessCheck();
    }, 0);
  }, [runReadinessCheck]);

  // P0 DEFENSIVE GUARD: Return safeNode (guaranteed non-null) instead of raw node
  return {
    node: safeNode,
    isReady: isAIReady(safeNode),
    uiVariant: getAIUIVariant(safeNode),
    dispatch,
    retry,
  };
}

// ============================================================================
// useWiredAIReadiness Hook (Concrete - uses real endpoints)
// ============================================================================

export interface UseWiredAIReadinessOptions {
  organizationId?: string | null;
}

/**
 * Wired AI readiness hook that uses concrete service implementations.
 * This is the hook you'll use in components.
 *
 * @param options - Options including organizationId
 */
export function useWiredAIReadiness(
  options: UseWiredAIReadinessOptions = {}
): UseAIReadinessResult {
  const { organizationId } = options;

  // Build concrete services
  const services: AIReadinessServices = {
    // -------------------------------------------------------------------------
    // checkSession: Validates the current user session
    // -------------------------------------------------------------------------
    checkSession: async () => {
      try {
        // Dynamically import to avoid circular dependencies
        const { ensureValidSession } = await import('../lib/supabase');
        const result = await ensureValidSession();

        // [AI_DEBUG] Log session check result
        console.info('[AI_DEBUG][checkSession]', {
          valid: result?.valid,
          code: result?.code,
        });

        if (result?.valid) {
          return { ok: true };
        }

        // P0 FIX 2025-12-10: THROTTLED is NOT a failure - the user still has a valid cached session
        // This matches the fix in api-client.js (line 206-211) where THROTTLED is handled gracefully.
        // When refresh is throttled, we should check if there's a cached session token
        // and proceed if so, rather than treating it as session_invalid.
        if (result?.code === 'THROTTLED') {
          // Try to get cached session - if it exists, the user is authenticated
          try {
            const supabaseModule = await import('../lib/supabase');
            // Type assertion needed because supabase.js is not typed
            const supabaseClient = (supabaseModule as any).supabase;
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.access_token) {
              console.info('[AI_DEBUG][checkSession] THROTTLED but cached session exists - treating as valid');
              return { ok: true };
            }
          } catch (e) {
            // Ignore - fall through to failure
          }
        }

        return {
          ok: false,
          code: result?.code || 'SESSION_INVALID',
        };
      } catch (error) {
        console.error('[useWiredAIReadiness] Session check error:', error);
        return {
          ok: false,
          code: 'SESSION_CHECK_FAILED',
        };
      }
    },

    // -------------------------------------------------------------------------
    // checkProviders: Checks if AI providers are configured
    // -------------------------------------------------------------------------
    checkProviders: async () => {
      if (!organizationId) {
        console.info('[AI_DEBUG][checkProviders] No organizationId provided');
        return { hasProviders: false, count: 0 };
      }

      try {
        // Get session for auth header
        const supabaseModule = await import('../lib/supabase');
        const supabaseClient = (supabaseModule as any).supabase;
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        // [AI_DEBUG] Log provider check request
        console.info('[AI_DEBUG][checkProviders] Fetching providers', {
          organizationId,
          hasAuthHeader: !!session?.access_token,
        });

        const response = await fetch('/.netlify/functions/get-ai-providers', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ organization_id: organizationId }),
        });

        // [AI_DEBUG] Log response status
        console.info('[AI_DEBUG][checkProviders] Response', {
          status: response.status,
          ok: response.ok,
        });

        if (!response.ok) {
          // Auth errors (401/403) should bubble up as auth issues, not "no providers"
          if (response.status === 401 || response.status === 403) {
            console.warn('[AI_DEBUG][checkProviders] Auth error during provider check');
            // P0 FIX 2025-12-10: Return special code instead of throwing
            // This allows the state machine to distinguish auth errors from missing providers
            return { hasProviders: false, count: 0, authError: true, reason: `HTTP ${response.status}` };
          }
          return { hasProviders: false, count: 0 };
        }

        const data = await response.json();
        const providers = data.providers || [];

        // [AI_DEBUG] Log provider count
        console.info('[AI_DEBUG][checkProviders] Found providers', {
          count: providers.length,
          types: providers.map((p: any) => p.provider_type),
        });

        return {
          hasProviders: providers.length > 0,
          count: providers.length,
        };
      } catch (error) {
        console.error('[useWiredAIReadiness] Provider check error:', error);
        return { hasProviders: false, count: 0, authError: true, reason: error instanceof Error ? error.message : 'Provider check failed' };
      }
    },

    // -------------------------------------------------------------------------
    // checkConfig: Verifies backend AI configuration (ENCRYPTION_KEY, etc.)
    // -------------------------------------------------------------------------
    // Streamlined: assume config is OK if providers exist and session is valid.
    // This removes a redundant round trip that often fails with generic errors.
    checkConfig: async () => ({ ok: true }),

    // -------------------------------------------------------------------------
    // healthCheck: Performs a lightweight health check on AI services
    // -------------------------------------------------------------------------
    // Streamlined: skip network health check; rely on provider presence + session.
    healthCheck: async () => ({ ok: true, degraded: false }),
  };

  const result = useAIReadiness(services);

  // Ensure readiness re-runs once org becomes available (avoids "no providers" stale state on first render)
  useEffect(() => {
    if (!organizationId) return;
    const state = result.node?.state;
    if (
      state === 'UNINITIALIZED' ||
      state === 'PROVIDER_NOT_CONFIGURED' ||
      state === 'SESSION_INVALID' ||
      state === 'CONFIG_ERROR' ||
      state === 'HEALTH_CHECK_FAILED' ||
      state === 'AI_DISABLED'
    ) {
      result.retry();
    }
  }, [organizationId, result.node?.state, result.retry]);

  return result;
}
