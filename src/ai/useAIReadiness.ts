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
  checkProviders: () => Promise<{ hasProviders: boolean; count: number }>;
  checkConfig: () => Promise<{ ok: boolean; code?: string; message?: string }>;
  healthCheck: () => Promise<{
    ok: boolean;
    degraded?: boolean;
    networkError?: boolean;
    message?: string;
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

  // Keep services ref updated
  servicesRef.current = services;

  // Run the readiness check sequence
  const runReadinessCheck = useCallback(async () => {
    const currentServices = servicesRef.current;

    // Step 1: APP_BOOT -> SESSION_CHECKING
    dispatch({ type: 'APP_BOOT' });

    // Step 2: Check session
    try {
      const sessionResult = await currentServices.checkSession();
      if (!sessionResult.ok) {
        dispatch({
          type: 'SESSION_INVALID',
          reason: sessionResult.code || 'Session validation failed',
        });
        return; // STOP - session is invalid
      }
      dispatch({ type: 'SESSION_OK' });
    } catch (error) {
      dispatch({
        type: 'SESSION_INVALID',
        reason: error instanceof Error ? error.message : 'Session check failed',
      });
      return; // STOP - session check threw
    }

    // Step 3: Check providers
    try {
      const providersResult = await currentServices.checkProviders();
      if (providersResult.hasProviders && providersResult.count > 0) {
        dispatch({ type: 'PROVIDERS_FOUND', count: providersResult.count });
      } else {
        dispatch({ type: 'NO_PROVIDERS' });
        return; // STOP - no providers configured
      }
    } catch (error) {
      dispatch({ type: 'NO_PROVIDERS' });
      return; // STOP - provider check threw
    }

    // Step 4: Check config
    try {
      const configResult = await currentServices.checkConfig();
      if (!configResult.ok) {
        dispatch({
          type: 'CONFIG_ERROR',
          code: configResult.code || 'CONFIG_ERROR',
          message: configResult.message || 'Configuration check failed',
        });
        return; // STOP - config error
      }
      dispatch({ type: 'CONFIG_OK' });
    } catch (error) {
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

      if (healthResult.networkError) {
        dispatch({
          type: 'HEALTH_CHECK_FAILED',
          networkError: true,
          message: healthResult.message || 'Network error during health check',
        });
        return;
      }

      if (!healthResult.ok) {
        dispatch({
          type: 'HEALTH_CHECK_FAILED',
          networkError: false,
          message: healthResult.message || 'Health check failed',
        });
        return;
      }

      // Success!
      dispatch({
        type: 'HEALTH_CHECK_OK',
        degraded: healthResult.degraded ?? false,
      });
    } catch (error) {
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

  return {
    node,
    isReady: isAIReady(node),
    uiVariant: getAIUIVariant(node),
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

        if (result?.valid) {
          return { ok: true };
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
        return { hasProviders: false, count: 0 };
      }

      try {
        // Get session for auth header
        const { supabase } = await import('../lib/supabase');
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const response = await fetch('/.netlify/functions/get-ai-providers', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ organization_id: organizationId }),
        });

        if (!response.ok) {
          // Auth errors (401/403) should not be treated as "no providers"
          if (response.status === 401 || response.status === 403) {
            throw new Error('Auth error during provider check');
          }
          return { hasProviders: false, count: 0 };
        }

        const data = await response.json();
        const providers = data.providers || [];

        return {
          hasProviders: providers.length > 0,
          count: providers.length,
        };
      } catch (error) {
        console.error('[useWiredAIReadiness] Provider check error:', error);
        return { hasProviders: false, count: 0 };
      }
    },

    // -------------------------------------------------------------------------
    // checkConfig: Verifies backend AI configuration (ENCRYPTION_KEY, etc.)
    // -------------------------------------------------------------------------
    checkConfig: async () => {
      try {
        // Get session for auth header
        const { supabase } = await import('../lib/supabase');
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const response = await fetch('/.netlify/functions/ai-assistant', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            message: '__health_check__',
            deals: [],
            healthCheckOnly: true,
          }),
        });

        if (!response.ok) {
          return {
            ok: false,
            code: 'CONFIG_ERROR',
            message: `Config check failed with status ${response.status}`,
          };
        }

        const data = await response.json();

        // Check for config errors in response
        if (data.code === 'CONFIG_ERROR' || data.configHealthy === false) {
          return {
            ok: false,
            code: data.code || 'CONFIG_ERROR',
            message: data.error || 'AI configuration error',
          };
        }

        return { ok: true };
      } catch (error) {
        console.error('[useWiredAIReadiness] Config check error:', error);
        return {
          ok: false,
          code: 'CONFIG_ERROR',
          message:
            error instanceof Error ? error.message : 'Network error during config check',
        };
      }
    },

    // -------------------------------------------------------------------------
    // healthCheck: Performs a lightweight health check on AI services
    // -------------------------------------------------------------------------
    healthCheck: async () => {
      try {
        // Get session for auth header
        const { supabase } = await import('../lib/supabase');
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        // Use the same health check endpoint as config check
        // but interpret the response differently
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
          const response = await fetch('/.netlify/functions/ai-assistant', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
              message: '__health_check__',
              deals: [],
              healthCheckOnly: true,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            return {
              ok: false,
              networkError: false,
              message: `Health check returned ${response.status}`,
            };
          }

          const data = await response.json();

          // Check for degraded mode indicators
          const isDegraded = data.degraded === true || data.slow === true;

          return {
            ok: true,
            degraded: isDegraded,
          };
        } catch (fetchError) {
          clearTimeout(timeoutId);

          // AbortError means timeout - treat as network error
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            return {
              ok: false,
              networkError: true,
              message: 'Health check timed out',
            };
          }

          throw fetchError;
        }
      } catch (error) {
        console.error('[useWiredAIReadiness] Health check error:', error);
        return {
          ok: false,
          networkError: true,
          message: error instanceof Error ? error.message : 'Health check failed',
        };
      }
    },
  };

  return useAIReadiness(services);
}
