/**
 * AI Readiness State Machine
 *
 * A pure, deterministic state machine for tracking AI service readiness.
 * This module has NO side effects and NO external dependencies.
 */

// ============================================================================
// State Types
// ============================================================================

export type AIReadinessState =
  | 'UNINITIALIZED'
  | 'SESSION_CHECKING'
  | 'SESSION_INVALID'
  | 'PROVIDER_CHECKING'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'CONFIG_CHECKING'
  | 'CONFIG_ERROR'
  | 'HEALTH_CHECK_PENDING'
  | 'AI_READY'
  | 'AI_DEGRADED'
  | 'HEALTH_CHECK_FAILED'
  | 'AI_DISABLED';

// ============================================================================
// Context Type
// ============================================================================

export interface AIReadinessContext {
  lastCheckedAt?: string | null;
  hasSession?: boolean;
  hasProviders?: boolean;
  providerCount?: number;
  configHealthy?: boolean;
  degraded?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastHealthCheckNetworkError?: boolean;
  disabledByPlan?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

export type AIReadinessEvent =
  | { type: 'APP_BOOT' }
  | { type: 'SESSION_OK' }
  | { type: 'SESSION_INVALID'; reason?: string }
  | { type: 'PROVIDERS_FOUND'; count: number }
  | { type: 'NO_PROVIDERS' }
  | { type: 'CONFIG_OK' }
  | { type: 'CONFIG_ERROR'; code?: string; message?: string }
  | { type: 'HEALTH_CHECK_OK'; degraded?: boolean }
  | { type: 'HEALTH_CHECK_FAILED'; networkError?: boolean; message?: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'AI_DISABLED_BY_PLAN' }
  | { type: 'RESET' };

// ============================================================================
// Node Type (State + Context)
// ============================================================================

export interface AIReadinessNode {
  state: AIReadinessState;
  context: AIReadinessContext;
}

// ============================================================================
// Initial Values
// ============================================================================

export const initialAIReadinessContext: AIReadinessContext = {
  lastCheckedAt: null,
  hasSession: undefined,
  hasProviders: undefined,
  providerCount: undefined,
  configHealthy: undefined,
  degraded: undefined,
  lastErrorCode: null,
  lastErrorMessage: null,
  lastHealthCheckNetworkError: undefined,
  disabledByPlan: false,
};

export const initialAIReadinessNode: AIReadinessNode = {
  state: 'UNINITIALIZED',
  context: initialAIReadinessContext,
};

// ============================================================================
// Reducer
// ============================================================================

export function aiReadinessReducer(
  node: AIReadinessNode,
  event: AIReadinessEvent
): AIReadinessNode {
  const { state, context } = node;

  // RESET is allowed from any state
  if (event.type === 'RESET') {
    return {
      state: 'UNINITIALIZED',
      context: { ...initialAIReadinessContext },
    };
  }

  switch (state) {
    // -------------------------------------------------------------------------
    // UNINITIALIZED
    // -------------------------------------------------------------------------
    case 'UNINITIALIZED': {
      if (event.type === 'APP_BOOT') {
        return {
          state: 'SESSION_CHECKING',
          context: {
            ...context,
            lastCheckedAt: new Date().toISOString(),
          },
        };
      }
      return node;
    }

    // -------------------------------------------------------------------------
    // SESSION_CHECKING
    // -------------------------------------------------------------------------
    case 'SESSION_CHECKING': {
      switch (event.type) {
        case 'SESSION_OK':
          return {
            state: 'PROVIDER_CHECKING',
            context: {
              ...context,
              hasSession: true,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          };
        case 'SESSION_INVALID':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage: event.reason ?? 'Session is invalid',
            },
          };
        case 'AI_DISABLED_BY_PLAN':
          return {
            state: 'AI_DISABLED',
            context: {
              ...context,
              disabledByPlan: true,
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // SESSION_INVALID
    // -------------------------------------------------------------------------
    case 'SESSION_INVALID': {
      // From SESSION_INVALID, we typically need a RESET to restart
      // But SESSION_OK could allow re-checking if session is restored
      if (event.type === 'SESSION_OK') {
        return {
          state: 'PROVIDER_CHECKING',
          context: {
            ...context,
            hasSession: true,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        };
      }
      return node;
    }

    // -------------------------------------------------------------------------
    // PROVIDER_CHECKING
    // -------------------------------------------------------------------------
    case 'PROVIDER_CHECKING': {
      switch (event.type) {
        case 'PROVIDERS_FOUND':
          if (event.count > 0) {
            return {
              state: 'CONFIG_CHECKING',
              context: {
                ...context,
                hasProviders: true,
                providerCount: event.count,
              },
            };
          }
          return {
            state: 'PROVIDER_NOT_CONFIGURED',
            context: {
              ...context,
              hasProviders: false,
              providerCount: 0,
            },
          };
        case 'NO_PROVIDERS':
          return {
            state: 'PROVIDER_NOT_CONFIGURED',
            context: {
              ...context,
              hasProviders: false,
              providerCount: 0,
            },
          };
        case 'SESSION_INVALID':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage: event.reason ?? 'Session is invalid',
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // PROVIDER_NOT_CONFIGURED
    // -------------------------------------------------------------------------
    case 'PROVIDER_NOT_CONFIGURED': {
      if (event.type === 'PROVIDERS_FOUND' && event.count > 0) {
        return {
          state: 'CONFIG_CHECKING',
          context: {
            ...context,
            hasProviders: true,
            providerCount: event.count,
          },
        };
      }
      return node;
    }

    // -------------------------------------------------------------------------
    // CONFIG_CHECKING
    // -------------------------------------------------------------------------
    case 'CONFIG_CHECKING': {
      switch (event.type) {
        case 'CONFIG_OK':
          return {
            state: 'HEALTH_CHECK_PENDING',
            context: {
              ...context,
              configHealthy: true,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          };
        case 'CONFIG_ERROR':
          return {
            state: 'CONFIG_ERROR',
            context: {
              ...context,
              configHealthy: false,
              lastErrorCode: event.code ?? 'CONFIG_ERROR',
              lastErrorMessage: event.message ?? 'Configuration error',
            },
          };
        case 'SESSION_INVALID':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage: event.reason ?? 'Session is invalid',
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // CONFIG_ERROR
    // -------------------------------------------------------------------------
    case 'CONFIG_ERROR': {
      // Allow retry via CONFIG_OK
      if (event.type === 'CONFIG_OK') {
        return {
          state: 'HEALTH_CHECK_PENDING',
          context: {
            ...context,
            configHealthy: true,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        };
      }
      return node;
    }

    // -------------------------------------------------------------------------
    // HEALTH_CHECK_PENDING
    // -------------------------------------------------------------------------
    case 'HEALTH_CHECK_PENDING': {
      switch (event.type) {
        case 'HEALTH_CHECK_OK':
          if (event.degraded) {
            return {
              state: 'AI_DEGRADED',
              context: {
                ...context,
                degraded: true,
                lastHealthCheckNetworkError: false,
              },
            };
          }
          return {
            state: 'AI_READY',
            context: {
              ...context,
              degraded: false,
              lastHealthCheckNetworkError: false,
            },
          };
        case 'HEALTH_CHECK_FAILED':
          return {
            state: 'HEALTH_CHECK_FAILED',
            context: {
              ...context,
              lastHealthCheckNetworkError: event.networkError ?? false,
              lastErrorMessage: event.message ?? 'Health check failed',
            },
          };
        case 'SESSION_INVALID':
        case 'SESSION_EXPIRED':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage:
                event.type === 'SESSION_INVALID'
                  ? (event.reason ?? 'Session is invalid')
                  : 'Session expired',
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // HEALTH_CHECK_FAILED
    // -------------------------------------------------------------------------
    case 'HEALTH_CHECK_FAILED': {
      // Allow retry
      if (event.type === 'HEALTH_CHECK_OK') {
        if (event.degraded) {
          return {
            state: 'AI_DEGRADED',
            context: {
              ...context,
              degraded: true,
              lastHealthCheckNetworkError: false,
              lastErrorMessage: null,
            },
          };
        }
        return {
          state: 'AI_READY',
          context: {
            ...context,
            degraded: false,
            lastHealthCheckNetworkError: false,
            lastErrorMessage: null,
          },
        };
      }
      return node;
    }

    // -------------------------------------------------------------------------
    // AI_READY
    // -------------------------------------------------------------------------
    case 'AI_READY': {
      switch (event.type) {
        case 'SESSION_EXPIRED':
        case 'SESSION_INVALID':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage:
                event.type === 'SESSION_INVALID'
                  ? (event.reason ?? 'Session is invalid')
                  : 'Session expired',
            },
          };
        case 'HEALTH_CHECK_OK':
          if (event.degraded) {
            return {
              state: 'AI_DEGRADED',
              context: {
                ...context,
                degraded: true,
              },
            };
          }
          return node;
        case 'HEALTH_CHECK_FAILED':
          return {
            state: 'HEALTH_CHECK_FAILED',
            context: {
              ...context,
              lastHealthCheckNetworkError: event.networkError ?? false,
              lastErrorMessage: event.message ?? 'Health check failed',
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // AI_DEGRADED
    // -------------------------------------------------------------------------
    case 'AI_DEGRADED': {
      switch (event.type) {
        case 'HEALTH_CHECK_OK':
          if (!event.degraded) {
            return {
              state: 'AI_READY',
              context: {
                ...context,
                degraded: false,
              },
            };
          }
          return node;
        case 'SESSION_EXPIRED':
        case 'SESSION_INVALID':
          return {
            state: 'SESSION_INVALID',
            context: {
              ...context,
              hasSession: false,
              lastErrorCode: 'SESSION_INVALID',
              lastErrorMessage:
                event.type === 'SESSION_INVALID'
                  ? (event.reason ?? 'Session is invalid')
                  : 'Session expired',
            },
          };
        case 'HEALTH_CHECK_FAILED':
          return {
            state: 'HEALTH_CHECK_FAILED',
            context: {
              ...context,
              lastHealthCheckNetworkError: event.networkError ?? false,
              lastErrorMessage: event.message ?? 'Health check failed',
            },
          };
        default:
          return node;
      }
    }

    // -------------------------------------------------------------------------
    // AI_DISABLED
    // -------------------------------------------------------------------------
    case 'AI_DISABLED': {
      // Only RESET can exit AI_DISABLED (handled at top of function)
      return node;
    }

    default: {
      // Exhaustive check - TypeScript will error if we miss a state
      const _exhaustive: never = state;
      return node;
    }
  }
}
