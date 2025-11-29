/**
 * Offline Snapshot - Build charts and metrics from cached deals
 *
 * "Works on a plane" - Show useful pipeline data when offline
 *
 * Features:
 * - Compute pipeline distribution from local deals
 * - Calculate win rates and metrics
 * - Build chart data for DealAnalyticsChart
 * - No network calls required
 *
 * @author StageFlow Engineering
 * @date November 25, 2025
 */

import { logger } from './logger';

// Stage configuration for chart colors
const STAGE_COLORS = {
  lead: '#60A5FA',      // Blue
  discovery: '#A78BFA', // Purple
  proposal: '#FBBF24',  // Yellow
  negotiation: '#F97316', // Orange
  closed_won: '#10B981',  // Green
  closed_lost: '#EF4444', // Red
};

const STAGE_LABELS = {
  lead: 'Lead',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Won',
  closed_lost: 'Lost',
};

/**
 * Build an offline snapshot with charts and metrics from cached deals
 *
 * @param {Array} deals - Array of deal objects
 * @param {Object} [options] - Optional configuration
 * @param {Object} [options.targets] - User targets (monthlyTarget, quarterlyTarget, annualTarget)
 * @param {string} [options.userId] - Current user ID for user-specific metrics
 * @returns {Object} Snapshot with chartType, chartData, and metrics
 */
export function buildOfflineSnapshot(deals, options = {}) {
  if (!deals || !Array.isArray(deals)) {
    logger.log('[Offline Snapshot] No deals provided');
    return {
      chartType: 'pipeline_flow',
      chartData: [],
      metrics: {},
    };
  }

  const validDeals = deals.filter(d => d != null && typeof d === 'object');

  // Build pipeline distribution (most useful offline view)
  const chartData = buildPipelineDistribution(validDeals);
  const metrics = calculateMetrics(validDeals, options);

  return {
    chartType: 'pipeline_flow',
    chartData,
    metrics,
    dealCount: validDeals.length,
    snapshotTime: new Date().toISOString(),
  };
}

/**
 * Build pipeline distribution chart data
 *
 * @param {Array} deals - Valid deal objects
 * @returns {Array} Chart data for pipeline_flow chart
 */
function buildPipelineDistribution(deals) {
  // Count deals by stage
  const stageCounts = {};
  const stageValues = {};

  deals.forEach(deal => {
    const stage = deal.stage || 'lead';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    stageValues[stage] = (stageValues[stage] || 0) + (parseFloat(deal.value) || 0);
  });

  // Build chart data array
  const chartData = Object.entries(stageCounts)
    .filter(([stage]) => stage !== 'closed_won' && stage !== 'closed_lost')
    .map(([stage, count]) => ({
      name: STAGE_LABELS[stage] || stage,
      value: count,
      amount: stageValues[stage] || 0,
      fill: STAGE_COLORS[stage] || '#6B7280',
    }))
    .sort((a, b) => {
      // Sort by pipeline order
      const order = ['Lead', 'Discovery', 'Proposal', 'Negotiation'];
      return order.indexOf(a.name) - order.indexOf(b.name);
    });

  return chartData;
}

/**
 * Calculate pipeline metrics from deals
 *
 * @param {Array} deals - Valid deal objects
 * @param {Object} options - Options with targets and userId
 * @returns {Object} Metrics object
 */
function calculateMetrics(deals, options = {}) {
  const { userId } = options;

  // Separate closed deals
  const closedDeals = deals.filter(d =>
    d.status === 'won' || d.status === 'lost' ||
    d.stage === 'closed_won' || d.stage === 'closed_lost'
  );
  const wonDeals = closedDeals.filter(d =>
    d.status === 'won' || d.stage === 'closed_won'
  );
  const lostDeals = closedDeals.filter(d =>
    d.status === 'lost' || d.stage === 'closed_lost'
  );

  // Organization win rate
  const orgWinRate = closedDeals.length > 0
    ? Math.round((wonDeals.length / closedDeals.length) * 100)
    : null;

  // User win rate (if userId provided)
  let userWinRate = null;
  if (userId) {
    const userClosed = closedDeals.filter(d => d.user_id === userId || d.owner_id === userId);
    const userWon = userClosed.filter(d =>
      d.status === 'won' || d.stage === 'closed_won'
    );
    if (userClosed.length > 0) {
      userWinRate = Math.round((userWon.length / userClosed.length) * 100);
    }
  }

  // Average days to close
  // MEDIUM-03 FIX: Use d.created || d.created_at for date field consistency
  let avgDaysToClose = null;
  const wonWithDates = wonDeals.filter(d => (d.created || d.created_at) && d.closed_at);
  if (wonWithDates.length > 0) {
    const totalDays = wonWithDates.reduce((sum, d) => {
      const createdDate = d.created || d.created_at;
      const created = new Date(createdDate);
      // Guard against invalid dates
      if (isNaN(created.getTime())) return sum;
      const closed = new Date(d.closed_at || d.last_activity);
      if (isNaN(closed.getTime())) return sum;
      const days = Math.max(0, Math.floor((closed - created) / (1000 * 60 * 60 * 24)));
      return sum + days;
    }, 0);
    avgDaysToClose = Math.round(totalDays / wonWithDates.length);
  }

  // High value at risk (deals over $10k that haven't been updated in 14+ days)
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const atRiskDeals = deals.filter(d => {
    if (d.status === 'won' || d.status === 'lost') return false;
    if (d.stage === 'closed_won' || d.stage === 'closed_lost') return false;
    const value = parseFloat(d.value) || 0;
    if (value < 10000) return false;
    // MEDIUM-03 FIX: Use d.created || d.created_at for date field consistency
    const lastActivity = d.last_activity ? new Date(d.last_activity) : new Date(d.created || d.created_at);
    if (isNaN(lastActivity.getTime())) return false;
    return lastActivity < fourteenDaysAgo;
  });
  const highValueAtRisk = atRiskDeals.length;

  // Pipeline value
  const activeDeals = deals.filter(d =>
    d.status !== 'won' && d.status !== 'lost' &&
    d.stage !== 'closed_won' && d.stage !== 'closed_lost'
  );
  const pipelineValue = activeDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  // Won this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const wonThisMonth = wonDeals.filter(d => {
    const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
    return closedAt >= startOfMonth;
  });
  const revenueThisMonth = wonThisMonth.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  return {
    orgWinRate,
    userWinRate,
    avgDaysToClose,
    highValueAtRisk: highValueAtRisk > 0 ? highValueAtRisk : null,
    pipelineValue,
    pipelineDealCount: activeDeals.length,
    revenueThisMonth,
    wonThisMonthCount: wonThisMonth.length,
  };
}

/**
 * Build weekly trends chart data from deals
 *
 * @param {Array} deals - Valid deal objects
 * @returns {Array} Chart data for weekly_trends chart
 */
export function buildWeeklyTrends(deals) {
  if (!deals || !Array.isArray(deals)) {
    return [];
  }

  const validDeals = deals.filter(d => d != null && typeof d === 'object');
  const now = new Date();
  const weeks = [];

  // Generate last 8 weeks
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Count deals created this week
    // MEDIUM-03 FIX: Use d.created || d.created_at for date field consistency
    const created = validDeals.filter(d => {
      const createdDate = new Date(d.created || d.created_at);
      if (isNaN(createdDate.getTime())) return false;
      return createdDate >= weekStart && createdDate < weekEnd;
    }).length;

    // Count deals won this week
    const won = validDeals.filter(d => {
      if (d.status !== 'won' && d.stage !== 'closed_won') return false;
      const closedDate = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
      return closedDate >= weekStart && closedDate < weekEnd;
    }).length;

    // Count deals lost this week
    const lost = validDeals.filter(d => {
      if (d.status !== 'lost' && d.stage !== 'closed_lost') return false;
      const closedDate = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
      return closedDate >= weekStart && closedDate < weekEnd;
    }).length;

    weeks.push({
      week: `W${8 - i}`,
      created,
      won,
      lost,
    });
  }

  return weeks;
}

/**
 * Build goal progress chart data
 *
 * @param {Array} deals - Valid deal objects
 * @param {Object} targets - User targets
 * @returns {Array} Chart data for goal_progress chart
 */
export function buildGoalProgress(deals, targets = {}) {
  if (!deals || !Array.isArray(deals)) {
    return [];
  }

  const validDeals = deals.filter(d => d != null && typeof d === 'object');
  const now = new Date();

  // Calculate revenue for different periods
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const wonDeals = validDeals.filter(d =>
    d.status === 'won' || d.stage === 'closed_won'
  );

  const revenueThisMonth = wonDeals
    .filter(d => {
      const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
      return closedAt >= startOfMonth;
    })
    .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  const revenueThisQuarter = wonDeals
    .filter(d => {
      const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
      return closedAt >= startOfQuarter;
    })
    .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  const revenueThisYear = wonDeals
    .filter(d => {
      const closedAt = d.closed_at ? new Date(d.closed_at) : new Date(d.last_activity);
      return closedAt >= startOfYear;
    })
    .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  const chartData = [];

  if (targets.monthlyTarget) {
    chartData.push({
      name: 'Monthly',
      current: revenueThisMonth,
      target: targets.monthlyTarget,
      percentage: Math.min(100, Math.round((revenueThisMonth / targets.monthlyTarget) * 100)),
    });
  }

  if (targets.quarterlyTarget) {
    chartData.push({
      name: 'Quarterly',
      current: revenueThisQuarter,
      target: targets.quarterlyTarget,
      percentage: Math.min(100, Math.round((revenueThisQuarter / targets.quarterlyTarget) * 100)),
    });
  }

  if (targets.annualTarget) {
    chartData.push({
      name: 'Annual',
      current: revenueThisYear,
      target: targets.annualTarget,
      percentage: Math.min(100, Math.round((revenueThisYear / targets.annualTarget) * 100)),
    });
  }

  return chartData;
}

export default {
  buildOfflineSnapshot,
  buildWeeklyTrends,
  buildGoalProgress,
};
