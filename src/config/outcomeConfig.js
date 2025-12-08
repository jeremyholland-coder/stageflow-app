/**
 * Unified Outcome Configuration
 *
 * Phase 4: Disqualified/Lost System Unification
 *
 * This module provides a single, authoritative source of truth for deal outcomes.
 * It unifies the previously separate "lost" and "disqualified" reason taxonomies
 * into a coherent model while maintaining backward compatibility.
 *
 * Key Principles:
 * - Mutual exclusivity: A deal can be either lost OR disqualified, never both
 * - Single taxonomy: All negative outcomes use the same reason categories
 * - Backward compatible: Existing data is preserved and mapped to new model
 *
 * @module outcomeConfig
 * @since Phase 4
 */

/**
 * Deal outcome types
 *
 * A deal's lifecycle ends in one of these outcomes:
 * - ACTIVE: Still in progress (not a final outcome)
 * - WON: Successfully closed
 * - LOST: Prospect decided against us (competitive loss, budget, etc.)
 * - DISQUALIFIED: We decided prospect wasn't a fit (bad fit, unresponsive, etc.)
 */
export const OUTCOME_TYPES = {
  ACTIVE: 'active',
  WON: 'won',
  LOST: 'lost',
  DISQUALIFIED: 'disqualified'
};

/**
 * Unified reason categories for negative outcomes (lost/disqualified)
 *
 * These categories apply to both lost and disqualified deals, enabling
 * consistent analytics and reporting across all negative outcomes.
 *
 * Category taxonomy:
 * - COMPETITOR: Lost to a competing solution
 * - BUDGET: Financial constraints prevented the deal
 * - TIMING: Not the right time for the prospect
 * - NO_FIT: Product/prospect mismatch
 * - UNRESPONSIVE: Prospect stopped engaging
 * - NO_INTEREST: Prospect lost interest or deprioritized
 * - OTHER: Catch-all for uncategorized reasons
 */
export const OUTCOME_REASON_CATEGORIES = {
  COMPETITOR: 'competitor',
  BUDGET: 'budget',
  TIMING: 'timing',
  NO_FIT: 'no_fit',
  UNRESPONSIVE: 'unresponsive',
  NO_INTEREST: 'no_interest',
  OTHER: 'other'
};

/**
 * Reason display configuration
 *
 * Maps reason categories to user-friendly labels and icons.
 * Used across all UI surfaces for consistent presentation.
 */
export const REASON_DISPLAY = {
  [OUTCOME_REASON_CATEGORIES.COMPETITOR]: {
    label: 'Lost to Competitor',
    shortLabel: 'Competitor',
    icon: '🏆',
    description: 'Prospect chose a competing solution'
  },
  [OUTCOME_REASON_CATEGORIES.BUDGET]: {
    label: 'Budget Constraints',
    shortLabel: 'Budget',
    icon: '💰',
    description: 'Financial limitations prevented the deal'
  },
  [OUTCOME_REASON_CATEGORIES.TIMING]: {
    label: 'Wrong Timing',
    shortLabel: 'Timing',
    icon: '⏰',
    description: 'Not the right time for the prospect'
  },
  [OUTCOME_REASON_CATEGORIES.NO_FIT]: {
    label: 'Not a Fit',
    shortLabel: 'No Fit',
    icon: '🎯',
    description: 'Product or service doesn\'t match prospect needs'
  },
  [OUTCOME_REASON_CATEGORIES.UNRESPONSIVE]: {
    label: 'Unresponsive',
    shortLabel: 'Unresponsive',
    icon: '📵',
    description: 'Prospect stopped responding to outreach'
  },
  [OUTCOME_REASON_CATEGORIES.NO_INTEREST]: {
    label: 'No Longer Interested',
    shortLabel: 'No Interest',
    icon: '❌',
    description: 'Prospect lost interest or deprioritized'
  },
  [OUTCOME_REASON_CATEGORIES.OTHER]: {
    label: 'Other',
    shortLabel: 'Other',
    icon: '📝',
    description: 'Other reason not listed above'
  }
};

/**
 * Reason options for Lost deals
 *
 * Subset of reasons that make sense for deals we lost
 * (prospect made the decision against us)
 */
export const LOST_REASON_OPTIONS = [
  OUTCOME_REASON_CATEGORIES.COMPETITOR,
  OUTCOME_REASON_CATEGORIES.NO_INTEREST,
  OUTCOME_REASON_CATEGORIES.BUDGET,
  OUTCOME_REASON_CATEGORIES.TIMING,
  OUTCOME_REASON_CATEGORIES.OTHER
];

/**
 * Reason options for Disqualified deals
 *
 * Subset of reasons that make sense for deals we disqualified
 * (we made the decision to exit)
 */
export const DISQUALIFIED_REASON_OPTIONS = [
  OUTCOME_REASON_CATEGORIES.BUDGET,
  OUTCOME_REASON_CATEGORIES.NO_FIT,
  OUTCOME_REASON_CATEGORIES.TIMING,
  OUTCOME_REASON_CATEGORIES.COMPETITOR,
  OUTCOME_REASON_CATEGORIES.UNRESPONSIVE,
  OUTCOME_REASON_CATEGORIES.OTHER
];

/**
 * Legacy reason mapping
 *
 * Maps old reason IDs to the unified taxonomy.
 * Used for backward compatibility with existing data.
 */
export const LEGACY_REASON_MAP = {
  // Legacy lost reasons
  'competitor': OUTCOME_REASON_CATEGORIES.COMPETITOR,
  'no_interest': OUTCOME_REASON_CATEGORIES.NO_INTEREST,
  'budget': OUTCOME_REASON_CATEGORIES.BUDGET,
  'timing': OUTCOME_REASON_CATEGORIES.TIMING,

  // Legacy disqualify reasons
  'no_budget': OUTCOME_REASON_CATEGORIES.BUDGET,
  'not_a_fit': OUTCOME_REASON_CATEGORIES.NO_FIT,
  'wrong_timing': OUTCOME_REASON_CATEGORIES.TIMING,
  'went_with_competitor': OUTCOME_REASON_CATEGORIES.COMPETITOR,
  'unresponsive': OUTCOME_REASON_CATEGORIES.UNRESPONSIVE,

  // Common
  'other': OUTCOME_REASON_CATEGORIES.OTHER
};

/**
 * Normalize a legacy reason ID to the unified taxonomy
 *
 * @param {string} legacyReason - The legacy reason ID
 * @returns {string} The unified reason category
 */
export function normalizeReasonCategory(legacyReason) {
  if (!legacyReason) return null;

  // Already in unified format
  if (Object.values(OUTCOME_REASON_CATEGORIES).includes(legacyReason)) {
    return legacyReason;
  }

  // Map from legacy format
  return LEGACY_REASON_MAP[legacyReason] || OUTCOME_REASON_CATEGORIES.OTHER;
}

/**
 * Get display info for a reason category
 *
 * @param {string} reasonCategory - The reason category ID
 * @returns {Object} Display info with label, icon, description
 */
export function getReasonDisplay(reasonCategory) {
  const normalized = normalizeReasonCategory(reasonCategory);
  return REASON_DISPLAY[normalized] || REASON_DISPLAY[OUTCOME_REASON_CATEGORIES.OTHER];
}

/**
 * Get reason options for a specific outcome type
 *
 * @param {string} outcomeType - The outcome type (lost/disqualified)
 * @returns {Array} Array of reason option objects with id, label, icon
 */
export function getReasonOptionsForOutcome(outcomeType) {
  const reasonIds = outcomeType === OUTCOME_TYPES.LOST
    ? LOST_REASON_OPTIONS
    : DISQUALIFIED_REASON_OPTIONS;

  return reasonIds.map(id => ({
    id,
    ...REASON_DISPLAY[id]
  }));
}

/**
 * Validate that an outcome is properly formed
 *
 * @param {Object} deal - The deal object
 * @returns {Object} Validation result with isValid and errors array
 */
export function validateOutcome(deal) {
  const errors = [];
  const { status, outcome_reason_category, outcome_notes } = deal;

  // Won deals should not have negative outcome reasons
  if (status === OUTCOME_TYPES.WON) {
    if (outcome_reason_category) {
      errors.push('Won deals should not have an outcome reason category');
    }
  }

  // Lost/Disqualified deals should have a reason
  if (status === OUTCOME_TYPES.LOST || status === OUTCOME_TYPES.DISQUALIFIED) {
    if (!outcome_reason_category) {
      errors.push(`${status} deals require an outcome reason category`);
    }
  }

  // Active deals should not have outcome data
  if (status === OUTCOME_TYPES.ACTIVE) {
    if (outcome_reason_category || outcome_notes) {
      errors.push('Active deals should not have outcome data');
    }
  }

  // Validate reason category is valid for the outcome type
  if (outcome_reason_category && (status === OUTCOME_TYPES.LOST || status === OUTCOME_TYPES.DISQUALIFIED)) {
    const validReasons = status === OUTCOME_TYPES.LOST
      ? LOST_REASON_OPTIONS
      : DISQUALIFIED_REASON_OPTIONS;

    if (!validReasons.includes(outcome_reason_category)) {
      errors.push(`Invalid reason category "${outcome_reason_category}" for ${status} deals`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Create a unified outcome object from legacy deal data
 *
 * This function normalizes deals that may have old-format data
 * (lost_reason, disqualified_reason_category) into the unified model.
 *
 * @param {Object} deal - The deal object with potentially legacy fields
 * @returns {Object} Unified outcome data
 */
export function createUnifiedOutcome(deal) {
  const {
    status,
    // Legacy lost fields
    lost_reason,
    lost_reason_notes,
    // Legacy disqualified fields
    disqualified_reason_category,
    disqualified_reason_notes,
    // New unified fields (if present)
    outcome_reason_category,
    outcome_notes,
    outcome_recorded_at,
    outcome_recorded_by
  } = deal;

  // If unified fields already exist, use them
  if (outcome_reason_category) {
    return {
      outcome_reason_category,
      outcome_notes: outcome_notes || null,
      outcome_recorded_at: outcome_recorded_at || null,
      outcome_recorded_by: outcome_recorded_by || null
    };
  }

  // Map from legacy fields based on status
  if (status === OUTCOME_TYPES.LOST && lost_reason) {
    return {
      outcome_reason_category: normalizeReasonCategory(lost_reason),
      outcome_notes: lost_reason_notes || null,
      outcome_recorded_at: deal.updated_at || null,
      outcome_recorded_by: null
    };
  }

  if (status === OUTCOME_TYPES.DISQUALIFIED && disqualified_reason_category) {
    return {
      outcome_reason_category: normalizeReasonCategory(disqualified_reason_category),
      outcome_notes: disqualified_reason_notes || null,
      outcome_recorded_at: deal.disqualified_at || deal.updated_at || null,
      outcome_recorded_by: deal.disqualified_by || null
    };
  }

  // No outcome data
  return {
    outcome_reason_category: null,
    outcome_notes: null,
    outcome_recorded_at: null,
    outcome_recorded_by: null
  };
}

/**
 * Check if a deal has a negative outcome (lost or disqualified)
 *
 * @param {Object} deal - The deal object
 * @returns {boolean} True if the deal is lost or disqualified
 */
export function hasNegativeOutcome(deal) {
  return deal.status === OUTCOME_TYPES.LOST || deal.status === OUTCOME_TYPES.DISQUALIFIED;
}

/**
 * Check if a deal is in a final state (won, lost, or disqualified)
 *
 * @param {Object} deal - The deal object
 * @returns {boolean} True if the deal is in a final state
 */
export function isFinalOutcome(deal) {
  return [OUTCOME_TYPES.WON, OUTCOME_TYPES.LOST, OUTCOME_TYPES.DISQUALIFIED].includes(deal.status);
}

/**
 * Get analytics-friendly outcome summary
 *
 * @param {Object} deal - The deal object
 * @returns {Object} Summary with outcome type, reason, and display strings
 */
export function getOutcomeSummary(deal) {
  const unified = createUnifiedOutcome(deal);
  const reasonDisplay = unified.outcome_reason_category
    ? getReasonDisplay(unified.outcome_reason_category)
    : null;

  return {
    status: deal.status,
    isNegative: hasNegativeOutcome(deal),
    isFinal: isFinalOutcome(deal),
    reasonCategory: unified.outcome_reason_category,
    reasonLabel: reasonDisplay?.label || null,
    reasonIcon: reasonDisplay?.icon || null,
    notes: unified.outcome_notes,
    recordedAt: unified.outcome_recorded_at,
    recordedBy: unified.outcome_recorded_by
  };
}

export default {
  OUTCOME_TYPES,
  OUTCOME_REASON_CATEGORIES,
  REASON_DISPLAY,
  LOST_REASON_OPTIONS,
  DISQUALIFIED_REASON_OPTIONS,
  LEGACY_REASON_MAP,
  normalizeReasonCategory,
  getReasonDisplay,
  getReasonOptionsForOutcome,
  validateOutcome,
  createUnifiedOutcome,
  hasNegativeOutcome,
  isFinalOutcome,
  getOutcomeSummary
};
