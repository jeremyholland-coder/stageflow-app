import React from 'react';
import { TrendingUp, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

/**
 * REVENUE AGENT: Revenue Coach Strip
 *
 * A compact, Apple-inspired strip that displays AI-generated revenue insights.
 * This component surfaces the Revenue Coach interpretation even when the user
 * hasn't typed anything in Mission Control.
 *
 * Design:
 * - Glass-style card with subtle gradient
 * - Color-coded status indicator (green/amber/red)
 * - Brief summary + top action
 * - Non-intrusive but visible
 *
 * @param {Object} props
 * @param {Object} props.projection - Revenue projection data
 * @param {Object} props.coach - AI coach interpretation
 * @param {boolean} props.loading - Loading state
 * @param {string} props.error - Error message (optional)
 * @param {Function} props.onRefresh - Refresh callback
 * @param {Date} props.lastUpdated - Last update timestamp
 */
export const RevenueCoachStrip = ({
  projection,
  coach,
  loading = false,
  error = null,
  onRefresh,
  lastUpdated,
}) => {
  // Determine status color based on data
  const getStatusConfig = () => {
    if (!projection) {
      return {
        color: 'neutral',
        bgClass: 'from-white/[0.04] to-white/[0.02] border-white/[0.08]',
        iconClass: 'text-white/50',
        Icon: TrendingUp,
      };
    }

    const { pace_month = null, risk_flags = [] } = projection || {};
    const coachRiskLevel = coach?.risk_level;

    // Determine overall status
    if (coachRiskLevel === 'low' || (pace_month && pace_month >= 0.9 && risk_flags.length === 0)) {
      return {
        color: 'green',
        bgClass: 'from-emerald-500/[0.08] to-emerald-600/[0.03] border-emerald-500/20',
        iconClass: 'text-emerald-400',
        Icon: CheckCircle,
      };
    }

    if (coachRiskLevel === 'high' || (pace_month && pace_month < 0.7) || risk_flags.length >= 3) {
      return {
        color: 'red',
        bgClass: 'from-rose-500/[0.08] to-rose-600/[0.03] border-rose-500/20',
        iconClass: 'text-rose-400',
        Icon: AlertTriangle,
      };
    }

    // Medium risk / at-risk
    return {
      color: 'amber',
      bgClass: 'from-amber-500/[0.08] to-amber-600/[0.03] border-amber-500/20',
      iconClass: 'text-amber-400',
      Icon: AlertTriangle,
    };
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.Icon;

  // Format time since last update
  const getTimeAgo = () => {
    if (!lastUpdated) return null;
    const diff = Date.now() - lastUpdated.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Loading state
  if (loading && !projection) {
    return (
      <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.02] border border-white/[0.08] backdrop-blur-md animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-white/[0.06] rounded w-3/4" />
            <div className="h-2 bg-white/[0.04] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  // No data state - don't render
  if (!projection && !loading) {
    return null;
  }

  // Error state with data - show warning but still show data
  const hasError = error && !loading;

  // Build summary text
  const getSummaryText = () => {
    if (coach?.summary) {
      return coach.summary;
    }

    // Fallback: Generate summary from projection
    if (!projection) return null;

    const { month_pct_to_goal = null, pace_month = null, risk_flags = [] } = projection || {};

    if (month_pct_to_goal === null) {
      return 'Set revenue goals to unlock AI-powered coaching insights.';
    }

    const pctText = month_pct_to_goal !== null ? `${Math.round(month_pct_to_goal)}%` : 'N/A';
    const paceStatus = pace_month >= 1 ? 'ahead of pace' : pace_month >= 0.9 ? 'on track' : pace_month >= 0.7 ? 'slightly behind' : 'behind pace';

    if (risk_flags.length === 0) {
      return `You're on track to hit ${pctText} of your monthly goal. Strong position - keep the momentum going.`;
    }

    const riskText = risk_flags.length === 1 ? 'One area needs attention' : `${risk_flags.length} areas need attention`;
    return `Currently ${paceStatus} at ${pctText} of goal. ${riskText}.`;
  };

  // Build top action
  const getTopAction = () => {
    if (coach?.top_actions?.length > 0) {
      return coach.top_actions[0];
    }

    if (!projection?.risk_flags) return null;

    // Fallback: Suggest action based on risk flags
    const flags = projection.risk_flags;
    if (flags.includes('lead_drought')) return 'Focus on lead generation';
    if (flags.includes('stagnant_pipeline')) return 'Follow up on inactive deals';
    if (flags.includes('off_pace_month')) return 'Close pending proposals';
    if (flags.includes('high_value_at_risk')) return 'Prioritize high-value opportunities';

    return 'Review your pipeline priorities';
  };

  const summaryText = getSummaryText();
  const topAction = getTopAction();

  // Don't render if we have nothing to show
  if (!summaryText) return null;

  return (
    <div className={`mb-4 p-4 rounded-xl bg-gradient-to-r ${statusConfig.bgClass} border backdrop-blur-md transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)]`}>
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center ${statusConfig.iconClass}`}>
          <StatusIcon className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Summary */}
          <p className="text-sm text-white/90 leading-relaxed">
            {summaryText}
          </p>

          {/* Top action + timestamp */}
          <div className="flex items-center gap-3 mt-2">
            {topAction && (
              <span className="text-xs font-medium text-[#0CE3B1] bg-[#0CE3B1]/10 px-2 py-1 rounded-md">
                {topAction}
              </span>
            )}
            {lastUpdated && (
              <span className="text-[10px] text-white/40 flex items-center gap-1">
                Updated {getTimeAgo()}
              </span>
            )}
          </div>
        </div>

        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex-shrink-0 p-2 rounded-lg hover:bg-white/[0.06] transition-colors disabled:opacity-40"
            title="Refresh insights"
          >
            <RefreshCw className={`w-4 h-4 text-white/50 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Error warning (subtle) */}
      {hasError && (
        <div className="mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-amber-400/70">
          {error}
        </div>
      )}
    </div>
  );
};

export default RevenueCoachStrip;
