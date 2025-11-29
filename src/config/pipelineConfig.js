/**
 * Pipeline Configuration - Single Source of Truth
 *
 * IMPORTANT: This file is the centralized configuration for:
 * - Stage stagnation thresholds (industry benchmarks)
 * - Stage base confidence scores
 *
 * Used by BOTH frontend (aiConfidence.js) and backend (ai-assistant.mts)
 * to ensure consistency across the entire application.
 *
 * NO REACT DEPENDENCIES - This file must be importable by Node.js
 */

// ============================================================================
// STAGE CATEGORIES - Single Source of Truth for stage groupings
// ============================================================================
// Use these arrays when filtering deals by category (dashboard stats, reports, etc.)
// Adding a new lead-type stage? Add it here and all components update automatically.

export const LEAD_STAGES = [
  'lead',
  'lead_captured',
  'lead_generation',
  'lead_identified',
  'lead_qualification',
  'lead_qualified'
];

export const WON_STAGES = [
  'deal_won',
  'closed',
  'closed_won',
  'investment_closed',
  'retention'
];

export const LOST_STAGES = [
  'lost',
  'deal_lost',
  'passed'
];

// ============================================================================
// STAGNATION THRESHOLDS (in days)
// ============================================================================
// Industry-standard benchmarks for how long deals should stay in each stage
// Deals exceeding these thresholds are flagged as "stagnant" and lose confidence

export const STAGNATION_THRESHOLDS = {
  // Early stages - should move quickly
  lead: 7,
  lead_captured: 7,
  lead_generation: 7,
  lead_identified: 7,
  lead_qualification: 10,
  lead_qualified: 10,
  prospecting: 7,

  // Initial contact stages - quick follow-up is critical
  contacted: 10,
  contact: 10,
  initial_screening: 10,
  qualification: 14,

  // Discovery/needs stages - allow more time
  discovery: 14,
  discovery_demo: 14,
  needs_identified: 14,
  scope_defined: 14,

  // Proposal/quote stages - expect response within 2 weeks
  quote: 14,
  proposal: 14,
  proposal_sent: 14,
  contract: 14,
  contract_sent: 14,

  // Negotiation/final stages - critical momentum
  negotiation: 21,
  approval: 21,
  term_sheet_presented: 21,

  // Invoice/payment stages - quick turnaround expected
  invoice: 14,
  invoice_sent: 14,
  payment: 14,
  payment_received: 7,

  // Default fallback
  default: 14
};

// ============================================================================
// STAGE BASE CONFIDENCE (0-100)
// ============================================================================
// Base confidence scores for each stage, before user performance adjustments
// Higher stages = higher confidence that deal will close

export const STAGE_BASE_CONFIDENCE = {
  // Early stages - lower confidence
  lead: 15,
  lead_captured: 20,
  lead_generation: 18,
  lead_identified: 20,
  lead_qualification: 25,
  lead_qualified: 28,
  prospecting: 15,

  // Initial contact stages
  contacted: 30,
  contact: 30,
  initial_screening: 32,
  qualification: 35,

  // Discovery/needs stages
  discovery: 40,
  discovery_demo: 42,
  needs_identified: 45,
  scope_defined: 48,

  // Proposal/quote stages
  quote: 55,
  proposal: 58,
  proposal_sent: 60,
  contract: 75,
  contract_sent: 78,

  // Negotiation/final stages - VERY HIGH confidence, deal is nearly closed
  negotiation: 80,
  approval: 85,
  term_sheet_presented: 87,

  // Invoice/payment stages - very high confidence, deal is essentially closed
  invoice: 88,
  invoice_sent: 92,
  payment: 93,
  payment_received: 95,

  // Won/retention stages
  deal_won: 95,
  closed: 95,
  closed_won: 95,
  investment_closed: 95,
  onboarding: 92,
  customer_onboarded: 92,
  client_onboarding: 92,
  retention: 90,
  renewal: 90,
  renewal_upsell: 88,

  // Lost stages
  lost: 0,
  deal_lost: 0,
  passed: 0
};

// ============================================================================
// HELPER: Get threshold for a stage (with default fallback)
// ============================================================================
export function getStagnationThreshold(stage) {
  return STAGNATION_THRESHOLDS[stage] || STAGNATION_THRESHOLDS.default;
}

// ============================================================================
// HELPER: Get base confidence for a stage (with default fallback)
// ============================================================================
export function getBaseConfidence(stage) {
  return STAGE_BASE_CONFIDENCE[stage] || 30; // Default 30% for unknown stages
}
