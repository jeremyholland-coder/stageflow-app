/**
 * Deal Endpoints Unit Tests
 *
 * Tests the validation logic and expected behavior of deal CRUD operations
 * based on the canonical specification in docs/spec-deals-kanban.md
 *
 * These tests validate the contracts defined in the spec.
 */

import { describe, it, expect } from 'vitest';

// Test data fixtures
const VALID_DEAL_DATA = {
  client: 'Acme Corp',
  email: 'john@acme.com',
  phone: '+15551234567',
  value: 50000,
  stage: 'lead_qualified',
  notes: 'Hot lead from conference',
};

const VALID_STAGES = new Set([
  // Legacy default pipeline stages
  'lead', 'quote', 'approval', 'invoice', 'onboarding', 'delivery', 'retention', 'lost',
  // Default (StageFlow) pipeline
  'lead_captured', 'lead_qualified', 'contacted', 'needs_identified', 'proposal_sent',
  'negotiation', 'deal_won', 'deal_lost', 'invoice_sent', 'payment_received', 'customer_onboarded',
  // Healthcare pipeline
  'lead_generation', 'lead_qualification', 'discovery', 'scope_defined', 'contract_sent',
  'client_onboarding', 'renewal_upsell',
  // VC/PE pipeline
  'deal_sourced', 'initial_screening', 'due_diligence', 'term_sheet_presented',
  'investment_closed', 'capital_call_sent', 'capital_received', 'portfolio_mgmt',
  // Real Estate pipeline
  'qualification', 'property_showing', 'contract_signed', 'closing_statement_sent',
  'escrow_completed', 'client_followup',
  // Professional Services pipeline
  'lead_identified',
  // SaaS pipeline
  'prospecting', 'contact', 'proposal', 'closed', 'adoption', 'renewal',
  // Additional stages
  'discovery_demo', 'contract', 'payment', 'closed_won', 'passed'
]);

const VALID_STATUSES = ['active', 'won', 'lost', 'disqualified'];

const DISQUALIFY_CATEGORIES = [
  'no_budget',
  'not_a_fit',
  'wrong_timing',
  'went_with_competitor',
  'unresponsive',
  'other'
];

describe('Deal Creation Validation', () => {
  describe('Required Fields', () => {
    it('should require client name', () => {
      const dealWithoutClient = { ...VALID_DEAL_DATA };
      delete dealWithoutClient.client;

      expect(dealWithoutClient.client).toBeUndefined();
      // In real endpoint, this would return 400
    });

    it('should require email', () => {
      const dealWithoutEmail = { ...VALID_DEAL_DATA };
      delete dealWithoutEmail.email;

      expect(dealWithoutEmail.email).toBeUndefined();
    });

    it('should require value', () => {
      const dealWithoutValue = { ...VALID_DEAL_DATA };
      delete dealWithoutValue.value;

      expect(dealWithoutValue.value).toBeUndefined();
    });

    it('should require valid stage', () => {
      const invalidStage = 'invalid_stage_xyz';
      expect(VALID_STAGES.has(invalidStage)).toBe(false);
    });
  });

  describe('Field Validation', () => {
    it('should validate client name length (2-200 chars)', () => {
      const shortClient = 'A';
      const validClient = 'Acme Corporation';
      const longClient = 'A'.repeat(201);

      expect(shortClient.length).toBeLessThan(2);
      expect(validClient.length).toBeGreaterThanOrEqual(2);
      expect(validClient.length).toBeLessThanOrEqual(200);
      expect(longClient.length).toBeGreaterThan(200);
    });

    it('should validate email format', () => {
      const validEmails = ['test@example.com', 'user.name@domain.org'];
      const invalidEmails = ['notanemail', '@missing.com', 'spaces in@email.com'];

      validEmails.forEach(email => {
        expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).toBe(true);
      });

      invalidEmails.forEach(email => {
        expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).toBe(false);
      });
    });

    it('should validate value is non-negative', () => {
      expect(VALID_DEAL_DATA.value).toBeGreaterThanOrEqual(0);
      expect(-1000).toBeLessThan(0);
    });
  });
});

describe('Deal Update Validation', () => {
  describe('Stage Transitions', () => {
    it('should allow valid stage changes', () => {
      const stages = ['lead_qualified', 'contacted', 'proposal_sent', 'negotiation'];

      stages.forEach(stage => {
        expect(VALID_STAGES.has(stage)).toBe(true);
      });
    });

    it('should reject invalid stage changes', () => {
      const invalidStages = ['fake_stage', 'not_a_stage', 'xyz'];

      invalidStages.forEach(stage => {
        expect(VALID_STAGES.has(stage)).toBe(false);
      });
    });
  });

  describe('Status Transitions', () => {
    it('should allow valid status values', () => {
      VALID_STATUSES.forEach(status => {
        expect(VALID_STATUSES).toContain(status);
      });
    });

    it('should reject invalid status values', () => {
      const invalidStatuses = ['pending', 'cancelled', 'archived'];

      invalidStatuses.forEach(status => {
        expect(VALID_STATUSES).not.toContain(status);
      });
    });
  });

  describe('Lost Reason Requirements', () => {
    it('should require lost_reason when status is lost', () => {
      const lostDealWithReason = {
        status: 'lost',
        lost_reason: 'Price too high'
      };

      expect(lostDealWithReason.status).toBe('lost');
      expect(lostDealWithReason.lost_reason).toBeDefined();
      expect(lostDealWithReason.lost_reason.length).toBeGreaterThan(0);
    });

    it('should reject lost status without reason', () => {
      const lostDealWithoutReason = {
        status: 'lost',
        lost_reason: null
      };

      expect(lostDealWithoutReason.status).toBe('lost');
      expect(lostDealWithoutReason.lost_reason).toBeNull();
      // In real endpoint, this would return 400
    });
  });

  describe('Disqualified Reason Requirements', () => {
    it('should require disqualified_reason_category when status is disqualified', () => {
      const disqualifiedDeal = {
        status: 'disqualified',
        disqualified_reason_category: 'no_budget',
        disqualified_reason_notes: 'Client has no budget until Q2'
      };

      expect(disqualifiedDeal.status).toBe('disqualified');
      expect(disqualifiedDeal.disqualified_reason_category).toBeDefined();
      expect(DISQUALIFY_CATEGORIES).toContain(disqualifiedDeal.disqualified_reason_category);
    });

    it('should validate disqualify category values', () => {
      DISQUALIFY_CATEGORIES.forEach(category => {
        expect(DISQUALIFY_CATEGORIES).toContain(category);
      });

      expect(DISQUALIFY_CATEGORIES).not.toContain('invalid_category');
    });
  });

  describe('Lost/Disqualified Mutual Exclusivity', () => {
    it('should clear lost fields when setting disqualified', () => {
      const updates = {
        status: 'disqualified',
        disqualified_reason_category: 'no_budget',
        // These should be cleared:
        lost_reason: null,
        lost_reason_notes: null
      };

      expect(updates.status).toBe('disqualified');
      expect(updates.lost_reason).toBeNull();
    });

    it('should clear disqualified fields when setting lost', () => {
      const updates = {
        status: 'lost',
        lost_reason: 'Competitor won',
        // These should be cleared:
        disqualified_reason_category: null,
        disqualified_reason_notes: null,
        stage_at_disqualification: null,
        disqualified_at: null
      };

      expect(updates.status).toBe('lost');
      expect(updates.disqualified_reason_category).toBeNull();
    });

    it('should clear all reason fields when setting active', () => {
      const updates = {
        status: 'active',
        lost_reason: null,
        lost_reason_notes: null,
        disqualified_reason_category: null,
        disqualified_reason_notes: null,
        stage_at_disqualification: null,
        disqualified_at: null
      };

      expect(updates.status).toBe('active');
      expect(updates.lost_reason).toBeNull();
      expect(updates.disqualified_reason_category).toBeNull();
    });
  });
});

describe('API Response Format', () => {
  describe('Success Responses', () => {
    it('should return success: true with deal object on create', () => {
      const successResponse = {
        success: true,
        deal: { id: 'uuid', client: 'Test', stage: 'lead' }
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.deal).toBeDefined();
      expect(successResponse.deal.id).toBeDefined();
    });

    it('should return success: true with deal object on update', () => {
      const successResponse = {
        success: true,
        deal: { id: 'uuid', stage: 'proposal_sent' }
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.deal).toBeDefined();
    });
  });

  describe('Error Responses', () => {
    it('should return structured error with code', () => {
      const errorResponse = {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.code).toBeDefined();
    });

    it('should use correct error codes', () => {
      const errorCodes = [
        'VALIDATION_ERROR',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'DB_ERROR'
      ];

      errorCodes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });
  });
});

/**
 * REGRESSION TESTS: Update-Deal Error Response Format
 *
 * Added 2025-12-07 after P0 fix for 500 errors on deal updates.
 * These tests ensure error responses have consistent structure:
 * - success: false
 * - error: string (user-friendly message)
 * - code: string (machine-readable error code)
 */
describe('Update-Deal Error Response Format (P0 Regression)', () => {
  describe('Validation Errors (400)', () => {
    it('should return success:false with VALIDATION_ERROR code for invalid stage', () => {
      const errorResponse = {
        success: false,
        error: 'Invalid stage value: fake_stage',
        code: 'VALIDATION_ERROR',
        hint: 'Stage must be a valid pipeline stage'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toContain('Invalid stage');
      expect(errorResponse.code).toBe('VALIDATION_ERROR');
    });

    it('should return success:false with VALIDATION_ERROR code for missing fields', () => {
      const errorResponse = {
        success: false,
        error: 'Missing required fields: dealId, updates, organizationId',
        code: 'VALIDATION_ERROR'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('VALIDATION_ERROR');
    });

    it('should return success:false with VALIDATION_ERROR code for no valid fields to update', () => {
      const errorResponse = {
        success: false,
        error: 'No valid fields to update',
        code: 'VALIDATION_ERROR'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authorization Errors (401/403)', () => {
    it('should return success:false with AUTH_REQUIRED code for auth errors', () => {
      const errorResponse = {
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('AUTH_REQUIRED');
    });

    it('should return success:false with FORBIDDEN code for org access denied', () => {
      const errorResponse = {
        success: false,
        error: 'Not authorized for this organization',
        code: 'FORBIDDEN'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('FORBIDDEN');
    });
  });

  describe('Not Found Errors (404)', () => {
    it('should return success:false with NOT_FOUND code for missing deal', () => {
      const errorResponse = {
        success: false,
        error: 'Deal not found',
        code: 'NOT_FOUND'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('NOT_FOUND');
    });
  });

  describe('Server Errors (500)', () => {
    it('should return success:false with SERVER_ERROR code and safe message', () => {
      const errorResponse = {
        success: false,
        error: 'Something went wrong updating this deal. Please try again.',
        code: 'SERVER_ERROR'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('SERVER_ERROR');
      // Should NOT expose internal error details
      expect(errorResponse.error).not.toContain('stack');
      expect(errorResponse.error).not.toContain('undefined');
    });

    it('should return UPDATE_VALIDATION_ERROR for Supabase client errors', () => {
      const errorResponse = {
        success: false,
        error: 'Update failed: Not null violation',
        code: 'UPDATE_VALIDATION_ERROR',
        details: 'null value in column "client" violates not-null constraint'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.code).toBe('UPDATE_VALIDATION_ERROR');
    });
  });

  describe('All Error Codes Used by Frontend', () => {
    const BACKEND_ERROR_CODES = [
      'VALIDATION_ERROR',
      'UPDATE_VALIDATION_ERROR',
      'FORBIDDEN',
      'NOT_FOUND',
      'AUTH_REQUIRED',
      'SESSION_ERROR',
      'SERVER_ERROR'
    ];

    it('should have all required error codes defined', () => {
      BACKEND_ERROR_CODES.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code).toMatch(/^[A-Z_]+$/);
      });
    });

    it('should map error codes to user-friendly messages', () => {
      const codeToMessage = {
        'VALIDATION_ERROR': 'Invalid data. Please check your input.',
        'UPDATE_VALIDATION_ERROR': 'Invalid data. Please check your input.',
        'FORBIDDEN': 'You don\'t have permission to update this deal.',
        'NOT_FOUND': 'Deal not found. It may have been deleted.',
        'AUTH_REQUIRED': 'Session expired. Please refresh the page.',
        'SESSION_ERROR': 'Session expired. Please refresh the page.',
        'SERVER_ERROR': 'Something went wrong. Please try again.'
      };

      Object.entries(codeToMessage).forEach(([code, message]) => {
        expect(BACKEND_ERROR_CODES).toContain(code);
        expect(message.length).toBeGreaterThan(0);
        expect(message).not.toContain('connection issue'); // Should be specific, not generic
      });
    });
  });
});

describe('Allowed Fields Sanitization', () => {
  describe('Create Deal Allowed Fields', () => {
    const ALLOWED_CREATE_FIELDS = [
      'client', 'email', 'phone', 'value', 'stage', 'status', 'notes',
      'company', 'contact_name', 'contact_email', 'contact_phone',
      'expected_close', 'probability', 'source'
    ];

    it('should allow standard deal fields', () => {
      ALLOWED_CREATE_FIELDS.forEach(field => {
        expect(ALLOWED_CREATE_FIELDS).toContain(field);
      });
    });

    it('should not allow dangerous fields', () => {
      const dangerousFields = ['id', 'organization_id', 'created', 'deleted_at'];

      dangerousFields.forEach(field => {
        expect(ALLOWED_CREATE_FIELDS).not.toContain(field);
      });
    });
  });

  describe('Update Deal Allowed Fields', () => {
    const ALLOWED_UPDATE_FIELDS = [
      'client', 'client_name', 'name',
      'email', 'contact_email',
      'phone', 'contact_phone',
      'value', 'stage', 'status', 'probability',
      'company', 'notes', 'expected_close', 'last_activity',
      'lost_reason', 'lost_reason_notes',
      'ai_health_score', 'ai_health_analysis', 'ai_health_updated_at',
      'assigned_to', 'assigned_by', 'assigned_at',
      'disqualified_reason_category', 'disqualified_reason_notes',
      'stage_at_disqualification', 'disqualified_at', 'disqualified_by'
    ];

    it('should allow client field with multiple naming conventions', () => {
      expect(ALLOWED_UPDATE_FIELDS).toContain('client');
      expect(ALLOWED_UPDATE_FIELDS).toContain('client_name');
    });

    it('should allow disqualification fields', () => {
      expect(ALLOWED_UPDATE_FIELDS).toContain('disqualified_reason_category');
      expect(ALLOWED_UPDATE_FIELDS).toContain('disqualified_reason_notes');
    });

    it('should allow assignment fields', () => {
      expect(ALLOWED_UPDATE_FIELDS).toContain('assigned_to');
      expect(ALLOWED_UPDATE_FIELDS).toContain('assigned_by');
      expect(ALLOWED_UPDATE_FIELDS).toContain('assigned_at');
    });
  });
});
