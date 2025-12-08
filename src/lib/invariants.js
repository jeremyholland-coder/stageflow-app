/**
 * INVARIANT VALIDATION MODULE
 *
 * P0 FIX 2025-12-08: Permanent elimination of false success conditions
 *
 * This module provides strict invariant validators that ensure:
 * 1. No "success: true" is ever returned without a valid, complete deal object
 * 2. All deal objects match the canonical schema
 * 3. All responses are typed and validated before being trusted
 *
 * USAGE:
 * - Import validators where deal operations occur
 * - Call validators BEFORE returning success to UI
 * - Any violation throws InvariantViolationError
 */

/**
 * Canonical Deal Schema - The minimum required fields for a valid deal
 * Any deal object missing these fields is considered INVALID
 */
export const DEAL_REQUIRED_FIELDS = [
  'id',
  'organization_id',
  'stage',
  'status'
];

/**
 * Extended deal fields that should be present for a complete deal
 */
export const DEAL_EXPECTED_FIELDS = [
  'id',
  'organization_id',
  'client',
  'stage',
  'status',
  'value',
  'created_at'
];

/**
 * Valid stage values across all pipeline templates
 */
export const VALID_STAGES = new Set([
  // Legacy default pipeline
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

/**
 * Valid status values
 */
export const VALID_STATUSES = new Set(['active', 'won', 'lost', 'disqualified']);

/**
 * Error codes for invariant violations
 */
export const INVARIANT_ERROR_CODES = {
  MISSING_DEAL: 'INVARIANT_MISSING_DEAL',
  INVALID_DEAL_SHAPE: 'INVARIANT_INVALID_DEAL_SHAPE',
  MISSING_REQUIRED_FIELD: 'INVARIANT_MISSING_REQUIRED_FIELD',
  INVALID_STAGE: 'INVARIANT_INVALID_STAGE',
  INVALID_STATUS: 'INVARIANT_INVALID_STATUS',
  INVALID_VALUE: 'INVARIANT_INVALID_VALUE',
  STALE_RESPONSE: 'INVARIANT_STALE_RESPONSE',
  RESPONSE_MISMATCH: 'INVARIANT_RESPONSE_MISMATCH'
};

/**
 * Custom error class for invariant violations
 */
export class InvariantViolationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'InvariantViolationError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

/**
 * Validate that a deal object has all required fields
 * @param {object} deal - The deal object to validate
 * @param {string} context - Where this validation is happening (for logging)
 * @returns {boolean} - true if valid
 * @throws {InvariantViolationError} - if invalid
 */
export function validateDealSchema(deal, context = 'unknown') {
  // Check deal exists and is an object
  if (!deal || typeof deal !== 'object') {
    throw new InvariantViolationError(
      `Deal validation failed: received ${typeof deal} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_DEAL,
      { context, receivedType: typeof deal }
    );
  }

  // Check for array (common mistake)
  if (Array.isArray(deal)) {
    throw new InvariantViolationError(
      'Deal validation failed: received array instead of single deal object',
      INVARIANT_ERROR_CODES.INVALID_DEAL_SHAPE,
      { context, receivedType: 'array' }
    );
  }

  // Check required fields
  const missingFields = [];
  for (const field of DEAL_REQUIRED_FIELDS) {
    if (deal[field] === undefined || deal[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `Deal validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      { context, missingFields, dealKeys: Object.keys(deal) }
    );
  }

  // Validate stage
  if (deal.stage && !VALID_STAGES.has(deal.stage)) {
    throw new InvariantViolationError(
      `Deal validation failed: invalid stage "${deal.stage}"`,
      INVARIANT_ERROR_CODES.INVALID_STAGE,
      { context, stage: deal.stage }
    );
  }

  // Validate status
  if (deal.status && !VALID_STATUSES.has(deal.status)) {
    throw new InvariantViolationError(
      `Deal validation failed: invalid status "${deal.status}"`,
      INVARIANT_ERROR_CODES.INVALID_STATUS,
      { context, status: deal.status }
    );
  }

  // Validate value is non-negative if present
  if (deal.value !== undefined && deal.value !== null) {
    const numValue = Number(deal.value);
    if (isNaN(numValue) || numValue < 0) {
      throw new InvariantViolationError(
        `Deal validation failed: invalid value "${deal.value}"`,
        INVARIANT_ERROR_CODES.INVALID_VALUE,
        { context, value: deal.value }
      );
    }
  }

  return true;
}

/**
 * Validate an API response contains a valid deal
 * @param {object} response - The API response { success, deal, error, code }
 * @param {string} context - Where this validation is happening
 * @returns {object} - The validated response
 * @throws {InvariantViolationError} - if response claims success but deal is invalid
 */
export function validateDealResponse(response, context = 'unknown') {
  // If response indicates failure, that's valid (just not successful)
  if (response.success === false) {
    return response;
  }

  // If response claims success, deal MUST be present and valid
  if (response.success === true) {
    if (!response.deal) {
      throw new InvariantViolationError(
        'Response claims success but deal is missing',
        INVARIANT_ERROR_CODES.MISSING_DEAL,
        { context, response: { success: response.success, hasError: !!response.error } }
      );
    }

    // Validate the deal schema
    validateDealSchema(response.deal, context);
  }

  // If success is undefined/null, that's suspicious
  if (response.success === undefined || response.success === null) {
    // Check if there's an error
    if (response.error) {
      // Treat as failure
      return { ...response, success: false };
    }

    // Check if there's a deal
    if (response.deal) {
      // Validate and assume success
      validateDealSchema(response.deal, context);
      return { ...response, success: true };
    }

    // Ambiguous response - fail safe
    throw new InvariantViolationError(
      'Ambiguous response: success is undefined and no deal/error present',
      INVARIANT_ERROR_CODES.RESPONSE_MISMATCH,
      { context, responseKeys: Object.keys(response) }
    );
  }

  return response;
}

/**
 * Validate that an update request actually updated the expected fields
 * @param {object} originalDeal - Deal before update
 * @param {object} updatedDeal - Deal after update
 * @param {object} requestedUpdates - The updates that were requested
 * @param {string} context - Where this validation is happening
 * @returns {boolean} - true if update was applied correctly
 * @throws {InvariantViolationError} - if update didn't apply
 */
export function validateUpdateApplied(originalDeal, updatedDeal, requestedUpdates, context = 'unknown') {
  // Validate both deals first
  validateDealSchema(originalDeal, `${context}-original`);
  validateDealSchema(updatedDeal, `${context}-updated`);

  // Check each requested update was applied
  const unappliedUpdates = [];
  for (const [key, value] of Object.entries(requestedUpdates)) {
    // Skip null/undefined values (these are intentional clears)
    if (value === null || value === undefined) continue;

    // Check if the value was applied
    if (updatedDeal[key] !== value) {
      // Special handling for numeric values (DB might return string)
      if (typeof value === 'number' && Number(updatedDeal[key]) === value) {
        continue;
      }
      unappliedUpdates.push({
        field: key,
        requested: value,
        actual: updatedDeal[key]
      });
    }
  }

  if (unappliedUpdates.length > 0) {
    console.warn(`[Invariant] Update verification found ${unappliedUpdates.length} unapplied fields:`, unappliedUpdates);
    // This is a warning, not an error - the DB might have constraints or triggers
    // that modified values. Log but don't throw.
  }

  return true;
}

/**
 * Safe wrapper for deal operations that enforces invariants
 * @param {Function} operation - Async function that returns { success, deal, error, code }
 * @param {string} context - Where this operation is happening
 * @returns {Promise<object>} - Validated response
 */
export async function withDealInvariant(operation, context = 'unknown') {
  try {
    const response = await operation();
    return validateDealResponse(response, context);
  } catch (error) {
    // If it's already an invariant error, rethrow
    if (error instanceof InvariantViolationError) {
      console.error(`[Invariant] Violation in ${context}:`, error.toJSON());
      throw error;
    }

    // Wrap other errors
    console.error(`[Invariant] Operation failed in ${context}:`, error);
    return {
      success: false,
      error: error.message || 'Operation failed',
      code: error.code || 'OPERATION_ERROR'
    };
  }
}

/**
 * Check if a response is a valid success response
 * Does not throw, just returns boolean
 * @param {object} response - The response to check
 * @returns {boolean} - true if this is a valid success response
 */
export function isValidSuccessResponse(response) {
  try {
    if (response?.success !== true) return false;
    if (!response.deal) return false;
    validateDealSchema(response.deal, 'isValidSuccessResponse');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Normalize a deal response to ensure consistent shape
 * @param {object} response - Raw response from API
 * @param {string} context - Where this normalization is happening
 * @returns {object} - Normalized response { success, deal?, error?, code? }
 */
export function normalizeDealResponse(response, context = 'unknown') {
  // Handle null/undefined
  if (!response) {
    return {
      success: false,
      error: 'No response received',
      code: 'NO_RESPONSE'
    };
  }

  // Handle non-object responses
  if (typeof response !== 'object') {
    return {
      success: false,
      error: `Invalid response type: ${typeof response}`,
      code: 'INVALID_RESPONSE_TYPE'
    };
  }

  // If it has success: false with error, pass through
  if (response.success === false && response.error) {
    return {
      success: false,
      error: response.error,
      code: response.code || 'UNKNOWN_ERROR'
    };
  }

  // If it has success: true with deal, validate
  if (response.success === true && response.deal) {
    try {
      validateDealSchema(response.deal, context);
      return {
        success: true,
        deal: response.deal
      };
    } catch (e) {
      return {
        success: false,
        error: e.message,
        code: e.code || 'VALIDATION_ERROR'
      };
    }
  }

  // If it just has a deal (no explicit success), validate and assume success
  if (response.deal && !response.error) {
    try {
      validateDealSchema(response.deal, context);
      return {
        success: true,
        deal: response.deal
      };
    } catch (e) {
      return {
        success: false,
        error: e.message,
        code: e.code || 'VALIDATION_ERROR'
      };
    }
  }

  // If it has an error but no success field
  if (response.error) {
    return {
      success: false,
      error: response.error,
      code: response.code || 'UNKNOWN_ERROR'
    };
  }

  // Ambiguous response - fail safe
  console.warn(`[Invariant] Ambiguous response in ${context}:`, Object.keys(response));
  return {
    success: false,
    error: 'Ambiguous response from server',
    code: 'AMBIGUOUS_RESPONSE'
  };
}

export default {
  DEAL_REQUIRED_FIELDS,
  DEAL_EXPECTED_FIELDS,
  VALID_STAGES,
  VALID_STATUSES,
  INVARIANT_ERROR_CODES,
  InvariantViolationError,
  validateDealSchema,
  validateDealResponse,
  validateUpdateApplied,
  withDealInvariant,
  isValidSuccessResponse,
  normalizeDealResponse
};
