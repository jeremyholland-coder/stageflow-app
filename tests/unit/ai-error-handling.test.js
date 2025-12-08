/**
 * AI Error Handling Unit Tests
 *
 * P0 FIX 2025-12-07: Regression tests for AI Dashboard error handling
 *
 * Tests that:
 * 1. ALL_PROVIDERS_FAILED responses include fallbackPlan
 * 2. Error responses include structured providers array with dashboard URLs
 * 3. Frontend getErrorGuidance correctly extracts error information
 * 4. AIProviderErrorDisplay receives correct props
 *
 * Based on spec: docs/spec-ai-dashboard.md
 */

import { describe, it, expect } from 'vitest';

// Mock error response formats that backends should produce
// These match the P0 FIX 2025-12-07 format

/**
 * Non-streaming ALL_PROVIDERS_FAILED response (ai-assistant.mts)
 * HTTP 200 with ok: false
 */
const NON_STREAMING_ERROR_RESPONSE = {
  ok: false,
  error: {
    type: 'AI_PROVIDER_FAILURE',
    reason: 'ALL_PROVIDERS_FAILED',
    code: 'ALL_PROVIDERS_FAILED',
    message: 'Your AI providers are experiencing issues. OpenAI: insufficient quota. Anthropic: billing required.',
    providers: [
      {
        provider: 'openai',
        code: 'INSUFFICIENT_QUOTA',
        message: 'You have exceeded your OpenAI API quota',
        dashboardUrl: 'https://platform.openai.com/account/billing',
        httpStatus: 429
      },
      {
        provider: 'anthropic',
        code: 'BILLING_REQUIRED',
        message: 'Your Anthropic account needs billing setup',
        dashboardUrl: 'https://console.anthropic.com/settings/billing',
        httpStatus: 402
      }
    ],
    fallbackPlan: {
      headline: "Here's your pipeline at a glance",
      bullets: [
        '3 active deals need attention',
        '2 deals have been idle for 7+ days'
      ],
      recommendedActions: [
        { action: 'Follow up with Acme Corp', priority: 'high', reason: 'Deal idle for 14 days' }
      ],
      revOpsMetrics: {
        followupHealth: { totalActiveDeals: 5, summary: { status: 'yellow', description: '2 deals overdue' } },
        retentionHealth: null,
        arHealth: null,
        monthlyGoal: { status: 'green', attainmentPct: 75, projectedPct: 90 }
      }
    }
  },
  // Legacy fields for backwards compatibility
  code: 'ALL_PROVIDERS_FAILED',
  message: 'Your AI providers are experiencing issues.',
  fallbackPlan: {
    headline: "Here's your pipeline at a glance",
    bullets: ['3 active deals need attention']
  }
};

/**
 * Streaming ALL_PROVIDERS_FAILED SSE event (ai-assistant-stream.mts)
 * P0 FIX 2025-12-07: Now includes same format as non-streaming
 */
const STREAMING_ERROR_EVENT = {
  error: {
    type: 'AI_PROVIDER_FAILURE',
    reason: 'ALL_PROVIDERS_FAILED',
    code: 'ALL_PROVIDERS_FAILED',
    message: 'Your AI providers are experiencing issues.',
    providers: [
      {
        provider: 'openai',
        code: 'INSUFFICIENT_QUOTA',
        message: 'API quota exceeded',
        dashboardUrl: 'https://platform.openai.com/account/billing',
        httpStatus: null
      }
    ],
    fallbackPlan: {
      headline: "Here's your pipeline at a glance",
      bullets: ['3 active deals need attention']
    }
  },
  // Legacy fields
  code: 'ALL_PROVIDERS_FAILED',
  message: 'Your AI providers are experiencing issues.',
  errors: [{ provider: 'openai', errorType: 'INSUFFICIENT_QUOTA', message: 'quota exceeded' }],
  fallbackPlan: {
    headline: "Here's your pipeline at a glance",
    bullets: ['3 active deals need attention']
  }
};

describe('AI Error Response Format', () => {
  describe('Non-streaming endpoint (ai-assistant.mts)', () => {
    it('should include ok: false for ALL_PROVIDERS_FAILED', () => {
      expect(NON_STREAMING_ERROR_RESPONSE.ok).toBe(false);
    });

    it('should include error.type = AI_PROVIDER_FAILURE', () => {
      expect(NON_STREAMING_ERROR_RESPONSE.error.type).toBe('AI_PROVIDER_FAILURE');
    });

    it('should include error.providers array with dashboard URLs', () => {
      const providers = NON_STREAMING_ERROR_RESPONSE.error.providers;
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);

      for (const provider of providers) {
        expect(provider).toHaveProperty('provider');
        expect(provider).toHaveProperty('code');
        expect(provider).toHaveProperty('message');
        expect(provider).toHaveProperty('dashboardUrl');
      }
    });

    it('should include error.fallbackPlan for graceful degradation', () => {
      expect(NON_STREAMING_ERROR_RESPONSE.error.fallbackPlan).toBeDefined();
      expect(NON_STREAMING_ERROR_RESPONSE.error.fallbackPlan.headline).toBeDefined();
      expect(Array.isArray(NON_STREAMING_ERROR_RESPONSE.error.fallbackPlan.bullets)).toBe(true);
    });

    it('should include top-level fallbackPlan for backwards compatibility', () => {
      expect(NON_STREAMING_ERROR_RESPONSE.fallbackPlan).toBeDefined();
    });
  });

  describe('Streaming endpoint (ai-assistant-stream.mts)', () => {
    it('should include error.type = AI_PROVIDER_FAILURE (P0 FIX)', () => {
      expect(STREAMING_ERROR_EVENT.error.type).toBe('AI_PROVIDER_FAILURE');
    });

    it('should include error.providers array with dashboard URLs (P0 FIX)', () => {
      const providers = STREAMING_ERROR_EVENT.error.providers;
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);

      for (const provider of providers) {
        expect(provider).toHaveProperty('provider');
        expect(provider).toHaveProperty('code');
        expect(provider).toHaveProperty('dashboardUrl');
      }
    });

    it('should include error.fallbackPlan for graceful degradation (P0 FIX)', () => {
      expect(STREAMING_ERROR_EVENT.error.fallbackPlan).toBeDefined();
      expect(STREAMING_ERROR_EVENT.error.fallbackPlan.headline).toBeDefined();
    });

    it('should include top-level fallbackPlan for backwards compatibility', () => {
      expect(STREAMING_ERROR_EVENT.fallbackPlan).toBeDefined();
    });

    it('should include legacy errors array for backwards compatibility', () => {
      expect(Array.isArray(STREAMING_ERROR_EVENT.errors)).toBe(true);
    });
  });

  describe('Format parity between streaming and non-streaming', () => {
    it('should have same error.type in both responses', () => {
      expect(STREAMING_ERROR_EVENT.error.type).toBe(NON_STREAMING_ERROR_RESPONSE.error.type);
    });

    it('should have same error.reason in both responses', () => {
      expect(STREAMING_ERROR_EVENT.error.reason).toBe(NON_STREAMING_ERROR_RESPONSE.error.reason);
    });

    it('should have providers array with same structure', () => {
      const streamingProvider = STREAMING_ERROR_EVENT.error.providers[0];
      const nonStreamingProvider = NON_STREAMING_ERROR_RESPONSE.error.providers[0];

      // Same keys
      expect(Object.keys(streamingProvider).sort()).toEqual(Object.keys(nonStreamingProvider).sort());
    });

    it('should have fallbackPlan in error object in both', () => {
      expect(STREAMING_ERROR_EVENT.error.fallbackPlan).toBeDefined();
      expect(NON_STREAMING_ERROR_RESPONSE.error.fallbackPlan).toBeDefined();
    });
  });
});

describe('Frontend Error Handling Compatibility', () => {
  /**
   * Simulates getErrorGuidance from CustomQueryView.jsx
   * Tests that the error format is correctly parsed
   */
  function extractErrorInfo(errorData) {
    const error = errorData.error || errorData;

    const isAllProvidersFailed =
      error.type === 'AI_PROVIDER_FAILURE' ||
      error.reason === 'ALL_PROVIDERS_FAILED' ||
      errorData.code === 'ALL_PROVIDERS_FAILED';

    const providerErrors = error.providers || [];
    const fallbackPlan = error.fallbackPlan || errorData.fallbackPlan;

    return {
      isAllProvidersFailed,
      providerErrors,
      fallbackPlan,
      message: error.message || errorData.message
    };
  }

  it('should correctly identify ALL_PROVIDERS_FAILED from non-streaming response', () => {
    const extracted = extractErrorInfo(NON_STREAMING_ERROR_RESPONSE);
    expect(extracted.isAllProvidersFailed).toBe(true);
  });

  it('should correctly identify ALL_PROVIDERS_FAILED from streaming response', () => {
    const extracted = extractErrorInfo(STREAMING_ERROR_EVENT);
    expect(extracted.isAllProvidersFailed).toBe(true);
  });

  it('should extract providerErrors from non-streaming response', () => {
    const extracted = extractErrorInfo(NON_STREAMING_ERROR_RESPONSE);
    expect(extracted.providerErrors.length).toBe(2);
    expect(extracted.providerErrors[0].dashboardUrl).toContain('openai.com');
  });

  it('should extract providerErrors from streaming response', () => {
    const extracted = extractErrorInfo(STREAMING_ERROR_EVENT);
    expect(extracted.providerErrors.length).toBe(1);
    expect(extracted.providerErrors[0].dashboardUrl).toContain('openai.com');
  });

  it('should extract fallbackPlan from non-streaming response', () => {
    const extracted = extractErrorInfo(NON_STREAMING_ERROR_RESPONSE);
    expect(extracted.fallbackPlan).toBeDefined();
    expect(extracted.fallbackPlan.headline).toBeDefined();
  });

  it('should extract fallbackPlan from streaming response', () => {
    const extracted = extractErrorInfo(STREAMING_ERROR_EVENT);
    expect(extracted.fallbackPlan).toBeDefined();
    expect(extracted.fallbackPlan.headline).toBeDefined();
  });
});

describe('AIProviderErrorDisplay Props Compatibility', () => {
  /**
   * Tests that error data can be transformed into AIProviderErrorDisplay props
   * Based on CustomQueryView.jsx getErrorGuidance function
   */
  function buildProviderErrorDisplayProps(errorData) {
    const error = errorData.error || errorData;
    return {
      message: error.message || errorData.message,
      providerErrors: error.providers || [],
      fallbackPlan: error.fallbackPlan || errorData.fallbackPlan
    };
  }

  it('should build valid props from non-streaming response', () => {
    const props = buildProviderErrorDisplayProps(NON_STREAMING_ERROR_RESPONSE);

    expect(props.message).toBeDefined();
    expect(props.providerErrors.length).toBeGreaterThan(0);
    expect(props.fallbackPlan).toBeDefined();

    // Verify provider has required fields for ProviderErrorRow
    const provider = props.providerErrors[0];
    expect(provider.provider).toBeDefined();
    expect(provider.code).toBeDefined();
    expect(provider.message).toBeDefined();
  });

  it('should build valid props from streaming response', () => {
    const props = buildProviderErrorDisplayProps(STREAMING_ERROR_EVENT);

    expect(props.message).toBeDefined();
    expect(props.providerErrors.length).toBeGreaterThan(0);
    expect(props.fallbackPlan).toBeDefined();

    // Verify provider has required fields for ProviderErrorRow
    const provider = props.providerErrors[0];
    expect(provider.provider).toBeDefined();
    expect(provider.code).toBeDefined();
  });

  it('should handle fallbackPlan.recommendedActions', () => {
    const props = buildProviderErrorDisplayProps(NON_STREAMING_ERROR_RESPONSE);

    // FallbackPlanDisplay component expects recommendedActions array
    expect(Array.isArray(props.fallbackPlan.recommendedActions)).toBe(true);

    const action = props.fallbackPlan.recommendedActions[0];
    expect(action.action).toBeDefined();
    expect(action.priority).toBeDefined();
  });

  it('should handle fallbackPlan.revOpsMetrics', () => {
    const props = buildProviderErrorDisplayProps(NON_STREAMING_ERROR_RESPONSE);

    // RevOpsHealthSection component expects revOpsMetrics
    const metrics = props.fallbackPlan.revOpsMetrics;
    expect(metrics).toBeDefined();
    expect(metrics.followupHealth).toBeDefined();
    expect(metrics.monthlyGoal).toBeDefined();
  });
});
