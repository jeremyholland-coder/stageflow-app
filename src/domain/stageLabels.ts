/**
 * STAGE LABELS DOMAIN SPINE
 *
 * Single source of truth for stage and outcome display names.
 * All UI code must use these helpers - no inline string manipulation.
 *
 * @module domain/stageLabels
 * @since Engine Rebuild Phase 5
 */

// =============================================================================
// STAGE DISPLAY NAMES
// =============================================================================

/**
 * Human-readable names for core stages.
 * Custom stages will be auto-formatted.
 */
const STAGE_DISPLAY_NAMES: Record<string, string> = {
  // Default pipeline
  lead: 'Lead',
  lead_captured: 'Lead Captured',
  lead_qualified: 'Lead Qualified',
  contacted: 'Contacted',
  needs_identified: 'Needs Identified',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  deal_won: 'Deal Won',
  deal_lost: 'Deal Lost',
  invoice_sent: 'Invoice Sent',
  payment_received: 'Payment Received',
  customer_onboarded: 'Customer Onboarded',

  // Legacy stages
  quote: 'Quote',
  approval: 'Approval',
  invoice: 'Invoice',
  onboarding: 'Onboarding',
  delivery: 'Delivery',
  retention: 'Retention',
  lost: 'Lost',

  // Healthcare pipeline
  lead_generation: 'Lead Generation',
  lead_qualification: 'Lead Qualification',
  discovery: 'Discovery',
  scope_defined: 'Scope Defined',
  contract_sent: 'Contract Sent',
  client_onboarding: 'Client Onboarding',
  renewal_upsell: 'Renewal / Upsell',

  // VC/PE pipeline
  deal_sourced: 'Deal Sourced',
  initial_screening: 'Initial Screening',
  due_diligence: 'Due Diligence',
  term_sheet_presented: 'Term Sheet Presented',
  investment_closed: 'Investment Closed',
  capital_call_sent: 'Capital Call Sent',
  capital_received: 'Capital Received',
  portfolio_mgmt: 'Portfolio Management',

  // Real Estate pipeline
  qualification: 'Qualification',
  property_showing: 'Property Showing',
  contract_signed: 'Contract Signed',
  closing_statement_sent: 'Closing Statement Sent',
  escrow_completed: 'Escrow Completed',
  client_followup: 'Client Follow-up',

  // Professional Services
  lead_identified: 'Lead Identified',

  // SaaS pipeline
  prospecting: 'Prospecting',
  contact: 'Contact',
  proposal: 'Proposal',
  closed: 'Closed',
  adoption: 'Adoption',
  renewal: 'Renewal',

  // Terminal stages
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  won: 'Won',
};

/**
 * Convert snake_case to Title Case.
 * Used for custom stages that aren't in the lookup table.
 */
function snakeCaseToTitleCase(str: string): string {
  if (!str) return 'Unknown';
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get the display name for a stage.
 *
 * - Uses lookup table for known stages
 * - Falls back to Title Case conversion for custom stages
 * - Never returns raw snake_case
 */
export function getStageDisplayName(stageId: string | null | undefined): string {
  if (!stageId) return 'Unknown';

  // Check lookup table first
  const known = STAGE_DISPLAY_NAMES[stageId];
  if (known) return known;

  // Convert custom stage to Title Case
  return snakeCaseToTitleCase(stageId);
}

// =============================================================================
// LOST REASON DISPLAY
// =============================================================================

/**
 * Human-readable names for lost reasons.
 */
const LOST_REASON_DISPLAY: Record<string, string> = {
  competitor: 'Lost to Competitor',
  no_interest: 'No Longer Interested',
  budget: 'Budget Constraints',
  timing: 'Wrong Timing',
  other: 'Other',
};

/**
 * Get display text for a lost reason.
 *
 * - Handles legacy "Other: custom text" format
 * - Returns null if no reason
 */
export function getLostReasonDisplay(
  reason: string | null | undefined,
  notes: string | null | undefined
): string | null {
  if (!reason) return null;

  // Handle legacy "Other: custom text" format
  if (reason.startsWith('Other:')) {
    const customText = reason.substring(6).trim();
    return customText || 'Other';
  }

  // Look up in display names
  const display = LOST_REASON_DISPLAY[reason];
  if (display) {
    // If "Other" and has notes, show the notes
    if (reason === 'other' && notes) {
      return notes;
    }
    return display;
  }

  // Fallback: Title case the reason
  return snakeCaseToTitleCase(reason);
}

// =============================================================================
// DISQUALIFIED REASON DISPLAY
// =============================================================================

/**
 * Human-readable names for disqualified reasons.
 */
const DISQUALIFIED_REASON_DISPLAY: Record<string, string> = {
  no_budget: 'No Budget',
  budget: 'Budget Constraints',
  not_a_fit: 'Not a Fit',
  no_fit: 'Not a Fit',
  wrong_timing: 'Wrong Timing',
  timing: 'Wrong Timing',
  went_with_competitor: 'Went with Competitor',
  competitor: 'Went with Competitor',
  unresponsive: 'Unresponsive',
  other: 'Other',
};

/**
 * Get display text for a disqualified reason.
 *
 * - Maps legacy reason IDs to human-readable text
 * - Returns null if no reason
 */
export function getDisqualifiedReasonDisplay(
  category: string | null | undefined,
  notes: string | null | undefined
): string | null {
  if (!category) return null;

  // Look up in display names
  const display = DISQUALIFIED_REASON_DISPLAY[category];
  if (display) {
    // If "Other" and has notes, show the notes
    if ((category === 'other' || category === 'no_fit') && notes) {
      return notes.length > 50 ? notes.substring(0, 47) + '...' : notes;
    }
    return display;
  }

  // Fallback: Title case the category
  return snakeCaseToTitleCase(category);
}

// =============================================================================
// UNIFIED OUTCOME DISPLAY
// =============================================================================

/**
 * Human-readable names for unified outcome reasons.
 * Maps to both lost and disqualified contexts.
 */
const OUTCOME_REASON_DISPLAY: Record<string, { label: string; icon: string }> = {
  competitor: { label: 'Lost to Competitor', icon: '🏆' },
  budget: { label: 'Budget Constraints', icon: '💰' },
  timing: { label: 'Wrong Timing', icon: '⏰' },
  no_fit: { label: 'Not a Fit', icon: '🎯' },
  unresponsive: { label: 'Unresponsive', icon: '📵' },
  no_interest: { label: 'No Longer Interested', icon: '❌' },
  other: { label: 'Other', icon: '📝' },
};

/**
 * Get display info for a unified outcome reason.
 */
export function getOutcomeReasonDisplay(
  category: string | null | undefined,
  notes: string | null | undefined
): { label: string; icon: string } | null {
  if (!category) return null;

  const display = OUTCOME_REASON_DISPLAY[category];
  if (display) {
    // If "Other" and has notes, use notes as label
    if (category === 'other' && notes) {
      return { label: notes.length > 50 ? notes.substring(0, 47) + '...' : notes, icon: '📝' };
    }
    return display;
  }

  // Fallback
  return { label: snakeCaseToTitleCase(category), icon: '📋' };
}

// =============================================================================
// STATUS DISPLAY
// =============================================================================

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: '#3B82F6' },
  won: { label: 'Won', color: '#10B981' },
  lost: { label: 'Lost', color: '#EF4444' },
  disqualified: { label: 'Disqualified', color: '#6B7280' },
};

/**
 * Get display info for a deal status.
 */
export function getStatusDisplay(status: string | null | undefined): { label: string; color: string } {
  if (!status) return { label: 'Unknown', color: '#9CA3AF' };
  return STATUS_DISPLAY[status] || { label: snakeCaseToTitleCase(status), color: '#9CA3AF' };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  getStageDisplayName,
  getLostReasonDisplay,
  getDisqualifiedReasonDisplay,
  getOutcomeReasonDisplay,
  getStatusDisplay,
};
