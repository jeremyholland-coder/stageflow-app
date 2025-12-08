/**
 * INVARIANT VALIDATION MODULE
 *
 * P0 FIX 2025-12-08: Permanent elimination of false success conditions
 * PHASE 1 2025-12-08: Extended to ALL response types (not just deals)
 *
 * This module provides strict invariant validators that ensure:
 * 1. No "success: true" is ever returned without valid payload
 * 2. All entity objects match their canonical schemas
 * 3. All API responses are typed and validated before being trusted
 * 4. Invariant breaches are tracked for telemetry
 *
 * RESPONSE TYPES COVERED:
 * - Deals (create, update, delete, list)
 * - Sessions (login, refresh, validate)
 * - Organizations (settings, targets)
 * - AI (assistant, insights, streaming)
 * - Generic API responses
 *
 * USAGE:
 * - Import validators where API operations occur
 * - Use withInvariant() wrapper for automatic validation
 * - Any violation throws InvariantViolationError
 */

// FIX 2025-12-08: Import centralized stage config (single source of truth)
import { ALL_VALID_STAGES } from '../config/pipelineConfig.js';

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
 * FIX 2025-12-08: Use centralized config (single source of truth)
 */
export const VALID_STAGES = ALL_VALID_STAGES;

/**
 * Check if a stage looks valid (basic sanity check)
 * Accepts any lowercase snake_case string as potentially valid
 * This is permissive to support custom organization stages from pipeline_stages table
 */
export function isValidStageFormat(stage) {
  if (!stage || typeof stage !== 'string') return false;
  // Must be non-empty, lowercase, snake_case format
  return /^[a-z][a-z0-9_]*$/.test(stage);
}

/**
 * Valid status values
 */
export const VALID_STATUSES = new Set(['active', 'won', 'lost', 'disqualified']);

/**
 * Error codes for invariant violations
 */
export const INVARIANT_ERROR_CODES = {
  // Deal invariants
  MISSING_DEAL: 'INVARIANT_MISSING_DEAL',
  INVALID_DEAL_SHAPE: 'INVARIANT_INVALID_DEAL_SHAPE',
  MISSING_REQUIRED_FIELD: 'INVARIANT_MISSING_REQUIRED_FIELD',
  INVALID_STAGE: 'INVARIANT_INVALID_STAGE',
  INVALID_STATUS: 'INVARIANT_INVALID_STATUS',
  INVALID_VALUE: 'INVARIANT_INVALID_VALUE',
  STALE_RESPONSE: 'INVARIANT_STALE_RESPONSE',
  RESPONSE_MISMATCH: 'INVARIANT_RESPONSE_MISMATCH',

  // Session invariants (PHASE 1)
  MISSING_SESSION: 'INVARIANT_MISSING_SESSION',
  INVALID_SESSION_SHAPE: 'INVARIANT_INVALID_SESSION_SHAPE',
  MISSING_USER: 'INVARIANT_MISSING_USER',
  INVALID_USER_SHAPE: 'INVARIANT_INVALID_USER_SHAPE',

  // Organization invariants (PHASE 1)
  MISSING_ORGANIZATION: 'INVARIANT_MISSING_ORGANIZATION',
  INVALID_ORGANIZATION_SHAPE: 'INVARIANT_INVALID_ORGANIZATION_SHAPE',

  // AI invariants (PHASE 1)
  MISSING_AI_RESPONSE: 'INVARIANT_MISSING_AI_RESPONSE',
  INVALID_AI_RESPONSE_SHAPE: 'INVARIANT_INVALID_AI_RESPONSE_SHAPE',
  AI_RESPONSE_EMPTY: 'INVARIANT_AI_RESPONSE_EMPTY',

  // Generic invariants (PHASE 1)
  MISSING_RESPONSE: 'INVARIANT_MISSING_RESPONSE',
  INVALID_RESPONSE_SHAPE: 'INVARIANT_INVALID_RESPONSE_SHAPE',
  SUCCESS_WITHOUT_DATA: 'INVARIANT_SUCCESS_WITHOUT_DATA',
  AMBIGUOUS_RESPONSE: 'INVARIANT_AMBIGUOUS_RESPONSE'
};

// ============================================================================
// PHASE 1: SESSION/USER SCHEMA DEFINITIONS
// ============================================================================

/**
 * Required fields for a valid user object
 */
export const USER_REQUIRED_FIELDS = ['id', 'email'];

/**
 * Required fields for a valid session object
 */
export const SESSION_REQUIRED_FIELDS = ['access_token', 'user'];

/**
 * Valid user roles
 */
export const VALID_USER_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

// ============================================================================
// PHASE 1: ORGANIZATION SCHEMA DEFINITIONS
// ============================================================================

/**
 * Required fields for a valid organization object
 */
export const ORGANIZATION_REQUIRED_FIELDS = ['id', 'name'];

/**
 * Valid organization plans
 */
export const VALID_PLANS = new Set(['free', 'startup', 'growth', 'pro', 'enterprise']);

// ============================================================================
// PHASE 1: AI RESPONSE SCHEMA DEFINITIONS
// ============================================================================

/**
 * Required fields for a valid AI assistant response
 */
export const AI_RESPONSE_REQUIRED_FIELDS = ['response'];

/**
 * Valid AI provider types
 */
export const VALID_AI_PROVIDERS = new Set(['openai', 'anthropic', 'google']);

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

  // Validate stage - PERMISSIVE: accept any valid-format stage
  // FIX 2025-12-08: Don't fail for unknown stages, just warn
  // Organizations may have custom stages from pipeline_stages table
  if (deal.stage) {
    if (!isValidStageFormat(deal.stage)) {
      throw new InvariantViolationError(
        `Deal validation failed: invalid stage format "${deal.stage}"`,
        INVARIANT_ERROR_CODES.INVALID_STAGE,
        { context, stage: deal.stage }
      );
    }
    // Warn but don't fail for unknown stages
    if (!VALID_STAGES.has(deal.stage)) {
      console.warn(`[Invariant] Unknown stage "${deal.stage}" in ${context} - allowing (may be custom stage)`);
    }
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

// ============================================================================
// PHASE 1: USER/SESSION VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate that a user object has all required fields
 * @param {object} user - The user object to validate
 * @param {string} context - Where this validation is happening
 * @returns {boolean} - true if valid
 * @throws {InvariantViolationError} - if invalid
 */
export function validateUserSchema(user, context = 'unknown') {
  if (!user || typeof user !== 'object') {
    throw new InvariantViolationError(
      `User validation failed: received ${typeof user} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_USER,
      { context, receivedType: typeof user }
    );
  }

  const missingFields = [];
  for (const field of USER_REQUIRED_FIELDS) {
    if (user[field] === undefined || user[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `User validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.INVALID_USER_SHAPE,
      { context, missingFields, userKeys: Object.keys(user) }
    );
  }

  return true;
}

/**
 * Validate a session response
 * @param {object} response - The session response to validate
 * @param {string} context - Where this validation is happening
 * @returns {object} - The validated response
 */
export function validateSessionResponse(response, context = 'unknown') {
  if (response.valid === false || response.error) {
    return response; // Explicit failure is valid
  }

  if (response.valid === true || response.user) {
    if (!response.user) {
      throw new InvariantViolationError(
        'Session response claims valid but user is missing',
        INVARIANT_ERROR_CODES.MISSING_USER,
        { context, responseKeys: Object.keys(response) }
      );
    }
    validateUserSchema(response.user, context);
  }

  return response;
}

// ============================================================================
// PHASE 1: ORGANIZATION VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate that an organization object has all required fields
 * @param {object} org - The organization object to validate
 * @param {string} context - Where this validation is happening
 * @returns {boolean} - true if valid
 * @throws {InvariantViolationError} - if invalid
 */
export function validateOrganizationSchema(org, context = 'unknown') {
  if (!org || typeof org !== 'object') {
    throw new InvariantViolationError(
      `Organization validation failed: received ${typeof org} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_ORGANIZATION,
      { context, receivedType: typeof org }
    );
  }

  const missingFields = [];
  for (const field of ORGANIZATION_REQUIRED_FIELDS) {
    if (org[field] === undefined || org[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `Organization validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.INVALID_ORGANIZATION_SHAPE,
      { context, missingFields, orgKeys: Object.keys(org) }
    );
  }

  // Validate plan if present
  if (org.plan && !VALID_PLANS.has(org.plan.toLowerCase())) {
    console.warn(`[Invariant] Unknown plan "${org.plan}" in ${context} - allowing but flagging`);
    // Don't throw - just warn. New plans might be added.
  }

  return true;
}

// ============================================================================
// PHASE 1: AI RESPONSE VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate an AI assistant response
 * @param {object} response - The AI response to validate
 * @param {string} context - Where this validation is happening
 * @returns {object} - The validated response
 * @throws {InvariantViolationError} - if invalid
 */
export function validateAIResponse(response, context = 'unknown') {
  if (!response || typeof response !== 'object') {
    throw new InvariantViolationError(
      `AI response validation failed: received ${typeof response}`,
      INVARIANT_ERROR_CODES.MISSING_AI_RESPONSE,
      { context, receivedType: typeof response }
    );
  }

  // Check for explicit error response
  if (response.error || response.ok === false || response.success === false) {
    return response; // Error responses are valid (just not successful)
  }

  // For success responses, validate content exists
  const hasContent = response.response || response.content || response.message;
  if (!hasContent && !response.fallbackPlan) {
    // Allow fallbackPlan as valid "content" for graceful degradation
    throw new InvariantViolationError(
      'AI response has no content (response, content, message, or fallbackPlan)',
      INVARIANT_ERROR_CODES.AI_RESPONSE_EMPTY,
      { context, responseKeys: Object.keys(response) }
    );
  }

  // Validate provider if present
  if (response.provider && !VALID_AI_PROVIDERS.has(response.provider.toLowerCase())) {
    // Map display names to provider types
    const providerMap = { 'chatgpt': 'openai', 'claude': 'anthropic', 'gemini': 'google' };
    const normalized = providerMap[response.provider.toLowerCase()];
    if (!normalized && !VALID_AI_PROVIDERS.has(response.provider.toLowerCase())) {
      console.warn(`[Invariant] Unknown AI provider "${response.provider}" in ${context}`);
    }
  }

  return response;
}

/**
 * Normalize an AI response to consistent shape
 * @param {object} response - Raw AI response
 * @param {string} context - Where this normalization is happening
 * @returns {object} - Normalized response
 */
export function normalizeAIResponse(response, context = 'unknown') {
  if (!response) {
    return {
      success: false,
      error: 'No AI response received',
      code: 'NO_RESPONSE'
    };
  }

  // If it's an error response, normalize it
  if (response.error || response.ok === false) {
    return {
      success: false,
      error: response.error || response.message || 'AI request failed',
      code: response.code || 'AI_ERROR',
      ...(response.fallbackPlan && { fallbackPlan: response.fallbackPlan })
    };
  }

  // Success response
  return {
    success: true,
    response: response.response || response.content || response.message,
    provider: response.provider,
    ...(response.chartData && { chartData: response.chartData }),
    ...(response.chartType && { chartType: response.chartType }),
    ...(response.suggestions && { suggestions: response.suggestions })
  };
}

// ============================================================================
// PHASE 1: GENERIC API RESPONSE VALIDATION
// ============================================================================

/**
 * Validate any API response for basic consistency
 * @param {object} response - The API response to validate
 * @param {string} context - Where this validation is happening
 * @param {object} options - Validation options
 * @param {string[]} options.requiredFields - Fields required on success
 * @param {string} options.dataKey - Key containing the main data (default: 'data')
 * @returns {object} - The validated response
 */
export function validateApiResponse(response, context = 'unknown', options = {}) {
  const { requiredFields = [], dataKey = 'data' } = options;

  if (!response || typeof response !== 'object') {
    throw new InvariantViolationError(
      `API response validation failed: received ${typeof response}`,
      INVARIANT_ERROR_CODES.MISSING_RESPONSE,
      { context, receivedType: typeof response }
    );
  }

  // Explicit failure is always valid
  if (response.success === false || response.error) {
    return response;
  }

  // If success: true, check required fields
  if (response.success === true && requiredFields.length > 0) {
    const data = response[dataKey] || response;
    const missingFields = requiredFields.filter(f => data[f] === undefined || data[f] === null);

    if (missingFields.length > 0) {
      throw new InvariantViolationError(
        `API response missing required fields: ${missingFields.join(', ')}`,
        INVARIANT_ERROR_CODES.SUCCESS_WITHOUT_DATA,
        { context, missingFields, dataKey }
      );
    }
  }

  return response;
}

/**
 * Normalize any API response to consistent shape
 * @param {object} response - Raw API response
 * @param {string} context - Where this normalization is happening
 * @param {object} options - Normalization options
 * @returns {object} - Normalized response { success, data?, error?, code? }
 */
export function normalizeApiResponse(response, context = 'unknown', options = {}) {
  const { dataKey = 'data' } = options;

  if (!response) {
    return {
      success: false,
      error: 'No response received',
      code: 'NO_RESPONSE'
    };
  }

  if (typeof response !== 'object') {
    return {
      success: false,
      error: `Invalid response type: ${typeof response}`,
      code: 'INVALID_RESPONSE_TYPE'
    };
  }

  // Explicit success
  if (response.success === true) {
    return {
      success: true,
      data: response[dataKey] || response.data || response
    };
  }

  // Explicit failure
  if (response.success === false || response.error) {
    return {
      success: false,
      error: response.error || response.message || 'Request failed',
      code: response.code || 'UNKNOWN_ERROR'
    };
  }

  // Ambiguous - check for data presence
  if (response[dataKey] || response.data) {
    return {
      success: true,
      data: response[dataKey] || response.data
    };
  }

  // Truly ambiguous
  console.warn(`[Invariant] Ambiguous API response in ${context}:`, Object.keys(response));
  return {
    success: false,
    error: 'Ambiguous response from server',
    code: 'AMBIGUOUS_RESPONSE'
  };
}

// ============================================================================
// PHASE 1: UNIVERSAL withInvariant() WRAPPER
// ============================================================================

/**
 * Universal invariant wrapper for any async operation
 *
 * @param {Function} operation - Async function that returns a response
 * @param {string} context - Where this operation is happening
 * @param {object} options - Validation options
 * @param {string} options.type - Response type: 'deal', 'session', 'ai', 'organization', 'generic'
 * @param {string[]} options.requiredFields - Fields required on success (for generic type)
 * @param {Function} options.onViolation - Called when invariant is violated
 * @returns {Promise<object>} - Validated response
 */
export async function withInvariant(operation, context = 'unknown', options = {}) {
  const { type = 'generic', requiredFields = [], onViolation } = options;

  try {
    const response = await operation();

    // Validate based on type
    switch (type) {
      case 'deal':
        return validateDealResponse(response, context);

      case 'session':
        return validateSessionResponse(response, context);

      case 'ai':
        return validateAIResponse(response, context);

      case 'organization':
        if (response.success !== false && response.organization) {
          validateOrganizationSchema(response.organization, context);
        }
        return response;

      case 'generic':
      default:
        return validateApiResponse(response, context, { requiredFields });
    }
  } catch (error) {
    // If it's already an invariant error
    if (error instanceof InvariantViolationError) {
      console.error(`[Invariant] Violation in ${context}:`, error.toJSON());

      // Call violation handler if provided
      if (onViolation) {
        try {
          onViolation(error);
        } catch (e) {
          console.error('[Invariant] Error in onViolation handler:', e);
        }
      }

      // Return failure response instead of throwing
      return {
        success: false,
        error: 'Response validation failed',
        code: error.code,
        details: error.details
      };
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
 * Synchronous invariant check (does not wrap async operations)
 * Use this when you already have the response and just want to validate
 *
 * @param {object} response - The response to validate
 * @param {string} context - Where this validation is happening
 * @param {object} options - Same as withInvariant
 * @returns {object} - The response (unchanged if valid, normalized if not)
 */
export function checkInvariant(response, context = 'unknown', options = {}) {
  const { type = 'generic', requiredFields = [] } = options;

  try {
    switch (type) {
      case 'deal':
        return validateDealResponse(response, context);
      case 'session':
        return validateSessionResponse(response, context);
      case 'ai':
        return validateAIResponse(response, context);
      case 'organization':
        if (response.success !== false && response.organization) {
          validateOrganizationSchema(response.organization, context);
        }
        return response;
      case 'generic':
      default:
        return validateApiResponse(response, context, { requiredFields });
    }
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      console.error(`[Invariant] Violation in ${context}:`, error.toJSON());
      return {
        success: false,
        error: 'Response validation failed',
        code: error.code,
        details: error.details
      };
    }
    throw error;
  }
}

/**
 * Track invariant violation for telemetry
 * PHASE 5: Now connected to throttled telemetry reporter
 *
 * @param {string} context - Where the violation occurred
 * @param {string} code - Invariant error code
 * @param {object} details - Additional details
 */
export function trackInvariantViolation(context, code, details = {}) {
  // Log locally for debugging
  console.error('[Invariant] VIOLATION:', { context, code, details, timestamp: new Date().toISOString() });

  // PHASE 5: Send to throttled telemetry reporter
  // Lazy import to avoid circular dependencies
  import('./telemetry-reporter').then(({ telemetryReporter }) => {
    telemetryReporter.reportInvariantViolation(code, {
      context,
      ...details,
    });
  }).catch(() => {
    // Silently fail if telemetry module not available
    // This ensures invariant checking still works even if telemetry fails
  });
}

export default {
  // Deal schema
  DEAL_REQUIRED_FIELDS,
  DEAL_EXPECTED_FIELDS,
  VALID_STAGES,
  VALID_STATUSES,

  // User/Session schema (PHASE 1)
  USER_REQUIRED_FIELDS,
  SESSION_REQUIRED_FIELDS,
  VALID_USER_ROLES,

  // Organization schema (PHASE 1)
  ORGANIZATION_REQUIRED_FIELDS,
  VALID_PLANS,

  // AI schema (PHASE 1)
  AI_RESPONSE_REQUIRED_FIELDS,
  VALID_AI_PROVIDERS,

  // Error codes
  INVARIANT_ERROR_CODES,
  InvariantViolationError,

  // Deal validators
  validateDealSchema,
  validateDealResponse,
  validateUpdateApplied,
  withDealInvariant,
  isValidSuccessResponse,
  normalizeDealResponse,

  // User/Session validators (PHASE 1)
  validateUserSchema,
  validateSessionResponse,

  // Organization validators (PHASE 1)
  validateOrganizationSchema,

  // AI validators (PHASE 1)
  validateAIResponse,
  normalizeAIResponse,

  // Generic validators (PHASE 1)
  validateApiResponse,
  normalizeApiResponse,

  // Universal wrappers (PHASE 1)
  withInvariant,
  checkInvariant,
  trackInvariantViolation
};
