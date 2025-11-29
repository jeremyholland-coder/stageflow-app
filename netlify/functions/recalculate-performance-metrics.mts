/**
 * Recalculate Performance Metrics - Learning Engine v1
 *
 * This scheduled function calculates aggregated performance metrics from
 * deal_stage_history and stores them in performance_metrics table.
 *
 * Run schedule: Daily or on-demand via internal call
 *
 * Metrics calculated:
 * - Org-wide win rates and velocity
 * - Per-user win rates and velocity
 * - Per-stage conversion rates and time-in-stage
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Calculate metrics for a specific time period
async function calculateMetricsForPeriod(
  organizationId: string,
  periodDays: number,
  periodName: string
): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - periodDays);

  console.log(`[Metrics] Calculating ${periodName} metrics for org ${organizationId}`);

  // Get all deals for this organization
  const { data: deals, error: dealsError } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', organizationId);

  if (dealsError) {
    console.error('Error fetching deals:', dealsError);
    return;
  }

  if (!deals || deals.length === 0) {
    console.log(`[Metrics] No deals found for org ${organizationId}`);
    return;
  }

  // Get stage history for this period
  const { data: history, error: historyError } = await supabase
    .from('deal_stage_history')
    .select('*')
    .eq('organization_id', organizationId)
    .gte('changed_at', cutoffDate.toISOString())
    .order('changed_at', { ascending: true });

  if (historyError) {
    console.error('Error fetching history:', historyError);
  }

  // Filter deals by status change within period
  const wonDealsInPeriod = deals.filter(d => {
    if (d.status !== 'won') return false;
    const wonDate = new Date(d.last_activity || d.updated_at || d.created);
    return wonDate >= cutoffDate;
  });

  const lostDealsInPeriod = deals.filter(d => {
    if (d.status !== 'lost') return false;
    const lostDate = new Date(d.last_activity || d.updated_at || d.created);
    return lostDate >= cutoffDate;
  });

  // -------------------------------------------------------------------------
  // ORG-WIDE METRICS (user_id = NULL, stage = NULL)
  // -------------------------------------------------------------------------
  const orgDealsWon = wonDealsInPeriod.length;
  const orgDealsLost = lostDealsInPeriod.length;
  const orgValueWon = wonDealsInPeriod.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const orgValueLost = lostDealsInPeriod.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const orgWinRate = (orgDealsWon + orgDealsLost) > 0
    ? orgDealsWon / (orgDealsWon + orgDealsLost)
    : 0;

  // Calculate average days to close for won deals
  const avgDaysToClose = wonDealsInPeriod.length > 0
    ? wonDealsInPeriod.reduce((sum, d) => {
        const created = new Date(d.created || d.created_at);
        const closed = new Date(d.last_activity || d.updated_at);
        return sum + Math.floor((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }, 0) / wonDealsInPeriod.length
    : null;

  // Upsert org-wide metrics
  try {
    await supabase.rpc('upsert_performance_metrics', {
      p_organization_id: organizationId,
      p_user_id: null,
      p_stage: null,
      p_period: periodName,
      p_deals_won: orgDealsWon,
      p_deals_lost: orgDealsLost,
      p_total_value_won: orgValueWon,
      p_total_value_lost: orgValueLost,
      p_avg_days_in_stage: null,
      p_avg_days_to_close: avgDaysToClose,
      p_win_rate: orgWinRate
    });
    console.log(`[Metrics] Org-wide metrics saved: win_rate=${(orgWinRate * 100).toFixed(1)}%`);
  } catch (error) {
    console.error('[Metrics] Failed to save org-wide metrics:', error);
  }

  // -------------------------------------------------------------------------
  // PER-USER METRICS (stage = NULL)
  // -------------------------------------------------------------------------
  const userIds = [...new Set(deals.map(d => d.user_id).filter(Boolean))];

  for (const userId of userIds) {
    const userWonDeals = wonDealsInPeriod.filter(d => d.user_id === userId);
    const userLostDeals = lostDealsInPeriod.filter(d => d.user_id === userId);
    const userWon = userWonDeals.length;
    const userLost = userLostDeals.length;
    const userValueWon = userWonDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const userValueLost = userLostDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const userWinRate = (userWon + userLost) > 0 ? userWon / (userWon + userLost) : 0;

    const userAvgDaysToClose = userWonDeals.length > 0
      ? userWonDeals.reduce((sum, d) => {
          const created = new Date(d.created || d.created_at);
          const closed = new Date(d.last_activity || d.updated_at);
          return sum + Math.floor((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        }, 0) / userWonDeals.length
      : null;

    try {
      await supabase.rpc('upsert_performance_metrics', {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_stage: null,
        p_period: periodName,
        p_deals_won: userWon,
        p_deals_lost: userLost,
        p_total_value_won: userValueWon,
        p_total_value_lost: userValueLost,
        p_avg_days_in_stage: null,
        p_avg_days_to_close: userAvgDaysToClose,
        p_win_rate: userWinRate
      });
    } catch (error) {
      console.error(`[Metrics] Failed to save user ${userId} metrics:`, error);
    }
  }

  console.log(`[Metrics] Per-user metrics saved for ${userIds.length} users`);

  // -------------------------------------------------------------------------
  // PER-STAGE METRICS (user_id = NULL)
  // -------------------------------------------------------------------------
  if (history && history.length > 0) {
    // Group history by stage
    const stageMetrics: { [stage: string]: { daysInStage: number[]; count: number } } = {};

    history.forEach(h => {
      if (h.to_stage && h.days_in_previous_stage != null) {
        if (!stageMetrics[h.from_stage || 'initial']) {
          stageMetrics[h.from_stage || 'initial'] = { daysInStage: [], count: 0 };
        }
        stageMetrics[h.from_stage || 'initial'].daysInStage.push(h.days_in_previous_stage);
        stageMetrics[h.from_stage || 'initial'].count++;
      }
    });

    // Calculate stage-specific win rates from final stage transitions
    const stages = [...new Set(deals.map(d => d.stage))];

    for (const stage of stages) {
      const stageDeals = deals.filter(d => d.stage === stage || history.some(h => h.to_stage === stage && h.deal_id === d.id));
      const stageWon = stageDeals.filter(d => d.status === 'won').length;
      const stageLost = stageDeals.filter(d => d.status === 'lost').length;
      const stageWinRate = (stageWon + stageLost) > 0 ? stageWon / (stageWon + stageLost) : null;

      // Get avg days in this stage
      const avgDaysInStage = stageMetrics[stage]
        ? stageMetrics[stage].daysInStage.reduce((a, b) => a + b, 0) / stageMetrics[stage].daysInStage.length
        : null;

      try {
        await supabase.rpc('upsert_performance_metrics', {
          p_organization_id: organizationId,
          p_user_id: null,
          p_stage: stage,
          p_period: periodName,
          p_deals_won: stageWon,
          p_deals_lost: stageLost,
          p_total_value_won: 0,
          p_total_value_lost: 0,
          p_avg_days_in_stage: avgDaysInStage,
          p_avg_days_to_close: null,
          p_win_rate: stageWinRate
        });
      } catch (error) {
        console.error(`[Metrics] Failed to save stage ${stage} metrics:`, error);
      }
    }

    console.log(`[Metrics] Per-stage metrics saved for ${stages.length} stages`);
  }
}

export default async (req: Request, context: any) => {
  // Only allow POST or scheduled invocations
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Parse request body for optional org filter
    let targetOrgId: string | null = null;
    try {
      const body = await req.json();
      targetOrgId = body.organizationId || null;
    } catch {
      // No body or invalid JSON - process all orgs
    }

    // Get all organizations (or specific one)
    let orgsQuery = supabase.from('organizations').select('id');
    if (targetOrgId) {
      orgsQuery = orgsQuery.eq('id', targetOrgId);
    }

    const { data: orgs, error: orgsError } = await orgsQuery;

    if (orgsError) {
      throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      return new Response(JSON.stringify({
        message: 'No organizations found',
        processed: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Metrics] Processing ${orgs.length} organizations`);

    // Process each organization
    let processed = 0;
    let errors = 0;

    for (const org of orgs) {
      try {
        // Calculate metrics for last 90 days
        await calculateMetricsForPeriod(org.id, 90, 'last_90_days');
        processed++;
      } catch (error) {
        console.error(`[Metrics] Error processing org ${org.id}:`, error);
        errors++;
      }
    }

    return new Response(JSON.stringify({
      message: 'Performance metrics recalculated',
      processed,
      errors,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Metrics] Fatal error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
