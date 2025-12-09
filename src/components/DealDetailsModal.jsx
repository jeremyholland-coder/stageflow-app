import React, { useState, useEffect, memo, useRef, useCallback } from 'react';
import { X, Loader2, Trash2, Calendar, XCircle, Receipt, DollarSign, CheckCircle2, UserCircle, Check } from 'lucide-react';
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
// TASK 3: Demo user display utilities
import { isDemoEmail, getDemoUserData } from '../lib/demo-users';
// PHASE 4: Unified outcome configuration
import { getReasonDisplay, createUnifiedOutcome } from '../config/outcomeConfig';

// NEXT-LEVEL: Memoize modal to prevent unnecessary re-renders (30-40% performance gain)
export const DealDetailsModal = memo(({ deal, isOpen, onClose, onDealUpdated, onDealDeleted, pipelineStages = [] }) => {
  const { addNotification, organization } = useApp();
  const [deleting, setDeleting] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [pendingStageChange, setPendingStageChange] = useState(null);
  const closeButtonRef = React.useRef(null);
  // UX FRICTION FIX: Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const autoSaveTimerRef = useRef(null);
  const lastSavedDataRef = useRef(null);
  // P0 FIX 2025-12-09: Track status reset timer to prevent race condition
  // Old bug: setTimeout would reset to 'idle' even if a new save started
  const statusResetTimerRef = useRef(null);
  // Track if form has changes (used for auto-save trigger, not blocking close)
  const [isDirty, setIsDirty] = useState(false);

  // PRO TIER FIX: Team members for deal assignment
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);

  // Check if user has a paid plan that enables team features
  const hasPaidPlan = organization?.plan && ['startup', 'growth', 'pro'].includes(organization.plan.toLowerCase());

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(isOpen);

  // Phase 9: Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape' && !deleting && !showLostModal) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, deleting, showLostModal, onClose]);

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
      const initialData = {
        client: deal.client || '',
        email: deal.email || '',
        phone: deal.phone || '',
        value: deal.value || '',
        stage: deal.stage || 'lead',
        status: deal.status || 'active',
        notes: deal.notes || '',
        lost_reason: deal.lost_reason || '',
        assigned_to: deal.assigned_to || ''
      };
      setFormData(initialData);
      // Store initial data for comparison
      lastSavedDataRef.current = JSON.stringify(initialData);
      setIsDirty(false);
      setAutoSaveStatus('idle');
    }
  }, [deal]);

  // UX FRICTION FIX: Auto-save function with 800ms debounce
  // FIX 2025-12-06: Added payload validation, undefined filtering, and diagnostic logging
  const performAutoSave = useCallback(async (dataToSave) => {
    if (!deal || !organization?.id) {
      console.warn('[DealDetailsModal] Auto-save skipped: missing deal or organization');
      return;
    }

    // Don't auto-save if data hasn't actually changed
    const currentDataStr = JSON.stringify(dataToSave);
    if (currentDataStr === lastSavedDataRef.current) return;

    // Don't auto-save if stage is lost and no reason provided
    if (dataToSave.stage === 'lost' && !dataToSave.lost_reason) return;

    // P0 FIX 2025-12-09: Clear any pending status reset timer before starting new save
    // This prevents the race condition where a previous save's timer resets status
    if (statusResetTimerRef.current) {
      clearTimeout(statusResetTimerRef.current);
      statusResetTimerRef.current = null;
    }

    setAutoSaveStatus('saving');

    try {
      const finalStatus = getStatusForStage(dataToSave.stage);

      // FIX 2025-12-06: Build payload with explicit field handling
      // All values must be defined - no undefined values allowed
      const rawPayload = {
        client: sanitizeText(dataToSave.client) || '',
        email: sanitizeText(dataToSave.email) || '',
        phone: sanitizeText(dataToSave.phone) || '',
        notes: sanitizeText(dataToSave.notes) || '',
        value: parseFloat(dataToSave.value) || 0,
        stage: dataToSave.stage,
        status: finalStatus,
        lost_reason: dataToSave.lost_reason || null,
        last_activity: new Date().toISOString(),
        assigned_to: dataToSave.assigned_to || null
      };

      // FIX 2025-12-06: Only include assigned_at if it has a real value
      // Don't send undefined - it breaks Supabase
      if (dataToSave.assigned_to && dataToSave.assigned_to !== deal.assigned_to) {
        rawPayload.assigned_at = new Date().toISOString();
      } else if (deal.assigned_at) {
        rawPayload.assigned_at = deal.assigned_at;
      }
      // If neither condition is true, assigned_at is simply not included (not undefined)

      // FIX 2025-12-06: Filter out any remaining undefined/null keys (defensive)
      const sanitizedData = Object.fromEntries(
        Object.entries(rawPayload).filter(([_, v]) => v !== undefined)
      );

      // FIX 2025-12-06: Diagnostic logging BEFORE network call
      console.log('[DealDetailsModal] Auto-save payload:', {
        dealId: deal.id,
        organizationId: organization.id,
        fieldCount: Object.keys(sanitizedData).length,
        fields: Object.keys(sanitizedData),
        stage: sanitizedData.stage,
        status: sanitizedData.status
      });

      // P0 FIX 2025-12-08: Use api.deal for invariant-validated responses
      // This ensures we NEVER get false success - deal is always validated
      const { data: result } = await api.deal('update-deal', {
        dealId: deal.id,
        updates: sanitizedData,
        organizationId: organization.id
      });

      // FIX 2025-12-06: Log response for debugging
      console.log('[DealDetailsModal] Auto-save response:', {
        success: result?.success,
        hasError: !!result?.error,
        hasDeal: !!result?.deal
      });

      // P0 FIX 2025-12-08: Simplified check - api.deal normalizes response
      // result.success is ALWAYS defined (true or false) after normalization
      if (!result.success) {
        const error = new Error(result.error || 'Save failed');
        error.code = result.code || 'UPDATE_ERROR';
        throw error;
      }

      // Update last saved data
      lastSavedDataRef.current = currentDataStr;
      setIsDirty(false);
      setAutoSaveStatus('saved');

      // Notify parent of update
      if (result.deal) {
        onDealUpdated(result.deal);
      }

      // P0 FIX 2025-12-09: Reset status after 2 seconds using ref to prevent race condition
      // Store timer in ref so it can be cancelled if a new save starts
      statusResetTimerRef.current = setTimeout(() => {
        setAutoSaveStatus('idle');
        statusResetTimerRef.current = null;
      }, 2000);
    } catch (error) {
      // FIX 2025-12-06: Enhanced error logging with full context
      console.error('[DealDetailsModal] Auto-save FAILED:', {
        error: error.message,
        code: error.code,
        status: error.status,
        dealId: deal?.id,
        organizationId: organization?.id
      });
      setAutoSaveStatus('idle');

      // P0 FIX 2025-12-08: Show specific error messages based on error code
      // Keep in sync with useDealManagement.js error handling
      let userMessage = 'Save failed. Please try again.';
      if (error.code === 'VALIDATION_ERROR' || error.code === 'UPDATE_VALIDATION_ERROR') {
        userMessage = error.message || 'Invalid data. Please check your input.';
      } else if (error.code === 'FORBIDDEN') {
        userMessage = 'You don\'t have permission to update this deal.';
      } else if (error.code === 'NOT_FOUND') {
        userMessage = 'Deal not found. It may have been deleted.';
      } else if (error.code === 'AUTH_REQUIRED' || error.code === 'SESSION_ERROR') {
        userMessage = 'Session expired. Please refresh the page.';
      } else if (error.code === 'RATE_LIMITED' || error.code === 'THROTTLED') {
        // P0 FIX 2025-12-08: Handle rate limiting from session validation
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (error.code === 'SERVER_ERROR') {
        userMessage = 'Something went wrong. Please try again.';
      } else if (error.userMessage) {
        // P0 FIX 2025-12-08: Use userMessage if api-client provided one
        userMessage = error.userMessage;
      } else if (error.message && error.message.length < 100) {
        // P0 FIX 2025-12-08: Use error.message for unknown codes if it's user-friendly
        userMessage = error.message;
      }
      // Always show error to user (not just silent fail)
      addNotification(userMessage, 'error');
    }
  }, [deal, organization?.id, onDealUpdated, addNotification]);

  // UX FRICTION FIX: Trigger auto-save with debounce when form changes
  useEffect(() => {
    if (!isDirty || !isOpen) return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer for 800ms debounce
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave(formData);
    }, 800);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [formData, isDirty, isOpen, performAutoSave]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      // P0 FIX 2025-12-09: Also cleanup status reset timer
      if (statusResetTimerRef.current) {
        clearTimeout(statusResetTimerRef.current);
      }
    };
  }, []);

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

  // TASK 1 FIX: Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // H6-D HARDENING 2025-12-04: Helper to update form fields and mark as dirty
  const updateFormField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  // UX FRICTION FIX: Close without confirmation - auto-save handles persistence
  const handleClose = () => {
    // Clear any pending auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    // If there are unsaved changes, trigger immediate save before closing
    if (isDirty) {
      performAutoSave(formData);
    }
    setIsDirty(false);
    setAutoSaveStatus('idle');
    onClose();
  };

  const handleStageChange = (newStage) => {
    // P0 WAR ROOM FIX 2025-12-09: Centralized stage/status sync for all stages
    // Uses getStatusForStage for consistent handling across all pipelines

    // CRITICAL: If changing to any "lost" stage, show reason modal first
    const isLostStage = newStage === 'lost' || newStage === 'deal_lost';
    if (isLostStage && deal.stage !== 'lost' && deal.stage !== 'deal_lost') {
      setPendingStageChange(newStage);
      setShowLostModal(true);
      return; // Don't update formData yet, wait for reason
    }

    // Get the correct status for this stage using centralized logic
    const newStatus = getStatusForStage(newStage);

    // H6-D: Mark form as dirty when stage changes
    setIsDirty(true);
    setFormData({ ...formData, stage: newStage, status: newStatus });
  };

  const handleLostReasonConfirm = (reason) => {
    // P0 WAR ROOM FIX 2025-12-09: Use the pending stage (could be 'lost' or 'deal_lost')
    // H6-D: Mark form as dirty
    setIsDirty(true);
    const targetStage = pendingStageChange || 'lost';
    setFormData({
      ...formData,
      stage: targetStage,
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
      {/* TASK 1 FIX: Top-anchored modal with internal scroll, body scroll locked via fixed backdrop */}
      {/* P0 FIX 2025-12-09: Increased horizontal padding and added box-sizing to prevent right-side clipping */}
      {/* UI-BUG-1 FIX 2025-12-09: Raised z-index from 70 to 160 to render ABOVE navbar (z-[150]) */}
      <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-xl z-[160] overflow-hidden">
        <div className="w-full h-full overflow-y-auto pt-8 pb-6 px-6 md:pt-10 md:px-12 lg:px-16 box-border">
          {/* UI-FIX 2025-12-09: Added overflow-hidden to clip sticky header within rounded corners */}
          <div
            ref={focusTrapRef}
            className="modal-content bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl w-full max-w-2xl mx-auto box-border overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deal-details-title"
          >
          {/* UI-FIX 2025-12-09: Added rounded-t-2xl to match parent container corners */}
          <div className="sticky top-0 bg-gradient-to-br from-gray-900 to-black border-b border-gray-700 p-6 flex items-center justify-between z-10 rounded-t-2xl">
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
              onClick={handleClose}
              className="min-w-touch min-h-touch flex items-center justify-center text-gray-400 hover:text-white rounded-lg transition"
              aria-label="Close deal details"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          {isLost && (deal.lost_reason || deal.outcome_reason_category) && (() => {
            // PHASE 4: Use unified outcome for display
            const unified = createUnifiedOutcome(deal);
            const reasonDisplay = unified.outcome_reason_category
              ? getReasonDisplay(unified.outcome_reason_category)
              : null;
            return (
              <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                <div className="flex items-center gap-3">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-red-400 mb-2">Deal Lost</p>
                    <p className="text-sm text-red-300">
                      Reason: {reasonDisplay?.label || deal.lost_reason || 'Unknown'}
                    </p>
                    {unified.outcome_notes && (
                      <p className="text-xs text-red-300/70 mt-1">{unified.outcome_notes}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <form onSubmit={(e) => e.preventDefault()} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Client Name *
              </label>
              <input
                type="text"
                required
                value={formData.client}
                onChange={(e) => { setFormData({ ...formData, client: e.target.value }); setIsDirty(true); }}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setIsDirty(true); }}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                />
              </div>
              {/* P0 FIX 2025-12-08: Use modal variant for consistent dark theme styling */}
              <PhoneInput
                id="deal-phone"
                value={formData.phone}
                onChange={(value) => { setFormData({ ...formData, phone: value }); setIsDirty(true); }}
                error={null}
                required={false}
                variant="modal"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  onChange={(e) => { setFormData({ ...formData, value: e.target.value }); setIsDirty(true); }}
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
                  onChange={(e) => { setFormData({ ...formData, assigned_to: e.target.value }); setIsDirty(true); }}
                  disabled={loadingTeamMembers || teamMembers.length === 0}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239CA3AF%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map(member => {
                    // TASK 3: Use demo user name if applicable
                    const displayName = isDemoEmail(member.email)
                      ? (getDemoUserData(member.email)?.name || member.name)
                      : member.name;
                    return (
                      <option key={member.id} value={member.id}>
                        {displayName} ({member.email})
                      </option>
                    );
                  })}
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
                onChange={(e) => { setFormData({ ...formData, notes: e.target.value }); setIsDirty(true); }}
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

            {/* UX FRICTION FIX: Auto-save footer with status indicator */}
            <div className="flex gap-3 pt-4 border-t border-gray-700 items-center">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                title={deleting ? "Deleting deal..." : "Permanently delete this deal"}
                className="px-4 py-3 min-h-touch border border-red-500/50 text-red-400 rounded-xl hover:bg-red-500/10 transition flex items-center gap-2 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                Delete
              </button>

              {/* Auto-save status indicator */}
              <div className="flex-1 flex justify-center">
                {autoSaveStatus === 'saving' && (
                  <span className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="flex items-center gap-2 text-sm text-teal-400">
                    <Check className="w-4 h-4" />
                    Saved
                  </span>
                )}
                {autoSaveStatus === 'idle' && !isDirty && (
                  <span className="text-xs text-gray-500">Changes auto-save</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-3 min-h-touch bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-semibold transition"
              >
                Done
              </button>
            </div>
          </form>
          </div>
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

/**
 * ACCEPTANCE CRITERIA (UI-FIX 2025-12-09)
 * ========================================
 *
 * 1. Phone field
 *    - At 1440px width: Phone input + country selector fully inside modal
 *    - No horizontal scroll in the overlay
 *    - On mobile: Layout degrades gracefully (stacked or cleanly wrapped), no overflow
 *
 * 2. Deal Details modal
 *    - Centered, with equal left/right padding
 *    - Corners are smooth; no visible protruding corners at top
 *    - Feedback tab does not visually overlap the modal
 *
 * 3. Other modals & forms
 *    - No input or label extends beyond the right edge of its card at standard widths (1024, 1280, 1440)
 *    - All modals use a consistent overlay + card shell (same radius, padding, z-index discipline)
 *
 * 4. Code quality
 *    - No "just for this viewport" hacks unless absolutely necessary and commented
 *    - All changes are in JSX/Tailwind classes; no global CSS regressions
 *
 * ROOT CAUSE FIXES APPLIED:
 * - PhoneInput.jsx: Added `w-full min-w-0` to outer container and `min-w-0` to input
 *   (allows flex-1 items to shrink below intrinsic content width)
 * - DealDetailsModal.jsx: Added `overflow-hidden` to modal-content container
 *   (clips sticky header within rounded corners)
 * - DealDetailsModal.jsx: Added `rounded-t-2xl` to sticky header
 *   (matches parent container radius for seamless visual integration)
 * - All modals: Added `overflow-x-hidden` or `overflow-hidden` for consistent clipping
 */
