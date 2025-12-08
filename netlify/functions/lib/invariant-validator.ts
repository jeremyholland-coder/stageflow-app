/**
 * BACKEND INVARIANT VALIDATION MODULE
 *
 * PHASE 1 2025-12-08: Server-side invariant enforcement
 *
 * This module provides strict invariant validators for Netlify functions.
 * It ensures that ALL API responses meet their schema requirements before
 * being sent to clients.
 *
 * INTEGRATION:
 * - Works with with-error-boundary.ts for automatic response validation
 * - Logs violations to Sentry for monitoring
 * - Never exposes internal validation errors to clients
 *
 * USAGE:
 * ```typescript
 * import { validateDealResponse, withResponseInvariant } from './lib/invariant-validator';
 *
 * // Option 1: Manual validation
 * const validatedDeal = validateDealResponse(deal, 'update-deal');
 *
 * // Option 2: Wrapper (validates before returning)
 * return withResponseInvariant(
 *   () => ({ success: true, deal }),
 *   'update-deal',
 *   { type: 'deal' }
 * );
 * ```
 */

import { captureBackendError, captureBackendMessage } from './sentry-backend';

// ============================================================================
// SCHEMA DEFINITIONS (mirrored from frontend for consistency)
// ============================================================================

/**
 * Required fields for a valid deal object
 */
export const DEAL_REQUIRED_FIELDS = ['id', 'organization_id', 'stage', 'status'] as const;

/**
 * Valid deal stages across all pipeline templates
 * This is a comprehensive list but NOT exhaustive - organizations may have custom stages
 * FIX 2025-12-08: Stage validation is now permissive to support custom pipeline stages
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
 * Check if a stage looks valid (basic sanity check)
 * Accepts any lowercase snake_case string as potentially valid
 * This is permissive to support custom organization stages from pipeline_stages table
 */
export function isValidStageFormat(stage: string): boolean {
  if (!stage || typeof stage !== 'string') return false;
  // Must be non-empty, lowercase, snake_case format
  return /^[a-z][a-z0-9_]*$/.test(stage);
}

/**
 * Valid deal status values
 */
export const VALID_STATUSES = new Set(['active', 'won', 'lost', 'disqualified']);

/**
 * Required fields for a valid user object
 */
export const USER_REQUIRED_FIELDS = ['id', 'email'] as const;

/**
 * Required fields for a valid organization object
 */
export const ORGANIZATION_REQUIRED_FIELDS = ['id', 'name'] as const;

/**
 * Valid AI provider types
 */
export const VALID_AI_PROVIDERS = new Set(['openai', 'anthropic', 'google']);

// ============================================================================
// ERROR CODES
// ============================================================================

export const INVARIANT_ERROR_CODES = {
  // Deal invariants
  MISSING_DEAL: 'INVARIANT_MISSING_DEAL',
  INVALID_DEAL_SHAPE: 'INVARIANT_INVALID_DEAL_SHAPE',
  MISSING_REQUIRED_FIELD: 'INVARIANT_MISSING_REQUIRED_FIELD',
  INVALID_STAGE: 'INVARIANT_INVALID_STAGE',
  INVALID_STATUS: 'INVARIANT_INVALID_STATUS',
  INVALID_VALUE: 'INVARIANT_INVALID_VALUE',

  // Session invariants
  MISSING_USER: 'INVARIANT_MISSING_USER',
  INVALID_USER_SHAPE: 'INVARIANT_INVALID_USER_SHAPE',

  // Organization invariants
  MISSING_ORGANIZATION: 'INVARIANT_MISSING_ORGANIZATION',
  INVALID_ORGANIZATION_SHAPE: 'INVARIANT_INVALID_ORGANIZATION_SHAPE',

  // AI invariants
  MISSING_AI_RESPONSE: 'INVARIANT_MISSING_AI_RESPONSE',
  AI_RESPONSE_EMPTY: 'INVARIANT_AI_RESPONSE_EMPTY',

  // Generic invariants
  MISSING_RESPONSE: 'INVARIANT_MISSING_RESPONSE',
  SUCCESS_WITHOUT_DATA: 'INVARIANT_SUCCESS_WITHOUT_DATA',
  AMBIGUOUS_RESPONSE: 'INVARIANT_AMBIGUOUS_RESPONSE'
} as const;

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================

/**
 * Custom error class for invariant violations
 */
export class InvariantViolationError extends Error {
  code: string;
  details: Record<string, unknown>;
  timestamp: string;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
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

// ============================================================================
// DEAL VALIDATION
// ============================================================================

interface Deal {
  id: string;
  organization_id: string;
  stage: string;
  status: string;
  value?: number;
  [key: string]: unknown;
}

/**
 * Validate that a deal object has all required fields
 */
export function validateDealSchema(deal: unknown, context: string = 'unknown'): deal is Deal {
  if (!deal || typeof deal !== 'object') {
    throw new InvariantViolationError(
      `Deal validation failed: received ${typeof deal} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_DEAL,
      { context, receivedType: typeof deal }
    );
  }

  if (Array.isArray(deal)) {
    throw new InvariantViolationError(
      'Deal validation failed: received array instead of single deal object',
      INVARIANT_ERROR_CODES.INVALID_DEAL_SHAPE,
      { context, receivedType: 'array' }
    );
  }

  const dealObj = deal as Record<string, unknown>;
  const missingFields: string[] = [];

  for (const field of DEAL_REQUIRED_FIELDS) {
    if (dealObj[field] === undefined || dealObj[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `Deal validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      { context, missingFields, dealKeys: Object.keys(dealObj) }
    );
  }

  // Validate stage - PERMISSIVE: accept any valid-format stage
  // FIX 2025-12-08: Don't fail for unknown stages, just warn
  // Organizations may have custom stages from pipeline_stages table
  if (dealObj.stage) {
    const stage = dealObj.stage as string;
    if (!isValidStageFormat(stage)) {
      throw new InvariantViolationError(
        `Deal validation failed: invalid stage format "${stage}"`,
        INVARIANT_ERROR_CODES.INVALID_STAGE,
        { context, stage }
      );
    }
    // Warn but don't fail for unknown stages
    if (!VALID_STAGES.has(stage)) {
      console.warn(`[Invariant] Unknown stage "${stage}" in ${context} - allowing (may be custom stage)`);
    }
  }

  // Validate status
  if (dealObj.status && !VALID_STATUSES.has(dealObj.status as string)) {
    throw new InvariantViolationError(
      `Deal validation failed: invalid status "${dealObj.status}"`,
      INVARIANT_ERROR_CODES.INVALID_STATUS,
      { context, status: dealObj.status }
    );
  }

  // Validate value is non-negative if present
  if (dealObj.value !== undefined && dealObj.value !== null) {
    const numValue = Number(dealObj.value);
    if (isNaN(numValue) || numValue < 0) {
      throw new InvariantViolationError(
        `Deal validation failed: invalid value "${dealObj.value}"`,
        INVARIANT_ERROR_CODES.INVALID_VALUE,
        { context, value: dealObj.value }
      );
    }
  }

  return true;
}

/**
 * Validate an API response that should contain a deal
 */
export function validateDealResponse(
  response: unknown,
  context: string = 'unknown'
): { success: boolean; deal?: Deal; error?: string; code?: string } {
  if (!response || typeof response !== 'object') {
    throw new InvariantViolationError(
      `Response validation failed: received ${typeof response}`,
      INVARIANT_ERROR_CODES.MISSING_RESPONSE,
      { context, receivedType: typeof response }
    );
  }

  const resp = response as Record<string, unknown>;

  // Explicit failure is valid
  if (resp.success === false) {
    return resp as { success: false; error?: string; code?: string };
  }

  // If success: true, deal MUST be present and valid
  if (resp.success === true) {
    if (!resp.deal) {
      throw new InvariantViolationError(
        'Response claims success but deal is missing',
        INVARIANT_ERROR_CODES.MISSING_DEAL,
        { context, responseKeys: Object.keys(resp) }
      );
    }

    validateDealSchema(resp.deal, context);
    return resp as { success: true; deal: Deal };
  }

  // Ambiguous - try to normalize
  if (resp.deal) {
    validateDealSchema(resp.deal, context);
    return { success: true, deal: resp.deal as Deal };
  }

  if (resp.error) {
    return { success: false, error: resp.error as string, code: resp.code as string };
  }

  throw new InvariantViolationError(
    'Ambiguous response: success is undefined and no deal/error present',
    INVARIANT_ERROR_CODES.AMBIGUOUS_RESPONSE,
    { context, responseKeys: Object.keys(resp) }
  );
}

// ============================================================================
// USER VALIDATION
// ============================================================================

interface User {
  id: string;
  email: string;
  [key: string]: unknown;
}

/**
 * Validate that a user object has all required fields
 */
export function validateUserSchema(user: unknown, context: string = 'unknown'): user is User {
  if (!user || typeof user !== 'object') {
    throw new InvariantViolationError(
      `User validation failed: received ${typeof user} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_USER,
      { context, receivedType: typeof user }
    );
  }

  const userObj = user as Record<string, unknown>;
  const missingFields: string[] = [];

  for (const field of USER_REQUIRED_FIELDS) {
    if (userObj[field] === undefined || userObj[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `User validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.INVALID_USER_SHAPE,
      { context, missingFields, userKeys: Object.keys(userObj) }
    );
  }

  return true;
}

// ============================================================================
// ORGANIZATION VALIDATION
// ============================================================================

interface Organization {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Validate that an organization object has all required fields
 */
export function validateOrganizationSchema(
  org: unknown,
  context: string = 'unknown'
): org is Organization {
  if (!org || typeof org !== 'object') {
    throw new InvariantViolationError(
      `Organization validation failed: received ${typeof org} instead of object`,
      INVARIANT_ERROR_CODES.MISSING_ORGANIZATION,
      { context, receivedType: typeof org }
    );
  }

  const orgObj = org as Record<string, unknown>;
  const missingFields: string[] = [];

  for (const field of ORGANIZATION_REQUIRED_FIELDS) {
    if (orgObj[field] === undefined || orgObj[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new InvariantViolationError(
      `Organization validation failed: missing required fields: ${missingFields.join(', ')}`,
      INVARIANT_ERROR_CODES.INVALID_ORGANIZATION_SHAPE,
      { context, missingFields, orgKeys: Object.keys(orgObj) }
    );
  }

  return true;
}

// ============================================================================
// AI RESPONSE VALIDATION
// ============================================================================

interface AIResponse {
  response?: string;
  content?: string;
  message?: string;
  fallbackPlan?: unknown;
  provider?: string;
  [key: string]: unknown;
}

/**
 * Validate an AI assistant response
 */
export function validateAIResponse(
  response: unknown,
  context: string = 'unknown'
): AIResponse {
  if (!response || typeof response !== 'object') {
    throw new InvariantViolationError(
      `AI response validation failed: received ${typeof response}`,
      INVARIANT_ERROR_CODES.MISSING_AI_RESPONSE,
      { context, receivedType: typeof response }
    );
  }

  const resp = response as Record<string, unknown>;

  // Error responses are valid
  if (resp.error || resp.ok === false || resp.success === false) {
    return resp as AIResponse;
  }

  // Success responses must have content
  const hasContent = resp.response || resp.content || resp.message || resp.fallbackPlan;
  if (!hasContent) {
    throw new InvariantViolationError(
      'AI response has no content (response, content, message, or fallbackPlan)',
      INVARIANT_ERROR_CODES.AI_RESPONSE_EMPTY,
      { context, responseKeys: Object.keys(resp) }
    );
  }

  return resp as AIResponse;
}

// ============================================================================
// GENERIC RESPONSE VALIDATION
// ============================================================================

interface GenericResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/**
 * Validate any API response for basic consistency
 */
export function validateApiResponse(
  response: unknown,
  context: string = 'unknown',
  options: { requiredFields?: string[]; dataKey?: string } = {}
): GenericResponse {
  const { requiredFields = [], dataKey = 'data' } = options;

  if (!response || typeof response !== 'object') {
    throw new InvariantViolationError(
      `API response validation failed: received ${typeof response}`,
      INVARIANT_ERROR_CODES.MISSING_RESPONSE,
      { context, receivedType: typeof response }
    );
  }

  const resp = response as Record<string, unknown>;

  // Explicit failure is valid
  if (resp.success === false || resp.error) {
    return {
      success: false,
      error: (resp.error || resp.message || 'Request failed') as string,
      code: resp.code as string
    };
  }

  // Check required fields on success
  if (resp.success === true && requiredFields.length > 0) {
    const data = (resp[dataKey] || resp) as Record<string, unknown>;
    const missingFields = requiredFields.filter(f => data[f] === undefined || data[f] === null);

    if (missingFields.length > 0) {
      throw new InvariantViolationError(
        `API response missing required fields: ${missingFields.join(', ')}`,
        INVARIANT_ERROR_CODES.SUCCESS_WITHOUT_DATA,
        { context, missingFields, dataKey }
      );
    }
  }

  return {
    success: resp.success !== false,
    data: resp[dataKey] ?? resp.data ?? resp
  };
}

// ============================================================================
// RESPONSE WRAPPER
// ============================================================================

type ResponseType = 'deal' | 'user' | 'organization' | 'ai' | 'generic';

interface InvariantOptions {
  type: ResponseType;
  requiredFields?: string[];
  dataKey?: string;
}

/**
 * Wrap a response generator with invariant validation
 *
 * @param responseGenerator - Function that generates the response
 * @param context - Where this validation is happening (for logging)
 * @param options - Validation options
 * @returns Validated response
 */
export async function withResponseInvariant<T>(
  responseGenerator: () => T | Promise<T>,
  context: string,
  options: InvariantOptions
): Promise<T> {
  try {
    const response = await responseGenerator();

    // Validate based on type
    switch (options.type) {
      case 'deal':
        validateDealResponse(response, context);
        break;

      case 'user':
        if (response && typeof response === 'object') {
          const resp = response as Record<string, unknown>;
          if (resp.user) {
            validateUserSchema(resp.user, context);
          }
        }
        break;

      case 'organization':
        if (response && typeof response === 'object') {
          const resp = response as Record<string, unknown>;
          if (resp.organization) {
            validateOrganizationSchema(resp.organization, context);
          }
        }
        break;

      case 'ai':
        validateAIResponse(response, context);
        break;

      case 'generic':
      default:
        validateApiResponse(response, context, {
          requiredFields: options.requiredFields,
          dataKey: options.dataKey
        });
        break;
    }

    return response;

  } catch (error) {
    // Log to Sentry for monitoring
    if (error instanceof InvariantViolationError) {
      captureBackendMessage(`Invariant violation in ${context}`, {
        level: 'error',
        extra: error.toJSON()
      });

      console.error(`[Invariant] VIOLATION in ${context}:`, error.toJSON());
    } else {
      captureBackendError(error as Error, { context, type: options.type });
    }

    throw error;
  }
}

/**
 * Track an invariant violation for telemetry
 */
export function trackInvariantViolation(
  context: string,
  code: string,
  details: Record<string, unknown> = {}
): void {
  const violation = {
    context,
    code,
    details,
    timestamp: new Date().toISOString()
  };

  console.error('[Invariant] VIOLATION:', violation);

  // Send to Sentry
  captureBackendMessage(`Invariant violation: ${code}`, {
    level: 'error',
    extra: violation
  });
}

/**
 * Ensure a deal response is valid before returning to client
 * This is a convenience function for deal endpoints
 */
export function ensureValidDealResponse(
  response: unknown,
  context: string
): { success: true; deal: Deal } | { success: false; error: string; code: string } {
  try {
    const validated = validateDealResponse(response, context);
    return validated as { success: true; deal: Deal } | { success: false; error: string; code: string };
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      trackInvariantViolation(context, error.code, error.details);

      // Return safe error response
      return {
        success: false,
        error: 'An error occurred processing your request',
        code: error.code
      };
    }
    throw error;
  }
}

/**
 * Ensure an AI response is valid before returning to client
 */
export function ensureValidAIResponse(
  response: unknown,
  context: string
): AIResponse | { success: false; error: string; code: string } {
  try {
    return validateAIResponse(response, context);
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      trackInvariantViolation(context, error.code, error.details);

      return {
        success: false,
        error: 'AI response unavailable',
        code: error.code
      };
    }
    throw error;
  }
}

export default {
  // Schema constants
  DEAL_REQUIRED_FIELDS,
  VALID_STAGES,
  VALID_STATUSES,
  USER_REQUIRED_FIELDS,
  ORGANIZATION_REQUIRED_FIELDS,
  VALID_AI_PROVIDERS,
  INVARIANT_ERROR_CODES,

  // Error class
  InvariantViolationError,

  // Validators
  validateDealSchema,
  validateDealResponse,
  validateUserSchema,
  validateOrganizationSchema,
  validateAIResponse,
  validateApiResponse,

  // Wrappers
  withResponseInvariant,
  ensureValidDealResponse,
  ensureValidAIResponse,

  // Telemetry
  trackInvariantViolation
};
