/**
 * useAIReadiness Hook Tests
 *
 * Tests for the AI readiness helper functions and types.
 * The core state machine logic is already tested in aiReadinessMachine.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  isAIReady,
  getAIUIVariant,
  AIUIVariant,
} from '../../src/ai/useAIReadiness';
import {
  AIReadinessNode,
  AIReadinessState,
  initialAIReadinessContext,
} from '../../src/ai/aiReadinessMachine';

// Helper to create a node with a specific state
function createNode(state: AIReadinessState): AIReadinessNode {
  return {
    state,
    context: { ...initialAIReadinessContext },
  };
}

describe('useAIReadiness helpers', () => {
  describe('isAIReady', () => {
    it('should return true for AI_READY state', () => {
      const node = createNode('AI_READY');
      expect(isAIReady(node)).toBe(true);
    });

    it('should return true for AI_DEGRADED state', () => {
      const node = createNode('AI_DEGRADED');
      expect(isAIReady(node)).toBe(true);
    });

    it('should return false for UNINITIALIZED state', () => {
      const node = createNode('UNINITIALIZED');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for SESSION_CHECKING state', () => {
      const node = createNode('SESSION_CHECKING');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for SESSION_INVALID state', () => {
      const node = createNode('SESSION_INVALID');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for PROVIDER_CHECKING state', () => {
      const node = createNode('PROVIDER_CHECKING');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for PROVIDER_NOT_CONFIGURED state', () => {
      const node = createNode('PROVIDER_NOT_CONFIGURED');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for CONFIG_CHECKING state', () => {
      const node = createNode('CONFIG_CHECKING');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for CONFIG_ERROR state', () => {
      const node = createNode('CONFIG_ERROR');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for HEALTH_CHECK_PENDING state', () => {
      const node = createNode('HEALTH_CHECK_PENDING');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for HEALTH_CHECK_FAILED state', () => {
      const node = createNode('HEALTH_CHECK_FAILED');
      expect(isAIReady(node)).toBe(false);
    });

    it('should return false for AI_DISABLED state', () => {
      const node = createNode('AI_DISABLED');
      expect(isAIReady(node)).toBe(false);
    });
  });

  describe('getAIUIVariant', () => {
    // Loading states
    describe('loading variant', () => {
      const loadingStates: AIReadinessState[] = [
        'UNINITIALIZED',
        'SESSION_CHECKING',
        'PROVIDER_CHECKING',
        'CONFIG_CHECKING',
        'HEALTH_CHECK_PENDING',
      ];

      loadingStates.forEach((state) => {
        it(`should return 'loading' for ${state}`, () => {
          const node = createNode(state);
          expect(getAIUIVariant(node)).toBe('loading');
        });
      });
    });

    // Error/warning states
    it('should return "session_invalid" for SESSION_INVALID', () => {
      const node = createNode('SESSION_INVALID');
      expect(getAIUIVariant(node)).toBe('session_invalid');
    });

    it('should return "connect_provider" for PROVIDER_NOT_CONFIGURED', () => {
      const node = createNode('PROVIDER_NOT_CONFIGURED');
      expect(getAIUIVariant(node)).toBe('connect_provider');
    });

    it('should return "config_error" for CONFIG_ERROR', () => {
      const node = createNode('CONFIG_ERROR');
      expect(getAIUIVariant(node)).toBe('config_error');
    });

    it('should return "health_warning" for HEALTH_CHECK_FAILED', () => {
      const node = createNode('HEALTH_CHECK_FAILED');
      expect(getAIUIVariant(node)).toBe('health_warning');
    });

    it('should return "disabled" for AI_DISABLED', () => {
      const node = createNode('AI_DISABLED');
      expect(getAIUIVariant(node)).toBe('disabled');
    });

    // Success states
    it('should return "ready" for AI_READY', () => {
      const node = createNode('AI_READY');
      expect(getAIUIVariant(node)).toBe('ready');
    });

    it('should return "degraded" for AI_DEGRADED', () => {
      const node = createNode('AI_DEGRADED');
      expect(getAIUIVariant(node)).toBe('degraded');
    });
  });

  describe('AIUIVariant type coverage', () => {
    it('should have all expected variants', () => {
      const allVariants: AIUIVariant[] = [
        'loading',
        'session_invalid',
        'connect_provider',
        'config_error',
        'health_warning',
        'ready',
        'degraded',
        'disabled',
      ];

      // Every state should map to one of these variants
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
        const node = createNode(state);
        const variant = getAIUIVariant(node);
        expect(allVariants).toContain(variant);
      });
    });
  });

  describe('state to variant mapping consistency', () => {
    it('should map ready states to ready/degraded variants', () => {
      const readyVariants = ['ready', 'degraded'];

      // AI_READY and AI_DEGRADED are the only "usable" states
      expect(readyVariants).toContain(getAIUIVariant(createNode('AI_READY')));
      expect(readyVariants).toContain(getAIUIVariant(createNode('AI_DEGRADED')));
    });

    it('should map error states to non-ready variants', () => {
      const errorStates: AIReadinessState[] = [
        'SESSION_INVALID',
        'PROVIDER_NOT_CONFIGURED',
        'CONFIG_ERROR',
        'HEALTH_CHECK_FAILED',
        'AI_DISABLED',
      ];

      errorStates.forEach((state) => {
        const node = createNode(state);
        const isReadyResult = isAIReady(node);
        expect(isReadyResult).toBe(false);
      });
    });

    it('isAIReady should be consistent with ready/degraded variants', () => {
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
        const node = createNode(state);
        const ready = isAIReady(node);
        const variant = getAIUIVariant(node);

        if (ready) {
          expect(['ready', 'degraded']).toContain(variant);
        } else {
          expect(['ready', 'degraded']).not.toContain(variant);
        }
      });
    });
  });
});
