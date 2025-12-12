/**
 * REVOPS METRICS ENGINE
 *
 * Pure, reusable functions for calculating RevOps health metrics.
 * Designed for both backend (Netlify functions) and frontend consumption.
 *
 * Features:
 * - Deal follow-up health (stage-aware thresholds)
 * - Retention health (post-won customer cadence)
 * - AR/Invoice health (graceful no-op if no invoice data)
 * - Monthly goal attainment + projection
 * - Unified buildRevOpsMetrics() for dashboards and AI
 *
 * @author StageFlow Engineering
 * @since 2025-12-04
 */

// ============================================================================
// TYPES
// ============================================================================

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface HealthSummary {
  status: HealthStatus;
  label: string;
  description: string;
  count?: number;
  percentage?: number;
}

export interface DealFollowupStatus {
  dealId: string;
  client: string;
  stage: string;
  value: number;
  daysSinceActivity: number;
  maxGapDays: number;
  status: HealthStatus;
  isOverdue: boolean;
}

export interface RetentionStatus {
  dealId: string;
  client: string;
  value: number;
  daysSinceLastTouch: number;
  daysSinceWon: number;
  status: HealthStatus;
  isOverdue: boolean;
}

export interface InvoiceStatus {
  invoiceId: string;
  client: string;
  amount: number;
  daysSinceSent: number;
  daysPastDue: number;
  status: HealthStatus;
}

export interface MonthlyGoalSummary {
  closedThisMonth: number;
  monthlyTarget: number;
  attainmentPct: number;
  projectedPct: number;
  daysElapsed: number;
  totalDays: number;
  status: HealthStatus;
}

export interface RevOpsMetrics {
  generatedAt: string;

  // Follow-up health for active deals
  followupHealth: {
    summary: HealthSummary;
    overdueCount: number;
    totalActiveDeals: number;
    overdueDeals: DealFollowupStatus[];
  };

  // Retention health for won deals
  retentionHealth: {
    summary: HealthSummary;
    overdueCount: number;
    totalRetentionDeals: number;
    overdueDeals: RetentionStatus[];
  };

  // AR health (no-op if no invoices)
  arHealth: {
    available: boolean;
    summary: HealthSummary | null;
    totalOpenAmount: number;
    pastDueAmount: number;
    overdueInvoices: InvoiceStatus[];
  };

  // Monthly goal tracking
  monthlyGoal: MonthlyGoalSummary | null;
}

// ============================================================================
// CONSTANTS - Stage-specific follow-up rules
// ============================================================================

/**
 * Maximum days between touches by stage (business rules from spec)
 * Early stages: 14 days max
 * Proposal/Negotiation: 7 days max
 * Retention: 45 days for first check
 */
export const STAGE_FOLLOWUP_RULES: Record<string, { maxGapDays: number; warningMultiplier: number }> = {
  // Early stages - 14 day max
  lead: { maxGapDays: 14, warningMultiplier: 1.5 },
  lead_captured: { maxGapDays: 14, warningMultiplier: 1.5 },
  new: { maxGapDays: 14, warningMultiplier: 1.5 },
  contacted: { maxGapDays: 14, warningMultiplier: 1.5 },
  discovery: { maxGapDays: 14, warningMultiplier: 1.5 },

  // Active deal stages - 7 day max
  proposal: { maxGapDays: 7, warningMultiplier: 1.5 },
  proposal_sent: { maxGapDays: 7, warningMultiplier: 1.5 },
  negotiation: { maxGapDays: 7, warningMultiplier: 1.5 },
  verbal_commit: { maxGapDays: 7, warningMultiplier: 1.5 },
  contract_sent: { maxGapDays: 7, warningMultiplier: 1.5 },

  // Retention (post-won) - 45 day cadence
  retention: { maxGapDays: 45, warningMultiplier: 2 },
  closed_won: { maxGapDays: 45, warningMultiplier: 2 },

  // Default for unknown stages
  default: { maxGapDays: 14, warningMultiplier: 1.5 }
};

/**
 * Retention cadence thresholds (days since last touch)
 */
export const RETENTION_THRESHOLDS = {
  green: 45,    // Within expected cadence
  yellow: 90,   // 1.5-3 months - needs attention
  red: 90       // > 3 months - at risk
};

/**
 * Invoice/AR thresholds (days past due)
 * Default: 30-day payment terms
 */
export const AR_THRESHOLDS = {
  paymentTermsDays: 30,
  yellowDaysPastDue: 15,
  redDaysPastDue: 15
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days between two dates
 */
export function daysSince(date: Date | string | null | undefined, now: Date = new Date()): number {
  if (!date) return 0;

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;

  const diffMs = now.getTime() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get stage follow-up rules (with fallback to default)
 */
function getStageRules(stage: string | null | undefined): { maxGapDays: number; warningMultiplier: number } {
  if (!stage) return STAGE_FOLLOWUP_RULES.default;
  const normalized = stage.toLowerCase().replace(/-/g, '_');
  return STAGE_FOLLOWUP_RULES[normalized] || STAGE_FOLLOWUP_RULES.default;
}

// ============================================================================
// DEAL FOLLOW-UP HEALTH
// ============================================================================

/**
 * Get follow-up status for a single deal
 */
export function getDealFollowupStatus(deal: any, now: Date = new Date()): DealFollowupStatus {
  const lastActivity = deal.last_activity || deal.updated || deal.created_at || deal.created;
  const daysSinceActivity = daysSince(lastActivity, now);
  const rules = getStageRules(deal.stage);
  const warningGap = Math.round(rules.maxGapDays * rules.warningMultiplier);

  let status: HealthStatus = 'green';
  if (daysSinceActivity > warningGap) {
    status = 'red';
  } else if (daysSinceActivity > rules.maxGapDays) {
    status = 'yellow';
  }

  return {
    dealId: deal.id,
    client: deal.client || 'Unknown',
    stage: deal.stage || 'unknown',
    value: Number(deal.value || 0),
    daysSinceActivity,
    maxGapDays: rules.maxGapDays,
    status,
    isOverdue: daysSinceActivity > rules.maxGapDays
  };
}

/**
 * Summarize follow-up health across all active deals
 */
export function summarizeFollowupHealth(deals: any[], now: Date = new Date()): RevOpsMetrics['followupHealth'] {
  // Filter to active deals only
  const activeDeals = deals.filter(d => d.status === 'active');

  if (activeDeals.length === 0) {
    return {
      summary: {
        status: 'unknown',
        label: 'No active deals',
        description: 'Add deals to track follow-up health'
      },
      overdueCount: 0,
      totalActiveDeals: 0,
      overdueDeals: []
    };
  }

  // Calculate status for each deal
  const statuses = activeDeals.map(d => getDealFollowupStatus(d, now));
  const overdue = statuses.filter(s => s.isOverdue);
  const overdueCount = overdue.length;
  const overduePercentage = Math.round((overdueCount / activeDeals.length) * 100);

  // Determine overall health
  let status: HealthStatus = 'green';
  let label = 'Healthy';
  let description = 'All deals have recent activity';

  if (overduePercentage > 40) {
    status = 'red';
    label = 'Needs Attention';
    description = `${overdueCount} deals overdue for follow-up`;
  } else if (overduePercentage > 20) {
    status = 'yellow';
    label = 'Watch';
    description = `${overdueCount} deals need follow-up soon`;
  }

  return {
    summary: { status, label, description, count: overdueCount, percentage: overduePercentage },
    overdueCount,
    totalActiveDeals: activeDeals.length,
    overdueDeals: overdue.sort((a, b) => b.value - a.value).slice(0, 5) // Top 5 by value
  };
}

// ============================================================================
// RETENTION HEALTH
// ============================================================================

/**
 * Get retention status for a won deal
 */
export function getRetentionStatus(deal: any, now: Date = new Date()): RetentionStatus {
  const wonAt = deal.won_at || deal.closed_at || deal.last_activity;
  const lastTouch = deal.last_retention_touch_at || deal.last_activity || wonAt;

  const daysSinceWon = daysSince(wonAt, now);
  const daysSinceLastTouch = daysSince(lastTouch, now);

  let status: HealthStatus = 'green';
  if (daysSinceLastTouch > RETENTION_THRESHOLDS.red) {
    status = 'red';
  } else if (daysSinceLastTouch > RETENTION_THRESHOLDS.green) {
    status = 'yellow';
  }

  return {
    dealId: deal.id,
    client: deal.client || 'Unknown',
    value: Number(deal.value || 0),
    daysSinceLastTouch,
    daysSinceWon,
    status,
    isOverdue: daysSinceLastTouch > RETENTION_THRESHOLDS.green
  };
}

/**
 * Summarize retention health across won deals
 */
export function summarizeRetentionHealth(deals: any[], now: Date = new Date()): RevOpsMetrics['retentionHealth'] {
  // Filter to won deals (retention pool)
  const wonDeals = deals.filter(d => d.status === 'won');

  if (wonDeals.length === 0) {
    return {
      summary: {
        status: 'unknown',
        label: 'No customers',
        description: 'Close deals to build retention pool'
      },
      overdueCount: 0,
      totalRetentionDeals: 0,
      overdueDeals: []
    };
  }

  // Calculate status for each customer
  const statuses = wonDeals.map(d => getRetentionStatus(d, now));
  const overdue = statuses.filter(s => s.isOverdue);
  const overdueCount = overdue.length;
  const overduePercentage = Math.round((overdueCount / wonDeals.length) * 100);

  // Determine overall health
  let status: HealthStatus = 'green';
  let label = 'Healthy';
  let description = 'Customer check-ins on cadence';

  if (overduePercentage > 40) {
    status = 'red';
    label = 'At Risk';
    description = `${overdueCount} customers need attention`;
  } else if (overduePercentage > 20) {
    status = 'yellow';
    label = 'Watch';
    description = `${overdueCount} customers overdue for check-in`;
  }

  return {
    summary: { status, label, description, count: overdueCount, percentage: overduePercentage },
    overdueCount,
    totalRetentionDeals: wonDeals.length,
    overdueDeals: overdue.sort((a, b) => b.value - a.value).slice(0, 5) // Top 5 by value
  };
}

// ============================================================================
// AR / INVOICE HEALTH
// ============================================================================

/**
 * Get status for a single invoice
 */
export function getInvoiceStatus(invoice: any, paymentTermsDays: number = AR_THRESHOLDS.paymentTermsDays): InvoiceStatus {
  const sentAt = invoice.invoice_sent_at || invoice.sent_at || invoice.created_at;
  const daysSinceSent = daysSince(sentAt);
  const daysPastDue = Math.max(0, daysSinceSent - paymentTermsDays);

  let status: HealthStatus = 'green';
  if (daysPastDue > AR_THRESHOLDS.redDaysPastDue) {
    status = 'red';
  } else if (daysPastDue > 0) {
    status = 'yellow';
  }

  return {
    invoiceId: invoice.id,
    client: invoice.client || 'Unknown',
    amount: Number(invoice.amount || invoice.value || 0),
    daysSinceSent,
    daysPastDue,
    status
  };
}

/**
 * Summarize AR health across open invoices
 * No-ops gracefully if no invoice data is provided
 */
export function summarizeARHealth(invoices: any[] | null | undefined): RevOpsMetrics['arHealth'] {
  // Graceful no-op if no invoice data
  if (!invoices || invoices.length === 0) {
    return {
      available: false,
      summary: null,
      totalOpenAmount: 0,
      pastDueAmount: 0,
      overdueInvoices: []
    };
  }

  // Filter to unpaid invoices
  const openInvoices = invoices.filter(i => !i.paid_at);

  if (openInvoices.length === 0) {
    return {
      available: true,
      summary: {
        status: 'green',
        label: 'All Clear',
        description: 'No open invoices'
      },
      totalOpenAmount: 0,
      pastDueAmount: 0,
      overdueInvoices: []
    };
  }

  const statuses = openInvoices.map(i => getInvoiceStatus(i));
  const totalOpenAmount = statuses.reduce((sum, s) => sum + s.amount, 0);
  const pastDueInvoices = statuses.filter(s => s.daysPastDue > 0);
  const pastDueAmount = pastDueInvoices.reduce((sum, s) => sum + s.amount, 0);
  const pastDuePercentage = totalOpenAmount > 0 ? Math.round((pastDueAmount / totalOpenAmount) * 100) : 0;

  // Determine overall health
  let status: HealthStatus = 'green';
  let label = 'Healthy';
  let description = 'AR on track';

  if (pastDuePercentage > 25) {
    status = 'red';
    label = 'At Risk';
    description = `${pastDuePercentage}% of open AR past due`;
  } else if (pastDuePercentage > 10) {
    status = 'yellow';
    label = 'Watch';
    description = `${pastDuePercentage}% past due`;
  }

  return {
    available: true,
    summary: { status, label, description, percentage: pastDuePercentage },
    totalOpenAmount,
    pastDueAmount,
    overdueInvoices: pastDueInvoices.sort((a, b) => b.amount - a.amount).slice(0, 5)
  };
}

// ============================================================================
// MONTHLY GOAL HEALTH
// ============================================================================

/**
 * Calculate monthly goal attainment and projection
 */
export function summarizeMonthlyGoal(
  closedThisMonth: number,
  monthlyTarget: number,
  now: Date = new Date()
): MonthlyGoalSummary | null {
  if (!monthlyTarget || monthlyTarget <= 0) {
    return null;
  }

  // Calculate days in month and elapsed
  const year = now.getFullYear();
  const month = now.getMonth();
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  const totalDays = endOfMonth.getDate();
  const daysElapsed = now.getDate();

  // Calculate attainment and projection
  const attainmentPct = Math.round((closedThisMonth / monthlyTarget) * 100);
  const projectedRevenue = daysElapsed > 0
    ? (closedThisMonth / daysElapsed) * totalDays
    : closedThisMonth;
  const projectedPct = Math.round((projectedRevenue / monthlyTarget) * 100);

  // Determine status
  let status: HealthStatus = 'green';
  if (projectedPct < 75) {
    status = 'red';
  } else if (projectedPct < 100) {
    status = 'yellow';
  }

  return {
    closedThisMonth,
    monthlyTarget,
    attainmentPct,
    projectedPct,
    daysElapsed,
    totalDays,
    status
  };
}

// ============================================================================
// UNIFIED METRICS BUILDER
// ============================================================================

export interface BuildRevOpsMetricsOptions {
  deals: any[];
  invoices?: any[] | null;
  monthlyTarget?: number;
  closedThisMonth?: number;
  now?: Date;
}

/**
 * Build complete RevOps metrics object
 * Used by both Mission Control fallback and AI context
 */
export function buildRevOpsMetrics(options: BuildRevOpsMetricsOptions): RevOpsMetrics {
  const { deals, invoices, monthlyTarget, now = new Date() } = options;

  // Calculate closed this month from deals if not provided
  let closedThisMonth = options.closedThisMonth;
  if (closedThisMonth === undefined) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    closedThisMonth = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const closedAt = new Date(d.closed_at || d.last_activity || d.updated_at);
        return closedAt >= startOfMonth && closedAt <= now;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);
  }

  return {
    generatedAt: now.toISOString(),
    followupHealth: summarizeFollowupHealth(deals, now),
    retentionHealth: summarizeRetentionHealth(deals, now),
    arHealth: summarizeARHealth(invoices),
    monthlyGoal: summarizeMonthlyGoal(closedThisMonth, monthlyTarget || 0, now)
  };
}

/**
 * Format RevOps metrics as human-readable text bullets
 * For use in Mission Control fallback text response
 */
export function formatRevOpsMetricsAsText(metrics: RevOpsMetrics): string[] {
  const bullets: string[] = [];

  // Follow-up health
  const followup = metrics.followupHealth;
  if (followup.totalActiveDeals > 0) {
    if (followup.overdueCount > 0) {
      bullets.push(`${followup.overdueCount} of ${followup.totalActiveDeals} active deals need follow-up attention`);
    } else {
      bullets.push(`All ${followup.totalActiveDeals} active deals have recent activity`);
    }
  }

  // Retention health
  const retention = metrics.retentionHealth;
  if (retention.totalRetentionDeals > 0) {
    if (retention.overdueCount > 0) {
      bullets.push(`${retention.overdueCount} customers overdue for check-in`);
    } else {
      bullets.push(`Customer retention cadence is healthy`);
    }
  }

  // AR health (if available)
  if (metrics.arHealth.available && metrics.arHealth.summary) {
    if (metrics.arHealth.pastDueAmount > 0) {
      bullets.push(`$${metrics.arHealth.pastDueAmount.toLocaleString()} in past-due invoices`);
    }
  }

  // Monthly goal
  if (metrics.monthlyGoal) {
    const goal = metrics.monthlyGoal;
    bullets.push(`Monthly goal: ${goal.attainmentPct}% achieved, projected ${goal.projectedPct}%`);
  }

  return bullets;
}

export default {
  // Status functions
  getDealFollowupStatus,
  getRetentionStatus,
  getInvoiceStatus,

  // Summary functions
  summarizeFollowupHealth,
  summarizeRetentionHealth,
  summarizeARHealth,
  summarizeMonthlyGoal,

  // Unified builder
  buildRevOpsMetrics,
  formatRevOpsMetricsAsText,

  // Constants
  STAGE_FOLLOWUP_RULES,
  RETENTION_THRESHOLDS,
  AR_THRESHOLDS
};
