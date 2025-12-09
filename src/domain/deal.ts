/**
 * DEAL DOMAIN SPINE
 *
 * Single source of truth for Deal types, validation, and normalization.
 * All deal-related code (backend + frontend) must go through this module.
 *
 * @module domain/deal
 * @since Engine Rebuild Phase 5
 */

// =============================================================================
// TYPES
// =============================================================================

export type DealStatus = 'active' | 'won' | 'lost' | 'disqualified';

/** Internal stage IDs - lowercase snake_case, including custom stages */
export type DealStageId = string;

export interface Deal {
  id: string;
  organization_id: string;
  client: string;
  stage: DealStageId;
  status: DealStatus;
  value: number | null;
  created: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity?: string | null;
  assigned_to?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  confidence?: number | null;
  probability?: number | null;
  expected_close?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  source?: string | null;
  // Lost outcome fields
  lost_reason?: string | null;
  lost_reason_notes?: string | null;
  // Disqualified outcome fields
  disqualified_reason_category?: string | null;
  disqualified_reason_notes?: string | null;
  stage_at_disqualification?: string | null;
  disqualified_at?: string | null;
  disqualified_by?: string | null;
  // Unified outcome fields (Phase 4)
  outcome_reason_category?: string | null;
  outcome_notes?: string | null;
  outcome_recorded_at?: string | null;
  outcome_recorded_by?: string | null;
  // AI health fields
  ai_health_score?: number | null;
  ai_health_analysis?: string | null;
  ai_health_updated_at?: string | null;
  // Soft delete
  deleted_at?: string | null;
}

// =============================================================================
// CORE STAGES (built-in pipeline stages)
// =============================================================================

/**
 * Core stages that ship with StageFlow.
 * Custom stages are also valid - this list is for reference and smart defaults.
 */
export const CORE_STAGES = [
  // Default pipeline
  'lead', 'lead_captured', 'lead_qualified', 'contacted', 'needs_identified',
  'proposal_sent', 'negotiation', 'deal_won', 'deal_lost',
  'invoice_sent', 'payment_received', 'customer_onboarded',
  // Legacy stages
  'quote', 'approval', 'invoice', 'onboarding', 'delivery', 'retention', 'lost',
  // Healthcare pipeline
  'lead_generation', 'lead_qualification', 'discovery', 'scope_defined',
  'contract_sent', 'client_onboarding', 'renewal_upsell',
  // VC/PE pipeline
  'deal_sourced', 'initial_screening', 'due_diligence', 'term_sheet_presented',
  'investment_closed', 'capital_call_sent', 'capital_received', 'portfolio_mgmt',
  // Real Estate pipeline
  'qualification', 'property_showing', 'contract_signed',
  'closing_statement_sent', 'escrow_completed', 'client_followup',
  // Professional Services
  'lead_identified',
  // SaaS pipeline
  'prospecting', 'contact', 'proposal', 'closed', 'adoption', 'renewal',
] as const;

export const CORE_STAGES_SET = new Set<string>(CORE_STAGES);

// =============================================================================
// STAGE VALIDATION
// =============================================================================

/**
 * Validates a stage ID format.
 *
 * Rules:
 * - Must be lowercase
 * - Only letters, numbers, and underscores
 * - Cannot start with a number
 * - 1-50 characters
 *
 * This is PERMISSIVE - it allows custom stages.
 * Use isCoreSt age() to check if it's a built-in stage.
 */
export function isValidStageId(stage: unknown): stage is DealStageId {
  if (typeof stage !== 'string') return false;
  if (stage.length === 0 || stage.length > 50) return false;

  // Must be lowercase snake_case
  const validFormat = /^[a-z][a-z0-9_]*$/.test(stage);
  return validFormat;
}

/**
 * Check if a stage is one of the core built-in stages.
 */
export function isCoreStage(stage: string): boolean {
  return CORE_STAGES_SET.has(stage);
}

/**
 * Validate stage with detailed result.
 * Returns { valid, warning } - warning is set for custom stages.
 */
export function validateStage(stage: unknown): { valid: boolean; warning?: string; error?: string } {
  if (!isValidStageId(stage)) {
    return {
      valid: false,
      error: `Invalid stage format: "${stage}". Stage must be lowercase snake_case (e.g., lead_captured).`
    };
  }

  if (!isCoreStage(stage)) {
    return {
      valid: true,
      warning: `Custom stage detected: ${stage}`
    };
  }

  return { valid: true };
}

// =============================================================================
// STATUS VALIDATION
// =============================================================================

const VALID_STATUSES: Set<DealStatus> = new Set(['active', 'won', 'lost', 'disqualified']);

export function isValidStatus(status: unknown): status is DealStatus {
  return typeof status === 'string' && VALID_STATUSES.has(status as DealStatus);
}

// =============================================================================
// STAGE ↔ STATUS SYNC
// =============================================================================

/**
 * Maps stage to its implied status.
 * Some stages (like deal_won, deal_lost) imply a specific status.
 */
const STAGE_TO_STATUS_MAP: Record<string, DealStatus> = {
  // Win stages
  'deal_won': 'won',
  'closed_won': 'won',
  'won': 'won',
  'closed': 'won',
  'investment_closed': 'won',
  'contract_signed': 'won',
  'escrow_completed': 'won',
  'payment_received': 'won',

  // Lost stages
  'deal_lost': 'lost',
  'closed_lost': 'lost',
  'lost': 'lost',
};

/**
 * Get the implied status for a stage, or null if stage doesn't imply a status.
 */
export function getImpliedStatusForStage(stage: DealStageId): DealStatus | null {
  return STAGE_TO_STATUS_MAP[stage] || null;
}

/**
 * Sync stage and status to ensure consistency.
 *
 * Rules:
 * - If stage implies a status (e.g., deal_won → won), set that status
 * - If status is 'won' or 'lost' but stage doesn't match, keep the explicit status
 * - Returns a new deal object (does not mutate input)
 */
export function syncStageAndStatus(deal: Deal): Deal {
  const impliedStatus = getImpliedStatusForStage(deal.stage);

  // If stage implies a status, use it
  if (impliedStatus && deal.status !== impliedStatus) {
    return { ...deal, status: impliedStatus };
  }

  // If status is active but we're in a won/lost stage, sync it
  if (deal.status === 'active' && impliedStatus) {
    return { ...deal, status: impliedStatus };
  }

  return deal;
}

// =============================================================================
// OUTCOME VALIDATION
// =============================================================================

export interface OutcomeViolation {
  field: string;
  message: string;
}

/**
 * Validate that outcome fields are consistent with status.
 * Returns array of violations (empty = valid).
 */
export function validateOutcome(deal: Deal): OutcomeViolation[] {
  const violations: OutcomeViolation[] = [];

  if (deal.status === 'lost') {
    // Lost deals must have a reason
    const hasLostReason = !!(deal.lost_reason || deal.outcome_reason_category);
    if (!hasLostReason) {
      violations.push({
        field: 'lost_reason',
        message: 'Lost deals must have a reason'
      });
    }

    // If reason is "Other", must have notes
    const isOtherReason = deal.lost_reason === 'other' ||
                          deal.outcome_reason_category === 'other' ||
                          deal.lost_reason?.startsWith('Other:');
    const hasNotes = !!(deal.lost_reason_notes || deal.outcome_notes);

    if (isOtherReason && !hasNotes) {
      violations.push({
        field: 'lost_reason_notes',
        message: 'Please provide details when selecting "Other"'
      });
    }
  }

  if (deal.status === 'disqualified') {
    // Disqualified deals must have a reason
    const hasDisqReason = !!(deal.disqualified_reason_category || deal.outcome_reason_category);
    if (!hasDisqReason) {
      violations.push({
        field: 'disqualified_reason_category',
        message: 'Disqualified deals must have a reason'
      });
    }
  }

  // Active/Won deals should not have negative outcome data
  if (deal.status === 'active' || deal.status === 'won') {
    if (deal.lost_reason || deal.disqualified_reason_category || deal.outcome_reason_category) {
      violations.push({
        field: 'outcome_reason_category',
        message: `${deal.status} deals should not have outcome reason data`
      });
    }
  }

  return violations;
}

// =============================================================================
// DEAL NORMALIZATION
// =============================================================================

/**
 * Normalize raw deal data from API/DB into a clean Deal object.
 *
 * - Ensures required fields exist
 * - Clamps confidence to 0-100
 * - Syncs stage/status
 * - Returns null if deal is invalid (missing id/org)
 */
export function normalizeDeal(raw: unknown): Deal | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  // Required fields
  if (!obj.id || typeof obj.id !== 'string') return null;
  if (!obj.organization_id || typeof obj.organization_id !== 'string') return null;

  // ENGINE REBUILD Phase 9: Helper to safely coerce to number, rejecting NaN
  // typeof NaN === 'number' is true, so we must explicitly check for NaN
  const safeNumber = (val: unknown): number | null => {
    if (typeof val !== 'number') return null;
    if (Number.isNaN(val)) return null;
    return val;
  };

  // Build normalized deal
  const deal: Deal = {
    id: obj.id as string,
    organization_id: obj.organization_id as string,
    client: typeof obj.client === 'string' ? obj.client : (obj.client_name as string) || '',
    stage: isValidStageId(obj.stage) ? obj.stage : 'lead',
    status: isValidStatus(obj.status) ? obj.status : 'active',
    value: safeNumber(obj.value),
    created: typeof obj.created === 'string' ? obj.created : null,
    created_at: typeof obj.created_at === 'string' ? obj.created_at : undefined,
    updated_at: typeof obj.updated_at === 'string' ? obj.updated_at : undefined,
    last_activity: typeof obj.last_activity === 'string' ? obj.last_activity : undefined,
    assigned_to: typeof obj.assigned_to === 'string' ? obj.assigned_to : undefined,
    confidence: (() => {
      const val = safeNumber(obj.confidence);
      return val !== null ? Math.max(0, Math.min(100, val)) : undefined;
    })(),
    probability: (() => {
      const val = safeNumber(obj.probability);
      return val !== null ? Math.max(0, Math.min(100, val)) : undefined;
    })(),
    expected_close: typeof obj.expected_close === 'string' ? obj.expected_close : undefined,
    company: typeof obj.company === 'string' ? obj.company : undefined,
    email: typeof obj.email === 'string' ? obj.email : undefined,
    phone: typeof obj.phone === 'string' ? obj.phone : undefined,
    notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    // Outcome fields
    lost_reason: typeof obj.lost_reason === 'string' ? obj.lost_reason : undefined,
    lost_reason_notes: typeof obj.lost_reason_notes === 'string' ? obj.lost_reason_notes : undefined,
    disqualified_reason_category: typeof obj.disqualified_reason_category === 'string' ? obj.disqualified_reason_category : undefined,
    disqualified_reason_notes: typeof obj.disqualified_reason_notes === 'string' ? obj.disqualified_reason_notes : undefined,
    outcome_reason_category: typeof obj.outcome_reason_category === 'string' ? obj.outcome_reason_category : undefined,
    outcome_notes: typeof obj.outcome_notes === 'string' ? obj.outcome_notes : undefined,
  };

  // Sync stage and status
  return syncStageAndStatus(deal);
}

/**
 * Clear outcome fields for a deal (used when reactivating a lost/disqualified deal)
 */
export function clearOutcomeFields(deal: Deal): Deal {
  return {
    ...deal,
    lost_reason: null,
    lost_reason_notes: null,
    disqualified_reason_category: null,
    disqualified_reason_notes: null,
    stage_at_disqualification: null,
    disqualified_at: null,
    disqualified_by: null,
    outcome_reason_category: null,
    outcome_notes: null,
    outcome_recorded_at: null,
    outcome_recorded_by: null,
  };
}

// =============================================================================
// EXPORTS FOR BACKEND (CommonJS compatible)
// =============================================================================

export default {
  CORE_STAGES,
  CORE_STAGES_SET,
  isValidStageId,
  isCoreStage,
  validateStage,
  isValidStatus,
  getImpliedStatusForStage,
  syncStageAndStatus,
  validateOutcome,
  normalizeDeal,
  clearOutcomeFields,
};
