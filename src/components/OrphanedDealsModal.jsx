import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Check, ChevronDown } from 'lucide-react';
import { findOrphanedDeals } from '../utils/dealRecovery';
import { getStatusForStage } from '../config/pipelineTemplates';
// FIX 2025-12-03: Use api-client for proper Authorization header injection
import { api } from '../lib/api-client';

export const OrphanedDealsModal = ({
  isOpen,
  onClose,
  organization,
  currentStages,
  onSuccess
}) => {
  const [orphanedDeals, setOrphanedDeals] = useState([]);
  const [selectedStages, setSelectedStages] = useState({});
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && organization?.id) {
      loadOrphanedDeals();
    }
  }, [isOpen, organization?.id]);

  const loadOrphanedDeals = async () => {
    setLoading(true);
    try {
      const orphaned = await findOrphanedDeals(organization.id, currentStages);
      setOrphanedDeals(orphaned);

      // Initialize with first valid stage for each deal
      const initialStages = {};
      orphaned.forEach(deal => {
        initialStages[deal.id] = currentStages[0]?.id;
      });
      setSelectedStages(initialStages);
    } catch (error) {
      console.error('Error loading orphaned deals:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStageChange = (dealId, stageId) => {
    setSelectedStages(prev => ({
      ...prev,
      [dealId]: stageId
    }));
  };

  // PHASE 14 FIX: Use backend endpoint instead of direct Supabase
  // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
  // RLS policies deny all client-side mutations. Use backend with service role.
  // FIX 2025-12-03: Use api.post for proper Authorization header injection
  const handleRecoverAll = async () => {
    setRecovering(true);
    try {
      // Update each deal via the backend endpoint using api-client
      const updates = orphanedDeals.map(async (deal) => {
        const newStage = selectedStages[deal.id];
        const newStatus = getStatusForStage(newStage);

        // FIX 2025-12-03: Use api.post instead of direct fetch
        // api-client calls ensureValidSession() and injects Authorization header
        const { data: result } = await api.post('update-deal', {
          dealId: deal.id,
          organizationId: organization.id,
          updates: {
            stage: newStage,
            status: newStatus // Set correct status based on stage
          }
        });

        if (!result.success && result.error) {
          throw new Error(result.error || `Failed to update deal ${deal.id}`);
        }

        return result;
      });

      await Promise.all(updates);

      setShowSuccess(true);

      // Wait 1.5 seconds to show success, then close and trigger refresh
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 1500);
    } catch (error) {
      console.error('Error recovering deals:', error);
      alert(`Failed to recover some deals: ${error.message}`);
    } finally {
      setRecovering(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50"
        onClick={!recovering ? onClose : undefined}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-amber-500/20 rounded-xl ring-2 ring-amber-500/10 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Recover Orphaned Deals
                  </h2>
                  <p className="text-sm text-gray-400">
                    {orphanedDeals.length} deal{orphanedDeals.length !== 1 ? 's' : ''} found in invalid stages
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={recovering}
                className="p-2 hover:bg-gray-800/50 rounded-lg transition text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Success Message */}
          {showSuccess ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-full ring-2 ring-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  Deals Recovered!
                </h3>
                <p className="text-gray-300">
                  All {orphanedDeals.length} deals have been moved to their new stages
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {loading ? (
                  <div className="text-center py-8">
                    <div className="inline-block w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
                    <p className="mt-4 text-gray-400">Loading orphaned deals...</p>
                  </div>
                ) : orphanedDeals.length === 0 ? (
                  <div className="text-center py-8">
                    <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                    <p className="text-gray-400">No orphaned deals found</p>
                  </div>
                ) : (
                  orphanedDeals.map((deal, index) => (
                    <div
                      key={deal.id}
                      className="p-4 bg-gray-800/30 rounded-xl border border-gray-700 hover:border-gray-600 transition"
                    >
                      <div className="flex items-start gap-4">
                        {/* Deal Number */}
                        <div className="w-8 h-8 bg-teal-500 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">
                          {index + 1}
                        </div>

                        {/* Deal Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white truncate">
                            {deal.client || 'Untitled Deal'}
                          </h4>
                          <div className="flex items-center gap-4 mt-1 text-sm text-gray-400">
                            <span>${Number(deal.value || 0).toLocaleString()}</span>
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-medium">
                              Invalid: {deal.stage}
                            </span>
                          </div>
                        </div>

                        {/* Stage Selector */}
                        <div className="w-48 flex-shrink-0">
                          <label htmlFor={`stage-select-${deal.id}`} className="block text-xs font-medium text-gray-400 mb-1">
                            Move to stage:
                          </label>
                          <div className="relative">
                            <select
                              id={`stage-select-${deal.id}`}
                              value={selectedStages[deal.id] || ''}
                              onChange={(e) => handleStageChange(deal.id, e.target.value)}
                              disabled={recovering}
                              aria-label={`Select stage for ${deal.client || 'Untitled Deal'}`}
                              className="w-full px-3 py-2 pr-8 bg-gray-800/50 border border-gray-700 rounded-xl text-sm text-white appearance-none cursor-pointer hover:border-teal-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition disabled:opacity-50"
                            >
                              {currentStages.map(stage => (
                                <option key={stage.id} value={stage.id}>
                                  {stage.name}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              {!loading && orphanedDeals.length > 0 && (
                <div className="p-6 border-t border-gray-700">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-400">
                      Each deal will be moved to its selected stage
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={onClose}
                        disabled={recovering}
                        className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-xl transition disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleRecoverAll}
                        disabled={recovering}
                        className="px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold transition disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
                      >
                        {recovering ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Recovering...
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            Recover All {orphanedDeals.length} Deals
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};
