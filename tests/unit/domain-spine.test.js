/**
 * DOMAIN SPINE TESTS
 *
 * ENGINE REBUILD Phase 5: Comprehensive tests for the domain spine modules
 *
 * Tests ensure:
 * 1. Deal normalization produces consistent, valid objects
 * 2. AI error classification maps errors to correct codes
 * 3. AI response normalization extracts content from all provider formats
 * 4. Stage labels convert snake_case to human-readable names
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDeal,
  isValidStageId,
  isCoreStage,
  validateStage,
  isValidStatus,
  getImpliedStatusForStage,
  syncStageAndStatus,
  validateOutcome,
  clearOutcomeFields,
  CORE_STAGES,
  CORE_STAGES_SET,
} from '../../src/domain/deal';

import {
  classifyAIError,
  normalizeAIResponse,
  isAIErrorResponse,
  getProviderStatusFromError,
} from '../../src/domain/ai';

import {
  getStageDisplayName,
  getLostReasonDisplay,
  getDisqualifiedReasonDisplay,
  getOutcomeReasonDisplay,
  getStatusDisplay,
} from '../../src/domain/stageLabels';

// =============================================================================
// DEAL DOMAIN TESTS
// =============================================================================

describe('Deal Domain Spine', () => {
  describe('normalizeDeal', () => {
    const validRawDeal = {
      id: 'deal-uuid-123',
      organization_id: 'org-uuid-456',
      client: 'Test Corp',
      stage: 'lead_captured',
      status: 'active',
      value: 5000,
      created: '2025-01-01T00:00:00Z',
    };

    it('should normalize a valid deal object', () => {
      const normalized = normalizeDeal(validRawDeal);

      expect(normalized).not.toBeNull();
      expect(normalized.id).toBe('deal-uuid-123');
      expect(normalized.organization_id).toBe('org-uuid-456');
      expect(normalized.client).toBe('Test Corp');
      expect(normalized.stage).toBe('lead_captured');
      expect(normalized.status).toBe('active');
      expect(normalized.value).toBe(5000);
    });

    it('should return null for null input', () => {
      expect(normalizeDeal(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeDeal(undefined)).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(normalizeDeal('string')).toBeNull();
      expect(normalizeDeal(123)).toBeNull();
      expect(normalizeDeal([])).toBeNull();
    });

    it('should return null for missing id', () => {
      const missingId = { ...validRawDeal, id: undefined };
      expect(normalizeDeal(missingId)).toBeNull();
    });

    it('should return null for missing organization_id', () => {
      const missingOrgId = { ...validRawDeal, organization_id: null };
      expect(normalizeDeal(missingOrgId)).toBeNull();
    });

    it('should default stage to "lead" if invalid', () => {
      const invalidStage = { ...validRawDeal, stage: 'INVALID' };
      const normalized = normalizeDeal(invalidStage);

      expect(normalized.stage).toBe('lead');
    });

    it('should default status to "active" if invalid', () => {
      const invalidStatus = { ...validRawDeal, status: 'invalid' };
      const normalized = normalizeDeal(invalidStatus);

      expect(normalized.status).toBe('active');
    });

    it('should clamp confidence to 0-100', () => {
      const overConfidence = { ...validRawDeal, confidence: 150 };
      const normalized = normalizeDeal(overConfidence);
      expect(normalized.confidence).toBe(100);

      const underConfidence = { ...validRawDeal, confidence: -50 };
      const normalizedUnder = normalizeDeal(underConfidence);
      expect(normalizedUnder.confidence).toBe(0);
    });

    it('should handle client_name alias for client', () => {
      const withClientName = { ...validRawDeal, client: undefined, client_name: 'Alias Corp' };
      const normalized = normalizeDeal(withClientName);

      expect(normalized.client).toBe('Alias Corp');
    });

    it('should sync stage and status for terminal stages', () => {
      const wonDeal = { ...validRawDeal, stage: 'deal_won', status: 'active' };
      const normalized = normalizeDeal(wonDeal);

      expect(normalized.status).toBe('won');
    });

    it('should preserve outcome fields when present', () => {
      const lostDeal = {
        ...validRawDeal,
        stage: 'deal_lost',
        status: 'lost',
        lost_reason: 'competitor',
        lost_reason_notes: 'Price was better',
      };
      const normalized = normalizeDeal(lostDeal);

      expect(normalized.lost_reason).toBe('competitor');
      expect(normalized.lost_reason_notes).toBe('Price was better');
    });

    // ENGINE REBUILD Phase 9: NaN handling tests
    describe('NaN and invalid number handling', () => {
      it('should normalize NaN value to null', () => {
        const nanValue = { ...validRawDeal, value: NaN };
        const normalized = normalizeDeal(nanValue);

        expect(normalized.value).toBeNull();
      });

      it('should normalize string value to null', () => {
        const stringValue = { ...validRawDeal, value: 'abc' };
        const normalized = normalizeDeal(stringValue);

        expect(normalized.value).toBeNull();
      });

      it('should normalize undefined value to null', () => {
        const undefinedValue = { ...validRawDeal, value: undefined };
        const normalized = normalizeDeal(undefinedValue);

        expect(normalized.value).toBeNull();
      });

      it('should keep valid number values', () => {
        const zeroValue = { ...validRawDeal, value: 0 };
        const normalized = normalizeDeal(zeroValue);

        expect(normalized.value).toBe(0);
      });

      it('should normalize NaN confidence to undefined', () => {
        const nanConfidence = { ...validRawDeal, confidence: NaN };
        const normalized = normalizeDeal(nanConfidence);

        expect(normalized.confidence).toBeUndefined();
      });

      it('should normalize NaN probability to undefined', () => {
        const nanProbability = { ...validRawDeal, probability: NaN };
        const normalized = normalizeDeal(nanProbability);

        expect(normalized.probability).toBeUndefined();
      });
    });
  });

  describe('isValidStageId', () => {
    it('should accept valid snake_case stages', () => {
      expect(isValidStageId('lead')).toBe(true);
      expect(isValidStageId('lead_captured')).toBe(true);
      expect(isValidStageId('custom_stage_name')).toBe(true);
    });

    it('should reject uppercase stages', () => {
      expect(isValidStageId('Lead')).toBe(false);
      expect(isValidStageId('LEAD_CAPTURED')).toBe(false);
    });

    it('should reject stages starting with number', () => {
      expect(isValidStageId('1st_stage')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidStageId('')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidStageId(null)).toBe(false);
      expect(isValidStageId(undefined)).toBe(false);
      expect(isValidStageId(123)).toBe(false);
    });

    it('should reject stages with special characters', () => {
      expect(isValidStageId('lead-captured')).toBe(false);
      expect(isValidStageId('lead captured')).toBe(false);
    });
  });

  describe('isCoreStage', () => {
    it('should return true for core stages', () => {
      expect(isCoreStage('lead')).toBe(true);
      expect(isCoreStage('lead_captured')).toBe(true);
      expect(isCoreStage('deal_won')).toBe(true);
    });

    it('should return false for custom stages', () => {
      expect(isCoreStage('custom_stage')).toBe(false);
      expect(isCoreStage('my_pipeline_stage')).toBe(false);
    });
  });

  describe('validateStage', () => {
    it('should return valid:true for core stages without warning', () => {
      const result = validateStage('lead_captured');
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should return valid:true with warning for custom stages', () => {
      const result = validateStage('custom_stage');
      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Custom stage');
    });

    it('should return valid:false with error for invalid format', () => {
      const result = validateStage('Invalid Stage');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getImpliedStatusForStage', () => {
    it('should return "won" for win stages', () => {
      expect(getImpliedStatusForStage('deal_won')).toBe('won');
      expect(getImpliedStatusForStage('closed_won')).toBe('won');
      expect(getImpliedStatusForStage('investment_closed')).toBe('won');
    });

    it('should return "lost" for lost stages', () => {
      expect(getImpliedStatusForStage('deal_lost')).toBe('lost');
      expect(getImpliedStatusForStage('closed_lost')).toBe('lost');
      expect(getImpliedStatusForStage('lost')).toBe('lost');
    });

    it('should return null for active stages', () => {
      expect(getImpliedStatusForStage('lead')).toBeNull();
      expect(getImpliedStatusForStage('lead_captured')).toBeNull();
      expect(getImpliedStatusForStage('negotiation')).toBeNull();
    });
  });

  describe('syncStageAndStatus', () => {
    it('should sync status when stage implies won', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'deal_won', status: 'active', value: null, created: null };
      const synced = syncStageAndStatus(deal);
      expect(synced.status).toBe('won');
    });

    it('should sync status when stage implies lost', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'deal_lost', status: 'active', value: null, created: null };
      const synced = syncStageAndStatus(deal);
      expect(synced.status).toBe('lost');
    });

    it('should not modify deal when stage has no implied status', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'lead', status: 'active', value: null, created: null };
      const synced = syncStageAndStatus(deal);
      expect(synced.status).toBe('active');
    });

    it('should not mutate the original deal', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'deal_won', status: 'active', value: null, created: null };
      const synced = syncStageAndStatus(deal);
      expect(deal.status).toBe('active');
      expect(synced.status).toBe('won');
    });
  });

  describe('validateOutcome', () => {
    it('should return empty array for valid active deal', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'lead', status: 'active', value: null, created: null };
      const violations = validateOutcome(deal);
      expect(violations).toHaveLength(0);
    });

    it('should flag lost deal missing reason', () => {
      const deal = { id: '1', organization_id: '1', client: '', stage: 'deal_lost', status: 'lost', value: null, created: null };
      const violations = validateOutcome(deal);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].field).toBe('lost_reason');
    });

    it('should flag "other" reason missing notes', () => {
      const deal = {
        id: '1', organization_id: '1', client: '', stage: 'deal_lost', status: 'lost',
        value: null, created: null, lost_reason: 'other'
      };
      const violations = validateOutcome(deal);
      const notesViolation = violations.find(v => v.field === 'lost_reason_notes');
      expect(notesViolation).toBeDefined();
    });

    it('should flag active deal with outcome reason', () => {
      const deal = {
        id: '1', organization_id: '1', client: '', stage: 'lead', status: 'active',
        value: null, created: null, lost_reason: 'competitor'
      };
      const violations = validateOutcome(deal);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('clearOutcomeFields', () => {
    it('should clear all outcome fields', () => {
      const deal = {
        id: '1', organization_id: '1', client: '', stage: 'lead', status: 'active',
        value: null, created: null,
        lost_reason: 'competitor',
        lost_reason_notes: 'Notes',
        disqualified_reason_category: 'budget',
        outcome_reason_category: 'timing',
      };
      const cleared = clearOutcomeFields(deal);

      expect(cleared.lost_reason).toBeNull();
      expect(cleared.lost_reason_notes).toBeNull();
      expect(cleared.disqualified_reason_category).toBeNull();
      expect(cleared.outcome_reason_category).toBeNull();
    });
  });
});

// =============================================================================
// AI DOMAIN TESTS
// =============================================================================

describe('AI Domain Spine', () => {
  describe('classifyAIError', () => {
    it('should classify 401 as INVALID_API_KEY', () => {
      const error = { status: 401, message: 'Invalid credentials' };
      const result = classifyAIError(error, 'openai');

      expect(result.code).toBe('INVALID_API_KEY');
      expect(result.retryable).toBe(false);
    });

    it('should classify 429 as PROVIDER_RATE_LIMITED', () => {
      const error = { status: 429, message: 'Rate limited' };
      const result = classifyAIError(error, 'anthropic');

      expect(result.code).toBe('PROVIDER_RATE_LIMITED');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterSeconds).toBeDefined();
    });

    it('should classify quota errors as PROVIDER_QUOTA_EXCEEDED', () => {
      const error = { message: 'Quota exceeded for today' };
      const result = classifyAIError(error, 'openai');

      expect(result.code).toBe('PROVIDER_QUOTA_EXCEEDED');
      expect(result.retryable).toBe(false);
      expect(result.dashboardUrl).toBeDefined();
    });

    it('should classify 5xx as PROVIDER_DOWN', () => {
      const error = { status: 503, message: 'Service unavailable' };
      const result = classifyAIError(error);

      expect(result.code).toBe('PROVIDER_DOWN');
      expect(result.retryable).toBe(true);
    });

    it('should classify timeout errors as PROVIDER_TIMEOUT', () => {
      const error = { message: 'Request timed out', code: 'ETIMEDOUT' };
      const result = classifyAIError(error);

      expect(result.code).toBe('PROVIDER_TIMEOUT');
      expect(result.retryable).toBe(true);
    });

    it('should classify network errors as NETWORK_ERROR', () => {
      const error = { message: 'network error', code: 'ECONNREFUSED' };
      const result = classifyAIError(error);

      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify encryption errors as ENCRYPTION_FAILED', () => {
      const error = { message: 'failed to decrypt', code: 'ERR_OSSL_EVP_BAD_DECRYPT' };
      const result = classifyAIError(error, 'openai');

      expect(result.code).toBe('ENCRYPTION_FAILED');
      expect(result.retryable).toBe(false);
    });

    it('should return UNKNOWN for unrecognized errors', () => {
      const error = { message: 'Something weird happened' };
      const result = classifyAIError(error);

      expect(result.code).toBe('UNKNOWN');
      expect(result.retryable).toBe(true);
    });

    it('should handle null error gracefully', () => {
      const result = classifyAIError(null);

      expect(result.code).toBe('UNKNOWN');
    });

    it('should include provider in result', () => {
      const error = { status: 401 };
      const result = classifyAIError(error, 'anthropic');

      expect(result.provider).toBe('anthropic');
    });
  });

  describe('normalizeAIResponse', () => {
    it('should extract content from standard format', () => {
      const raw = { response: 'Hello from AI' };
      const result = normalizeAIResponse(raw, 'test');

      expect(result).not.toBeNull();
      expect(result.content).toBe('Hello from AI');
    });

    it('should extract content from OpenAI format', () => {
      const raw = {
        choices: [{ message: { content: 'OpenAI response' } }]
      };
      const result = normalizeAIResponse(raw);

      expect(result).not.toBeNull();
      expect(result.content).toBe('OpenAI response');
    });

    it('should extract content from Anthropic format', () => {
      const raw = {
        content: [{ text: 'Anthropic response' }]
      };
      const result = normalizeAIResponse(raw);

      expect(result).not.toBeNull();
      expect(result.content).toBe('Anthropic response');
    });

    it('should extract content from direct content format', () => {
      const raw = { content: 'Direct content' };
      const result = normalizeAIResponse(raw);

      expect(result).not.toBeNull();
      expect(result.content).toBe('Direct content');
    });

    it('should extract content from text format', () => {
      const raw = { text: 'Text field content' };
      const result = normalizeAIResponse(raw);

      expect(result).not.toBeNull();
      expect(result.content).toBe('Text field content');
    });

    it('should return null for null input', () => {
      expect(normalizeAIResponse(null)).toBeNull();
    });

    it('should return null for empty content', () => {
      const raw = { response: '' };
      expect(normalizeAIResponse(raw)).toBeNull();
    });

    it('should return null for whitespace-only content', () => {
      const raw = { response: '   \n\t  ' };
      expect(normalizeAIResponse(raw)).toBeNull();
    });

    it('should trim whitespace from content', () => {
      const raw = { response: '  Hello  ' };
      const result = normalizeAIResponse(raw);

      expect(result.content).toBe('Hello');
    });

    it('should include provider and timestamp', () => {
      const raw = { response: 'Hello', provider: 'openai' };
      const result = normalizeAIResponse(raw);

      expect(result.provider).toBe('openai');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('isAIErrorResponse', () => {
    it('should return true for ok:false', () => {
      expect(isAIErrorResponse({ ok: false })).toBe(true);
    });

    it('should return true for response with error field', () => {
      expect(isAIErrorResponse({ error: 'Something failed' })).toBe(true);
    });

    it('should return true for null/undefined', () => {
      expect(isAIErrorResponse(null)).toBe(true);
      expect(isAIErrorResponse(undefined)).toBe(true);
    });

    it('should return false for ok:true with content', () => {
      expect(isAIErrorResponse({ ok: true, response: 'Hello' })).toBe(false);
    });

    it('should return false for valid response', () => {
      expect(isAIErrorResponse({ response: 'Hello' })).toBe(false);
    });
  });

  describe('getProviderStatusFromError', () => {
    it('should return DOWN for PROVIDER_DOWN error code', () => {
      expect(getProviderStatusFromError({ code: 'PROVIDER_DOWN', message: '', retryable: true })).toBe('DOWN');
    });

    it('should return MISCONFIGURED for API key errors', () => {
      expect(getProviderStatusFromError({ code: 'INVALID_API_KEY', message: '', retryable: false })).toBe('MISCONFIGURED');
      expect(getProviderStatusFromError({ code: 'ENCRYPTION_FAILED', message: '', retryable: false })).toBe('MISCONFIGURED');
      expect(getProviderStatusFromError({ code: 'PROVIDER_QUOTA_EXCEEDED', message: '', retryable: false })).toBe('MISCONFIGURED');
    });

    it('should return DEGRADED for rate limits and timeouts', () => {
      expect(getProviderStatusFromError({ code: 'PROVIDER_RATE_LIMITED', message: '', retryable: true })).toBe('DEGRADED');
      expect(getProviderStatusFromError({ code: 'PROVIDER_TIMEOUT', message: '', retryable: true })).toBe('DEGRADED');
    });

    it('should return UNKNOWN for other error codes', () => {
      expect(getProviderStatusFromError({ code: 'UNKNOWN', message: '', retryable: true })).toBe('UNKNOWN');
      expect(getProviderStatusFromError({ code: 'NO_PROVIDERS', message: '', retryable: false })).toBe('UNKNOWN');
    });

    it('should correctly map from classified error to status', () => {
      // Test full flow: raw error -> classify -> get status
      const rawError = { status: 503, message: 'Service unavailable' };
      const classified = classifyAIError(rawError);
      const status = getProviderStatusFromError(classified);
      expect(status).toBe('DOWN');
    });
  });
});

// =============================================================================
// STAGE LABELS TESTS
// =============================================================================

describe('Stage Labels Domain Spine', () => {
  describe('getStageDisplayName', () => {
    it('should return known stage display names', () => {
      expect(getStageDisplayName('lead')).toBe('Lead');
      expect(getStageDisplayName('lead_captured')).toBe('Lead Captured');
      expect(getStageDisplayName('deal_won')).toBe('Deal Won');
      expect(getStageDisplayName('negotiation')).toBe('Negotiation');
    });

    it('should convert unknown stages to Title Case', () => {
      expect(getStageDisplayName('custom_stage')).toBe('Custom Stage');
      expect(getStageDisplayName('my_pipeline_stage')).toBe('My Pipeline Stage');
    });

    it('should return "Unknown" for null/undefined', () => {
      expect(getStageDisplayName(null)).toBe('Unknown');
      expect(getStageDisplayName(undefined)).toBe('Unknown');
    });

    it('should handle empty string', () => {
      expect(getStageDisplayName('')).toBe('Unknown');
    });
  });

  describe('getLostReasonDisplay', () => {
    it('should return known reason display names', () => {
      expect(getLostReasonDisplay('competitor', null)).toBe('Lost to Competitor');
      expect(getLostReasonDisplay('budget', null)).toBe('Budget Constraints');
      expect(getLostReasonDisplay('timing', null)).toBe('Wrong Timing');
    });

    it('should handle legacy "Other: custom text" format', () => {
      expect(getLostReasonDisplay('Other: Customer went bankrupt', null)).toBe('Customer went bankrupt');
    });

    it('should use notes when reason is "other"', () => {
      expect(getLostReasonDisplay('other', 'Custom reason here')).toBe('Custom reason here');
    });

    it('should return null for null reason', () => {
      expect(getLostReasonDisplay(null, null)).toBeNull();
    });

    it('should convert unknown reasons to Title Case', () => {
      expect(getLostReasonDisplay('some_custom_reason', null)).toBe('Some Custom Reason');
    });
  });

  describe('getDisqualifiedReasonDisplay', () => {
    it('should return known disqualified reasons', () => {
      expect(getDisqualifiedReasonDisplay('no_budget', null)).toBe('No Budget');
      expect(getDisqualifiedReasonDisplay('not_a_fit', null)).toBe('Not a Fit');
      expect(getDisqualifiedReasonDisplay('unresponsive', null)).toBe('Unresponsive');
    });

    it('should use notes for "other" category', () => {
      expect(getDisqualifiedReasonDisplay('other', 'Custom disqualification')).toBe('Custom disqualification');
    });

    it('should truncate long notes', () => {
      const longNotes = 'A'.repeat(100);
      const result = getDisqualifiedReasonDisplay('other', longNotes);
      expect(result.length).toBeLessThanOrEqual(50);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return null for null category', () => {
      expect(getDisqualifiedReasonDisplay(null, null)).toBeNull();
    });
  });

  describe('getOutcomeReasonDisplay', () => {
    it('should return label and icon for known reasons', () => {
      const result = getOutcomeReasonDisplay('competitor', null);
      expect(result).not.toBeNull();
      expect(result.label).toBe('Lost to Competitor');
      expect(result.icon).toBeDefined();
    });

    it('should use notes for "other" category', () => {
      const result = getOutcomeReasonDisplay('other', 'Custom reason');
      expect(result.label).toBe('Custom reason');
    });

    it('should return null for null category', () => {
      expect(getOutcomeReasonDisplay(null, null)).toBeNull();
    });
  });

  describe('getStatusDisplay', () => {
    it('should return correct display for all statuses', () => {
      expect(getStatusDisplay('active').label).toBe('Active');
      expect(getStatusDisplay('won').label).toBe('Won');
      expect(getStatusDisplay('lost').label).toBe('Lost');
      expect(getStatusDisplay('disqualified').label).toBe('Disqualified');
    });

    it('should include color for each status', () => {
      expect(getStatusDisplay('active').color).toBeDefined();
      expect(getStatusDisplay('won').color).toBeDefined();
      expect(getStatusDisplay('lost').color).toBeDefined();
    });

    it('should return "Unknown" for null/undefined', () => {
      expect(getStatusDisplay(null).label).toBe('Unknown');
      expect(getStatusDisplay(undefined).label).toBe('Unknown');
    });
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Domain Spine Integration', () => {
  describe('Deal normalization + Stage labels', () => {
    it('should normalize deal and display stage name correctly', () => {
      const rawDeal = {
        id: 'deal-1',
        organization_id: 'org-1',
        stage: 'lead_captured',
        status: 'active',
      };

      const normalized = normalizeDeal(rawDeal);
      const displayName = getStageDisplayName(normalized.stage);

      expect(displayName).toBe('Lead Captured');
    });

    it('should handle custom stage in normalization and display', () => {
      const rawDeal = {
        id: 'deal-1',
        organization_id: 'org-1',
        stage: 'my_custom_stage',
        status: 'active',
      };

      const normalized = normalizeDeal(rawDeal);
      const displayName = getStageDisplayName(normalized.stage);

      expect(displayName).toBe('My Custom Stage');
    });
  });

  describe('AI error + response flow', () => {
    it('should correctly identify and classify error responses', () => {
      const errorResponse = { ok: false, error: { status: 429 } };

      expect(isAIErrorResponse(errorResponse)).toBe(true);

      const classified = classifyAIError(errorResponse.error);
      expect(classified.code).toBe('PROVIDER_RATE_LIMITED');
    });

    it('should normalize valid responses after error check', () => {
      const response = { ok: true, response: 'Hello' };

      expect(isAIErrorResponse(response)).toBe(false);

      const normalized = normalizeAIResponse(response);
      expect(normalized.content).toBe('Hello');
    });
  });
});
