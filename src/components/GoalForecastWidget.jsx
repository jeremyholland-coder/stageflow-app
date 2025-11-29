import React, { useState, useEffect, useMemo } from 'react';
import { Target, TrendingUp, TrendingDown, Sparkles, DollarSign, Calendar, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * AI-Powered Goal Forecast Widget
 * Shows probability of hitting revenue goals based on current run rate
 * "98% chance of hitting your $8,400 goal this month" - StageFlow AI forecasting
 */
export const GoalForecastWidget = ({ organization, userId, deals = [] }) => {
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState(null);

  const loadTargets = async () => {
    if (!organization?.id || !userId) return;
    setLoading(true);
    try {
      // FIX: Use maybeSingle() instead of single() to prevent 406 errors when no targets exist
      const { data: userTarget, error: targetError } = await supabase
        .from('user_targets')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organization.id)
        .maybeSingle();

      // CRITICAL FIX: Handle missing table gracefully
      if (targetError) {
        if (targetError.code === '42P01' || targetError.code === 'PGRST116' || targetError.message?.includes('relation') || targetError.message?.includes('does not exist')) {
          setLoading(false);
          return;
        }
        console.warn('Could not load targets:', targetError);
        setLoading(false);
        return;
      }

      // Only show if user has targets and they're visible
      if (!userTarget || !userTarget.show_on_dashboard) {
        setLoading(false);
        return;
      }

      setTargets(userTarget);
    } catch (error) {
      console.error('Error loading targets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organization || !userId) return;
    loadTargets();
  }, [organization, userId]);

  if (loading || !targets) return null;

  // Calculate AI-powered forecast for monthly target (primary metric)
  // MEMOIZED: Only recalculates when dependencies change (performance optimization)
  const forecast = useMemo(() => {
    const calculateMonthlyForecast = () => {
    if (!targets.monthly_target || targets.monthly_target === 0) return null;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Need at least 2 days of data for meaningful forecast
    const currentDay = now.getDate();
    if (currentDay < 2) return null;

    // Get month boundaries
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0);
    const totalDays = monthEnd.getDate();
    const daysElapsed = now.getDate();
    const daysRemaining = totalDays - daysElapsed;

    // Filter won deals for this month (CRITICAL: Filter by userId for accurate individual forecasts)
    // DATE-FIELD-01 FIX: Use d.created || d.created_at for deals table compatibility
    const wonThisMonth = deals.filter(d => {
      if (d.status !== 'won' || d.user_id !== userId) return false;
      const dealDate = new Date(d.updated_at || d.created || d.created_at);
      return dealDate.getFullYear() === currentYear && dealDate.getMonth() === currentMonth;
    });

    const achieved = wonThisMonth.reduce((sum, deal) => sum + Number(deal.value || 0), 0);

    // Calculate run rate (AI-powered projection)
    const dailyRate = daysElapsed > 0 ? achieved / daysElapsed : 0;
    const projectedTotal = dailyRate * totalDays;
    const projectedRemaining = dailyRate * daysRemaining;

    // AI Confidence Calculation (probability of hitting goal)
    // Factors:
    // 1. How close is projected total to goal?
    // 2. How many deals in pipeline could push us over?
    // 3. Historical velocity (how fast deals close)
    let probability = 0;

    if (projectedTotal >= targets.monthly_target) {
      // Already on track to exceed goal
      const overage = ((projectedTotal - targets.monthly_target) / targets.monthly_target) * 100;
      probability = Math.min(95, 85 + overage); // 85-95% confidence if on track
    } else {
      // Need to catch up - calculate based on gap
      const gap = targets.monthly_target - projectedTotal;
      const gapPercentage = (gap / targets.monthly_target) * 100;

      // Count pipeline deals that could close this month
      const activePipelineValue = deals
        .filter(d => d.status === 'active' && d.user_id === userId)
        .reduce((sum, deal) => sum + Number(deal.value || 0), 0);

      const potentialTotal = projectedTotal + (activePipelineValue * 0.3); // 30% conversion assumption

      if (potentialTotal >= targets.monthly_target) {
        // Gap is closeable with current pipeline
        probability = Math.max(50, 85 - gapPercentage);
      } else {
        // Unlikely to hit goal
        probability = Math.max(10, 50 - gapPercentage);
      }
    }

    // Status classification
    let status = 'on-track';
    let trend = 'stable';
    if (probability >= 80) {
      status = 'excellent';
      trend = 'up';
    } else if (probability >= 60) {
      status = 'on-track';
      trend = 'stable';
    } else if (probability >= 40) {
      status = 'warning';
      trend = 'down';
    } else {
      status = 'critical';
      trend = 'down';
    }

    return {
      target: targets.monthly_target,
      achieved,
      projectedTotal,
      projectedRemaining,
      probability: Math.round(probability),
      status,
      trend,
      daysElapsed,
      daysRemaining,
      totalDays,
      gap: Math.max(0, targets.monthly_target - achieved)
    };
    };

    return calculateMonthlyForecast();
  }, [targets, deals, userId]); // Only recalculate when these dependencies change

  if (!forecast) return null;

  const formatCurrency = (value) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Status-based styling
  const statusConfig = {
    excellent: {
      gradient: 'from-emerald-500/20 to-green-500/20',
      border: 'border-emerald-500/30',
      icon: ArrowUpRight,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-500/10',
      textColor: 'text-emerald-700 dark:text-emerald-300',
      probabilityBg: 'bg-emerald-500',
      message: 'Crushing it! 🔥'
    },
    'on-track': {
      gradient: 'from-[#1ABC9C]/20 to-teal-500/20',
      border: 'border-[#1ABC9C]/30',
      icon: TrendingUp,
      iconColor: 'text-[#1ABC9C]',
      iconBg: 'bg-[#1ABC9C]/10',
      textColor: 'text-[#1ABC9C]',
      probabilityBg: 'bg-[#1ABC9C]',
      message: 'Looking good 👍'
    },
    warning: {
      gradient: 'from-amber-500/20 to-orange-500/20',
      border: 'border-amber-500/30',
      icon: Minus,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-500/10',
      textColor: 'text-amber-700 dark:text-amber-300',
      probabilityBg: 'bg-amber-500',
      message: 'Need to push harder 💪'
    },
    critical: {
      gradient: 'from-rose-500/20 to-red-500/20',
      border: 'border-rose-500/30',
      icon: ArrowDownRight,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-500/10',
      textColor: 'text-rose-700 dark:text-rose-300',
      probabilityBg: 'bg-rose-500',
      message: 'Time to hustle! ⚡'
    }
  };

  const config = statusConfig[forecast.status];
  const TrendIcon = config.icon;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${config.iconBg} ring-2 ring-teal-500/10 flex items-center justify-center`}>
            <Target className={`w-6 h-6 ${config.iconColor}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Monthly Goal Forecast</h3>
            <p className="text-xs text-gray-400">AI-powered prediction</p>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-3 py-1 ${config.iconBg} rounded-full`}>
          <Sparkles className={`w-4 h-4 ${config.iconColor}`} />
          <span className={`text-xs font-bold ${config.textColor}`}>AI POWERED</span>
        </div>
      </div>

      {/* Main Probability Display */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${config.probabilityBg}`}>
              <TrendIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className={`text-4xl font-black ${config.textColor}`}>
                  {forecast.probability}%
                </span>
                <span className="text-sm text-gray-400">confidence</span>
              </div>
              <p className={`text-sm font-semibold ${config.textColor} mt-1`}>
                {config.message}
              </p>
            </div>
          </div>
        </div>

        <div className="text-sm text-white">
          <span className="font-semibold">{forecast.probability}% chance</span> of hitting your{' '}
          <span className="font-bold text-teal-400">{formatCurrency(forecast.target)}</span> goal this month
          based on current run rate.
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Achieved */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-400 font-medium">Won This Month</span>
          </div>
          <p className="text-xl font-bold text-white">
            {formatCurrency(forecast.achieved)}
          </p>
        </div>

        {/* Projected */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            <span className="text-xs text-gray-400 font-medium">Projected Total</span>
          </div>
          <p className="text-xl font-bold text-white">
            {formatCurrency(forecast.projectedTotal)}
          </p>
        </div>

        {/* Gap */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-400 font-medium">Gap to Goal</span>
          </div>
          <p className="text-xl font-bold text-white">
            {formatCurrency(forecast.gap)}
          </p>
        </div>

        {/* Days Remaining */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-400 font-medium">Days Left</span>
          </div>
          <p className="text-xl font-bold text-white">
            {forecast.daysRemaining}
          </p>
        </div>
      </div>

      {/* AI Insight */}
      <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-white">
            {forecast.status === 'excellent' && (
              <span>
                You're <span className="font-bold text-emerald-400">ahead of pace</span>!
                Keep this momentum to finish strong.
              </span>
            )}
            {forecast.status === 'on-track' && (
              <span>
                On track to hit your goal. Projected finish:{' '}
                <span className="font-bold text-teal-400">{formatCurrency(forecast.projectedTotal)}</span>
              </span>
            )}
            {forecast.status === 'warning' && (
              <span>
                Need <span className="font-bold text-amber-400">{formatCurrency(forecast.gap)}</span> more
                to hit your goal. Focus on closing high-value deals this week.
              </span>
            )}
            {forecast.status === 'critical' && (
              <span>
                <span className="font-bold text-red-400">Gap is {formatCurrency(forecast.gap)}</span>.
                Time to accelerate your pipeline and close deals aggressively.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
