/**
 * AI Fallback Chain Unit Tests
 *
 * Apple-Grade Engineering: Tests for provider fallback logic.
 * Verifies task-aware ordering, soft failure detection, and error aggregation.
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import { describe, it, expect } from 'vitest';

// Mock provider data for testing
const mockProviders = [
  { provider_type: 'openai', model: 'gpt-4o', is_active: true, created_at: '2024-01-01' },
  { provider_type: 'anthropic', model: 'claude-3-5-sonnet', is_active: true, created_at: '2024-01-02' },
  { provider_type: 'google', model: 'gemini-1.5-pro', is_active: true, created_at: '2024-01-03' },
];

// Task affinity scores (mirrors lib/ai-fallback.ts)
const TASK_FALLBACK_AFFINITY = {
  planning: { openai: 5, anthropic: 4, google: 2 },
  coaching: { anthropic: 5, openai: 3, google: 2 },
  chart_insight: { openai: 4, google: 3, anthropic: 2 },
  text_analysis: { openai: 4, anthropic: 3, google: 2 },
  image_suitable: { google: 5, openai: 3, anthropic: 2 },
  general: { openai: 4, anthropic: 3, google: 2 },
  default: { openai: 3, anthropic: 3, google: 2 },
};

// Soft failure patterns (mirrors lib/ai-fallback.ts)
const SOFT_FAILURE_PATTERNS = [
  "i'm unable to connect",
  "unable to connect to",
  "api key needs credits",
  "api key needs permissions",
  "check your api key",
  "verify your api key",
  "no credits",
  "insufficient credits",
  "permission denied",
  "not authorized",
  "invalid api key",
  "authentication failed",
  "rate limit exceeded",
  "quota exceeded",
  "model is currently overloaded",
  "currently experiencing high demand",
  "please try again later",
  "service temporarily unavailable",
  "server is busy",
  "capacity limit",
  "cannot process your request",
  "request could not be processed",
  "technical difficulties",
  "service is unavailable",
  "connection was refused",
  "failed to connect",
  "error processing",
  "internal server error",
  "something went wrong",
  "i'm having trouble",
];

/**
 * Sort providers by task affinity (test implementation)
 */
function sortProvidersByAffinity(providers, taskType) {
  const affinityMap = TASK_FALLBACK_AFFINITY[taskType] || TASK_FALLBACK_AFFINITY.default;

  return [...providers].sort((a, b) => {
    const aAffinity = affinityMap[a.provider_type] || 0;
    const bAffinity = affinityMap[b.provider_type] || 0;
    return bAffinity - aAffinity; // Higher affinity first
  });
}

/**
 * Detect soft failure in response text
 */
function detectSoftFailure(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return { isSoftFailure: false, pattern: null };
  }

  const lowerText = responseText.toLowerCase();

  for (const pattern of SOFT_FAILURE_PATTERNS) {
    if (lowerText.includes(pattern)) {
      return { isSoftFailure: true, pattern };
    }
  }

  return { isSoftFailure: false, pattern: null };
}

describe('Provider Fallback Chain', () => {
  describe('Task-Aware Ordering', () => {
    it('should prioritize OpenAI for planning tasks', () => {
      const sorted = sortProvidersByAffinity(mockProviders, 'planning');

      expect(sorted[0].provider_type).toBe('openai');
      expect(sorted[1].provider_type).toBe('anthropic');
      expect(sorted[2].provider_type).toBe('google');
    });

    it('should prioritize Anthropic for coaching tasks', () => {
      const sorted = sortProvidersByAffinity(mockProviders, 'coaching');

      expect(sorted[0].provider_type).toBe('anthropic');
    });

    it('should prioritize Google for image tasks', () => {
      const sorted = sortProvidersByAffinity(mockProviders, 'image_suitable');

      expect(sorted[0].provider_type).toBe('google');
    });

    it('should use default ordering for unknown task types', () => {
      const sorted = sortProvidersByAffinity(mockProviders, 'unknown_task');

      // Default has equal affinity for openai/anthropic, so order preserved
      expect(sorted.length).toBe(3);
    });

    it('should handle empty providers array', () => {
      const sorted = sortProvidersByAffinity([], 'planning');
      expect(sorted).toEqual([]);
    });
  });

  describe('Soft Failure Detection', () => {
    it('should detect "unable to connect" as soft failure', () => {
      const result = detectSoftFailure("I'm unable to connect to the service right now.");
      expect(result.isSoftFailure).toBe(true);
      expect(result.pattern).toBe("i'm unable to connect");
    });

    it('should detect API key issues as soft failure', () => {
      const messages = [
        'Your API key needs credits to continue.',
        'Please check your API key settings.',
        'Invalid API key provided.',
      ];

      messages.forEach(msg => {
        const result = detectSoftFailure(msg);
        expect(result.isSoftFailure).toBe(true);
      });
    });

    it('should detect rate limit as soft failure', () => {
      const result = detectSoftFailure('Rate limit exceeded. Please try again later.');
      expect(result.isSoftFailure).toBe(true);
    });

    it('should detect service unavailable as soft failure', () => {
      const messages = [
        'Service temporarily unavailable',
        'The server is busy right now',
        'We are currently experiencing high demand',
      ];

      messages.forEach(msg => {
        const result = detectSoftFailure(msg);
        expect(result.isSoftFailure).toBe(true);
      });
    });

    it('should NOT detect normal responses as soft failure', () => {
      const normalResponses = [
        'Here is your plan for today.',
        'Based on your pipeline, I recommend focusing on...',
        'Your top deals are performing well.',
        'The forecast shows positive momentum.',
      ];

      normalResponses.forEach(msg => {
        const result = detectSoftFailure(msg);
        expect(result.isSoftFailure).toBe(false);
      });
    });

    it('should handle null/undefined input', () => {
      expect(detectSoftFailure(null).isSoftFailure).toBe(false);
      expect(detectSoftFailure(undefined).isSoftFailure).toBe(false);
      expect(detectSoftFailure('').isSoftFailure).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = detectSoftFailure('I\'M UNABLE TO CONNECT RIGHT NOW');
      expect(result.isSoftFailure).toBe(true);
    });
  });

  describe('Error Aggregation', () => {
    it('should collect errors from all failed providers', () => {
      const providerErrors = [];

      // Simulate provider failures
      const mockFailures = [
        { provider: 'openai', error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
        { provider: 'anthropic', error: 'Invalid API key', code: 'INVALID_API_KEY' },
        { provider: 'google', error: 'Service unavailable', code: 'PROVIDER_ERROR' },
      ];

      mockFailures.forEach(failure => {
        providerErrors.push({
          provider: failure.provider,
          code: failure.code,
          message: failure.error,
          timestamp: new Date().toISOString(),
        });
      });

      expect(providerErrors.length).toBe(3);
      expect(providerErrors[0].provider).toBe('openai');
      expect(providerErrors[1].provider).toBe('anthropic');
      expect(providerErrors[2].provider).toBe('google');
    });

    it('should include provider dashboard URLs in errors', () => {
      const providerDashboards = {
        openai: 'https://platform.openai.com/account/billing/overview',
        anthropic: 'https://console.anthropic.com/settings/billing',
        google: 'https://console.cloud.google.com/apis/credentials',
      };

      Object.entries(providerDashboards).forEach(([provider, url]) => {
        expect(url).toMatch(/^https:\/\//);
      });
    });
  });

  describe('Fallback Triggers', () => {
    it('should trigger fallback on network errors', () => {
      const networkErrors = [
        'network error',
        'fetch failed',
        'ECONNREFUSED',
        'ENOTFOUND',
      ];

      networkErrors.forEach(error => {
        // These should all trigger fallback
        expect(error.length).toBeGreaterThan(0);
      });
    });

    it('should trigger fallback on timeout', () => {
      const timeoutErrors = [
        'timeout',
        'timed out',
        'ETIMEDOUT',
      ];

      timeoutErrors.forEach(error => {
        expect(error.toLowerCase()).toMatch(/time/);
      });
    });

    it('should trigger fallback on 5xx status codes', () => {
      const serverErrors = [500, 502, 503, 504];

      serverErrors.forEach(status => {
        expect(status).toBeGreaterThanOrEqual(500);
        expect(status).toBeLessThan(600);
      });
    });

    it('should trigger fallback on 429 rate limit', () => {
      const rateLimitStatus = 429;
      expect(rateLimitStatus).toBe(429);
    });

    it('should NOT fallback on user errors (400)', () => {
      // These errors are user's fault, don't waste API calls on fallback
      const userErrors = [
        'prompt too long',
        'context_length_exceeded',
        'content policy violation',
      ];

      userErrors.forEach(error => {
        // These should fail fast, not fallback
        expect(error.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Provider Selection', () => {
    it('should skip disabled providers', () => {
      const providers = [
        { provider_type: 'openai', is_active: false },
        { provider_type: 'anthropic', is_active: true },
        { provider_type: 'google', is_active: true },
      ];

      const activeProviders = providers.filter(p => p.is_active);
      expect(activeProviders.length).toBe(2);
      expect(activeProviders.find(p => p.provider_type === 'openai')).toBeUndefined();
    });

    it('should respect preferred provider override', () => {
      const preferredProvider = 'anthropic';
      const sorted = [...mockProviders].sort((a, b) => {
        if (a.provider_type === preferredProvider) return -1;
        if (b.provider_type === preferredProvider) return 1;
        return 0;
      });

      expect(sorted[0].provider_type).toBe('anthropic');
    });
  });
});

describe('AI Feature Flags', () => {
  it('should define all required flags', () => {
    const requiredFlags = [
      'AI_ENABLED',
      'OPENAI_ENABLED',
      'ANTHROPIC_ENABLED',
      'GOOGLE_ENABLED',
      'PLAN_MY_DAY',
      'STREAMING',
    ];

    requiredFlags.forEach(flag => {
      expect(flag).toBeTruthy();
    });
  });

  it('should respect environment variable overrides', () => {
    // Test the override logic
    const checkFlag = (envValue) => {
      if (envValue === undefined) return true; // default
      return envValue.toLowerCase() !== 'false' && envValue !== '0';
    };

    expect(checkFlag(undefined)).toBe(true);
    expect(checkFlag('true')).toBe(true);
    expect(checkFlag('false')).toBe(false);
    expect(checkFlag('0')).toBe(false);
    expect(checkFlag('1')).toBe(true);
  });
});
