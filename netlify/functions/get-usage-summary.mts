/**
 * Get Usage Summary Endpoint
 * Area 7 - Billing & Quotas
 *
 * Returns the organization's current usage and plan limits for display
 * in the UsageAndLimitsCard component.
 *
 * Response includes:
 * - Current plan ID and name
 * - Quota limits for the plan
 * - Current usage from rate_limits table
 * - Monthly AI request count and limit
 */

import type { Context } from '@netlify/functions';
import { getSupabaseClient } from './lib/supabase-pool';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { getOrgPlan } from './lib/get-org-plan';
import { getPlanConfig, PLAN_QUOTAS, type StageflowPlanId } from './lib/plan-config';
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { buildCorsHeaders } from './lib/cors';

// Simple correlation ID generator
const generateCorrelationId = () => `usage-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

export default async (req: Request, context: Context) => {
  const correlationId = generateCorrelationId();

  // ENGINE REBUILD Phase 9: Use centralized CORS spine
  const requestOrigin = req.headers.get('origin') || '';
  const corsHeaders = buildCorsHeaders(requestOrigin, { methods: 'GET, OPTIONS' });

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;

    console.log(`[get-usage-summary] [${correlationId}] User: ${userId}`);

    const supabase = getSupabaseClient();

    // Get user's organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', userId)
      .single();

    if (memberError || !membership) {
      return new Response(
        JSON.stringify({ success: false, error: 'No organization found' }),
        { status: 404, headers: corsHeaders }
      );
    }

    const organizationId = membership.organization_id;

    // Get org's plan
    const planId = await getOrgPlan(organizationId, { correlationId });
    const planConfig = getPlanConfig(planId);

    // Get org data for monthly AI usage
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('ai_requests_used_this_month, plan')
      .eq('id', organizationId)
      .single();

    if (orgError) {
      console.error(`[get-usage-summary] [${correlationId}] Org fetch error:`, orgError);
    }

    // Get today's rate limit usage from rate_limits table
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Query rate limits for AI buckets
    const { data: rateLimits, error: rateLimitError } = await supabase
      .from('rate_limits')
      .select('bucket, count, window_start, window_seconds')
      .eq('organization_id', organizationId)
      .in('bucket', ['ai.generic', 'ai.insights', 'ai.plan_my_day', 'ai.plan_my_day_org'])
      .gte('window_start', todayStart.toISOString());

    if (rateLimitError) {
      console.warn(`[get-usage-summary] [${correlationId}] Rate limit query error (non-fatal):`, rateLimitError);
    }

    // Aggregate usage by bucket
    const usageByBucket: Record<string, number> = {};
    if (rateLimits) {
      for (const rl of rateLimits) {
        // Only count daily buckets (86400 seconds)
        if (rl.window_seconds === 86400) {
          usageByBucket[rl.bucket] = (usageByBucket[rl.bucket] || 0) + rl.count;
        }
      }
    }

    // Build usage summary
    const usage = {
      aiGenericToday: usageByBucket['ai.generic'] || 0,
      aiInsightsToday: usageByBucket['ai.insights'] || 0,
      planMyDayToday: usageByBucket['ai.plan_my_day'] || 0,
      planMyDayOrgToday: usageByBucket['ai.plan_my_day_org'] || 0,
      aiRequestsThisMonth: orgData?.ai_requests_used_this_month || 0,
    };

    // Build limits from plan config
    const limits = {
      aiGenericPerDay: planConfig.aiGenericPerDay,
      aiInsightsPerDay: planConfig.aiInsightsPerDay,
      planMyDayPerUserPerDay: planConfig.planMyDayPerUserPerDay,
      planMyDayPerOrgPerDay: planConfig.planMyDayPerOrgPerDay,
      aiRequestsPerMonth: planConfig.monthlyAiRequests,
      maxUsers: planConfig.maxUsers,
      maxDeals: planConfig.maxDeals,
    };

    // Calculate usage percentages for UI progress bars
    const percentages = {
      aiGenericToday: limits.aiGenericPerDay > 0
        ? Math.round((usage.aiGenericToday / limits.aiGenericPerDay) * 100)
        : 0,
      aiInsightsToday: limits.aiInsightsPerDay > 0
        ? Math.round((usage.aiInsightsToday / limits.aiInsightsPerDay) * 100)
        : 0,
      planMyDayToday: limits.planMyDayPerUserPerDay > 0
        ? Math.round((usage.planMyDayToday / limits.planMyDayPerUserPerDay) * 100)
        : 0,
      aiRequestsMonth: limits.aiRequestsPerMonth > 0
        ? Math.round((usage.aiRequestsThisMonth / limits.aiRequestsPerMonth) * 100)
        : 0,
    };

    // Determine if any quotas are near limit (>80%)
    const nearLimit = Object.entries(percentages).some(([_, pct]) => pct >= 80);
    const atLimit = Object.entries(percentages).some(([_, pct]) => pct >= 100);

    console.log(`[get-usage-summary] [${correlationId}] Plan: ${planId}, Monthly AI: ${usage.aiRequestsThisMonth}/${limits.aiRequestsPerMonth}`);

    return new Response(
      JSON.stringify({
        success: true,
        planId,
        planName: planConfig.displayName,
        limits,
        usage,
        percentages,
        nearLimit,
        atLimit,
        // Include upgrade info for free tier
        ...(planId === 'free' && {
          upgradePrompt: 'Upgrade to Startup for 5x higher limits',
          nextPlan: {
            id: 'startup',
            name: PLAN_QUOTAS.startup.displayName,
            aiRequestsPerMonth: PLAN_QUOTAS.startup.monthlyAiRequests,
          },
        }),
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error(`[get-usage-summary] [${correlationId}] Error:`, {
      message: error.message,
      code: error.code,
    });

    const isAuthError =
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.message?.includes('auth') ||
      error.message?.includes('token');

    if (isAuthError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'Authentication required',
          code: 'AUTH_REQUIRED',
        }),
        { status: 401, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An error occurred',
        code: 'USAGE_SUMMARY_ERROR',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
