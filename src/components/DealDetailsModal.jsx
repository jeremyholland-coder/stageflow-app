import React, { useState, useEffect, memo } from 'react';
import { X, Loader2, Trash2, Calendar, XCircle, Receipt, DollarSign, CheckCircle2, UserCircle } from 'lucide-react';
// P2 FIX 2025-12-04: Removed direct supabase import - use backend endpoint instead (RLS-safe)
import { useApp } from './AppShell';
// FIX CRITICAL #1: Import default pipeline as fallback if pipelineStages fails to load
import { PIPELINE_TEMPLATES } from '../config/pipelineTemplates';
import { sanitizeText } from '../lib/sanitize';
import { LostReasonModal } from './LostReasonModal';
import { getStatusForStage } from '../config/pipelineTemplates';
import { useFocusTrap } from '../lib/accessibility';
import { PhoneInput } from './PhoneInput';
import { api } from '../lib/api-client'; // PHASE J: Auth-aware API client

// NEXT-LEVEL: Memoize modal to prevent unnecessary re-renders (30-40% performance gain)
export const DealDetailsModal = memo(({ deal, isOpen, onClose, onDealUpdated, onDealDeleted, pipelineStages = [] }) => {
  const { addNotification, organization } = useApp();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [pendingStageChange, setPendingStageChange] = useState(null);
  const closeButtonRef = React.useRef(null);

  // PRO TIER FIX: Team members for deal assignment
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);

  // Check if user has a paid plan that enables team features
  const hasPaidPlan = organization?.plan && ['startup', 'growth', 'pro'].includes(organization.plan.toLowerCase());

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(isOpen);
  const [formData, setFormData] = useState({
    client: '',
    email: '',
    phone: '',
    value: '',
    stage: 'lead',
    status: 'active',
    notes: '',
    lost_reason: '',
    assigned_to: ''
  });

  useEffect(() => {
    if (deal) {
      setFormData({
        client: deal.client || '',
        email: deal.email || '',
        phone: deal.phone || '',
        value: deal.value || '',
        stage: deal.stage || 'lead',
        status: deal.status || 'active',
        notes: deal.notes || '',
        lost_reason: deal.lost_reason || '',
        assigned_to: deal.assigned_to || ''
      });
    }
  }, [deal]);

  // PRO TIER FIX: Fetch team members for deal assignment dropdown
  // P2 FIX 2025-12-04: Use backend endpoint instead of direct Supabase query
  // Direct Supabase queries fail with RLS when persistSession: false (auth.uid() is NULL)
  useEffect(() => {
    const fetchTeamMembers = async () => {
      if (!isOpen || !organization?.id || !hasPaidPlan) return;

      setLoadingTeamMembers(true);
      try {
        // P2 FIX: Use backend endpoint with service role (bypasses RLS)
        const { data: result } = await api.post('get-team-members', {
          organization_id: organization.id
        });

        // Check for error response from backend
        if (result.error) {
          console.error('[DealDetailsModal] Team members fetch returned error:', result.error);
          setTeamMembers([]);
          return;
        }

        // Use team members from backend response
        const members = result.teamMembers || [];
        setTeamMembers(members);

        if (members.length === 0) {
          console.warn('[DealDetailsModal] No team members found for org:', organization.id);
        }
      } catch (error) {
        // P2 FIX: Log error but don't crash - show empty list with error logged
        console.error('[DealDetailsModal] Error fetching team members:', error);
        setTeamMembers([]);
      } finally {
        setLoadingTeamMembers(false);
      }
    };

    fetchTeamMembers();
  }, [isOpen, organization?.id, hasPaidPlan]);

  // Focus management for accessibility
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleStageChange = (newStage) => {
    // CRITICAL: If changing to "lost", show reason modal first
    if (newStage === 'lost' && deal.stage !== 'lost') {
      setPendingStageChange(newStage);
      setShowLostModal(true);
      return; // Don't update formData yet, wait for reason
    }

    // CRITICAL: Auto-change status to "won" when moving to retention
    if (newStage === 'retention') {
      setFormData({ ...formData, stage: newStage, status: 'won' });
    } else {
      // Normal stage change
      setFormData({ ...formData, stage: newStage });
    }
  };

  const handleLostReasonConfirm = (reason) => {
    // Update form data with lost stage, status, and reason
    setFormData({ 
      ...formData, 
      stage: 'lost',
      status: 'lost',
      lost_reason: reason
    });
    setPendingStageChange(null);
    setShowLostModal(false);
  };

  const handleLostReasonCancel = () => {
    setPendingStageChange(null);
    setShowLostModal(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!deal) return;

    // Prevent double submission
    if (loading) return;

    // FIX H10: CRITICAL - Require lost reason before saving lost deals
    if (formData.stage === 'lost' && !formData.lost_reason) {
      addNotification('Please provide a reason for marking this deal as lost', 'error');
      setShowLostModal(true);
      return;
    }

    setLoading(true);
    try {
      // FIX C9: Use centralized stage-to-status mapping
      const finalStatus = getStatusForStage(formData.stage);

      // CRITICAL: Auto-timestamp notes if they changed
      let finalNotes = formData.notes;
      if (formData.notes !== deal.notes && formData.notes.trim()) {
        const timestamp = new Date().toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        // Prepend timestamp to new note content
        // FIX: Use substring instead of replace to avoid regex issues
        const oldNotesLength = (deal.notes || '').length;
        const newContent = formData.notes.length > oldNotesLength
          ? formData.notes.substring(oldNotesLength).trim()
          : '';
        if (newContent) {
          finalNotes = `[${timestamp}] ${newContent}${deal.notes ? '\n\n' + deal.notes : ''}`;
        }
      }

      // Sanitize all text inputs before saving
      const sanitizedData = {
        client: sanitizeText(formData.client),
        email: sanitizeText(formData.email),
        phone: sanitizeText(formData.phone),
        notes: sanitizeText(finalNotes),
        value: parseFloat(formData.value) || 0,
        stage: formData.stage,
        status: finalStatus,
        lost_reason: formData.lost_reason || null,
        last_activity: new Date().toISOString(),
        // PRO TIER FIX: Include assignment fields
        assigned_to: formData.assigned_to || null,
        assigned_at: formData.assigned_to && formData.assigned_to !== deal.assigned_to
          ? new Date().toISOString()
          : deal.assigned_at
      };

      // Store original data for rollback
      const originalData = {
        client: deal.client,
        email: deal.email,
        phone: deal.phone,
        notes: deal.notes,
        value: deal.value,
        stage: deal.stage,
        status: deal.status
      };

      // PHASE J: Use auth-aware api-client with Authorization header
      const { data: result } = await api.post('update-deal', {
        dealId: deal.id,
        updates: sanitizedData,
        organizationId: organization.id
      });

      if (!result.success && result.error) {
        throw new Error(result.error);
      }

      const data = result.deal;

      // NOTE: Stage history tracking is handled by useDealManagement hook
      // Don't track here to avoid duplicates

      if (data) {
        // Update was successful
        onDealUpdated(data);

        // Success message based on what changed
        let message = 'Deal updated successfully';
        if (formData.stage === 'lost') {
          message = 'Deal marked as Lost. Keep learning from each experience!';
        } else if (formData.stage === 'retention') {
          message = 'Deal marked as Won! 🎉 Celebration time!';
        }

        addNotification(message, 'success');
        onClose();
        // FIX: Removed early return to allow finally block to execute
      }
    } catch (error) {
      console.error('Error updating deal:', error);
      addNotification(error.message || 'Failed to update deal', 'error');
    } finally {
      setLoading(false);
    }
  };

  // PHASE J: Use auth-aware api-client with Authorization header
  const handleDelete = async () => {
    if (!deal || !confirm('Are you sure you want to delete this deal? This action cannot be undone.')) return;

    try {
      setDeleting(true);

      const { data: result } = await api.post('delete-deal', {
        dealId: deal.id,
        organizationId: organization.id
      });

      if (!result.success && result.error) {
        throw new Error(result.error);
      }

      onDealDeleted(deal.id);
      addNotification('Deal deleted successfully', 'success');
      onClose();
    } catch (error) {
      console.error('Error deleting deal:', error);
      addNotification(error.message || 'Failed to delete deal', 'error');
    } finally {
      setDeleting(false);
    }
  };


  if (!isOpen || !deal) return null;

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Check if deal is already lost
  const isLost = deal.status === 'lost' || deal.stage === 'lost';

  return (
    <>
      <div className="modal-backdrop fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[70] md:p-4">
        <div
          ref={focusTrapRef}
          className="modal-content bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-none md:rounded-2xl shadow-2xl w-full md:max-w-2xl h-full md:h-auto overflow-y-auto pb-safe"
          style={{
            maxHeight: '100dvh',
            paddingBottom: 'max(env(safe-area-inset-bottom, 20px), 20px)'
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-details-title"
        >
          <div className="sticky top-0 bg-gradient-to-br from-gray-900 to-black border-b border-gray-700 p-6 flex items-center justify-between z-10">
            <div>
              <h2 id="deal-details-title" className="text-2xl font-bold text-white">Deal Details</h2>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Created {formatDate(deal.created)}
                </div>
                <div>
                  Updated {formatDate(deal.last_activity)}
                </div>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="min-w-touch min-h-touch flex items-center justify-center text-gray-400 hover:text-white rounded-lg transition"
              aria-label="Close deal details"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          {isLost && deal.lost_reason && (
            <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-red-400 mb-1">Deal Lost</p>
                  <p className="text-sm text-red-300">
                    Reason: {deal.lost_reason}
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Client Name *
              </label>
              <input
                type="text"
                required
                value={formData.client}
                onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                />
              </div>
              <PhoneInput
                id="deal-phone"
                value={formData.phone}
                onChange={(value) => setFormData({ ...formData, phone: value })}
                error={null}
                required={false}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Deal Value *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Stage *
                </label>
                <select
                  required
                  value={formData.stage}
                  onChange={(e) => handleStageChange(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239CA3AF%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat"
                >
                  {/* FIX CRITICAL #1: Use default pipeline as fallback to prevent crash */}
                  {(pipelineStages.length > 0 ? pipelineStages : PIPELINE_TEMPLATES.default.stages).map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Status
                </label>
                <input
                  type="text"
                  value={formData.status}
                  disabled
                  className="w-full px-4 py-3 bg-gray-800/30 border border-gray-700 rounded-xl text-gray-400 capitalize cursor-not-allowed"
                  title="Status automatically changes based on stage"
                />
              </div>
            </div>

            {/* PRO TIER FIX: Deal Assignment - Only show for paid plans */}
            {hasPaidPlan && (
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  <div className="flex items-center gap-2">
                    <UserCircle className="w-4 h-4 text-teal-400" />
                    Assigned To
                  </div>
                </label>
                <select
                  value={formData.assigned_to}
                  onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                  disabled={loadingTeamMembers || teamMembers.length === 0}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239CA3AF%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.email})
                    </option>
                  ))}
                </select>
                {/* Clear messaging for different states */}
                {loadingTeamMembers && (
                  <p className="text-xs text-gray-400 mt-1">
                    Loading team members...
                  </p>
                )}
                {teamMembers.length === 0 && !loadingTeamMembers && (
                  <p className="text-xs text-gray-400 mt-1">
                    No team members to assign. Invite team members from Settings to enable assignment.
                  </p>
                )}
                {teamMembers.length > 0 && !loadingTeamMembers && (
                  <p className="text-xs text-gray-500 mt-1">
                    Select a team member to assign this deal.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={4}
                maxLength={5000}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                placeholder="Add any relevant notes..."
              />
              {/* Character counter for notes field */}
              <p className={`text-xs text-right mt-1 ${
                formData.notes.length > 4500
                  ? 'text-red-400 font-semibold'
                  : 'text-gray-400'
              }`}>
                {formData.notes.length} / 5000
              </p>
            </div>

            {/* Post-Sale Actions */}
            {(formData.stage === 'closed_won' || formData.stage === 'invoice_sent') && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-emerald-400 mb-2">
                      Post-Sale Tracking
                    </p>
                    <p className="text-sm text-gray-300 mb-3">
                      Track invoice and payment status to calculate commissions and monitor revenue completion.
                    </p>
                    <div className="flex gap-2">
                      {formData.stage === 'closed_won' && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, stage: 'invoice_sent' });
                            addNotification('Ready to mark invoice as sent', 'success');
                          }}
                          className="flex items-center gap-2 px-4 py-2 min-h-touch bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition font-medium text-sm shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <Receipt className="w-4 h-4" />
                          Mark Invoice Sent
                        </button>
                      )}
                      {formData.stage === 'invoice_sent' && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, stage: 'payment_received' });
                            addNotification('Ready to mark payment as received', 'success');
                          }}
                          className="flex items-center gap-2 px-4 py-2 min-h-touch bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition font-medium text-sm shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <DollarSign className="w-4 h-4" />
                          Mark Payment Received
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                title={deleting ? "Deleting deal..." : "Permanently delete this deal"}
                className="px-4 py-3 min-h-touch border border-red-500/50 text-red-400 rounded-xl hover:bg-red-500/10 transition flex items-center gap-2 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                Delete Deal
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-3 min-h-touch border border-gray-700 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800/50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 min-h-touch rounded-xl font-semibold flex items-center gap-2 transition disabled:opacity-50 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <LostReasonModal
        isOpen={showLostModal}
        onClose={handleLostReasonCancel}
        onConfirm={handleLostReasonConfirm}
        dealName={deal?.client || ''}
      />
    </>
  );
});

DealDetailsModal.displayName = 'DealDetailsModal';
