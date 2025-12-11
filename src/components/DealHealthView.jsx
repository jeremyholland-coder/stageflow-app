import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle, Loader2, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';

export const DealHealthView = ({ healthAlert = null, orphanedDealIds = new Set(), onDismissAlert = () => {}, deals: rawDeals = [] }) => {
  const { setActiveView } = useApp();
  const [loading, setLoading] = useState(false);

  // CRITICAL FIX: Use deals passed from parent instead of fetching our own
  // This ensures orphaned deals (with invalid stages) are included in the analysis
  const deals = useMemo(() => {
    if (!rawDeals || rawDeals.length === 0) return [];

    // Only analyze active deals for health scores
    const activeDeals = rawDeals.filter(d => d.status === 'active');

    // Calculate health scores
    return activeDeals.map(deal => {
      // CRITICAL: Orphaned deals get 0 health score
      const isOrphaned = orphanedDealIds.has(deal.id);

      if (isOrphaned) {
        return {
          ...deal,
          healthScore: 0,
          daysInStage: 0,
          trend: 'down'
        };
      }

      // CRITICAL FIX: Prevent NaN by validating dates
      const updatedDate = deal.updated_at ? new Date(deal.updated_at) : (deal.created_at ? new Date(deal.created_at) : new Date());
      const isValidDate = updatedDate instanceof Date && !isNaN(updatedDate.getTime());
      const daysInStage = isValidDate
        ? Math.floor((new Date() - updatedDate) / (1000 * 60 * 60 * 24))
        : 0;

      // Simple health algorithm
      let healthScore = 100;

      // Reduce score based on days in stage
      if (daysInStage > 30) healthScore -= 40;
      else if (daysInStage > 14) healthScore -= 20;
      else if (daysInStage > 7) healthScore -= 10;

      // Adjust based on deal value
      if (deal.value < 1000) healthScore -= 5;
      else if (deal.value > 10000) healthScore += 5;

      // Adjust based on stage
      if (['invoice', 'onboarding', 'delivery'].includes(deal.stage)) {
        healthScore += 10; // Closer to closing
      }

      healthScore = Math.max(0, Math.min(100, healthScore));

      return {
        ...deal,
        healthScore,
        daysInStage,
        trend: healthScore >= 70 ? 'up' : healthScore >= 40 ? 'neutral' : 'down'
      };
    });
  }, [rawDeals, orphanedDealIds]);

  const getHealthColor = (score) => {
    if (score >= 70) return 'text-[#27AE60]';
    if (score >= 40) return 'text-[#F39C12]';
    return 'text-[#E74C3C]';
  };

  const getHealthBg = (score) => {
    if (score >= 70) return 'bg-[#27AE60]/10';
    if (score >= 40) return 'bg-[#F39C12]/10';
    return 'bg-[#E74C3C]/10';
  };

  const getHealthLabel = (score) => {
    if (score >= 70) return 'Healthy';
    if (score >= 40) return 'At Risk';
    return 'Critical';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  // REMOVED: Orange alert box - orphaned deals now shown inline with orange highlighting in Critical section

  if (deals.length === 0 && !healthAlert) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-[#9CA3AF] mx-auto mb-3" />
        <p className="text-[#61788A] dark:text-[#ABCAE2]">
          No active deals to analyze
        </p>
        <p className="text-sm text-[#9CA3AF] mt-1">
          Create deals to see AI-powered health insights
        </p>
      </div>
    );
  }

  // Sort by health score (worst first)
  const sortedDeals = [...deals].sort((a, b) => a.healthScore - b.healthScore);

  const criticalCount = deals.filter(d => d.healthScore < 40 || orphanedDealIds.has(d.id)).length;
  const orphanedCount = orphanedDealIds.size;

  return (
    <div className="space-y-3">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-[#27AE60]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-[#27AE60]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Healthy</span>
          </div>
          <p className="text-2xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {deals.filter(d => d.healthScore >= 70).length}
          </p>
        </div>
        <div className="p-3 bg-[#F39C12]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-[#F39C12]" />
            <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">At Risk</span>
          </div>
          <p className="text-2xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {deals.filter(d => d.healthScore >= 40 && d.healthScore < 70).length}
          </p>
        </div>

        {/* CRITICAL FIX: Make Critical count clickable with deep link to Settings > Pipeline */}
        <button
          onClick={() => {
            if (orphanedCount > 0) {
              // DEEP LINK: Navigate to Settings, then scroll to Pipeline Health section
              setActiveView('settings');
              // Wait for Settings to render, then trigger tab switch
              setTimeout(() => {
                const pipelineTab = document.querySelector('[data-tab="pipeline"]');
                if (pipelineTab) {
                  pipelineTab.click();
                  // Scroll to Pipeline Health section
                  setTimeout(() => {
                    const healthSection = document.querySelector('[data-section="pipeline-health"]');
                    if (healthSection) {
                      healthSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }, 100);
                }
              }, 100);
            }
          }}
          className={`p-3 bg-[#E74C3C]/10 rounded-lg text-left transition-all ${
            orphanedCount > 0
              ? 'hover:bg-[#E74C3C]/20 hover:shadow-lg cursor-pointer ring-2 ring-[#E74C3C] ring-offset-2'
              : 'cursor-default'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-[#E74C3C]" />
              <span className="text-xs text-[#61788A] dark:text-[#ABCAE2]">Critical</span>
            </div>
            {orphanedCount > 0 && (
              <Settings className="w-3 h-3 text-[#E74C3C]" />
            )}
          </div>
          <p className="text-2xl font-bold text-[#1A1A1A] dark:text-[#E0E0E0]">
            {criticalCount}
          </p>
          {orphanedCount > 0 && (
            <p className="text-[10px] text-[#E74C3C] font-semibold mt-1">
              {orphanedCount} orphaned • Click to fix
            </p>
          )}
        </button>
      </div>

      {/* Deal List */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
        {sortedDeals.slice(0, 10).map(deal => {
          const isOrphaned = orphanedDealIds.has(deal.id);

          return (
          <div
            key={deal.id}
            className={`p-3 rounded-lg hover:shadow-md transition-all ${
              isOrphaned
                ? 'bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)] animate-pulse-slow'
                : 'bg-[#F9FAFB] dark:bg-[#121212]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1">
                <h4 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] text-sm">
                  {deal.client}
                </h4>
                <p className="text-xs text-[#61788A] dark:text-[#ABCAE2]">
                  {deal.stage.charAt(0).toUpperCase() + deal.stage.slice(1)} • ${(Number(deal.value) || 0).toLocaleString()}
                </p>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${getHealthBg(deal.healthScore)}`}>
                {deal.trend === 'up' && <TrendingUp className={`w-3 h-3 ${getHealthColor(deal.healthScore)}`} />}
                {deal.trend === 'down' && <TrendingDown className={`w-3 h-3 ${getHealthColor(deal.healthScore)}`} />}
                {deal.trend === 'neutral' && <AlertCircle className={`w-3 h-3 ${getHealthColor(deal.healthScore)}`} />}
                <span className={`text-xs font-bold ${getHealthColor(deal.healthScore)}`}>
                  {deal.healthScore}%
                </span>
              </div>
            </div>
            
            {/* Health bar */}
            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  deal.healthScore >= 70 ? 'bg-[#27AE60]' :
                  deal.healthScore >= 40 ? 'bg-[#F39C12]' :
                  'bg-[#E74C3C]'
                }`}
                style={{ width: `${deal.healthScore}%` }}
              />
            </div>
            
            <p className="text-xs text-[#61788A] dark:text-[#ABCAE2] mt-2">
              {deal.daysInStage} days in stage • {getHealthLabel(deal.healthScore)}
              {isOrphaned && (
                <span className="ml-2 px-2 py-0.5 bg-orange-600 text-white text-[10px] font-bold rounded-full">
                  NEEDS ATTENTION
                </span>
              )}
            </p>
          </div>
          );
        })}
      </div>

      {deals.length > 10 && (
        <p className="text-xs text-center text-[#9CA3AF] mt-2">
          Showing top 10 deals by health priority
        </p>
      )}
    </div>
  );
};
