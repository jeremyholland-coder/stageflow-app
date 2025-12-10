/**
 * AI USAGE LOGGER
 *
 * Centralized helper for logging all AI interactions to ai_usage_logs table.
 * Used by:
 * - ai-assistant.mts (Mission Control queries)
 * - ai-assistant-stream.mts (streaming queries)
 * - ai-revenue-health.mts (Revenue Coach - hourly/daily/weekly/monthly)
 *
 * This ensures ALL AI calls are tracked for:
 * - Billing (user value visibility)
 * - Analytics
 * - Quota enforcement
 *
 * @author StageFlow Engineering
 * @date 2025-12-10
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export type AIRequestType =
  | 'hourly_health'      // Automated hourly Revenue Coach
  | 'daily_plan'         // Plan My Day
  | 'weekly_review'      // Weekly review
  | 'monthly_forecast'   // Monthly forecast
  | 'mission_control_query' // Interactive Mission Control chat
  | 'quick_action'       // Quick actions (Draft Message, Research, etc.)
  | 'deal_insight';      // Per-deal AI insights

export interface AIUsageLogEntry {
  organization_id: string;
  user_id: string;
  request_type: AIRequestType;
  provider?: string | null;
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  success: boolean;
  error_code?: string | null;
  metadata?: Record<string, any>;
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

let cachedClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('[AI Usage Logger] Missing Supabase configuration');
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

// ============================================================================
// MAIN LOGGING FUNCTION
// ============================================================================

/**
 * Log an AI usage event to the ai_usage_logs table.
 *
 * This function is fire-and-forget with error handling:
 * - Errors are logged to console but do not throw
 * - AI operations should not fail due to logging issues
 *
 * @param entry - The usage log entry to record
 */
export async function logAIUsage(entry: AIUsageLogEntry): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('ai_usage_logs')
      .insert({
        organization_id: entry.organization_id,
        user_id: entry.user_id,
        request_type: entry.request_type,
        provider: entry.provider || null,
        model: entry.model || null,
        tokens_in: entry.tokens_in || 0,
        tokens_out: entry.tokens_out || 0,
        success: entry.success,
        error_code: entry.error_code || null,
        metadata: entry.metadata || {},
        // created_at defaults to now() in DB
      });

    if (error) {
      // Log error but don't throw - AI ops should not fail due to logging
      console.error('[AI Usage Logger] Failed to insert log entry:', error.message);
    } else {
      console.log(`[AI Usage Logger] Logged ${entry.request_type} for user ${entry.user_id}`);
    }
  } catch (err: any) {
    // Catch any unexpected errors to prevent AI operation failures
    console.error('[AI Usage Logger] Unexpected error:', err.message);
  }
}

/**
 * Also increment the legacy ai_requests_used_this_month counter on organizations.
 * This maintains backwards compatibility with existing billing UI.
 *
 * @param orgId - Organization ID
 */
export async function incrementOrgAIUsageCounter(orgId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // First get current count
    const { data: orgData, error: fetchError } = await supabase
      .from('organizations')
      .select('ai_requests_used_this_month')
      .eq('id', orgId)
      .single();

    if (fetchError) {
      console.error('[AI Usage Logger] Failed to fetch org usage:', fetchError.message);
      return;
    }

    // Increment
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        ai_requests_used_this_month: (orgData?.ai_requests_used_this_month || 0) + 1,
      })
      .eq('id', orgId);

    if (updateError) {
      console.error('[AI Usage Logger] Failed to increment org counter:', updateError.message);
    }
  } catch (err: any) {
    console.error('[AI Usage Logger] Unexpected error incrementing counter:', err.message);
  }
}

/**
 * Combined function: log usage AND increment org counter.
 * Use this for most AI operations.
 */
export async function logAIUsageAndIncrement(entry: AIUsageLogEntry): Promise<void> {
  // Run both in parallel
  await Promise.all([
    logAIUsage(entry),
    incrementOrgAIUsageCounter(entry.organization_id),
  ]);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  logAIUsage,
  incrementOrgAIUsageCounter,
  logAIUsageAndIncrement,
};
