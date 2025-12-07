/**
 * Get Organization Plan Helper
 * Area 7 - Billing & Quotas
 *
 * Fetches the current plan for an organization from Supabase.
 * Includes simple in-memory caching to reduce database hits.
 *
 * Uses the existing organizations.plan field that is set by:
 * - stripe-webhook.mts on subscription changes
 * - Default 'free' for new organizations
 */

import { getSupabaseClient } from './supabase-pool';
import { StageflowPlanId, isValidPlanId, getPlanConfig } from './plan-config';

// =============================================================================
// SIMPLE IN-MEMORY CACHE
// =============================================================================

interface CacheEntry {
  planId: StageflowPlanId;
  timestamp: number;
}

// Cache TTL: 5 minutes (plan changes are infrequent)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Simple in-memory cache (per Lambda instance)
const planCache = new Map<string, CacheEntry>();

/**
 * Check if a cache entry is still valid
 */
function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Clear expired cache entries (call periodically to prevent memory growth)
 */
export function clearExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of planCache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL_MS) {
      planCache.delete(key);
    }
  }
}

/**
 * Invalidate cache for a specific org (call after plan changes)
 */
export function invalidateOrgPlanCache(orgId: string): void {
  planCache.delete(orgId);
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Get the current plan ID for an organization.
 *
 * @param orgId - Organization UUID
 * @param options - Configuration options
 * @returns StageflowPlanId - The org's current plan (defaults to 'free')
 *
 * Behavior:
 * - Returns cached value if available and fresh
 * - Queries Supabase organizations table
 * - Defaults to 'free' if org not found or plan invalid
 * - Logs errors but doesn't throw (fail-open pattern)
 */
export async function getOrgPlan(
  orgId: string,
  options: { skipCache?: boolean; correlationId?: string } = {}
): Promise<StageflowPlanId> {
  const { skipCache = false, correlationId = 'unknown' } = options;

  // Check cache first (unless explicitly skipped)
  if (!skipCache) {
    const cached = planCache.get(orgId);
    if (isCacheValid(cached)) {
      return cached.planId;
    }
  }

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .maybeSingle();

    if (error) {
      console.error(`[get-org-plan] [${correlationId}] Database error:`, {
        orgId,
        error: error.message,
        code: error.code,
      });
      // Fail-open: return free plan on error
      return 'free';
    }

    if (!data) {
      console.warn(`[get-org-plan] [${correlationId}] Organization not found:`, { orgId });
      return 'free';
    }

    // Validate the plan value
    const planId = data.plan;
    if (!planId || !isValidPlanId(planId)) {
      console.warn(`[get-org-plan] [${correlationId}] Invalid or missing plan:`, {
        orgId,
        plan: planId,
      });
      return 'free';
    }

    // Cache the result
    planCache.set(orgId, {
      planId,
      timestamp: Date.now(),
    });

    return planId;
  } catch (error: any) {
    console.error(`[get-org-plan] [${correlationId}] Unexpected error:`, {
      orgId,
      error: error.message,
    });
    // Fail-open: return free plan on any error
    return 'free';
  }
}

/**
 * Get the full plan configuration for an organization.
 * Convenience wrapper that fetches plan ID and returns full config.
 */
export async function getOrgPlanConfig(
  orgId: string,
  options: { skipCache?: boolean; correlationId?: string } = {}
) {
  const planId = await getOrgPlan(orgId, options);
  return {
    planId,
    config: getPlanConfig(planId),
  };
}

/**
 * Batch fetch plans for multiple organizations.
 * Useful for admin dashboards or analytics.
 */
export async function getMultipleOrgPlans(
  orgIds: string[],
  options: { correlationId?: string } = {}
): Promise<Map<string, StageflowPlanId>> {
  const { correlationId = 'unknown' } = options;
  const results = new Map<string, StageflowPlanId>();

  // Filter out orgs we already have cached
  const uncachedOrgIds: string[] = [];
  for (const orgId of orgIds) {
    const cached = planCache.get(orgId);
    if (isCacheValid(cached)) {
      results.set(orgId, cached.planId);
    } else {
      uncachedOrgIds.push(orgId);
    }
  }

  // If all were cached, return early
  if (uncachedOrgIds.length === 0) {
    return results;
  }

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('organizations')
      .select('id, plan')
      .in('id', uncachedOrgIds);

    if (error) {
      console.error(`[get-org-plan] [${correlationId}] Batch query error:`, {
        error: error.message,
      });
      // Default all to free on error
      for (const orgId of uncachedOrgIds) {
        results.set(orgId, 'free');
      }
      return results;
    }

    // Process results
    const foundOrgIds = new Set<string>();
    for (const row of data || []) {
      const planId = row.plan && isValidPlanId(row.plan) ? row.plan : 'free';
      results.set(row.id, planId);
      foundOrgIds.add(row.id);

      // Cache it
      planCache.set(row.id, {
        planId,
        timestamp: Date.now(),
      });
    }

    // Default any not found to free
    for (const orgId of uncachedOrgIds) {
      if (!foundOrgIds.has(orgId)) {
        results.set(orgId, 'free');
      }
    }

    return results;
  } catch (error: any) {
    console.error(`[get-org-plan] [${correlationId}] Batch unexpected error:`, {
      error: error.message,
    });
    // Default all to free on error
    for (const orgId of uncachedOrgIds) {
      results.set(orgId, 'free');
    }
    return results;
  }
}

export default getOrgPlan;
