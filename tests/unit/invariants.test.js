/**
 * INVARIANT VALIDATION TESTS
 *
 * P0 FIX 2025-12-08: Comprehensive tests to prevent false success conditions
 *
 * These tests ensure that:
 * 1. No "success: true" is ever returned without a valid deal object
 * 2. Invalid/partial deal objects are rejected
 * 3. Response normalization always produces consistent shapes
 */

import { describe, it, expect } from 'vitest';
import {
  DEAL_REQUIRED_FIELDS,
  VALID_STAGES,
  VALID_STATUSES,
  InvariantViolationError,
  validateDealSchema,
  validateDealResponse,
  isValidSuccessResponse,
  normalizeDealResponse
} from '../../src/lib/invariants';

describe('Invariant Validation Module', () => {
  describe('DEAL_REQUIRED_FIELDS', () => {
    it('should include all critical deal fields', () => {
      expect(DEAL_REQUIRED_FIELDS).toContain('id');
      expect(DEAL_REQUIRED_FIELDS).toContain('organization_id');
      expect(DEAL_REQUIRED_FIELDS).toContain('stage');
      expect(DEAL_REQUIRED_FIELDS).toContain('status');
    });
  });

  describe('VALID_STAGES', () => {
    it('should include all StageFlow pipeline stages', () => {
      const stageflowStages = [
        'lead_captured', 'lead_qualified', 'contacted', 'needs_identified',
        'proposal_sent', 'negotiation', 'deal_won', 'deal_lost'
      ];

      stageflowStages.forEach(stage => {
        expect(VALID_STAGES.has(stage)).toBe(true);
      });
    });

    it('should include legacy stages', () => {
      const legacyStages = ['lead', 'quote', 'approval', 'invoice', 'onboarding'];

      legacyStages.forEach(stage => {
        expect(VALID_STAGES.has(stage)).toBe(true);
      });
    });

    it('should NOT include invalid stages', () => {
      expect(VALID_STAGES.has('fake_stage')).toBe(false);
      expect(VALID_STAGES.has('')).toBe(false);
      expect(VALID_STAGES.has('undefined')).toBe(false);
    });
  });

  describe('VALID_STATUSES', () => {
    it('should include all valid status values', () => {
      expect(VALID_STATUSES.has('active')).toBe(true);
      expect(VALID_STATUSES.has('won')).toBe(true);
      expect(VALID_STATUSES.has('lost')).toBe(true);
      expect(VALID_STATUSES.has('disqualified')).toBe(true);
    });

    it('should NOT include invalid statuses', () => {
      expect(VALID_STATUSES.has('invalid')).toBe(false);
      expect(VALID_STATUSES.has('')).toBe(false);
    });
  });
});

describe('validateDealSchema', () => {
  const validDeal = {
    id: 'deal-uuid-123',
    organization_id: 'org-uuid-456',
    stage: 'lead_captured',
    status: 'active',
    client: 'Test Corp',
    value: 1000
  };

  it('should pass for a valid deal object', () => {
    expect(() => validateDealSchema(validDeal, 'test')).not.toThrow();
    expect(validateDealSchema(validDeal, 'test')).toBe(true);
  });

  it('should throw for null deal', () => {
    expect(() => validateDealSchema(null, 'test')).toThrow(InvariantViolationError);
  });

  it('should throw for undefined deal', () => {
    expect(() => validateDealSchema(undefined, 'test')).toThrow(InvariantViolationError);
  });

  it('should throw for array instead of object', () => {
    expect(() => validateDealSchema([validDeal], 'test')).toThrow(InvariantViolationError);
    try {
      validateDealSchema([validDeal], 'test');
    } catch (e) {
      expect(e.code).toBe('INVARIANT_INVALID_DEAL_SHAPE');
    }
  });

  it('should throw for missing required fields', () => {
    const missingId = { ...validDeal, id: undefined };
    expect(() => validateDealSchema(missingId, 'test')).toThrow(InvariantViolationError);

    const missingOrgId = { ...validDeal, organization_id: null };
    expect(() => validateDealSchema(missingOrgId, 'test')).toThrow(InvariantViolationError);

    const missingStage = { ...validDeal, stage: undefined };
    expect(() => validateDealSchema(missingStage, 'test')).toThrow(InvariantViolationError);

    const missingStatus = { ...validDeal, status: null };
    expect(() => validateDealSchema(missingStatus, 'test')).toThrow(InvariantViolationError);
  });

  it('should throw for invalid stage FORMAT (not snake_case)', () => {
    // P0 FIX 2025-12-09: Stage validation is now PERMISSIVE for custom pipelines
    // Only stages with INVALID FORMAT should fail (spaces, uppercase, special chars)
    const invalidStage = { ...validDeal, stage: 'Invalid Stage Format' }; // Spaces + uppercase = invalid
    expect(() => validateDealSchema(invalidStage, 'test')).toThrow(InvariantViolationError);

    try {
      validateDealSchema(invalidStage, 'test');
    } catch (e) {
      expect(e.code).toBe('INVARIANT_INVALID_STAGE');
    }
  });

  it('should ACCEPT custom stages in valid snake_case format', () => {
    // P0 FIX 2025-12-09: Custom pipeline stages should be valid
    const customStage = { ...validDeal, stage: 'custom_pipeline_stage' };
    expect(() => validateDealSchema(customStage, 'test')).not.toThrow();
  });

  it('should throw for invalid status value', () => {
    const invalidStatus = { ...validDeal, status: 'invalid_status' };
    expect(() => validateDealSchema(invalidStatus, 'test')).toThrow(InvariantViolationError);

    try {
      validateDealSchema(invalidStatus, 'test');
    } catch (e) {
      expect(e.code).toBe('INVARIANT_INVALID_STATUS');
    }
  });

  it('should throw for negative deal value', () => {
    const negativeValue = { ...validDeal, value: -100 };
    expect(() => validateDealSchema(negativeValue, 'test')).toThrow(InvariantViolationError);

    try {
      validateDealSchema(negativeValue, 'test');
    } catch (e) {
      expect(e.code).toBe('INVARIANT_INVALID_VALUE');
    }
  });
});

describe('validateDealResponse', () => {
  const validDeal = {
    id: 'deal-uuid-123',
    organization_id: 'org-uuid-456',
    stage: 'lead_captured',
    status: 'active'
  };

  it('should pass for valid success response', () => {
    const response = { success: true, deal: validDeal };
    expect(() => validateDealResponse(response, 'test')).not.toThrow();
  });

  it('should pass for valid failure response', () => {
    const response = { success: false, error: 'Something went wrong', code: 'ERROR' };
    const result = validateDealResponse(response, 'test');
    expect(result.success).toBe(false);
  });

  it('should throw for success:true without deal (P0 CRITICAL)', () => {
    const response = { success: true };
    expect(() => validateDealResponse(response, 'test')).toThrow(InvariantViolationError);

    try {
      validateDealResponse(response, 'test');
    } catch (e) {
      expect(e.code).toBe('INVARIANT_MISSING_DEAL');
    }
  });

  it('should throw for success:true with invalid deal (P0 CRITICAL)', () => {
    const response = { success: true, deal: { id: 'only-id' } }; // Missing required fields
    expect(() => validateDealResponse(response, 'test')).toThrow(InvariantViolationError);
  });

  it('should throw for success:true with empty object deal (P0 CRITICAL)', () => {
    const response = { success: true, deal: {} };
    expect(() => validateDealResponse(response, 'test')).toThrow(InvariantViolationError);
  });
});

describe('isValidSuccessResponse', () => {
  const validDeal = {
    id: 'deal-uuid-123',
    organization_id: 'org-uuid-456',
    stage: 'lead_captured',
    status: 'active'
  };

  it('should return true for valid success response', () => {
    const response = { success: true, deal: validDeal };
    expect(isValidSuccessResponse(response)).toBe(true);
  });

  it('should return false for success:false', () => {
    const response = { success: false, error: 'Error' };
    expect(isValidSuccessResponse(response)).toBe(false);
  });

  it('should return false for success:true without deal', () => {
    const response = { success: true };
    expect(isValidSuccessResponse(response)).toBe(false);
  });

  it('should return false for success:true with invalid deal', () => {
    const response = { success: true, deal: {} };
    expect(isValidSuccessResponse(response)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isValidSuccessResponse(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidSuccessResponse(undefined)).toBe(false);
  });
});

describe('normalizeDealResponse', () => {
  const validDeal = {
    id: 'deal-uuid-123',
    organization_id: 'org-uuid-456',
    stage: 'lead_captured',
    status: 'active'
  };

  it('should normalize valid success response', () => {
    const response = { success: true, deal: validDeal };
    const normalized = normalizeDealResponse(response, 'test');

    expect(normalized.success).toBe(true);
    expect(normalized.deal).toEqual(validDeal);
  });

  it('should normalize valid failure response', () => {
    const response = { success: false, error: 'Failed', code: 'FAIL' };
    const normalized = normalizeDealResponse(response, 'test');

    expect(normalized.success).toBe(false);
    expect(normalized.error).toBe('Failed');
    expect(normalized.code).toBe('FAIL');
  });

  it('should convert null to failure response', () => {
    const normalized = normalizeDealResponse(null, 'test');

    expect(normalized.success).toBe(false);
    expect(normalized.code).toBe('NO_RESPONSE');
  });

  it('should convert undefined to failure response', () => {
    const normalized = normalizeDealResponse(undefined, 'test');

    expect(normalized.success).toBe(false);
    expect(normalized.code).toBe('NO_RESPONSE');
  });

  it('should convert success:true with invalid deal to failure (P0 CRITICAL)', () => {
    const response = { success: true, deal: {} };
    const normalized = normalizeDealResponse(response, 'test');

    // This is the critical fix - false success becomes explicit failure
    expect(normalized.success).toBe(false);
    expect(normalized.code).toBeDefined();
  });

  it('should convert response with only deal to success if valid', () => {
    const response = { deal: validDeal };
    const normalized = normalizeDealResponse(response, 'test');

    expect(normalized.success).toBe(true);
    expect(normalized.deal).toEqual(validDeal);
  });

  it('should convert response with only error to failure', () => {
    const response = { error: 'Something broke' };
    const normalized = normalizeDealResponse(response, 'test');

    expect(normalized.success).toBe(false);
    expect(normalized.error).toBe('Something broke');
  });

  it('should convert ambiguous response to failure', () => {
    const response = { foo: 'bar' };
    const normalized = normalizeDealResponse(response, 'test');

    expect(normalized.success).toBe(false);
    expect(normalized.code).toBe('AMBIGUOUS_RESPONSE');
  });
});

describe('InvariantViolationError', () => {
  it('should create error with correct properties', () => {
    const error = new InvariantViolationError('Test error', 'TEST_CODE', { foo: 'bar' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.name).toBe('InvariantViolationError');
    expect(error.timestamp).toBeDefined();
  });

  it('should serialize to JSON correctly', () => {
    const error = new InvariantViolationError('Test error', 'TEST_CODE', { foo: 'bar' });
    const json = error.toJSON();

    expect(json.name).toBe('InvariantViolationError');
    expect(json.message).toBe('Test error');
    expect(json.code).toBe('TEST_CODE');
    expect(json.timestamp).toBeDefined();
  });
});

/**
 * P0 REGRESSION TEST: The "100% Success" False Positive
 *
 * These tests specifically target the bug where a response could claim
 * success:true without actually having a valid deal object.
 */
describe('P0 Regression: False Success Prevention', () => {
  it('should NEVER consider empty success response as valid', () => {
    // The bug: { success: true } without deal
    const falsePositive = { success: true };

    expect(isValidSuccessResponse(falsePositive)).toBe(false);

    const normalized = normalizeDealResponse(falsePositive, 'test');
    expect(normalized.success).toBe(false);
  });

  it('should NEVER consider partial deal as success', () => {
    // The bug: { success: true, deal: { id: 'only-id' } }
    const partialDeal = {
      success: true,
      deal: {
        id: 'uuid-123'
        // Missing: organization_id, stage, status
      }
    };

    expect(isValidSuccessResponse(partialDeal)).toBe(false);

    const normalized = normalizeDealResponse(partialDeal, 'test');
    expect(normalized.success).toBe(false);
  });

  it('should NEVER consider invalid stage FORMAT as success', () => {
    // P0 FIX 2025-12-09: Stage validation is now PERMISSIVE for custom pipelines
    // We allow custom stage names like 'healthcare_review' or 'vc_due_diligence'
    // Only stages with INVALID FORMAT (spaces, uppercase, special chars) should fail
    const invalidStageDeal = {
      success: true,
      deal: {
        id: 'uuid-123',
        organization_id: 'org-456',
        stage: 'Invalid Stage With Spaces', // Invalid format - has spaces and uppercase
        status: 'active'
      }
    };

    expect(isValidSuccessResponse(invalidStageDeal)).toBe(false);

    const normalized = normalizeDealResponse(invalidStageDeal, 'test');
    expect(normalized.success).toBe(false);
  });

  it('should ACCEPT custom stages in valid snake_case format', () => {
    // P0 FIX 2025-12-09: Custom pipeline stages should be valid
    const customStageDeal = {
      success: true,
      deal: {
        id: 'uuid-123',
        organization_id: 'org-456',
        stage: 'healthcare_review', // Valid format - custom stage
        status: 'active'
      }
    };

    expect(isValidSuccessResponse(customStageDeal)).toBe(true);

    const normalized = normalizeDealResponse(customStageDeal, 'test');
    expect(normalized.success).toBe(true);
  });

  it('should ALWAYS have success: true OR success: false after normalization', () => {
    const testCases = [
      null,
      undefined,
      {},
      { deal: null },
      { success: undefined },
      { foo: 'bar' }
    ];

    testCases.forEach(input => {
      const normalized = normalizeDealResponse(input, 'test');
      expect(typeof normalized.success).toBe('boolean');
      expect([true, false]).toContain(normalized.success);
    });
  });

  it('should ALWAYS have error and code when success is false', () => {
    const testCases = [
      null,
      undefined,
      {},
      { success: true, deal: {} },
      { success: true } // Missing deal
    ];

    testCases.forEach(input => {
      const normalized = normalizeDealResponse(input, 'test');
      if (normalized.success === false) {
        expect(normalized.error).toBeDefined();
        expect(normalized.code).toBeDefined();
      }
    });
  });
});
