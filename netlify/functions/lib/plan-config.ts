/**
 * Plan Configuration
 * Area 7 - Billing & Quotas
 *
 * Centralized configuration for plan tiers, Stripe mappings, and quota limits.
 * This is the single source of truth for plan-based rate limiting.
 *
 * Plans: free, startup, growth, pro
 * - Matches existing organization.plan values
 * - Aligns with existing planLimits.js in frontend
 */

// =============================================================================
// PLAN TYPES
// =============================================================================

export type StageflowPlanId = 'free' | 'startup' | 'growth' | 'pro';

export interface PlanQuotas {
  /** AI requests per minute (burst protection) */
  aiGenericPerMinute: number;
  /** AI requests per hour */
  aiGenericPerHour: number;
  /** AI requests per day */
  aiGenericPerDay: number;
  /** AI Insights per hour */
  aiInsightsPerHour: number;
  /** AI Insights per day */
  aiInsightsPerDay: number;
  /** Plan My Day runs per user per day */
  planMyDayPerUserPerDay: number;
  /** Plan My Day runs per org per day */
  planMyDayPerOrgPerDay: number;
}

export interface PlanConfig extends PlanQuotas {
  name: string;
  displayName: string;
  /** Monthly AI request limit (for billing display) */
  monthlyAiRequests: number;
  /** Max users/seats */
  maxUsers: number;
  /** Max deals (-1 = unlimited) */
  maxDeals: number;
}

// =============================================================================
// STRIPE PRICE ID MAPPING
// =============================================================================

/**
 * Maps Stripe price IDs to internal plan IDs.
 * Price IDs come from environment variables.
 * Both monthly and annual prices map to the same plan tier.
 */
export function getStripePriceToPlanMap(): Record<string, StageflowPlanId> {
  return {
    // Monthly prices
    [process.env.VITE_STRIPE_STARTUP_PRICE_ID || '']: 'startup',
    [process.env.VITE_STRIPE_GROWTH_PRICE_ID || '']: 'growth',
    [process.env.VITE_STRIPE_PRO_PRICE_ID || '']: 'pro',
    // Annual prices
    [process.env.VITE_STRIPE_STARTUP_ANNUAL_PRICE_ID || '']: 'startup',
    [process.env.VITE_STRIPE_GROWTH_ANNUAL_PRICE_ID || '']: 'growth',
    [process.env.VITE_STRIPE_PRO_ANNUAL_PRICE_ID || '']: 'pro',
  };
}

/**
 * Get plan ID from Stripe price ID
 */
export function getPlanFromStripePrice(priceId: string): StageflowPlanId | null {
  const map = getStripePriceToPlanMap();
  return map[priceId] || null;
}

// =============================================================================
// PLAN QUOTAS
// =============================================================================

/**
 * Quota configuration per plan tier.
 *
 * Design principles:
 * - Free tier: Conservative limits to prevent abuse
 * - Startup: 5x free tier for small teams
 * - Growth: 10x free tier for scaling teams
 * - Pro: High limits for enterprise (effectively unlimited for most users)
 *
 * These limits are fed into the rate limiter and represent the maximum
 * allowed requests per time window.
 */
export const PLAN_QUOTAS: Record<StageflowPlanId, PlanConfig> = {
  free: {
    name: 'Free',
    displayName: 'Free Plan',
    monthlyAiRequests: 100,
    maxUsers: 1,
    maxDeals: 100,
    // Rate limits (conservative)
    aiGenericPerMinute: 5,
    aiGenericPerHour: 30,
    aiGenericPerDay: 100,
    aiInsightsPerHour: 5,
    aiInsightsPerDay: 15,
    planMyDayPerUserPerDay: 2,
    planMyDayPerOrgPerDay: 3,
  },

  startup: {
    name: 'Startup',
    displayName: 'Startup Plan',
    monthlyAiRequests: 1000,
    maxUsers: 5,
    maxDeals: 999999, // Unlimited
    // Rate limits (moderate)
    aiGenericPerMinute: 15,
    aiGenericPerHour: 100,
    aiGenericPerDay: 500,
    aiInsightsPerHour: 15,
    aiInsightsPerDay: 50,
    planMyDayPerUserPerDay: 5,
    planMyDayPerOrgPerDay: 15,
  },

  growth: {
    name: 'Growth',
    displayName: 'Growth Plan',
    monthlyAiRequests: 5000,
    maxUsers: 20,
    maxDeals: 999999, // Unlimited
    // Rate limits (generous)
    aiGenericPerMinute: 25,
    aiGenericPerHour: 200,
    aiGenericPerDay: 1000,
    aiInsightsPerHour: 30,
    aiInsightsPerDay: 100,
    planMyDayPerUserPerDay: 10,
    planMyDayPerOrgPerDay: 40,
  },

  pro: {
    name: 'Pro',
    displayName: 'Pro Plan',
    monthlyAiRequests: -1, // Unlimited
    maxUsers: 999999, // Unlimited
    maxDeals: 999999, // Unlimited
    // Rate limits (high - still protect against runaway)
    aiGenericPerMinute: 60,
    aiGenericPerHour: 500,
    aiGenericPerDay: 3000,
    aiInsightsPerHour: 60,
    aiInsightsPerDay: 300,
    planMyDayPerUserPerDay: 20,
    planMyDayPerOrgPerDay: 100,
  },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get plan configuration for a given plan ID
 * Defaults to free plan if unknown
 */
export function getPlanConfig(planId: StageflowPlanId | string | null | undefined): PlanConfig {
  if (planId && planId in PLAN_QUOTAS) {
    return PLAN_QUOTAS[planId as StageflowPlanId];
  }
  return PLAN_QUOTAS.free;
}

/**
 * Get quota value for a specific plan and bucket type
 */
export function getPlanQuota(
  planId: StageflowPlanId | string | null | undefined,
  quotaKey: keyof PlanQuotas
): number {
  const config = getPlanConfig(planId);
  return config[quotaKey];
}

/**
 * Check if a plan has unlimited AI requests
 */
export function hasUnlimitedAi(planId: StageflowPlanId | string | null | undefined): boolean {
  const config = getPlanConfig(planId);
  return config.monthlyAiRequests === -1;
}

/**
 * Validate that a string is a valid plan ID
 */
export function isValidPlanId(planId: string): planId is StageflowPlanId {
  return planId in PLAN_QUOTAS;
}

/**
 * Get all plan IDs in tier order (lowest to highest)
 */
export function getAllPlanIds(): StageflowPlanId[] {
  return ['free', 'startup', 'growth', 'pro'];
}

/**
 * Compare two plans, returns:
 * - negative if planA < planB (lower tier)
 * - 0 if equal
 * - positive if planA > planB (higher tier)
 */
export function comparePlans(planA: StageflowPlanId, planB: StageflowPlanId): number {
  const tiers = getAllPlanIds();
  return tiers.indexOf(planA) - tiers.indexOf(planB);
}

export default PLAN_QUOTAS;
