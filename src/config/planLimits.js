/**
 * FIX PHASE 10: Centralized Plan Limits Configuration
 * Single source of truth for all plan tier limits
 * Used by Settings.jsx and BillingSettings.jsx
 */

export const PLAN_LIMITS = {
  free: {
    deals: 100,
    users: 1,
    aiRequests: 100,
    name: 'Free',
    displayName: 'Free Plan'
  },
  startup: {
    deals: 999999, // Unlimited
    users: 5,
    aiRequests: 1000,
    name: 'Startup',
    displayName: 'Startup Plan'
  },
  growth: {
    deals: 999999, // Unlimited
    users: 20,
    aiRequests: 5000,
    name: 'Growth',
    displayName: 'Growth Plan'
  },
  pro: {
    deals: 999999, // Unlimited
    users: 999999, // Unlimited
    aiRequests: -1, // Unlimited
    name: 'Pro',
    displayName: 'Pro Plan'
  }
};

/**
 * Get limits for a specific plan
 * @param {string} planTier - Plan tier: 'free', 'startup', 'growth', 'pro'
 * @returns {Object} Plan limits object
 */
export const getPlanLimits = (planTier = 'free') => {
  return PLAN_LIMITS[planTier] || PLAN_LIMITS.free;
};

/**
 * Check if a plan has a specific feature limit
 * @param {string} planTier - Plan tier
 * @param {string} feature - Feature name: 'deals', 'users', 'aiRequests'
 * @returns {number} Feature limit
 */
export const getFeatureLimit = (planTier, feature) => {
  const limits = getPlanLimits(planTier);
  return limits[feature] || 0;
};

/**
 * Check if usage exceeds limit
 * @param {number} usage - Current usage
 * @param {number} limit - Maximum limit (-1 means unlimited)
 * @returns {boolean} True if over limit
 */
export const isOverLimit = (usage, limit) => {
  // Unlimited plans have limit of -1 or 999999
  if (limit === -1 || limit >= 999999) return false;
  return usage >= limit;
};

export default PLAN_LIMITS;
