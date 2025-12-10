import { describe, it, expect } from 'vitest';
import {
  aiReadinessReducer,
  initialAIReadinessNode,
  initialAIReadinessContext,
  AIReadinessNode,
  AIReadinessEvent,
  AIReadinessState,
} from '../../src/ai/aiReadinessMachine';

describe('aiReadinessMachine', () => {
  describe('initialAIReadinessNode', () => {
    it('should start in UNINITIALIZED state', () => {
      expect(initialAIReadinessNode.state).toBe('UNINITIALIZED');
    });

    it('should have initial context with default values', () => {
      expect(initialAIReadinessContext.lastCheckedAt).toBeNull();
      expect(initialAIReadinessContext.hasSession).toBeUndefined();
      expect(initialAIReadinessContext.hasProviders).toBeUndefined();
      expect(initialAIReadinessContext.providerCount).toBeUndefined();
      expect(initialAIReadinessContext.configHealthy).toBeUndefined();
      expect(initialAIReadinessContext.degraded).toBeUndefined();
      expect(initialAIReadinessContext.lastErrorCode).toBeNull();
      expect(initialAIReadinessContext.lastErrorMessage).toBeNull();
      expect(initialAIReadinessContext.lastHealthCheckNetworkError).toBeUndefined();
      expect(initialAIReadinessContext.disabledByPlan).toBe(false);
    });
  });

  describe('aiReadinessReducer', () => {
    // =========================================================================
    // UNINITIALIZED state transitions
    // =========================================================================
    describe('UNINITIALIZED state', () => {
      it('should transition to SESSION_CHECKING on APP_BOOT', () => {
        const node = initialAIReadinessNode;
        const event: AIReadinessEvent = { type: 'APP_BOOT' };

        const result = aiReadinessReducer(node, event);

        expect(result.state).toBe('SESSION_CHECKING');
        expect(result.context.lastCheckedAt).toBeTruthy();
      });

      it('should stay in UNINITIALIZED for unhandled events', () => {
        const node = initialAIReadinessNode;
        const event: AIReadinessEvent = { type: 'SESSION_OK' };

        const result = aiReadinessReducer(node, event);

        expect(result.state).toBe('UNINITIALIZED');
      });
    });

    // =========================================================================
    // SESSION_CHECKING state transitions
    // =========================================================================
    describe('SESSION_CHECKING state', () => {
      const sessionCheckingNode: AIReadinessNode = {
        state: 'SESSION_CHECKING',
        context: { ...initialAIReadinessContext },
      };

      it('should transition to PROVIDER_CHECKING on SESSION_OK', () => {
        const event: AIReadinessEvent = { type: 'SESSION_OK' };

        const result = aiReadinessReducer(sessionCheckingNode, event);

        expect(result.state).toBe('PROVIDER_CHECKING');
        expect(result.context.hasSession).toBe(true);
      });

      it('should transition to SESSION_INVALID on SESSION_INVALID', () => {
        const event: AIReadinessEvent = { type: 'SESSION_INVALID', reason: 'Token expired' };

        const result = aiReadinessReducer(sessionCheckingNode, event);

        expect(result.state).toBe('SESSION_INVALID');
        expect(result.context.hasSession).toBe(false);
        expect(result.context.lastErrorCode).toBe('SESSION_INVALID');
        expect(result.context.lastErrorMessage).toBe('Token expired');
      });

      it('should transition to AI_DISABLED on AI_DISABLED_BY_PLAN', () => {
        const event: AIReadinessEvent = { type: 'AI_DISABLED_BY_PLAN' };

        const result = aiReadinessReducer(sessionCheckingNode, event);

        expect(result.state).toBe('AI_DISABLED');
        expect(result.context.disabledByPlan).toBe(true);
      });
    });

    // =========================================================================
    // PROVIDER_CHECKING state transitions
    // =========================================================================
    describe('PROVIDER_CHECKING state', () => {
      const providerCheckingNode: AIReadinessNode = {
        state: 'PROVIDER_CHECKING',
        context: { ...initialAIReadinessContext, hasSession: true },
      };

      it('should transition to CONFIG_CHECKING on PROVIDERS_FOUND with count > 0', () => {
        const event: AIReadinessEvent = { type: 'PROVIDERS_FOUND', count: 2 };

        const result = aiReadinessReducer(providerCheckingNode, event);

        expect(result.state).toBe('CONFIG_CHECKING');
        expect(result.context.hasProviders).toBe(true);
        expect(result.context.providerCount).toBe(2);
      });

      it('should transition to PROVIDER_NOT_CONFIGURED on PROVIDERS_FOUND with count = 0', () => {
        const event: AIReadinessEvent = { type: 'PROVIDERS_FOUND', count: 0 };

        const result = aiReadinessReducer(providerCheckingNode, event);

        expect(result.state).toBe('PROVIDER_NOT_CONFIGURED');
        expect(result.context.hasProviders).toBe(false);
        expect(result.context.providerCount).toBe(0);
      });

      it('should transition to PROVIDER_NOT_CONFIGURED on NO_PROVIDERS', () => {
        const event: AIReadinessEvent = { type: 'NO_PROVIDERS' };

        const result = aiReadinessReducer(providerCheckingNode, event);

        expect(result.state).toBe('PROVIDER_NOT_CONFIGURED');
        expect(result.context.hasProviders).toBe(false);
        expect(result.context.providerCount).toBe(0);
      });

      it('should transition to SESSION_INVALID on SESSION_INVALID', () => {
        const event: AIReadinessEvent = { type: 'SESSION_INVALID' };

        const result = aiReadinessReducer(providerCheckingNode, event);

        expect(result.state).toBe('SESSION_INVALID');
        expect(result.context.hasSession).toBe(false);
      });
    });

    // =========================================================================
    // PROVIDER_NOT_CONFIGURED state transitions
    // =========================================================================
    describe('PROVIDER_NOT_CONFIGURED state', () => {
      const providerNotConfiguredNode: AIReadinessNode = {
        state: 'PROVIDER_NOT_CONFIGURED',
        context: { ...initialAIReadinessContext, hasProviders: false, providerCount: 0 },
      };

      it('should transition to CONFIG_CHECKING on PROVIDERS_FOUND with count > 0', () => {
        const event: AIReadinessEvent = { type: 'PROVIDERS_FOUND', count: 1 };

        const result = aiReadinessReducer(providerNotConfiguredNode, event);

        expect(result.state).toBe('CONFIG_CHECKING');
        expect(result.context.hasProviders).toBe(true);
        expect(result.context.providerCount).toBe(1);
      });

      it('should stay in PROVIDER_NOT_CONFIGURED for unhandled events', () => {
        const event: AIReadinessEvent = { type: 'CONFIG_OK' };

        const result = aiReadinessReducer(providerNotConfiguredNode, event);

        expect(result.state).toBe('PROVIDER_NOT_CONFIGURED');
      });
    });

    // =========================================================================
    // CONFIG_CHECKING state transitions
    // =========================================================================
    describe('CONFIG_CHECKING state', () => {
      const configCheckingNode: AIReadinessNode = {
        state: 'CONFIG_CHECKING',
        context: { ...initialAIReadinessContext, hasSession: true, hasProviders: true },
      };

      it('should transition to HEALTH_CHECK_PENDING on CONFIG_OK', () => {
        const event: AIReadinessEvent = { type: 'CONFIG_OK' };

        const result = aiReadinessReducer(configCheckingNode, event);

        expect(result.state).toBe('HEALTH_CHECK_PENDING');
        expect(result.context.configHealthy).toBe(true);
      });

      it('should transition to CONFIG_ERROR on CONFIG_ERROR', () => {
        const event: AIReadinessEvent = {
          type: 'CONFIG_ERROR',
          code: 'MISSING_API_KEY',
          message: 'API key not configured',
        };

        const result = aiReadinessReducer(configCheckingNode, event);

        expect(result.state).toBe('CONFIG_ERROR');
        expect(result.context.configHealthy).toBe(false);
        expect(result.context.lastErrorCode).toBe('MISSING_API_KEY');
        expect(result.context.lastErrorMessage).toBe('API key not configured');
      });

      it('should transition to SESSION_INVALID on SESSION_INVALID', () => {
        const event: AIReadinessEvent = { type: 'SESSION_INVALID' };

        const result = aiReadinessReducer(configCheckingNode, event);

        expect(result.state).toBe('SESSION_INVALID');
      });
    });

    // =========================================================================
    // CONFIG_ERROR state transitions
    // =========================================================================
    describe('CONFIG_ERROR state', () => {
      const configErrorNode: AIReadinessNode = {
        state: 'CONFIG_ERROR',
        context: {
          ...initialAIReadinessContext,
          configHealthy: false,
          lastErrorCode: 'CONFIG_ERROR',
        },
      };

      it('should transition to HEALTH_CHECK_PENDING on CONFIG_OK (retry)', () => {
        const event: AIReadinessEvent = { type: 'CONFIG_OK' };

        const result = aiReadinessReducer(configErrorNode, event);

        expect(result.state).toBe('HEALTH_CHECK_PENDING');
        expect(result.context.configHealthy).toBe(true);
      });
    });

    // =========================================================================
    // HEALTH_CHECK_PENDING state transitions
    // =========================================================================
    describe('HEALTH_CHECK_PENDING state', () => {
      const healthCheckPendingNode: AIReadinessNode = {
        state: 'HEALTH_CHECK_PENDING',
        context: { ...initialAIReadinessContext, configHealthy: true },
      };

      it('should transition to AI_READY on HEALTH_CHECK_OK with degraded=false', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: false };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('AI_READY');
        expect(result.context.degraded).toBe(false);
      });

      it('should transition to AI_READY on HEALTH_CHECK_OK with degraded undefined', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK' };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('AI_READY');
        expect(result.context.degraded).toBe(false);
      });

      it('should transition to AI_DEGRADED on HEALTH_CHECK_OK with degraded=true', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: true };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('AI_DEGRADED');
        expect(result.context.degraded).toBe(true);
      });

      it('should transition to HEALTH_CHECK_FAILED on HEALTH_CHECK_FAILED with networkError=true', () => {
        const event: AIReadinessEvent = {
          type: 'HEALTH_CHECK_FAILED',
          networkError: true,
          message: 'Network timeout',
        };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('HEALTH_CHECK_FAILED');
        expect(result.context.lastHealthCheckNetworkError).toBe(true);
        expect(result.context.lastErrorMessage).toBe('Network timeout');
      });

      it('should transition to HEALTH_CHECK_FAILED on HEALTH_CHECK_FAILED with networkError=false', () => {
        const event: AIReadinessEvent = {
          type: 'HEALTH_CHECK_FAILED',
          networkError: false,
          message: 'Service unavailable',
        };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('HEALTH_CHECK_FAILED');
        expect(result.context.lastHealthCheckNetworkError).toBe(false);
      });

      it('should transition to SESSION_INVALID on SESSION_EXPIRED', () => {
        const event: AIReadinessEvent = { type: 'SESSION_EXPIRED' };

        const result = aiReadinessReducer(healthCheckPendingNode, event);

        expect(result.state).toBe('SESSION_INVALID');
        expect(result.context.hasSession).toBe(false);
      });
    });

    // =========================================================================
    // HEALTH_CHECK_FAILED state transitions
    // =========================================================================
    describe('HEALTH_CHECK_FAILED state', () => {
      const healthCheckFailedNode: AIReadinessNode = {
        state: 'HEALTH_CHECK_FAILED',
        context: { ...initialAIReadinessContext, lastHealthCheckNetworkError: true },
      };

      it('should transition to AI_READY on HEALTH_CHECK_OK (retry)', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: false };

        const result = aiReadinessReducer(healthCheckFailedNode, event);

        expect(result.state).toBe('AI_READY');
      });

      it('should transition to AI_DEGRADED on HEALTH_CHECK_OK with degraded=true (retry)', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: true };

        const result = aiReadinessReducer(healthCheckFailedNode, event);

        expect(result.state).toBe('AI_DEGRADED');
      });
    });

    // =========================================================================
    // AI_READY state transitions
    // =========================================================================
    describe('AI_READY state', () => {
      const aiReadyNode: AIReadinessNode = {
        state: 'AI_READY',
        context: { ...initialAIReadinessContext, degraded: false },
      };

      it('should transition to SESSION_INVALID on SESSION_EXPIRED', () => {
        const event: AIReadinessEvent = { type: 'SESSION_EXPIRED' };

        const result = aiReadinessReducer(aiReadyNode, event);

        expect(result.state).toBe('SESSION_INVALID');
        expect(result.context.hasSession).toBe(false);
      });

      it('should transition to SESSION_INVALID on SESSION_INVALID', () => {
        const event: AIReadinessEvent = { type: 'SESSION_INVALID', reason: 'Token revoked' };

        const result = aiReadinessReducer(aiReadyNode, event);

        expect(result.state).toBe('SESSION_INVALID');
        expect(result.context.lastErrorMessage).toBe('Token revoked');
      });

      it('should transition to AI_DEGRADED on HEALTH_CHECK_OK with degraded=true', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: true };

        const result = aiReadinessReducer(aiReadyNode, event);

        expect(result.state).toBe('AI_DEGRADED');
        expect(result.context.degraded).toBe(true);
      });

      it('should stay in AI_READY on HEALTH_CHECK_OK with degraded=false', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: false };

        const result = aiReadinessReducer(aiReadyNode, event);

        expect(result.state).toBe('AI_READY');
      });

      it('should transition to HEALTH_CHECK_FAILED on HEALTH_CHECK_FAILED', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_FAILED', networkError: true };

        const result = aiReadinessReducer(aiReadyNode, event);

        expect(result.state).toBe('HEALTH_CHECK_FAILED');
      });
    });

    // =========================================================================
    // AI_DEGRADED state transitions
    // =========================================================================
    describe('AI_DEGRADED state', () => {
      const aiDegradedNode: AIReadinessNode = {
        state: 'AI_DEGRADED',
        context: { ...initialAIReadinessContext, degraded: true },
      };

      it('should transition to AI_READY on HEALTH_CHECK_OK with degraded=false', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: false };

        const result = aiReadinessReducer(aiDegradedNode, event);

        expect(result.state).toBe('AI_READY');
        expect(result.context.degraded).toBe(false);
      });

      it('should stay in AI_DEGRADED on HEALTH_CHECK_OK with degraded=true', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_OK', degraded: true };

        const result = aiReadinessReducer(aiDegradedNode, event);

        expect(result.state).toBe('AI_DEGRADED');
      });

      it('should transition to SESSION_INVALID on SESSION_EXPIRED', () => {
        const event: AIReadinessEvent = { type: 'SESSION_EXPIRED' };

        const result = aiReadinessReducer(aiDegradedNode, event);

        expect(result.state).toBe('SESSION_INVALID');
      });

      it('should transition to SESSION_INVALID on SESSION_INVALID', () => {
        const event: AIReadinessEvent = { type: 'SESSION_INVALID' };

        const result = aiReadinessReducer(aiDegradedNode, event);

        expect(result.state).toBe('SESSION_INVALID');
      });

      it('should transition to HEALTH_CHECK_FAILED on HEALTH_CHECK_FAILED', () => {
        const event: AIReadinessEvent = { type: 'HEALTH_CHECK_FAILED', networkError: false };

        const result = aiReadinessReducer(aiDegradedNode, event);

        expect(result.state).toBe('HEALTH_CHECK_FAILED');
      });
    });

    // =========================================================================
    // AI_DISABLED state transitions
    // =========================================================================
    describe('AI_DISABLED state', () => {
      const aiDisabledNode: AIReadinessNode = {
        state: 'AI_DISABLED',
        context: { ...initialAIReadinessContext, disabledByPlan: true },
      };

      it('should stay in AI_DISABLED for APP_BOOT', () => {
        const event: AIReadinessEvent = { type: 'APP_BOOT' };

        const result = aiReadinessReducer(aiDisabledNode, event);

        expect(result.state).toBe('AI_DISABLED');
      });

      it('should stay in AI_DISABLED for SESSION_OK', () => {
        const event: AIReadinessEvent = { type: 'SESSION_OK' };

        const result = aiReadinessReducer(aiDisabledNode, event);

        expect(result.state).toBe('AI_DISABLED');
      });

      it('should transition to UNINITIALIZED on RESET', () => {
        const event: AIReadinessEvent = { type: 'RESET' };

        const result = aiReadinessReducer(aiDisabledNode, event);

        expect(result.state).toBe('UNINITIALIZED');
        expect(result.context.disabledByPlan).toBe(false);
      });
    });

    // =========================================================================
    // RESET from any state
    // =========================================================================
    describe('RESET event', () => {
      const allStates: AIReadinessState[] = [
        'UNINITIALIZED',
        'SESSION_CHECKING',
        'SESSION_INVALID',
        'PROVIDER_CHECKING',
        'PROVIDER_NOT_CONFIGURED',
        'CONFIG_CHECKING',
        'CONFIG_ERROR',
        'HEALTH_CHECK_PENDING',
        'AI_READY',
        'AI_DEGRADED',
        'HEALTH_CHECK_FAILED',
        'AI_DISABLED',
      ];

      allStates.forEach((state) => {
        it(`should reset to UNINITIALIZED from ${state}`, () => {
          const node: AIReadinessNode = {
            state,
            context: {
              ...initialAIReadinessContext,
              hasSession: true,
              hasProviders: true,
              lastErrorCode: 'SOME_ERROR',
            },
          };
          const event: AIReadinessEvent = { type: 'RESET' };

          const result = aiReadinessReducer(node, event);

          expect(result.state).toBe('UNINITIALIZED');
          expect(result.context.hasSession).toBeUndefined();
          expect(result.context.hasProviders).toBeUndefined();
          expect(result.context.lastErrorCode).toBeNull();
        });
      });
    });

    // =========================================================================
    // Full happy path integration test
    // =========================================================================
    describe('full happy path', () => {
      it('should transition from UNINITIALIZED to AI_READY through all states', () => {
        let node = initialAIReadinessNode;

        // APP_BOOT
        node = aiReadinessReducer(node, { type: 'APP_BOOT' });
        expect(node.state).toBe('SESSION_CHECKING');

        // SESSION_OK
        node = aiReadinessReducer(node, { type: 'SESSION_OK' });
        expect(node.state).toBe('PROVIDER_CHECKING');
        expect(node.context.hasSession).toBe(true);

        // PROVIDERS_FOUND
        node = aiReadinessReducer(node, { type: 'PROVIDERS_FOUND', count: 2 });
        expect(node.state).toBe('CONFIG_CHECKING');
        expect(node.context.hasProviders).toBe(true);
        expect(node.context.providerCount).toBe(2);

        // CONFIG_OK
        node = aiReadinessReducer(node, { type: 'CONFIG_OK' });
        expect(node.state).toBe('HEALTH_CHECK_PENDING');
        expect(node.context.configHealthy).toBe(true);

        // HEALTH_CHECK_OK
        node = aiReadinessReducer(node, { type: 'HEALTH_CHECK_OK', degraded: false });
        expect(node.state).toBe('AI_READY');
        expect(node.context.degraded).toBe(false);
      });

      it('should handle degraded mode flow', () => {
        let node = initialAIReadinessNode;

        node = aiReadinessReducer(node, { type: 'APP_BOOT' });
        node = aiReadinessReducer(node, { type: 'SESSION_OK' });
        node = aiReadinessReducer(node, { type: 'PROVIDERS_FOUND', count: 1 });
        node = aiReadinessReducer(node, { type: 'CONFIG_OK' });
        node = aiReadinessReducer(node, { type: 'HEALTH_CHECK_OK', degraded: true });

        expect(node.state).toBe('AI_DEGRADED');
        expect(node.context.degraded).toBe(true);

        // Recovery
        node = aiReadinessReducer(node, { type: 'HEALTH_CHECK_OK', degraded: false });
        expect(node.state).toBe('AI_READY');
        expect(node.context.degraded).toBe(false);
      });
    });

    // =========================================================================
    // SESSION_INVALID state transitions (recovery)
    // =========================================================================
    describe('SESSION_INVALID state', () => {
      const sessionInvalidNode: AIReadinessNode = {
        state: 'SESSION_INVALID',
        context: {
          ...initialAIReadinessContext,
          hasSession: false,
          lastErrorCode: 'SESSION_INVALID',
        },
      };

      it('should transition to PROVIDER_CHECKING on SESSION_OK (session restored)', () => {
        const event: AIReadinessEvent = { type: 'SESSION_OK' };

        const result = aiReadinessReducer(sessionInvalidNode, event);

        expect(result.state).toBe('PROVIDER_CHECKING');
        expect(result.context.hasSession).toBe(true);
        expect(result.context.lastErrorCode).toBeNull();
      });
    });
  });
});
