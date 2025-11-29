import React, { useState, useEffect } from 'react';
import { TrendingUp, Clock, DollarSign, Target, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';

export const PatternsView = () => {
  const { organization } = useApp();
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatterns = async () => {
      if (!organization || !organization.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Fetch all deals for pattern analysis
        const { data: deals, error } = await supabase
          .from('deals')
          .select('*')
          .eq('organization_id', organization.id);

        if (error) throw error;

        // Fetch stage history
        const { data: history, error: historyError } = await supabase
          .from('deal_stage_history')
          .select('*')
          .eq('organization_id', organization.id);

        if (historyError) throw historyError;

        // Calculate patterns
        const wonDeals = deals.filter(d => d.status === 'won');
        const lostDeals = deals.filter(d => d.status === 'lost');
        const activeDeals = deals.filter(d => d.status === 'active');

        // Average time to close (won deals)
        // DATE-FIELD-01 FIX: Use d.created || d.created_at for deals table compatibility
        const avgTimeToClose = wonDeals.length > 0
          ? wonDeals.reduce((sum, d) => {
              const created = new Date(d.created || d.created_at);
              const updated = new Date(d.updated_at);
              const days = Math.floor((updated - created) / (1000 * 60 * 60 * 24));
              // Skip invalid dates
              return isNaN(days) ? sum : sum + days;
            }, 0) / wonDeals.length
          : null; // Use null instead of 0 to indicate no data

        // Win rate
        const totalClosed = wonDeals.length + lostDeals.length;
        const winRate = totalClosed > 0 ? (wonDeals.length / totalClosed) * 100 : 0;

        // Average deal value
        const avgDealValue = wonDeals.length > 0
          ? wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0) / wonDeals.length
          : 0;

        // Most common winning stage (where deals convert from)
        const winningStages = wonDeals.map(d => d.stage);
        const stageFrequency = {};
        winningStages.forEach(stage => {
          stageFrequency[stage] = (stageFrequency[stage] || 0) + 1;
        });
        const stageKeys = Object.keys(stageFrequency);
        const mostCommonWinStage = stageKeys.length > 0
          ? stageKeys.reduce((a, b) => stageFrequency[a] > stageFrequency[b] ? a : b)
          : 'N/A';

        // Best performing stage (by time)
        const stagePerformance = {};
        if (history && Array.isArray(history)) {
          history.forEach(h => {
            if (!h || !h.to_stage) return;
            if (!stagePerformance[h.to_stage]) {
              stagePerformance[h.to_stage] = { total: 0, count: 0 };
            }
            stagePerformance[h.to_stage].total += h.days_in_previous_stage || 0;
            stagePerformance[h.to_stage].count += 1;
          });
        }

        const fastestStage = Object.entries(stagePerformance)
          .map(([stage, data]) => ({
            stage,
            avgDays: data.count > 0 ? data.total / data.count : 0
          }))
          .sort((a, b) => a.avgDays - b.avgDays)[0]?.stage || 'N/A';

        // Predictions for active deals (only if we have avgTimeToClose data)
        // DATE-FIELD-01 FIX: Use d.created || d.created_at for deals table compatibility
        const predictedCloses = avgTimeToClose !== null && !isNaN(avgTimeToClose)
          ? activeDeals.filter(d => {
              const daysActive = Math.floor(
                (new Date() - new Date(d.created || d.created_at)) / (1000 * 60 * 60 * 24)
              );
              const daysRemaining = avgTimeToClose - daysActive;
              return daysRemaining <= 14 && daysRemaining >= 0;
            }).length
          : 0;

        setPatterns({
          avgTimeToClose: avgTimeToClose !== null && !isNaN(avgTimeToClose) ? Math.round(avgTimeToClose) : null,
          winRate: !isNaN(winRate) ? Math.round(winRate) : 0,
          avgDealValue: !isNaN(avgDealValue) ? Math.round(avgDealValue) : 0,
          mostCommonWinStage,
          fastestStage,
          predictedCloses,
          totalWon: wonDeals.length,
          totalLost: lostDeals.length,
          totalActive: activeDeals.length
        });
      } catch (error) {
        console.error('Error fetching patterns:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPatterns();
  }, [organization]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (!patterns) {
    return (
      <div className="text-center py-12">
        <TrendingUp className="w-12 h-12 text-[#9CA3AF] mx-auto mb-3" />
        <p className="text-[#61788A] dark:text-[#ABCAE2]">
          Unable to load patterns
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-[#1ABC9C]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Avg Close Time</span>
          </div>
          <p className="text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {patterns.avgTimeToClose !== null ? patterns.avgTimeToClose : '—'}
          </p>
          <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-1">
            {patterns.avgTimeToClose !== null ? 'days' : 'No won deals yet'}
          </p>
        </div>

        <div className="p-4 bg-[#3A86FF]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-[#3A86FF]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Win Rate</span>
          </div>
          <p className="text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {patterns.winRate}%
          </p>
          <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-1">
            {patterns.totalWon} won / {patterns.totalLost} lost
          </p>
        </div>

        <div className="p-4 bg-[#8B5CF6]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-[#8B5CF6]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Avg Deal Value</span>
          </div>
          <p className="text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            ${patterns.avgDealValue.toLocaleString()}
          </p>
          <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-1">won deals</p>
        </div>

        <div className="p-4 bg-[#F59E0B]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-[#F59E0B]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Closing Soon</span>
          </div>
          <p className="text-3xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {patterns.predictedCloses}
          </p>
          <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-1">next 2 weeks</p>
        </div>
      </div>

      {/* Insights */}
      <div className="space-y-3">
        <div className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[#27AE60]/10 rounded">
              <TrendingUp className="w-4 h-4 text-[#27AE60]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-1">
                Most Common Win Stage
              </p>
              <p className="text-xs text-[#61788A] dark:text-[#ABCAE2]">
                Deals most often close from the <span className="font-semibold text-[#1ABC9C]">{patterns.mostCommonWinStage}</span> stage. 
                Focus your efforts here for maximum conversion.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-[#F9FAFB] dark:bg-[#121212] rounded-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[#3A86FF]/10 rounded">
              <Clock className="w-4 h-4 text-[#3A86FF]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-1">
                Fastest Moving Stage
              </p>
              <p className="text-xs text-[#61788A] dark:text-[#ABCAE2]">
                Deals move through <span className="font-semibold text-[#3A86FF]">{patterns.fastestStage}</span> stage 
                the fastest. Consider using this as a momentum stage.
              </p>
            </div>
          </div>
        </div>

        {patterns.totalActive > 0 && patterns.predictedCloses !== null && !isNaN(patterns.predictedCloses) && (() => {
          // Color coding based on forecast health
          // Red: 0 deals closing (critical)
          // Orange: < 20% of active deals closing (warning)
          // Green: >= 20% of active deals closing (healthy)
          const forecastPercentage = patterns.totalActive > 0 ? (patterns.predictedCloses / patterns.totalActive) * 100 : 0;
          const forecastHealth = patterns.predictedCloses === 0
            ? 'critical'
            : forecastPercentage < 20
            ? 'warning'
            : 'healthy';

          const healthColors = {
            critical: {
              bg: 'bg-red-500/5',
              border: 'border-red-500/50',
              iconBg: 'bg-red-500/10',
              icon: 'text-red-500',
              number: 'text-red-500'
            },
            warning: {
              bg: 'bg-orange-500/5',
              border: 'border-orange-500/30',
              iconBg: 'bg-orange-500/10',
              icon: 'text-orange-500',
              number: 'text-orange-500'
            },
            healthy: {
              bg: 'bg-[#1ABC9C]/5',
              border: 'border-[#1ABC9C]/20',
              iconBg: 'bg-[#1ABC9C]/10',
              icon: 'text-[#1ABC9C]',
              number: 'text-[#1ABC9C]'
            }
          };

          const colors = healthColors[forecastHealth];

          return (
            <div className={`p-4 ${colors.bg} border-2 ${colors.border} rounded-lg`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 ${colors.iconBg} rounded`}>
                  <Target className={`w-4 h-4 ${colors.icon}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-1">
                    Pipeline Forecast
                  </p>
                  <p className="text-xs text-[#61788A] dark:text-[#ABCAE2]">
                    Based on historical patterns, <span className={`font-semibold ${colors.number}`}>{patterns.predictedCloses}</span> of
                    your <span className="font-semibold">{patterns.totalActive}</span> active deals are likely to close in the next 2 weeks.
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
