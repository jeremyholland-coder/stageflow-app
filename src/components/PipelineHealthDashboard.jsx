import React, { useMemo } from 'react';
import { CheckCircle, AlertCircle, TrendingUp, Zap } from 'lucide-react';
// FIX PHASE 7: Removed hardcoded STAGES import - using dynamic pipelineStages prop
import { useApp } from './AppShell';

/**
 * Compact Pipeline Health Dashboard - Apple HIG Style
 * FIX PHASE 7: Now fully pipeline-aware, supports ANY number of stages
 */
export const PipelineHealthDashboard = ({ deals = [], pipelineStages = [] }) => {
  const { setActiveView } = useApp();
  const { stageMetrics, summary } = useMemo(() => {
    const now = new Date();
    const activeDeals = deals.filter(d => d.status === 'active');

    // FIX PHASE 7: Use dynamic pipelineStages instead of hardcoded STAGES
    const metrics = pipelineStages.map(stage => {
      const stageDeals = activeDeals.filter(d => d.stage === stage.id);
      const count = stageDeals.length;
      
      if (count === 0) {
        return {
          stage: stage.name,
          color: stage.color,
          count: 0,
          avgDays: 0,
          health: 'neutral',
          value: 0
        };
      }
      
      const totalDays = stageDeals.reduce((sum, deal) => {
        const created = new Date(deal.created || deal.created_at);
        return sum + Math.floor((now - created) / (1000 * 60 * 60 * 24));
      }, 0);
      
      const avgDays = Math.floor(totalDays / count);
      const value = stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);

      // FIX PHASE 7: Dynamic health thresholds based on stage position
      // Early stages (first 25%): 14 day threshold
      // Mid stages (25-75%): 30 day threshold
      // Late stages (final 25%): 60 day threshold
      let health = 'healthy';
      const stageIndex = pipelineStages.findIndex(s => s.id === stage.id);
      const progressPercentage = pipelineStages.length > 0
        ? (stageIndex / pipelineStages.length) * 100
        : 0;

      if (progressPercentage < 25 && avgDays > 14) health = 'warning';
      else if (progressPercentage >= 25 && progressPercentage < 75 && avgDays > 30) health = 'warning';
      else if (progressPercentage >= 75 && avgDays > 60) health = 'warning';

      return { stage: stage.name, color: stage.color, count, avgDays, health, value };
    });
    
    const totalActive = metrics.reduce((sum, m) => sum + m.count, 0);
    const healthyCount = metrics.filter(m => m.health === 'healthy' && m.count > 0).length;
    const avgDuration = totalActive > 0 
      ? Math.floor(metrics.reduce((sum, m) => sum + (m.avgDays * m.count), 0) / totalActive)
      : 0;
    
    return {
      stageMetrics: metrics,
      summary: { totalActive, healthyCount, avgDuration }
    };
  }, [deals, pipelineStages]); // FIX PHASE 7: Added pipelineStages dependency
  
  const handleAIConnect = () => {
    const url = new URL(window.location);
    url.searchParams.set('tab', 'ai-providers');
    window.history.pushState({}, '', url);
    setActiveView('integrations');
  };
  
  return (
    <div className="bg-gradient-to-br from-[#118d6d] to-[#108465] rounded-xl p-6 text-white mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-white/20 rounded-lg">
          <TrendingUp className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Stage Duration Analytics</h2>
          <p className="text-white/90 text-sm">Track pipeline health automatically</p>
        </div>
      </div>
      
      {/* Summary - Horizontal */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/10 rounded-lg p-4">
          <p className="text-white/80 text-xs mb-1">Overall Average</p>
          <p className="text-3xl font-bold">{summary.avgDuration}d</p>
        </div>
        <div className="bg-white/10 rounded-lg p-4">
          <p className="text-white/80 text-xs mb-1">Active Deals</p>
          <p className="text-3xl font-bold">{summary.totalActive}</p>
        </div>
        <div className="bg-white/10 rounded-lg p-4">
          <p className="text-white/80 text-xs mb-1">Healthy Stages</p>
          <p className="text-3xl font-bold">{summary.healthyCount}</p>
        </div>
      </div>
      
      {/* Stage Grid - Compact */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stageMetrics.map((stage) => (
          <div
            key={stage.stage}
            className="bg-white/10 rounded-lg p-3 hover:bg-white/15 transition"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                <p className="text-sm font-semibold truncate">{stage.stage}</p>
              </div>
              {stage.count > 0 && (
                stage.health === 'healthy' ? (
                  <CheckCircle className="w-4 h-4 text-[#27AE60]" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#F39C12]" />
                )
              )}
            </div>
            <p className="text-2xl font-bold mb-1">{stage.count > 0 ? `${stage.avgDays}d` : '—'}</p>
            <p className="text-xs text-white/70">
              {stage.count} {stage.count === 1 ? 'deal' : 'deals'}
            </p>
          </div>
        ))}
      </div>
      
      {/* AI Upgrade Footer */}
      <div className="border-t border-white/20 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm text-white/90 mb-1">
              <strong>Unlock AI-Powered Insights:</strong> Get real-time deal health scoring, stage predictions, and smart recommendations.
            </p>
          </div>
          <button
            onClick={handleAIConnect}
            className="bg-white text-[#118d6d] px-4 py-2 rounded-lg font-semibold flex items-center gap-2 hover:bg-gray-50 transition flex-shrink-0 ml-4"
          >
            <Zap className="w-4 h-4" />
            Connect AI
          </button>
        </div>
      </div>
    </div>
  );
};
