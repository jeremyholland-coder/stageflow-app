/**
 * MISSION CONTROL FALLBACK
 *
 * Phase 3: Non-AI fallback for Mission Control / Plan My Day
 *
 * When AI providers fail (quota, billing, misconfiguration), this module
 * provides a deterministic, data-driven summary that gives users value
 * without requiring any external AI calls.
 *
 * The basic plan is generated entirely from database context:
 * - Deal counts and values by stage
 * - Overdue tasks
 * - Stagnant deals requiring attention
 * - High-value opportunities at risk
 * - Upcoming activities
 * - RevOps metrics (follow-up health, retention health, goal tracking)
 *
 * @author StageFlow Engineering
 * @since 2025-12-04
 */

// Import stagnation thresholds from centralized config
import { STAGNATION_THRESHOLDS } from '../../../src/config/pipelineConfig';

// Import RevOps metrics engine
import {
  buildRevOpsMetrics,
  formatRevOpsMetricsAsText,
  RevOpsMetrics
} from './revops-metrics';

/**
 * Mission Control context built from database data
 */
export interface MissionControlContext {
  // Deal statistics
  totalDeals: number;
  activeDeals: number;
  totalPipelineValue: number;

  // Stage distribution
  dealsByStage: Record<string, { count: number; value: number }>;

  // Attention items
  stagnantDeals: Array<{
    client: string;
    stage: string;
    value: number;
    daysSinceCreated: number;
  }>;
  highValueAtRisk: Array<{
    client: string;
    stage: string;
    value: number;
  }>;

  // Activity
  dealsNeedingFollowUp: number;
  recentlyWonValue: number;
  recentlyLostCount: number;

  // User context
  userWinRate: number | null;
  avgDaysToClose: number | null;
}

/**
 * Basic (non-AI) plan structure for Mission Control
 */
export interface BasicMissionControlPlan {
  mode: 'basic';
  headline: string;
  bullets: string[];
  recommendedActions: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
  }>;
  stats: {
    totalDeals: number;
    totalPipelineValue: number;
    stagnantCount: number;
    highValueAtRiskCount: number;
  };
  // RevOps metrics for dashboard display
  revOpsMetrics: RevOpsMetrics | null;
  generatedAt: string;
}

/**
 * Build Mission Control context from deals array
 *
 * This extracts all the data needed for both AI prompts and basic fallback plans.
 * Can be called before AI attempts to have context ready for fallback.
 *
 * @param deals - Array of deals from the database
 * @param performanceMetrics - Optional performance metrics from the metrics table
 * @param monthlyTarget - Optional monthly revenue target for goal tracking
 */
export function buildMissionControlContext(
  deals: any[],
  performanceMetrics?: { userWinRate?: number; avgDaysToClose?: number } | null,
  monthlyTarget?: number
): MissionControlContext {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Filter active deals
  const activeDeals = deals.filter(d => d.status === 'active');
  const wonDeals = deals.filter(d => d.status === 'won');
  const lostDeals = deals.filter(d => d.status === 'lost');

  // Calculate total pipeline value
  const totalPipelineValue = activeDeals.reduce(
    (sum, d) => sum + Number(d.value || 0), 0
  );

  // Group by stage
  const dealsByStage: Record<string, { count: number; value: number }> = {};
  activeDeals.forEach(deal => {
    const stage = deal.stage || 'unknown';
    if (!dealsByStage[stage]) {
      dealsByStage[stage] = { count: 0, value: 0 };
    }
    dealsByStage[stage].count++;
    dealsByStage[stage].value += Number(deal.value || 0);
  });

  // Find stagnant deals (exceeding stage threshold)
  const stagnantDeals = activeDeals
    .map(deal => {
      const created = new Date(deal.created || deal.created_at);
      if (isNaN(created.getTime())) return null;

      const daysSinceCreated = Math.floor(
        (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );

      const threshold = STAGNATION_THRESHOLDS[deal.stage as keyof typeof STAGNATION_THRESHOLDS]
        || STAGNATION_THRESHOLDS.default;

      if (daysSinceCreated > threshold) {
        return {
          client: deal.client || 'Unknown',
          stage: deal.stage || 'unknown',
          value: Number(deal.value || 0),
          daysSinceCreated
        };
      }
      return null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => b.value - a.value); // Sort by value descending

  // High value deals at risk (stagnant + high value)
  const highValueThreshold = 10000;
  const highValueAtRisk = stagnantDeals
    .filter(d => d.value >= highValueThreshold)
    .slice(0, 5); // Top 5

  // Recent activity
  const recentlyWon = wonDeals.filter(d => {
    const closedAt = new Date(d.closed_at || d.last_activity || d.updated_at);
    return closedAt >= oneWeekAgo;
  });
  const recentlyWonValue = recentlyWon.reduce(
    (sum, d) => sum + Number(d.value || 0), 0
  );

  const recentlyLost = lostDeals.filter(d => {
    const closedAt = new Date(d.closed_at || d.last_activity || d.updated_at);
    return closedAt >= oneWeekAgo;
  });

  // Deals needing follow-up (no activity in 7+ days)
  const dealsNeedingFollowUp = activeDeals.filter(d => {
    const lastActivity = new Date(d.last_activity || d.updated_at || d.created_at);
    return lastActivity < oneWeekAgo;
  }).length;

  return {
    totalDeals: deals.length,
    activeDeals: activeDeals.length,
    totalPipelineValue,
    dealsByStage,
    stagnantDeals: stagnantDeals.slice(0, 10), // Limit to 10
    highValueAtRisk,
    dealsNeedingFollowUp,
    recentlyWonValue,
    recentlyLostCount: recentlyLost.length,
    userWinRate: performanceMetrics?.userWinRate ?? null,
    avgDaysToClose: performanceMetrics?.avgDaysToClose ?? null
  };
}

/**
 * Build a basic (non-AI) Mission Control plan from context
 *
 * This is a deterministic fallback that provides value when AI is unavailable.
 * It analyzes the context and generates actionable recommendations based on rules.
 *
 * @param context - Mission Control context from buildMissionControlContext
 * @param deals - Optional raw deals array for RevOps metrics calculation
 * @param monthlyTarget - Optional monthly target for goal tracking
 */
export function buildBasicMissionControlPlan(
  context: MissionControlContext,
  deals?: any[],
  monthlyTarget?: number
): BasicMissionControlPlan {
  const bullets: string[] = [];
  const recommendedActions: BasicMissionControlPlan['recommendedActions'] = [];

  // Build headline based on pipeline state
  let headline = "Here's your pipeline at a glance";
  if (context.stagnantDeals.length > 3) {
    headline = `${context.stagnantDeals.length} deals need your attention today`;
  } else if (context.highValueAtRisk.length > 0) {
    headline = `High-value opportunity needs focus`;
  } else if (context.activeDeals === 0) {
    headline = "Your pipeline is empty - time to prospect!";
  }

  // Add summary bullets
  if (context.activeDeals > 0) {
    bullets.push(
      `You have ${context.activeDeals} active deals worth $${context.totalPipelineValue.toLocaleString()} in your pipeline.`
    );
  } else {
    bullets.push("No active deals in your pipeline yet.");
  }

  if (context.stagnantDeals.length > 0) {
    bullets.push(
      `${context.stagnantDeals.length} deal${context.stagnantDeals.length > 1 ? 's are' : ' is'} stagnant and may be losing momentum.`
    );
  }

  if (context.dealsNeedingFollowUp > 0) {
    bullets.push(
      `${context.dealsNeedingFollowUp} deal${context.dealsNeedingFollowUp > 1 ? 's haven\'t' : ' hasn\'t'} been touched in over a week.`
    );
  }

  if (context.recentlyWonValue > 0) {
    bullets.push(
      `Great work! You closed $${context.recentlyWonValue.toLocaleString()} in the past week.`
    );
  }

  // Generate recommended actions based on data
  // Priority 1: High-value at risk
  if (context.highValueAtRisk.length > 0) {
    const topDeal = context.highValueAtRisk[0];
    recommendedActions.push({
      priority: 'high',
      action: `Reach out to ${topDeal.client} ($${topDeal.value.toLocaleString()})`,
      reason: `This high-value deal in ${topDeal.stage} stage has been stagnant`
    });
  }

  // Priority 2: Stagnant deals not in high-value list
  const regularStagnant = context.stagnantDeals.filter(
    d => !context.highValueAtRisk.some(hv => hv.client === d.client)
  ).slice(0, 2);

  regularStagnant.forEach(deal => {
    recommendedActions.push({
      priority: 'medium',
      action: `Follow up with ${deal.client}`,
      reason: `${deal.daysSinceCreated} days in ${deal.stage} stage - needs momentum`
    });
  });

  // Priority 3: Stage-specific recommendations
  const stageOrder = ['discovery', 'proposal_sent', 'negotiation', 'verbal_commit', 'contract_sent'];
  for (const stage of stageOrder) {
    const stageData = context.dealsByStage[stage];
    if (stageData && stageData.count > 0) {
      const stageLabel = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      if (stage === 'proposal_sent' && stageData.count > 2) {
        recommendedActions.push({
          priority: 'medium',
          action: `Review your ${stageData.count} proposals awaiting response`,
          reason: 'Multiple proposals pending - consider follow-up calls'
        });
        break;
      }

      if (stage === 'negotiation' && stageData.count > 0) {
        recommendedActions.push({
          priority: 'high',
          action: `Focus on closing your ${stageData.count} deal${stageData.count > 1 ? 's' : ''} in negotiation`,
          reason: `$${stageData.value.toLocaleString()} ready to close`
        });
        break;
      }
    }
  }

  // Priority 4: General pipeline health
  if (recommendedActions.length < 3 && context.activeDeals > 0) {
    recommendedActions.push({
      priority: 'low',
      action: 'Review your pipeline stages',
      reason: 'Look for deals that can be advanced today'
    });
  }

  // If no deals, suggest prospecting
  if (context.activeDeals === 0) {
    recommendedActions.push({
      priority: 'high',
      action: 'Add new leads to your pipeline',
      reason: 'An empty pipeline means no revenue momentum'
    });
  }

  // Limit to 5 actions
  const limitedActions = recommendedActions.slice(0, 5);

  // Build RevOps metrics if deals are provided
  let revOpsMetrics: RevOpsMetrics | null = null;
  if (deals && deals.length > 0) {
    revOpsMetrics = buildRevOpsMetrics({
      deals,
      monthlyTarget: monthlyTarget || 0,
      invoices: null // No invoice data yet - graceful no-op
    });

    // Add RevOps insights to bullets
    const revOpsBullets = formatRevOpsMetricsAsText(revOpsMetrics);
    bullets.push(...revOpsBullets);
  }

  return {
    mode: 'basic',
    headline,
    bullets,
    recommendedActions: limitedActions,
    stats: {
      totalDeals: context.totalDeals,
      totalPipelineValue: context.totalPipelineValue,
      stagnantCount: context.stagnantDeals.length,
      highValueAtRiskCount: context.highValueAtRisk.length
    },
    revOpsMetrics,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Format a basic plan as a text response (for message display)
 */
export function formatBasicPlanAsText(plan: BasicMissionControlPlan): string {
  const lines: string[] = [];

  lines.push(plan.headline);
  lines.push('');

  // Add bullets
  plan.bullets.forEach(bullet => {
    lines.push(`• ${bullet}`);
  });

  // Add recommendations
  if (plan.recommendedActions.length > 0) {
    lines.push('');
    lines.push('RECOMMENDED ACTIONS:');
    plan.recommendedActions.forEach((action, index) => {
      const priorityEmoji = action.priority === 'high' ? '⚡' :
                           action.priority === 'medium' ? '→' : '○';
      lines.push(`${index + 1}. ${priorityEmoji} ${action.action}`);
      if (action.reason) {
        lines.push(`   ${action.reason}`);
      }
    });
  }

  lines.push('');
  lines.push('(Basic summary • Set up AI in Settings for personalized insights)');

  return lines.join('\n');
}

export default {
  buildMissionControlContext,
  buildBasicMissionControlPlan,
  formatBasicPlanAsText
};
