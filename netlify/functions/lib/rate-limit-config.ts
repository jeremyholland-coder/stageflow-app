/**
 * Rate Limit Configuration
 * Area 2 - Rate Limiting & Abuse Protection
 * Area 7 - Billing & Quotas (plan-based limits)
 *
 * Defines rate limit buckets for different operations.
 * Limits are per-user AND per-organization.
 *
 * Bucket naming convention:
 * - ai.generic: General AI calls (Coach, Mission Control chat)
 * - ai.plan_my_day: Plan My Day feature (limited runs per day)
 * - ai.plan_my_day_org: Org-wide Plan My Day limit
 * - ai.insights: AI Insights generation
 *
 * Area 7 additions:
 * - Plan-aware bucket generation via getBucketsForPlan()
 * - Limits are derived from plan-config.ts based on org's subscription
 */

import { StageflowPlanId, getPlanConfig } from './plan-config';

export interface RateLimitBucket {
  /** Bucket identifier for database storage */
  bucket: string;
  /** Time window in seconds */
  windowSeconds: number;
  /** Maximum requests allowed in this window */
  limit: number;
  /** Human-readable description for error messages */
  description: string;
}

/**
 * Rate limit bucket definitions
 * Adjust these values to tune rate limiting behavior
 */
export const RATE_LIMIT_BUCKETS = {
  // ============================================================================
  // GENERIC AI CALLS (Coach, Mission Control chat, etc.)
  // ============================================================================

  /** Per-minute limit to prevent burst abuse */
  aiGenericPerMinute: {
    bucket: 'ai.generic',
    windowSeconds: 60,
    limit: 20,
    description: 'AI requests per minute',
  } as RateLimitBucket,

  /** Per-hour limit to prevent sustained abuse */
  aiGenericPerHour: {
    bucket: 'ai.generic',
    windowSeconds: 3600,
    limit: 200,
    description: 'AI requests per hour',
  } as RateLimitBucket,

  /** Per-day limit to cap daily usage */
  aiGenericPerDay: {
    bucket: 'ai.generic',
    windowSeconds: 86400,
    limit: 1000,
    description: 'AI requests per day',
  } as RateLimitBucket,

  // ============================================================================
  // PLAN MY DAY (Premium feature, limited runs)
  // ============================================================================

  /** Per-user daily limit for Plan My Day */
  planMyDayPerUserPerDay: {
    bucket: 'ai.plan_my_day',
    windowSeconds: 86400,
    limit: 5,
    description: 'Plan My Day runs per day (per user)',
  } as RateLimitBucket,

  /** Per-org daily limit for Plan My Day (prevents one org from overusing) */
  planMyDayPerOrgPerDay: {
    bucket: 'ai.plan_my_day_org',
    windowSeconds: 86400,
    limit: 20,
    description: 'Plan My Day runs per day (per organization)',
  } as RateLimitBucket,

  // ============================================================================
  // AI INSIGHTS (Analytics generation)
  // ============================================================================

  /** Per-hour limit for AI Insights */
  aiInsightsPerHour: {
    bucket: 'ai.insights',
    windowSeconds: 3600,
    limit: 30,
    description: 'AI Insights requests per hour',
  } as RateLimitBucket,

  /** Per-day limit for AI Insights */
  aiInsightsPerDay: {
    bucket: 'ai.insights',
    windowSeconds: 86400,
    limit: 100,
    description: 'AI Insights requests per day',
  } as RateLimitBucket,

} as const;

/**
 * Predefined bucket groups for common use cases
 */
export const RATE_LIMIT_GROUPS = {
  /** Standard AI request limits (Coach, Mission Control) */
  aiGeneric: [
    RATE_LIMIT_BUCKETS.aiGenericPerMinute,
    RATE_LIMIT_BUCKETS.aiGenericPerHour,
    RATE_LIMIT_BUCKETS.aiGenericPerDay,
  ],

  /** Plan My Day limits (user + org) */
  planMyDay: [
    RATE_LIMIT_BUCKETS.planMyDayPerUserPerDay,
    RATE_LIMIT_BUCKETS.planMyDayPerOrgPerDay,
  ],

  /** AI Insights limits */
  aiInsights: [
    RATE_LIMIT_BUCKETS.aiInsightsPerHour,
    RATE_LIMIT_BUCKETS.aiInsightsPerDay,
  ],

  /** Combined: Plan My Day + generic AI limits */
  planMyDayWithGeneric: [
    RATE_LIMIT_BUCKETS.planMyDayPerUserPerDay,
    RATE_LIMIT_BUCKETS.planMyDayPerOrgPerDay,
    RATE_LIMIT_BUCKETS.aiGenericPerMinute,
    RATE_LIMIT_BUCKETS.aiGenericPerHour,
    RATE_LIMIT_BUCKETS.aiGenericPerDay,
  ],
} as const;

/**
 * Get user-friendly message for rate limit exceeded
 */
export function getRateLimitMessage(bucket: RateLimitBucket): string {
  const windowText = bucket.windowSeconds >= 86400
    ? 'today'
    : bucket.windowSeconds >= 3600
      ? 'this hour'
      : 'this minute';

  return `You've reached the limit of ${bucket.limit} ${bucket.description}. Please try again later.`;
}

/**
 * Calculate retry-after seconds based on window
 */
export function getRetryAfterSeconds(bucket: RateLimitBucket): number {
  // For minute windows, suggest retrying in 30 seconds
  if (bucket.windowSeconds <= 60) {
    return 30;
  }
  // For hour windows, suggest retrying in 5 minutes
  if (bucket.windowSeconds <= 3600) {
    return 300;
  }
  // For day windows, calculate time until midnight UTC
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

// =============================================================================
// AREA 7: PLAN-AWARE RATE LIMIT BUCKETS
// =============================================================================

/**
 * Base bucket definitions (without limits).
 * Limits are applied based on the org's plan via getBucketsForPlan().
 */
export const BASE_BUCKETS = {
  aiGenericPerMinute: { bucket: 'ai.generic', windowSeconds: 60, description: 'AI requests per minute' },
  aiGenericPerHour: { bucket: 'ai.generic', windowSeconds: 3600, description: 'AI requests per hour' },
  aiGenericPerDay: { bucket: 'ai.generic', windowSeconds: 86400, description: 'AI requests per day' },
  aiInsightsPerHour: { bucket: 'ai.insights', windowSeconds: 3600, description: 'AI Insights requests per hour' },
  aiInsightsPerDay: { bucket: 'ai.insights', windowSeconds: 86400, description: 'AI Insights requests per day' },
  planMyDayPerUserPerDay: { bucket: 'ai.plan_my_day', windowSeconds: 86400, description: 'Plan My Day runs per day (per user)' },
  planMyDayPerOrgPerDay: { bucket: 'ai.plan_my_day_org', windowSeconds: 86400, description: 'Plan My Day runs per day (per organization)' },
} as const;

/**
 * Plan-aware bucket groups.
 * Returns buckets with limits based on the org's subscription plan.
 *
 * @param planId - The organization's plan (free, startup, growth, pro)
 * @returns Object with bucket arrays for each feature area
 */
export function getBucketsForPlan(planId: StageflowPlanId) {
  const config = getPlanConfig(planId);

  return {
    /** Generic AI requests (Coach, Mission Control chat) */
    aiGeneric: [
      { ...BASE_BUCKETS.aiGenericPerMinute, limit: config.aiGenericPerMinute },
      { ...BASE_BUCKETS.aiGenericPerHour, limit: config.aiGenericPerHour },
      { ...BASE_BUCKETS.aiGenericPerDay, limit: config.aiGenericPerDay },
    ] as RateLimitBucket[],

    /** AI Insights generation */
    aiInsights: [
      { ...BASE_BUCKETS.aiInsightsPerHour, limit: config.aiInsightsPerHour },
      { ...BASE_BUCKETS.aiInsightsPerDay, limit: config.aiInsightsPerDay },
    ] as RateLimitBucket[],

    /** Plan My Day (user + org limits) */
    planMyDay: [
      { ...BASE_BUCKETS.planMyDayPerUserPerDay, limit: config.planMyDayPerUserPerDay },
      { ...BASE_BUCKETS.planMyDayPerOrgPerDay, limit: config.planMyDayPerOrgPerDay },
    ] as RateLimitBucket[],

    /** Combined: Plan My Day + generic AI limits */
    planMyDayWithGeneric: [
      { ...BASE_BUCKETS.planMyDayPerUserPerDay, limit: config.planMyDayPerUserPerDay },
      { ...BASE_BUCKETS.planMyDayPerOrgPerDay, limit: config.planMyDayPerOrgPerDay },
      { ...BASE_BUCKETS.aiGenericPerMinute, limit: config.aiGenericPerMinute },
      { ...BASE_BUCKETS.aiGenericPerHour, limit: config.aiGenericPerHour },
      { ...BASE_BUCKETS.aiGenericPerDay, limit: config.aiGenericPerDay },
    ] as RateLimitBucket[],
  };
}

/**
 * Get plan-aware rate limit message with upgrade suggestion for free users.
 */
export function getPlanAwareRateLimitMessage(
  bucket: RateLimitBucket,
  planId: StageflowPlanId
): string {
  const baseMessage = getRateLimitMessage(bucket);

  if (planId === 'free') {
    return `${baseMessage} Upgrade your plan for higher limits.`;
  }

  return baseMessage;
}

export default RATE_LIMIT_BUCKETS;
