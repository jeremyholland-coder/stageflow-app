import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, Loader2, DollarSign, Calendar, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Revenue Targets Dashboard Widget
 * Shows user's personal targets with progress bars and run rates
 */
export const RevenueTargetsWidget = ({ organization, userId }) => {
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState(null);
  const [orgTargets, setOrgTargets] = useState(null);
  const [wonDeals, setWonDeals] = useState([]);

  useEffect(() => {
    if (!organization || !userId) return;
    loadTargetsAndProgress();
  }, [organization, userId]);

  const loadTargetsAndProgress = async () => {
    if (!organization?.id || !userId) return;
    setLoading(true);
    try {
      // Load user's personal targets
      // FIX: Use maybeSingle() instead of single() to prevent 406 errors when no targets exist
      const { data: userTarget, error: targetError } = await supabase
        .from('user_targets')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organization.id)
        .maybeSingle();

      // CRITICAL FIX: Handle table not existing (42P01) or permission errors gracefully
      if (targetError) {
        if (targetError.code === '42P01' || targetError.code === 'PGRST116' || targetError.message?.includes('relation') || targetError.message?.includes('does not exist')) {
          // Table doesn't exist or no data - hide widget silently
          setLoading(false);
          return;
        }
        // Other errors - log but don't break app
        console.warn('Could not load revenue targets:', targetError);
        setLoading(false);
        return;
      }

      // Only load if user has targets and they're visible on dashboard
      if (!userTarget || !userTarget.show_on_dashboard) {
        setLoading(false);
        return;
      }

      setTargets(userTarget);

      // Load organization targets for context
      // FIX: Use maybeSingle() instead of single() to prevent 406 errors when no org targets exist
      const { data: orgTarget, error: orgTargetError } = await supabase
        .from('organization_targets')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (orgTargetError) {
        console.warn('Failed to load organization targets:', orgTargetError);
      }
      setOrgTargets(orgTarget);

      // Load won deals for this user (for progress calculation)
      const { data: deals, error: dealsError } = await supabase
        .from('deals')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
        .eq('status', 'won');

      if (dealsError) throw dealsError;
      setWonDeals(deals || []);
    } catch (error) {
      console.error('Error loading revenue targets:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null; // Don't show loader, just hide widget while loading
  }

  if (!targets || (!targets.annual_target && !targets.quarterly_target && !targets.monthly_target)) {
    return null; // No targets set or not visible, don't show widget
  }

  // Calculate progress for each target period
  const calculateProgress = (targetAmount, period) => {
    if (!targetAmount || targetAmount === 0) return null;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const currentQuarter = Math.floor(currentMonth / 3) + 1;

    // Filter deals based on period
    // DATE-FIELD-01 FIX: Use d.created || d.created_at for deals table compatibility
    let periodDeals = [];
    if (period === 'annual') {
      periodDeals = wonDeals.filter(d => {
        const dealYear = new Date(d.updated_at || d.created || d.created_at).getFullYear();
        return dealYear === currentYear;
      });
    } else if (period === 'quarterly') {
      periodDeals = wonDeals.filter(d => {
        const dealDate = new Date(d.updated_at || d.created || d.created_at);
        const dealYear = dealDate.getFullYear();
        const dealQuarter = Math.floor(dealDate.getMonth() / 3) + 1;
        return dealYear === currentYear && dealQuarter === currentQuarter;
      });
    } else if (period === 'monthly') {
      periodDeals = wonDeals.filter(d => {
        const dealDate = new Date(d.updated_at || d.created || d.created_at);
        const dealYear = dealDate.getFullYear();
        const dealMonth = dealDate.getMonth();
        return dealYear === currentYear && dealMonth === currentMonth;
      });
    }

    const achieved = periodDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
    const percentage = targetAmount > 0 ? (achieved / targetAmount) * 100 : 0;

    // Calculate run rate (extrapolate based on days elapsed)
    let runRate = 0;
    let daysElapsed = 0;
    let totalDays = 0;

    if (period === 'annual') {
      const yearStart = new Date(currentYear, 0, 1);
      daysElapsed = Math.floor((now - yearStart) / (1000 * 60 * 60 * 24));
      const yearEnd = new Date(currentYear, 11, 31);
      totalDays = Math.floor((yearEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1;
    } else if (period === 'quarterly') {
      const quarterStart = new Date(currentYear, (currentQuarter - 1) * 3, 1);
      daysElapsed = Math.floor((now - quarterStart) / (1000 * 60 * 60 * 24));
      const quarterEnd = new Date(currentYear, currentQuarter * 3, 0); // Last day of quarter
      totalDays = Math.floor((quarterEnd - quarterStart) / (1000 * 60 * 60 * 24)) + 1;
    } else if (period === 'monthly') {
      const monthStart = new Date(currentYear, currentMonth, 1);
      daysElapsed = Math.floor((now - monthStart) / (1000 * 60 * 60 * 24));
      const monthEnd = new Date(currentYear, currentMonth + 1, 0); // Last day of month
      totalDays = Math.floor((monthEnd - monthStart) / (1000 * 60 * 60 * 24)) + 1;
    }

    if (daysElapsed > 0) {
      runRate = (achieved / daysElapsed) * totalDays;
    }

    // Status: on track, ahead, or behind
    const expectedPercentage = (daysElapsed / totalDays) * 100;
    let status = 'on-track';
    if (percentage >= expectedPercentage + 10) {
      status = 'ahead';
    } else if (percentage < expectedPercentage - 10) {
      status = 'behind';
    }

    return {
      achieved,
      target: targetAmount,
      percentage: Math.min(percentage, 100), // Cap at 100% for display
      runRate,
      status,
      daysElapsed,
      totalDays
    };
  };

  const formatCurrency = (value) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const renderProgressBar = (progress, label, period) => {
    if (!progress) return null;

    const statusColors = {
      ahead: {
        bar: 'bg-emerald-500',
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        indicator: '↑'
      },
      'on-track': {
        bar: 'bg-teal-500',
        bg: 'bg-teal-500/10',
        text: 'text-teal-400',
        indicator: '→'
      },
      behind: {
        bar: 'bg-red-500',
        bg: 'bg-red-500/10',
        text: 'text-red-400',
        indicator: '↓'
      }
    };

    const colors = statusColors[progress.status];

    return (
      <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-gray-600 transition-all">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-white">{label}</span>
          </div>
          <span className={`text-xs font-semibold ${colors.text}`}>
            {colors.indicator} {progress.percentage.toFixed(0)}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
          <div
            className={`absolute top-0 left-0 h-full ${colors.bar} transition-all duration-500`}
            style={{ width: `${Math.min(progress.percentage, 100)}%` }}
          />
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="text-white font-semibold">{formatCurrency(progress.achieved)}</span>
            <span className="text-gray-400"> / {formatCurrency(progress.target)}</span>
          </div>
          <div className="text-gray-400">
            Run rate: <span className={colors.text}>{formatCurrency(progress.runRate)}</span>
          </div>
        </div>
      </div>
    );
  };

  // Calculate progress for each target period
  const annualProgress = targets.annual_target ? calculateProgress(targets.annual_target, 'annual') : null;
  const quarterlyProgress = targets.quarterly_target ? calculateProgress(targets.quarterly_target, 'quarterly') : null;
  const monthlyProgress = targets.monthly_target ? calculateProgress(targets.monthly_target, 'monthly') : null;

  // If no progress to show (no targets set), don't render
  if (!annualProgress && !quarterlyProgress && !monthlyProgress) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6 mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-amber-500/20 ring-2 ring-amber-500/10 flex items-center justify-center">
          <Target className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Revenue Targets</h2>
          <p className="text-sm text-gray-400">Your personal goals and progress</p>
        </div>
      </div>

      {/* Progress Bars */}
      <div className="space-y-3">
        {annualProgress && renderProgressBar(annualProgress, 'Annual Target', 'annual')}
        {quarterlyProgress && renderProgressBar(quarterlyProgress, 'Quarterly Target', 'quarterly')}
        {monthlyProgress && renderProgressBar(monthlyProgress, 'Monthly Target', 'monthly')}
      </div>

      {/* Context Note */}
      {targets.notes && (
        <div className="mt-4 p-3 bg-gray-800/50 border border-gray-700 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">{targets.notes}</p>
          </div>
        </div>
      )}
    </div>
  );
};
