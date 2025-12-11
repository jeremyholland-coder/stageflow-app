import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, TrendingUp, TrendingDown, BarChart3, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';

// Move stages outside component to prevent recreation on every render
const STAGES = [
  { id: 'lead', name: 'Lead', color: '#6B7280' },
  { id: 'quote', name: 'Quote', color: '#3A86FF' },
  { id: 'approval', name: 'Approval', color: '#8B5CF6' },
  { id: 'invoice', name: 'Invoice', color: '#1ABC9C' },
  { id: 'onboarding', name: 'Onboarding', color: '#F59E0B' },
  { id: 'delivery', name: 'Delivery', color: '#EC4899' },
  { id: 'retention', name: 'Retention', color: '#27AE60' },
];

// CRITICAL FIX: StageAnalyticsCard must be defined OUTSIDE StageDurationAnalytics to prevent React error #310
const StageAnalyticsCard = ({ id, name, color, avgDays, minDays, maxDays, totalTransitions }) => {
  const isHealthy = avgDays <= 7;
  const isWarning = avgDays > 7 && avgDays <= 14;
  const isRisk = avgDays > 14;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl hover:shadow-teal-500/20 p-5 transition-all duration-300 hover:scale-[1.02]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full ring-2 ring-teal-500/20"
            style={{ backgroundColor: color }}
          />
          <h4 className="font-semibold text-white">
            {name}
          </h4>
        </div>
        {isRisk && <AlertCircle className="w-4 h-4 text-red-400" />}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">
            {avgDays}
          </span>
          <span className="text-sm text-gray-400">
            days average
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <TrendingDown className="w-3 h-3" />
            <span>Min: {minDays}d</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>Max: {maxDays}d</span>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-700">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {totalTransitions} transitions
            </span>
            <span className={`font-medium ${
              isHealthy ? 'text-emerald-400' :
              isWarning ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {isHealthy ? 'Healthy' : isWarning ? 'Warning' : 'At Risk'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const StageDurationAnalytics = () => {
  const { organization, addNotification } = useApp();
  const [analytics, setAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    const fetchAnalytics = async () => {
      if (!organization) return;
      
      try {
        if (isMounted) {
          setLoading(true);
          setError(null);
        }
        
        const { data, error: fetchError } = await supabase
          .from('deal_stage_history')
          .select('to_stage, days_in_previous_stage')
          .eq('organization_id', organization.id);

        if (fetchError) {
          console.error('Supabase error:', fetchError);
          throw fetchError;
        }

        // Calculate analytics per stage
        const stageStats = STAGES.map(stage => {
          const stageData = (data || []).filter(d => d.to_stage === stage.id);
          const avgDays = stageData.length > 0
            ? stageData.reduce((sum, d) => sum + (d.days_in_previous_stage || 0), 0) / stageData.length
            : 0;
          const minDays = stageData.length > 0
            ? Math.min(...stageData.map(d => d.days_in_previous_stage || 0))
            : 0;
          const maxDays = stageData.length > 0
            ? Math.max(...stageData.map(d => d.days_in_previous_stage || 0))
            : 0;

          return {
            ...stage,
            avgDays: Math.round(avgDays),
            minDays,
            maxDays,
            totalTransitions: stageData.length,
          };
        });

        if (isMounted) {
          setAnalytics(stageStats);
        }
      } catch (error) {
        console.error('Error fetching analytics:', error);
        if (isMounted) {
          setError(error.message || 'Failed to load analytics');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (organization) {
      fetchAnalytics();
    }

    return () => {
      isMounted = false;
    };
  }, [organization]);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-teal-400" />
          </div>
          <h3 className="text-xl font-bold text-white">
            Stage Duration Analytics
          </h3>
          <span className="ml-auto px-3 py-1 bg-teal-500/20 text-teal-400 text-xs font-semibold rounded-full">
            COMPETITIVE ADVANTAGE
          </span>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-800/50 rounded-xl"></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="h-24 bg-gray-800/50 rounded-xl"></div>
            <div className="h-24 bg-gray-800/50 rounded-xl"></div>
            <div className="h-24 bg-gray-800/50 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-red-500/20 ring-2 ring-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-white">
            Stage Duration Analytics
          </h3>
        </div>
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-sm text-red-400">
            Failed to load analytics: {error}
          </p>
          <button
            onClick={fetchAnalytics}
            className="mt-3 text-sm text-teal-400 hover:text-teal-300 font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Memoize summary calculations to prevent unnecessary recalculations
  const summaryStats = useMemo(() => {
    const totalTransitions = analytics.reduce((sum, a) => sum + a.totalTransitions, 0);
    const overallAvg = analytics.length > 0
      ? Math.round(analytics.reduce((sum, a) => sum + a.avgDays, 0) / analytics.length)
      : 0;
    const activeStagesCount = analytics.filter(a => a.totalTransitions > 0).length;

    return { totalTransitions, overallAvg, activeStagesCount };
  }, [analytics]);

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl p-6 mb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-teal-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-white">
              Stage Duration Analytics
            </h3>
            <span className="px-3 py-1 bg-teal-500/20 text-teal-400 text-xs font-semibold rounded-full">
              YOUR COMPETITIVE EDGE
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Track how long deals spend in each stage automatically
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
        <div>
          <p className="text-xs text-gray-400 mb-1">
            Overall Average
          </p>
          <p className="text-2xl font-bold text-white">
            {summaryStats.overallAvg}d
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">
            Total Transitions
          </p>
          <p className="text-2xl font-bold text-white">
            {summaryStats.totalTransitions}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">
            Active Stages
          </p>
          <p className="text-2xl font-bold text-white">
            {summaryStats.activeStagesCount}
          </p>
        </div>
      </div>

      {/* Stage Cards */}
      {summaryStats.activeStagesCount > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {analytics
            .filter(a => a.totalTransitions > 0)
            .map(stage => (
              <StageAnalyticsCard key={stage.id} {...stage} />
            ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-800/50 border border-gray-700 flex items-center justify-center">
            <Clock className="w-8 h-8 text-gray-500" />
          </div>
          <p className="text-gray-300 mb-1">
            No stage transitions yet
          </p>
          <p className="text-sm text-gray-500">
            Move deals between stages to start tracking duration analytics
          </p>
        </div>
      )}

      {/* Footer Insight */}
      <div className="mt-6 p-4 bg-teal-500/10 border border-teal-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 ring-2 ring-teal-500/10 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              💡 Competitive Advantage
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Unlike most CRMs, StageFlow automatically tracks how long deals sit in each stage.
              Use this data to identify bottlenecks and optimize your sales process.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
