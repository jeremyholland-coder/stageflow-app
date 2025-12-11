import React, { useMemo, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, TrendingUp, Zap, Ban, RotateCcw, Trash2, UserCircle, Filter, ChevronDown, Loader2 } from 'lucide-react';
// FIX PHASE 7: Removed hardcoded STAGES import - using dynamic pipelineStages prop
import { useApp } from './AppShell';
import { AssigneeSelector } from './AssigneeSelector';
import { api } from '../lib/api-client';
// PHASE 4: Use unified outcome configuration
import {
  getReasonDisplay,
  createUnifiedOutcome,
  normalizeReasonCategory
} from '../config/outcomeConfig';
// ENGINE REBUILD Phase 8: Use domain spine for stage display names
import { getStageDisplayName } from '../domain/stageLabels';

// PHASE 4: Helper to get reason label from unified config (with legacy support)
const getOutcomeReasonLabel = (deal) => {
  // First check unified field
  if (deal.outcome_reason_category) {
    return getReasonDisplay(deal.outcome_reason_category).label;
  }
  // Fall back to legacy field
  if (deal.disqualified_reason_category) {
    return getReasonDisplay(normalizeReasonCategory(deal.disqualified_reason_category)).label;
  }
  return 'Unknown';
};

/**
 * Compact Pipeline Health Dashboard - Apple HIG Style
 * FIX PHASE 7: Now fully pipeline-aware, supports ANY number of stages
 * FIX: Added Inactive/Disqualified Deals section for pipeline health management
 */
export const PipelineHealthDashboard = ({ deals = [], pipelineStages = [], onUpdateDeal, onDeleteDeal }) => {
  const { setActiveView, organization, addNotification, user } = useApp();

  // State for inactive deals section
  const [showInactiveDeals, setShowInactiveDeals] = useState(true);
  const [reasonFilter, setReasonFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null); // Track which deal is being actioned
  const [confirmDelete, setConfirmDelete] = useState(null); // Track which deal is pending delete confirmation

  // Check if user is admin/owner
  const isAdminOrOwner = useMemo(() => {
    // For now, we'll assume all users can manage deals
    // In production, check organization membership role
    return true;
  }, []);
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

  // Compute disqualified deals with filters
  // PHASE 4: Updated to use unified outcome fields with legacy fallback
  const { disqualifiedDeals, uniqueOwners, uniqueReasons } = useMemo(() => {
    const disqualified = deals.filter(d => d.status === 'disqualified');

    // PHASE 4: Helper to get the reason category (unified or legacy)
    const getReasonCategory = (deal) => {
      return deal.outcome_reason_category ||
             (deal.disqualified_reason_category ? normalizeReasonCategory(deal.disqualified_reason_category) : null);
    };

    // Apply filters
    let filtered = disqualified;
    if (reasonFilter !== 'all') {
      // PHASE 4: Filter on normalized reason category
      filtered = filtered.filter(d => getReasonCategory(d) === reasonFilter);
    }
    if (ownerFilter !== 'all') {
      filtered = filtered.filter(d => d.assigned_to === ownerFilter);
    }

    // Get unique owners for filter dropdown
    const owners = new Map();
    disqualified.forEach(d => {
      if (d.assigned_to) {
        owners.set(d.assigned_to, d.assigned_to_name || d.assigned_to);
      }
    });

    // PHASE 4: Get unique reasons using unified taxonomy
    const reasons = new Set();
    disqualified.forEach(d => {
      const category = getReasonCategory(d);
      if (category) {
        reasons.add(category);
      }
    });

    return {
      disqualifiedDeals: filtered,
      uniqueOwners: Array.from(owners.entries()),
      uniqueReasons: Array.from(reasons)
    };
  }, [deals, reasonFilter, ownerFilter]);

  // Handle reopening a disqualified deal
  const handleReopenDeal = useCallback(async (deal) => {
    if (!onUpdateDeal) return;

    setActionLoading(deal.id);
    try {
      // Reopen to the stage it was in before disqualification, or 'lead' as default
      const targetStage = deal.stage_at_disqualification || 'lead';

      await onUpdateDeal(deal.id, {
        status: 'active',
        stage: targetStage,
        // Clear disqualification fields (legacy)
        disqualified_reason_category: null,
        disqualified_reason_notes: null,
        stage_at_disqualification: null,
        disqualified_at: null,
        disqualified_by: null,
        // PHASE 4: Clear unified outcome fields
        outcome_reason_category: null,
        outcome_notes: null,
        outcome_recorded_at: null,
        outcome_recorded_by: null
      });

      addNotification?.(`Deal "${deal.client}" reopened successfully`, 'success');
    } catch (error) {
      console.error('Error reopening deal:', error);
      addNotification?.(error.message || 'Failed to reopen deal', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [onUpdateDeal, addNotification]);

  // Handle deleting a disqualified deal (hard delete)
  const handleDeleteDeal = useCallback(async (deal) => {
    if (!onDeleteDeal || !isAdminOrOwner) return;

    setActionLoading(deal.id);
    try {
      await onDeleteDeal(deal.id);
      addNotification?.(`Deal "${deal.client}" deleted permanently`, 'success');
      setConfirmDelete(null);
    } catch (error) {
      console.error('Error deleting deal:', error);
      addNotification?.(error.message || 'Failed to delete deal', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [onDeleteDeal, isAdminOrOwner, addNotification]);

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Format currency
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  };

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
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

      {/* Inactive / Disqualified Deals Section */}
      <div className="mt-6 pt-6 border-t border-white/20">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setShowInactiveDeals(!showInactiveDeals)}
            className="flex items-center gap-3 text-left"
          >
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <Ban className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Inactive / Disqualified Deals
                <span className="text-sm font-normal text-white/60">
                  ({deals.filter(d => d.status === 'disqualified').length})
                </span>
              </h3>
              <p className="text-sm text-white/70">Review, reopen, or permanently remove inactive leads</p>
            </div>
          </button>
          <ChevronDown
            className={`w-5 h-5 text-white/60 transition-transform ${showInactiveDeals ? 'rotate-180' : ''}`}
          />
        </div>

        {showInactiveDeals && (
          <>
            {/* Filters */}
            {deals.filter(d => d.status === 'disqualified').length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                {/* Reason Filter */}
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-white/60" />
                  <select
                    value={reasonFilter}
                    onChange={(e) => setReasonFilter(e.target.value)}
                    className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                  >
                    <option value="all">All Reasons</option>
                    {uniqueReasons.map(reason => (
                      <option key={reason} value={reason}>
                        {/* ENGINE REBUILD Phase 8: Use spine instead of undefined constant */}
                        {getReasonDisplay(reason).label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Deals Table */}
            {disqualifiedDeals.length === 0 ? (
              <div className="bg-white/5 rounded-xl p-8 text-center">
                <Ban className="w-10 h-10 text-white/30 mx-auto mb-3" />
                <p className="text-white/70 text-sm">
                  {deals.filter(d => d.status === 'disqualified').length === 0
                    ? 'No disqualified deals yet. Deals you disqualify from the pipeline will appear here.'
                    : 'No deals match the selected filters.'}
                </p>
              </div>
            ) : (
              <div className="bg-white/5 rounded-xl overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-white/5 text-xs font-medium text-white/60 uppercase tracking-wide">
                  <div className="col-span-3">Deal</div>
                  <div className="col-span-2">Amount</div>
                  <div className="col-span-2">Reason</div>
                  <div className="col-span-2">Last Stage</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-white/10">
                  {disqualifiedDeals.map(deal => (
                    <div key={deal.id} className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-white/5 transition">
                      {/* Deal Name & Date */}
                      <div className="col-span-3">
                        <p className="font-medium text-white truncate">{deal.client || 'Unnamed Deal'}</p>
                        <p className="text-xs text-white/50">
                          Disqualified {formatDate(deal.disqualified_at || deal.last_activity)}
                        </p>
                      </div>

                      {/* Amount */}
                      <div className="col-span-2">
                        <p className="font-medium text-white">{formatCurrency(deal.value)}</p>
                      </div>

                      {/* Reason */}
                      <div className="col-span-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-amber-500/20 text-amber-300">
                          {getOutcomeReasonLabel(deal)}
                        </span>
                        {(deal.outcome_notes || deal.disqualified_reason_notes) && (
                          <p className="text-xs text-white/50 mt-1 truncate" title={deal.outcome_notes || deal.disqualified_reason_notes}>
                            {deal.outcome_notes || deal.disqualified_reason_notes}
                          </p>
                        )}
                      </div>

                      {/* Last Stage */}
                      <div className="col-span-2">
                        <p className="text-sm text-white/70">
                          {/* ENGINE REBUILD Phase 8: Use spine for stage display */}
                          {getStageDisplayName(deal.stage_at_disqualification)}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="col-span-3 flex items-center justify-end gap-2">
                        {/* Reopen Button */}
                        <button
                          onClick={() => handleReopenDeal(deal)}
                          disabled={actionLoading === deal.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 transition text-sm font-medium disabled:opacity-50"
                          title="Reopen this deal to active pipeline"
                        >
                          {actionLoading === deal.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                          Reopen
                        </button>

                        {/* Delete Button (Admin only) */}
                        {isAdminOrOwner && (
                          confirmDelete === deal.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteDeal(deal)}
                                disabled={actionLoading === deal.id}
                                className="px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition disabled:opacity-50"
                              >
                                {actionLoading === deal.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  'Confirm'
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-medium hover:bg-white/20 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(deal.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 transition text-sm font-medium"
                              title="Permanently delete this deal"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
