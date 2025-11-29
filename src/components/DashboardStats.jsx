import React, { memo, useMemo } from 'react';
import { DollarSign, Target, TrendingUp as TrendingUpIcon, TrendingDown as TrendingDownIcon, XCircle, Minus, Zap } from 'lucide-react';
import { buildUserPerformanceProfiles, calculateDealConfidence } from '../utils/aiConfidence';
import { LEAD_STAGES } from '../config/pipelineConfig';

const kpiCardClass = 'bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl hover:shadow-teal-500/20 p-6 transition-all duration-300 cursor-pointer transform hover:scale-[1.02]';

// Enhanced StatCard with trend indicators
const StatCard = memo(({ 
  icon: Icon, 
  label, 
  value, 
  subValue, 
  extraInfo, 
  colorClass = 'text-[#1ABC9C]',
  trend = null, // 'up', 'down', or 'neutral'
  trendValue = null // percentage or number
}) => {
  const getTrendColor = () => {
    if (trend === 'up') return 'text-emerald-400';
    if (trend === 'down') return 'text-red-400';
    return 'text-gray-400';
  };

  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUpIcon className="w-4 h-4" />;
    if (trend === 'down') return <TrendingDownIcon className="w-4 h-4" />;
    return <Minus className="w-4 h-4" />;
  };

  return (
    <div className={kpiCardClass}>
      <div className="flex items-center justify-between mb-4">
        <div className="w-14 h-14 relative">
          <div className="absolute inset-0 rounded-xl bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110">
            <Icon className="w-7 h-7 text-teal-400" strokeWidth={2.5} />
          </div>
        </div>
        {trend && trendValue !== null && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full bg-opacity-10 ${getTrendColor()} animate-fadeIn`}>
            {getTrendIcon()}
            <span className={`text-xs font-bold ${getTrendColor()}`}>
              {typeof trendValue === 'number' ? `${trendValue > 0 ? '+' : ''}${trendValue.toFixed(1)}%` : trendValue}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-400">
          {label}
        </p>
        <p className="text-4xl font-bold text-white leading-none transition-all duration-300">
          {value}
        </p>
        {subValue && (
          <p className="text-sm text-gray-500 mt-2">
            {subValue}
          </p>
        )}
        {extraInfo && (
          <p className="text-xs text-teal-400 mt-1 font-medium">
            {extraInfo}
          </p>
        )}
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';

export const DashboardStats = memo(({ deals = [], currentUser = null }) => {
  // Memoize expensive calculations
  const stats = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Active Pipeline = deals in middle stages
    const activePipeline = deals.filter(d =>
      d.status === 'active' &&
      d.stage !== 'lead' &&
      d.stage !== 'retention' &&
      d.stage !== 'lost'
    );

    // Leads = all lead-type stages from centralized config
    // CRITICAL FIX: Use LEAD_STAGES constant for single source of truth
    const leads = deals.filter(d => LEAD_STAGES.includes(d.stage));

    // Won = status 'won' or stage 'retention'
    const wonDeals = deals.filter(d => d.status === 'won' || d.stage === 'retention');

    // Lost = status 'lost' or stage 'lost'
    const lostDeals = deals.filter(d => d.status === 'lost' || d.stage === 'lost');
    
    // Calculate totals
    const activePipelineTotal = activePipeline.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const leadsTotal = leads.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const wonTotal = wonDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const lostTotal = lostDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    
    // Calculate historical win rate
    const totalClosed = wonDeals.length + lostDeals.length;
    const historicalWinRate = totalClosed > 0
      ? (wonDeals.length / totalClosed)
      : 0;

    const wonRatePercent = (historicalWinRate * 100).toFixed(1);

    // Calculate lost rate
    const lostRate = totalClosed > 0
      ? ((lostDeals.length / totalClosed) * 100).toFixed(1)
      : 0;

    // Calculate EXPECTED CLOSE
    const expectedClose = Math.round(activePipelineTotal * historicalWinRate);

    // AI-POWERED CLOSING FORECAST - Use centralized confidence calculation
    // CRITICAL FIX: Use same logic as KanbanBoard for data consistency
    const { userPerformance, globalWinRate } = buildUserPerformanceProfiles(deals);

    // Define late-stage deals that should ALWAYS be considered "closing soon"
    const LATE_STAGES = new Set([
      'negotiation', 'approval', 'term_sheet_presented',
      'contract', 'contract_sent', 'contract_signed',
      'proposal_sent', 'invoice', 'invoice_sent',
      'payment', 'payment_received'
    ]);

    // AI-POWERED FORECAST: Calculate "Closing Soon" (next 14 days)
    const closingSoonDeals = activePipeline.map(deal => {
      // Use centralized confidence calculation for consistency
      const confidence = calculateDealConfidence(deal, userPerformance, globalWinRate);

      // Deal is likely to close soon if:
      // 1. Confidence >= 60% OR
      // 2. In a late stage (negotiation, approval, contract, etc.)
      const isInLateStage = LATE_STAGES.has(deal.stage);
      const isLikelyToCloseIn14Days = confidence >= 60 || isInLateStage;

      return {
        deal,
        confidence,
        userId: deal.user_id || deal.assigned_to || 'unassigned',
        isLikelyToCloseSoon: isLikelyToCloseIn14Days
      };
    });

    // Filter deals likely to close in next 2 weeks (60%+ confidence OR in late stages)
    const dealsClosingSoon = closingSoonDeals.filter(d => d.isLikelyToCloseSoon);
    const closingSoonTotal = dealsClosingSoon.reduce((sum, d) => {
      // Weight by confidence
      return sum + (Number(d.deal.value || 0) * (d.confidence / 100));
    }, 0);
    const closingSoonCount = dealsClosingSoon.length;

    // Calculate average confidence/probability for "Closing Soon" deals
    const avgClosingSoonConfidence = closingSoonCount > 0
      ? Math.round(dealsClosingSoon.reduce((sum, d) => sum + d.confidence, 0) / closingSoonCount)
      : 0;
    
    // Calculate average ages
    const avgDealAge = activePipeline.length > 0
      ? Math.floor(activePipeline.reduce((sum, deal) => {
          const created = new Date(deal.created || deal.created_at);
          const daysDiff = Math.floor((now - created) / (1000 * 60 * 60 * 24));
          return sum + daysDiff;
        }, 0) / activePipeline.length)
      : 0;
    
    const avgLeadAge = leads.length > 0
      ? Math.floor(leads.reduce((sum, deal) => {
          const created = new Date(deal.created || deal.created_at);
          const daysDiff = Math.floor((now - created) / (1000 * 60 * 60 * 24));
          return sum + daysDiff;
        }, 0) / leads.length)
      : 0;
    
    // THIS MONTH calculations
    const wonThisMonth = wonDeals.filter(d => {
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= startOfMonth;
    });
    
    const lostThisMonth = lostDeals.filter(d => {
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= startOfMonth;
    });
    
    const wonThisMonthTotal = wonThisMonth.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const lostThisMonthTotal = lostThisMonth.reduce((sum, d) => sum + Number(d.value || 0), 0);
    
    // LAST MONTH calculations for trend
    const wonLastMonth = wonDeals.filter(d => {
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= startOfLastMonth && lastActivity <= endOfLastMonth;
    });
    
    const lostLastMonth = lostDeals.filter(d => {
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= startOfLastMonth && lastActivity <= endOfLastMonth;
    });
    
    const wonLastMonthTotal = wonLastMonth.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const lostLastMonthTotal = lostLastMonth.reduce((sum, d) => sum + Number(d.value || 0), 0);
    
    // Calculate trends
    const wonTrend = wonLastMonthTotal > 0 
      ? ((wonThisMonthTotal - wonLastMonthTotal) / wonLastMonthTotal) * 100
      : wonThisMonthTotal > 0 ? 100 : 0;
    
    const lostTrend = lostLastMonthTotal > 0
      ? ((lostThisMonthTotal - lostLastMonthTotal) / lostLastMonthTotal) * 100
      : lostThisMonthTotal > 0 ? 100 : 0;
    
    // User performance
    let userWonThisMonth = 0;
    let userWonCount = 0;
    if (currentUser) {
      const userWonDeals = wonThisMonth.filter(d => d.user_id === currentUser.id);
      userWonThisMonth = userWonDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
      userWonCount = userWonDeals.length;
    }
    
    const userPercentage = wonThisMonthTotal > 0
      ? ((userWonThisMonth / wonThisMonthTotal) * 100).toFixed(0)
      : 0;
    
    return {
      activePipelineTotal,
      activePipelineCount: activePipeline.length,
      avgDealAge,
      expectedClose,
      historicalWinRate,
      wonRatePercent,
      leadsTotal,
      leadsCount: leads.length,
      avgLeadAge,
      wonTotal,
      wonCount: wonDeals.length,
      wonThisMonthTotal,
      wonThisMonthCount: wonThisMonth.length,
      wonTrend,
      userWonThisMonth,
      userWonCount,
      userPercentage,
      lostTotal,
      lostCount: lostDeals.length,
      lostRate,
      lostThisMonthTotal,
      lostThisMonthCount: lostThisMonth.length,
      lostTrend,
      closingSoonTotal,
      closingSoonCount,
      avgClosingSoonConfidence
    };
  }, [deals, currentUser]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
      <StatCard
        icon={Target}
        label="Leads"
        value={`$${stats.leadsTotal.toLocaleString()}`}
        subValue={`${stats.leadsCount} leads • Avg age: ${stats.avgLeadAge}d`}
        colorClass="text-[#3A86FF]"
        trend={stats.leadsCount > 0 ? 'neutral' : null}
      />

      <StatCard
        icon={DollarSign}
        label="Active Pipeline"
        value={`$${stats.activePipelineTotal.toLocaleString()}`}
        subValue={`${stats.activePipelineCount} deals • Avg age: ${stats.avgDealAge}d`}
        extraInfo={stats.historicalWinRate > 0 ? `Expected close: $${stats.expectedClose.toLocaleString()} (${stats.wonRatePercent}%)` : null}
        colorClass="text-[#1ABC9C]"
        trend={stats.activePipelineCount > 0 ? 'neutral' : null}
      />

      <StatCard
        icon={Zap}
        label="Closing Soon"
        value={`$${Math.round(stats.closingSoonTotal).toLocaleString()}`}
        subValue={`${stats.closingSoonCount} ${stats.closingSoonCount === 1 ? 'deal' : 'deals'} • Next 14 days`}
        extraInfo={stats.closingSoonCount > 0 ? `Avg confidence: ${stats.avgClosingSoonConfidence}%` : 'AI-powered forecast'}
        colorClass="text-[#F39C12]"
        trend={stats.closingSoonCount > 0 ? 'up' : null}
      />

      <StatCard
        icon={TrendingUpIcon}
        label="Won/Retention"
        value={`$${stats.wonThisMonthTotal.toLocaleString()}`}
        subValue={`${stats.wonThisMonthCount} deals • ${stats.wonRatePercent}% win rate`}
        extraInfo={currentUser && stats.userWonThisMonth > 0 ? `You: $${stats.userWonThisMonth.toLocaleString()} (${stats.userPercentage}%)` : null}
        colorClass="text-[#27AE60]"
        trend={stats.wonTrend > 0 ? 'up' : stats.wonTrend < 0 ? 'down' : 'neutral'}
        trendValue={stats.wonTrend}
      />

      <StatCard
        icon={XCircle}
        label="Lost This Month"
        value={`$${stats.lostThisMonthTotal.toLocaleString()}`}
        subValue={`${stats.lostThisMonthCount} deals • ${stats.lostRate}% lost rate`}
        colorClass="text-[#E74C3C]"
        trend={stats.lostTrend < 0 ? 'up' : stats.lostTrend > 0 ? 'down' : 'neutral'}
        trendValue={Math.abs(stats.lostTrend)}
      />
    </div>
  );
});

DashboardStats.displayName = 'DashboardStats';
