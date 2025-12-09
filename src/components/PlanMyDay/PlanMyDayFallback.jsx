/**
 * PlanMyDayFallback.jsx
 *
 * Non-AI fallback dashboard displayed when all AI providers fail.
 * Provides a structured morning overview with:
 * - MTD/QTD/YTD metrics
 * - Top deals by velocity
 * - Stale deals requiring attention
 * - Momentum opportunities
 *
 * Uses StageFlow's glass-mint UI design system.
 *
 * @author StageFlow Engineering
 * @since 2025-12-06
 */

import React, { useMemo } from 'react';
import {
  AlertCircle,
  Target,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  AlertTriangle,
  Zap,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  Settings
} from 'lucide-react';

// Import stagnation thresholds from config
import { STAGNATION_THRESHOLDS } from '../../config/pipelineConfig';
// ENGINE REBUILD Phase 8: Use domain spine for stage display names
import { getStageDisplayName } from '../../domain/stageLabels';

/**
 * Metric card component
 */
const MetricCard = ({ label, value, sublabel, icon: Icon, accent = 'mint', trend = null }) => {
  const accentColors = {
    mint: 'from-[#0CE3B1]/20 to-[#0CE3B1]/5 border-[#0CE3B1]/30 text-[#0CE3B1]',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-400/30 text-amber-400',
    rose: 'from-rose-500/20 to-rose-600/5 border-rose-400/30 text-rose-400',
    sky: 'from-sky-500/20 to-sky-600/5 border-sky-400/30 text-sky-400',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-400/30 text-purple-400'
  };

  return (
    <div className={`p-4 rounded-2xl bg-gradient-to-br border backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 hover:shadow-[0_6px_24px_rgba(0,0,0,0.15)] hover:scale-[1.02] ${accentColors[accent]}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="p-2 rounded-xl bg-white/5 border border-white/10">
          <Icon className="w-4 h-4" />
        </div>
        {trend !== null && (
          <div className={`flex items-center gap-1 text-xs ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <p className="text-xs text-white/50 font-medium tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold text-white tracking-tight">{value}</p>
      {sublabel && (
        <p className="text-[10px] text-white/40 mt-1">{sublabel}</p>
      )}
    </div>
  );
};

/**
 * Deal card component
 */
const DealCard = ({ deal, type = 'velocity' }) => {
  const getTypeStyles = () => {
    switch (type) {
      case 'stale':
        return 'border-l-amber-400/70 bg-gradient-to-r from-amber-500/8 to-transparent';
      case 'at-risk':
        return 'border-l-rose-400/70 bg-gradient-to-r from-rose-500/8 to-transparent';
      case 'velocity':
      default:
        return 'border-l-[#0CE3B1]/70 bg-gradient-to-r from-[#0CE3B1]/8 to-transparent';
    }
  };

  const formatCurrency = (value) => {
    if (!value) return '$0';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  // ENGINE REBUILD Phase 8: Use spine for stage display names
  const formatStage = (stage) => getStageDisplayName(stage);

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border-l-4 transition-all duration-300 hover:bg-white/[0.03] ${getTypeStyles()}`}>
      {/* Icon */}
      <div className="flex-shrink-0">
        {type === 'stale' && <Clock className="w-5 h-5 text-amber-400" />}
        {type === 'at-risk' && <AlertTriangle className="w-5 h-5 text-rose-400" />}
        {type === 'velocity' && <Zap className="w-5 h-5 text-[#0CE3B1]" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{deal.client || 'Unknown Deal'}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-white/50">{formatStage(deal.stage)}</span>
          {deal.daysSinceActivity && (
            <span className="text-xs text-amber-400/70">
              {deal.daysSinceActivity}d since activity
            </span>
          )}
        </div>
      </div>

      {/* Value */}
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-white">{formatCurrency(deal.value)}</p>
      </div>
    </div>
  );
};

/**
 * Action item component
 */
const ActionItem = ({ action, onComplete }) => {
  const priorityColors = {
    high: 'border-l-rose-400/70 bg-gradient-to-r from-rose-500/8 to-transparent',
    medium: 'border-l-amber-400/70 bg-gradient-to-r from-amber-500/8 to-transparent',
    low: 'border-l-sky-400/70 bg-gradient-to-r from-sky-500/8 to-transparent'
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border-l-4 transition-all duration-300 hover:bg-white/[0.03] ${priorityColors[action.priority] || priorityColors.medium}`}>
      <button
        onClick={() => onComplete?.(action)}
        className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 border-white/20 hover:border-[#0CE3B1] hover:bg-[#0CE3B1]/10 transition-all duration-300"
      />
      <div className="flex-1">
        <p className="text-sm text-white leading-relaxed">{action.action}</p>
        <p className="text-xs text-white/40 mt-1">{action.reason}</p>
      </div>
    </div>
  );
};

/**
 * Main PlanMyDayFallback component
 */
export const PlanMyDayFallback = ({
  deals = [],
  onRetry = null,
  onSettings = null,
  onActionComplete = null
}) => {
  // Calculate metrics from deals
  const metrics = useMemo(() => {
    if (!deals || deals.length === 0) {
      return {
        activeDeals: 0,
        totalPipeline: 0,
        mtdWon: 0,
        qtdWon: 0,
        ytdWon: 0,
        staleDeals: [],
        highValueAtRisk: [],
        topVelocity: [],
        recommendedActions: []
      };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const activeDeals = deals.filter(d => d.status === 'active');
    const wonDeals = deals.filter(d => d.status === 'won');

    // Total pipeline value
    const totalPipeline = activeDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Won revenue by period
    const mtdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= monthStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const qtdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= quarterStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const ytdWon = wonDeals
      .filter(d => new Date(d.closed_at || d.updated_at) >= yearStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Find stale deals (exceeding stagnation threshold)
    const staleDeals = activeDeals
      .map(deal => {
        const created = new Date(deal.created_at || deal.created);
        const lastActivity = new Date(deal.last_activity || deal.updated_at || deal.created_at);
        const daysSinceCreated = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        const daysSinceActivity = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));

        const threshold = STAGNATION_THRESHOLDS?.[deal.stage] || STAGNATION_THRESHOLDS?.default || 14;

        if (daysSinceCreated > threshold) {
          return {
            ...deal,
            daysSinceCreated,
            daysSinceActivity
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // High value at risk
    const highValueThreshold = 10000;
    const highValueAtRisk = staleDeals
      .filter(d => d.value >= highValueThreshold)
      .slice(0, 3);

    // Top velocity deals (late stage deals)
    const lateStages = ['negotiation', 'contract_sent', 'verbal_commit'];
    const topVelocity = activeDeals
      .filter(d => lateStages.includes(d.stage))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(deal => ({
        ...deal,
        daysSinceActivity: Math.floor(
          (now - new Date(deal.last_activity || deal.updated_at || deal.created_at)) /
          (1000 * 60 * 60 * 24)
        )
      }));

    // Generate recommended actions
    const recommendedActions = [];

    // High-value at risk
    if (highValueAtRisk.length > 0) {
      const topDeal = highValueAtRisk[0];
      recommendedActions.push({
        priority: 'high',
        action: `Reach out to ${topDeal.client}`,
        reason: `$${(topDeal.value / 1000).toFixed(0)}K deal is stagnating in ${getStageDisplayName(topDeal.stage)}`
      });
    }

    // Late stage deals needing push
    if (topVelocity.length > 0) {
      const closeDeal = topVelocity[0];
      recommendedActions.push({
        priority: 'high',
        action: `Push ${closeDeal.client} to close`,
        reason: `Ready to close - in ${getStageDisplayName(closeDeal.stage)} stage`
      });
    }

    // Deals needing follow-up
    const needsFollowUp = activeDeals.filter(d => {
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created_at);
      return lastActivity < oneWeekAgo;
    });

    if (needsFollowUp.length > 0) {
      recommendedActions.push({
        priority: 'medium',
        action: `Follow up on ${needsFollowUp.length} deal${needsFollowUp.length > 1 ? 's' : ''} with no recent activity`,
        reason: 'No activity in the past week'
      });
    }

    // General pipeline review
    if (activeDeals.length > 5) {
      recommendedActions.push({
        priority: 'low',
        action: 'Review pipeline and update deal stages',
        reason: 'Regular pipeline hygiene keeps forecasts accurate'
      });
    }

    return {
      activeDeals: activeDeals.length,
      totalPipeline,
      mtdWon,
      qtdWon,
      ytdWon,
      staleDeals,
      highValueAtRisk,
      topVelocity,
      recommendedActions: recommendedActions.slice(0, 5)
    };
  }, [deals]);

  // Format currency
  const formatCurrency = (value) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="w-full space-y-6">
      {/* Header with warning */}
      <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/25">
            <AlertCircle className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white mb-1">
              AI is currently unavailable
            </h3>
            <p className="text-sm text-white/60 leading-relaxed">
              Here's your morning overview based on your pipeline data. Connect an AI provider for personalized insights.
            </p>
          </div>
          <div className="flex gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            )}
            {onSettings && (
              <button
                onClick={onSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0CE3B1]/10 hover:bg-[#0CE3B1]/20 border border-[#0CE3B1]/30 text-sm text-[#0CE3B1] transition-all"
              >
                <Settings className="w-4 h-4" />
                Add AI
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Active Deals"
          value={metrics.activeDeals}
          icon={Target}
          accent="mint"
        />
        <MetricCard
          label="Pipeline Value"
          value={formatCurrency(metrics.totalPipeline)}
          icon={DollarSign}
          accent="mint"
        />
        <MetricCard
          label="Month to Date"
          value={formatCurrency(metrics.mtdWon)}
          sublabel="Closed-won revenue"
          icon={TrendingUp}
          accent="sky"
        />
        <MetricCard
          label="Stale Deals"
          value={metrics.staleDeals.length}
          sublabel="Need attention"
          icon={AlertTriangle}
          accent={metrics.staleDeals.length > 0 ? 'amber' : 'mint'}
        />
      </div>

      {/* Two column layout for deals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top velocity deals */}
        {metrics.topVelocity.length > 0 && (
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.06]">
              <Zap className="w-5 h-5 text-[#0CE3B1]" />
              <h4 className="text-sm font-semibold text-white">Top Velocity Deals</h4>
            </div>
            <div className="space-y-2">
              {metrics.topVelocity.map((deal, idx) => (
                <DealCard key={deal.id || idx} deal={deal} type="velocity" />
              ))}
            </div>
          </div>
        )}

        {/* Stale deals */}
        {metrics.staleDeals.length > 0 && (
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.06]">
              <Clock className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-semibold text-white">Needs Attention</h4>
            </div>
            <div className="space-y-2">
              {metrics.staleDeals.map((deal, idx) => (
                <DealCard key={deal.id || idx} deal={deal} type="stale" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recommended actions */}
      {metrics.recommendedActions.length > 0 && (
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.06]">
            <CheckCircle className="w-5 h-5 text-[#0CE3B1]" />
            <h4 className="text-sm font-semibold text-white">Recommended Actions</h4>
          </div>
          <div className="space-y-2">
            {metrics.recommendedActions.map((action, idx) => (
              <ActionItem
                key={idx}
                action={action}
                onComplete={onActionComplete}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {deals.length === 0 && (
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 text-center">
          <Target className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h4 className="text-base font-semibold text-white mb-2">No deals yet</h4>
          <p className="text-sm text-white/50">
            Add some deals to your pipeline to see your morning overview.
          </p>
        </div>
      )}
    </div>
  );
};

export default PlanMyDayFallback;
