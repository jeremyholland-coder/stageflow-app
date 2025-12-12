/**
 * REVENUE ENGINE - Deterministic Revenue Projections
 *
 * Pure math module for calculating revenue projections.
 * NO AI calls, NO database calls, NO network requests.
 *
 * This module is:
 * - Pure functional (no side effects)
 * - Fully unit testable
 * - Used by ai-revenue-health.mts to generate context for AI coach
 *
 * @author StageFlow Engineering
 * @date 2025-12-10
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RevenueDealInput {
  id: string;
  value: number | null;
  stage: string;
  status: 'active' | 'won' | 'lost' | 'disqualified' | string;
  expected_close_date?: string | null;
  created_at?: string | null;
  updated?: string | null; // DB uses "updated"
  last_activity?: string | null;
  confidence?: number | null;
  assigned_to?: string | null;
}

export interface RevenueTargets {
  month_goal?: number | null;
  quarter_goal?: number | null;
  year_goal?: number | null;
}

export interface RevenueProjectionResult {
  // Projected revenue (closed + weighted pipeline)
  month_projected: number;
  quarter_projected: number;
  year_projected: number;

  // Closed revenue (won deals only)
  month_closed: number;
  quarter_closed: number;
  year_closed: number;

  // Pipeline value (active deals, weighted by probability)
  month_pipeline: number;
  quarter_pipeline: number;
  year_pipeline: number;

  // Goals
  month_goal: number | null;
  quarter_goal: number | null;
  year_goal: number | null;

  // Percent to goal (0-100+, null if no goal)
  month_pct_to_goal: number | null;
  quarter_pct_to_goal: number | null;
  year_pct_to_goal: number | null;

  // Pace metrics (1.0 = on pace, <1.0 = behind, >1.0 = ahead)
  pace_month: number | null;
  pace_quarter: number | null;
  pace_year: number | null;

  // Risk flags
  risk_flags: string[];

  // Period metadata
  period_info: {
    month_days_elapsed: number;
    month_days_total: number;
    quarter_days_elapsed: number;
    quarter_days_total: number;
    year_days_elapsed: number;
    year_days_total: number;
  };

  // Engine version for migrations
  engine_version: number;
}

// ============================================================================
// STAGE PROBABILITY MAPPING
// ============================================================================

/**
 * Default win probability by stage category.
 * Used when deal doesn't have explicit confidence set.
 *
 * Based on industry benchmarks:
 * - Early stages: 10-20%
 * - Discovery/Qualification: 25-40%
 * - Proposal: 40-60%
 * - Negotiation/Contract: 60-80%
 * - Won: 100%
 */
const STAGE_WIN_PROBABILITY: Record<string, number> = {
  // Lead stages - low probability
  lead: 0.10,
  lead_captured: 0.12,
  lead_generation: 0.10,
  lead_identified: 0.10,
  lead_qualification: 0.15,
  lead_qualified: 0.20,
  prospecting: 0.10,

  // Contact/Discovery - moderate-low
  contacted: 0.20,
  contact: 0.20,
  initial_screening: 0.20,
  qualification: 0.25,
  discovery: 0.30,
  discovery_demo: 0.35,
  needs_identified: 0.35,
  scope_defined: 0.40,

  // Proposal - moderate
  proposal_sent: 0.45,
  proposal: 0.45,
  quote: 0.40,
  term_sheet_presented: 0.50,

  // Negotiation/Contract - high
  negotiation: 0.60,
  contract: 0.65,
  contract_sent: 0.65,
  contract_signed: 0.75,
  approval: 0.70,
  due_diligence: 0.60,

  // Near close - very high
  invoice: 0.85,
  invoice_sent: 0.85,
  closing_statement_sent: 0.80,
  capital_call_sent: 0.85,

  // Won stages
  deal_won: 1.0,
  closed: 1.0,
  closed_won: 1.0,
  investment_closed: 1.0,
  payment_received: 1.0,
  escrow_completed: 1.0,
  capital_received: 1.0,

  // Post-sale (100% - already won)
  onboarding: 1.0,
  customer_onboarded: 1.0,
  client_onboarding: 1.0,
  delivery: 1.0,
  adoption: 1.0,
  retention: 1.0,
  renewal: 0.70, // Renewal is uncertain
  renewal_upsell: 0.50,
  portfolio_mgmt: 1.0,
  client_followup: 1.0,

  // Lost stages
  lost: 0,
  deal_lost: 0,
  passed: 0,

  // Default for unknown stages
  default: 0.25,
};

/**
 * Get win probability for a stage
 */
function getWinProbability(stage: string, dealConfidence?: number | null): number {
  // If deal has explicit confidence, use it (convert from 0-100 to 0-1)
  if (dealConfidence !== null && dealConfidence !== undefined && dealConfidence > 0) {
    return Math.min(1, Math.max(0, dealConfidence / 100));
  }

  // Otherwise use stage-based probability
  return STAGE_WIN_PROBABILITY[stage] ?? STAGE_WIN_PROBABILITY.default;
}

// ============================================================================
// PERIOD HELPERS
// ============================================================================

interface PeriodInfo {
  start: Date;
  end: Date;
  daysElapsed: number;
  daysTotal: number;
  pctElapsed: number;
}

function getMonthPeriod(now: Date): PeriodInfo {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysTotal = end.getDate();
  const daysElapsed = now.getDate();
  const pctElapsed = daysElapsed / daysTotal;

  return { start, end, daysElapsed, daysTotal, pctElapsed };
}

function getQuarterPeriod(now: Date): PeriodInfo {
  const currentQuarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), currentQuarter * 3, 1);
  const endMonth = (currentQuarter + 1) * 3;
  const end = new Date(now.getFullYear(), endMonth, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysTotal = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
  const daysElapsed = Math.round((now.getTime() - start.getTime()) / msPerDay) + 1;
  const pctElapsed = daysElapsed / daysTotal;

  return { start, end, daysElapsed, daysTotal, pctElapsed };
}

function getYearPeriod(now: Date): PeriodInfo {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysTotal = 365 + (isLeapYear(now.getFullYear()) ? 1 : 0);
  const daysElapsed = Math.round((now.getTime() - start.getTime()) / msPerDay) + 1;
  const pctElapsed = daysElapsed / daysTotal;

  return { start, end, daysElapsed, daysTotal, pctElapsed };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function isDateInPeriod(dateStr: string | null | undefined, period: PeriodInfo): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  return date >= period.start && date <= period.end;
}

// ============================================================================
// RISK FLAG DETECTION
// ============================================================================

interface RiskAnalysis {
  flags: string[];
  details: Record<string, any>;
}

function analyzeRisks(
  deals: RevenueDealInput[],
  monthPct: number | null,
  quarterPct: number | null,
  monthPeriod: PeriodInfo,
  quarterPeriod: PeriodInfo
): RiskAnalysis {
  const flags: string[] = [];
  const details: Record<string, any> = {};

  const activeDeals = deals.filter(d => d.status === 'active');
  const now = new Date();

  // 1. Off-pace detection (behind on % to goal vs % of period elapsed)
  if (monthPct !== null && monthPeriod.pctElapsed > 0.25) {
    const expectedPct = monthPeriod.pctElapsed * 100;
    if (monthPct < expectedPct * 0.7) {
      flags.push('off_pace_month');
      details.off_pace_month = {
        actual: monthPct,
        expected: expectedPct,
        deficit: expectedPct - monthPct
      };
    }
  }

  if (quarterPct !== null && quarterPeriod.pctElapsed > 0.25) {
    const expectedPct = quarterPeriod.pctElapsed * 100;
    if (quarterPct < expectedPct * 0.7) {
      flags.push('off_pace_quarter');
      details.off_pace_quarter = {
        actual: quarterPct,
        expected: expectedPct,
        deficit: expectedPct - quarterPct
      };
    }
  }

  // 2. Lead drought (no new leads in last 14 days)
  const leadStages = ['lead', 'lead_captured', 'lead_generation', 'lead_identified', 'prospecting'];
  const recentLeads = activeDeals.filter(d => {
    if (!leadStages.includes(d.stage)) return false;
    const created = new Date(d.created_at || '');
    if (isNaN(created.getTime())) return false;
    const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceCreated <= 14;
  });

  if (recentLeads.length === 0 && activeDeals.length > 0) {
    flags.push('lead_drought');
    details.lead_drought = { days_since_last_lead: 14 };
  }

  // 3. Stagnant pipeline (many deals without activity > 21 days)
  const stagnantThreshold = 21; // days
  const stagnantDeals = activeDeals.filter(d => {
    const lastActivity = d.last_activity || d.updated || d.created_at || d.created;
    if (!lastActivity) return false;
    const activityDate = new Date(lastActivity);
    if (isNaN(activityDate.getTime())) return false;
    const daysSinceActivity = Math.floor((now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceActivity > stagnantThreshold;
  });

  if (stagnantDeals.length >= 3 || (stagnantDeals.length > 0 && stagnantDeals.length >= activeDeals.length * 0.3)) {
    flags.push('stagnant_pipeline');
    details.stagnant_pipeline = {
      count: stagnantDeals.length,
      total_active: activeDeals.length,
      threshold_days: stagnantThreshold
    };
  }

  // 4. Empty middle stages (no deals in proposal/negotiation)
  const middleStages = ['proposal_sent', 'proposal', 'negotiation', 'contract_sent', 'quote'];
  const middleDeals = activeDeals.filter(d => middleStages.includes(d.stage));

  if (middleDeals.length === 0 && activeDeals.length >= 5) {
    flags.push('empty_middle_stages');
    details.empty_middle_stages = { stages_checked: middleStages };
  }

  // 5. High value at risk (>50% of pipeline in stagnant deals)
  const totalPipelineValue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const stagnantValue = stagnantDeals.reduce((sum, d) => sum + (d.value || 0), 0);

  if (totalPipelineValue > 0 && stagnantValue / totalPipelineValue > 0.5) {
    flags.push('high_value_at_risk');
    details.high_value_at_risk = {
      stagnant_value: stagnantValue,
      total_pipeline_value: totalPipelineValue,
      pct: Math.round((stagnantValue / totalPipelineValue) * 100)
    };
  }

  // 6. Overdue deals (expected close date passed)
  const overdueDeals = activeDeals.filter(d => {
    if (!d.expected_close_date) return false;
    const closeDate = new Date(d.expected_close_date);
    return closeDate < now;
  });

  if (overdueDeals.length >= 3) {
    flags.push('overdue_deals');
    details.overdue_deals = { count: overdueDeals.length };
  }

  return { flags, details };
}

// ============================================================================
// MAIN PROJECTION FUNCTION
// ============================================================================

/**
 * Compute deterministic revenue projections from deals and targets.
 *
 * This is a PURE FUNCTION:
 * - No side effects
 * - No DB calls
 * - No network requests
 * - Fully deterministic given same inputs
 *
 * @param deals - Array of deals to analyze
 * @param targets - Revenue goals (monthly, quarterly, annual)
 * @param now - Current date (injectable for testing)
 * @returns RevenueProjectionResult with all projections and risk flags
 */
export function computeRevenueProjections(
  deals: RevenueDealInput[],
  targets: RevenueTargets,
  now: Date = new Date()
): RevenueProjectionResult {
  // Get period boundaries
  const monthPeriod = getMonthPeriod(now);
  const quarterPeriod = getQuarterPeriod(now);
  const yearPeriod = getYearPeriod(now);

  // Initialize counters
  let monthClosed = 0;
  let quarterClosed = 0;
  let yearClosed = 0;

  let monthPipeline = 0;
  let quarterPipeline = 0;
  let yearPipeline = 0;

  // Process each deal
  for (const deal of deals) {
    const value = deal.value || 0;
    if (value <= 0) continue;

    if (deal.status === 'won') {
      // Won deals: check when they were closed
      const closedDate = deal.last_activity || deal.updated || deal.created_at || deal.created;

      if (isDateInPeriod(closedDate, monthPeriod)) {
        monthClosed += value;
      }
      if (isDateInPeriod(closedDate, quarterPeriod)) {
        quarterClosed += value;
      }
      if (isDateInPeriod(closedDate, yearPeriod)) {
        yearClosed += value;
      }
    } else if (deal.status === 'active') {
      // Active deals: weight by probability and expected close date
      const probability = getWinProbability(deal.stage, deal.confidence);
      const weightedValue = value * probability;

      // Determine which period this deal is expected to close in
      const expectedClose = deal.expected_close_date;

      if (expectedClose) {
        const closeDate = new Date(expectedClose);
        if (!isNaN(closeDate.getTime())) {
          // Has expected close date - assign to appropriate period
          if (closeDate <= monthPeriod.end) {
            monthPipeline += weightedValue;
            quarterPipeline += weightedValue;
            yearPipeline += weightedValue;
          } else if (closeDate <= quarterPeriod.end) {
            quarterPipeline += weightedValue;
            yearPipeline += weightedValue;
          } else if (closeDate <= yearPeriod.end) {
            yearPipeline += weightedValue;
          }
          continue;
        }
      }

      // No expected close date - use heuristics based on stage
      // Early stages: spread across periods
      // Later stages: more likely to close sooner
      const stageProbSoon = getWinProbability(deal.stage, null);

      if (stageProbSoon >= 0.6) {
        // Late stage: likely to close this month
        monthPipeline += weightedValue;
        quarterPipeline += weightedValue;
        yearPipeline += weightedValue;
      } else if (stageProbSoon >= 0.3) {
        // Mid stage: likely to close this quarter
        quarterPipeline += weightedValue;
        yearPipeline += weightedValue;
      } else {
        // Early stage: only count for year
        yearPipeline += weightedValue;
      }
    }
    // Lost/disqualified deals contribute 0
  }

  // Calculate projected totals (closed + pipeline)
  const monthProjected = monthClosed + monthPipeline;
  const quarterProjected = quarterClosed + quarterPipeline;
  const yearProjected = yearClosed + yearPipeline;

  // Safe division helper
  const safePct = (value: number, goal: number | null | undefined): number | null => {
    if (!goal || goal <= 0) return null;
    return Math.round((value / goal) * 100 * 10) / 10; // One decimal place
  };

  // Calculate percent to goal
  const monthGoal = targets.month_goal ?? null;
  const quarterGoal = targets.quarter_goal ?? null;
  const yearGoal = targets.year_goal ?? null;

  const monthPctToGoal = safePct(monthProjected, monthGoal);
  const quarterPctToGoal = safePct(quarterProjected, quarterGoal);
  const yearPctToGoal = safePct(yearProjected, yearGoal);

  // Calculate pace (actual closed vs expected based on time elapsed)
  // Pace = (closed / time_elapsed_pct) / goal
  // e.g., if 50% of month elapsed and you're at 45% closed, pace = 0.9 (90% of needed pace)
  const calcPace = (closed: number, goal: number | null | undefined, pctElapsed: number): number | null => {
    if (!goal || goal <= 0 || pctElapsed <= 0) return null;
    const expectedClosed = goal * pctElapsed;
    if (expectedClosed <= 0) return null;
    return Math.round((closed / expectedClosed) * 100) / 100; // Two decimal places
  };

  const paceMonth = calcPace(monthClosed, monthGoal, monthPeriod.pctElapsed);
  const paceQuarter = calcPace(quarterClosed, quarterGoal, quarterPeriod.pctElapsed);
  const paceYear = calcPace(yearClosed, yearGoal, yearPeriod.pctElapsed);

  // Analyze risks
  const riskAnalysis = analyzeRisks(
    deals,
    monthPctToGoal,
    quarterPctToGoal,
    monthPeriod,
    quarterPeriod
  );

  return {
    month_projected: Math.round(monthProjected),
    quarter_projected: Math.round(quarterProjected),
    year_projected: Math.round(yearProjected),

    month_closed: Math.round(monthClosed),
    quarter_closed: Math.round(quarterClosed),
    year_closed: Math.round(yearClosed),

    month_pipeline: Math.round(monthPipeline),
    quarter_pipeline: Math.round(quarterPipeline),
    year_pipeline: Math.round(yearPipeline),

    month_goal: monthGoal,
    quarter_goal: quarterGoal,
    year_goal: yearGoal,

    month_pct_to_goal: monthPctToGoal,
    quarter_pct_to_goal: quarterPctToGoal,
    year_pct_to_goal: yearPctToGoal,

    pace_month: paceMonth,
    pace_quarter: paceQuarter,
    pace_year: paceYear,

    risk_flags: riskAnalysis.flags,

    period_info: {
      month_days_elapsed: monthPeriod.daysElapsed,
      month_days_total: monthPeriod.daysTotal,
      quarter_days_elapsed: quarterPeriod.daysElapsed,
      quarter_days_total: quarterPeriod.daysTotal,
      year_days_elapsed: yearPeriod.daysElapsed,
      year_days_total: yearPeriod.daysTotal,
    },

    engine_version: 1,
  };
}

// ============================================================================
// HELPER: Summarize projection for AI context
// ============================================================================

/**
 * Generate a text summary of projections for AI consumption.
 * This is NOT the AI response - it's INPUT for the AI prompt.
 */
export function summarizeProjectionForAI(projection: RevenueProjectionResult): string {
  const lines: string[] = [];

  // Monthly status
  if (projection.month_goal) {
    const status = projection.pace_month !== null
      ? (projection.pace_month >= 1 ? 'ON TRACK' : projection.pace_month >= 0.7 ? 'SLIGHTLY BEHIND' : 'BEHIND PACE')
      : 'NO GOAL';
    lines.push(`MONTHLY: $${projection.month_closed.toLocaleString()} closed + $${projection.month_pipeline.toLocaleString()} pipeline = $${projection.month_projected.toLocaleString()} projected vs $${projection.month_goal.toLocaleString()} goal (${projection.month_pct_to_goal}%) - ${status}`);
  }

  // Quarterly status
  if (projection.quarter_goal) {
    const status = projection.pace_quarter !== null
      ? (projection.pace_quarter >= 1 ? 'ON TRACK' : projection.pace_quarter >= 0.7 ? 'SLIGHTLY BEHIND' : 'BEHIND PACE')
      : 'NO GOAL';
    lines.push(`QUARTERLY: $${projection.quarter_closed.toLocaleString()} closed + $${projection.quarter_pipeline.toLocaleString()} pipeline = $${projection.quarter_projected.toLocaleString()} projected vs $${projection.quarter_goal.toLocaleString()} goal (${projection.quarter_pct_to_goal}%) - ${status}`);
  }

  // Annual status
  if (projection.year_goal) {
    lines.push(`ANNUAL: $${projection.year_projected.toLocaleString()} projected vs $${projection.year_goal.toLocaleString()} goal (${projection.year_pct_to_goal}%)`);
  }

  // Risk flags
  if (projection.risk_flags.length > 0) {
    lines.push(`RISK FLAGS: ${projection.risk_flags.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  computeRevenueProjections,
  summarizeProjectionForAI,
  getWinProbability,
};
