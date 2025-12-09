import React, { useState, useEffect, memo } from 'react';
import { X, AlertCircle, Loader2, Ban } from 'lucide-react';
import { useFocusTrap } from '../lib/accessibility';
// PHASE 4: Use unified outcome configuration
import {
  OUTCOME_TYPES,
  getReasonOptionsForOutcome
} from '../config/outcomeConfig';

// PHASE 4: Get disqualify reasons from unified config
const DISQUALIFY_REASONS = getReasonOptionsForOutcome(OUTCOME_TYPES.DISQUALIFIED);

/**
 * DisqualifyModal - Modal for disqualifying a deal with a reason
 *
 * This removes the deal from the active pipeline and stores it in the
 * inactive/disqualified deals section for future reference.
 */
export const DisqualifyModal = memo(({ isOpen, onClose, onConfirm, dealName }) => {
  const [selectedReason, setSelectedReason] = useState('');
  const [otherText, setOtherText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // WCAG 2.1: Focus trap for keyboard accessibility
  const containerRef = useFocusTrap(isOpen);

  // Phase 9: Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  // UX FRICTION FIX: Submit for "Other" reason only
  const handleSubmit = async () => {
    if (selectedReason !== 'other') return;

    if (!otherText.trim()) {
      setError('Please provide details for "Other"');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await onConfirm({
        reasonCategory: 'other',
        reasonLabel: 'Other',
        notes: otherText.trim()
      });

      setSelectedReason('');
      setOtherText('');
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to disqualify deal');
    } finally {
      setSaving(false);
    }
  };

  // UX FRICTION FIX: One-click action for predefined reasons
  const handleReasonClick = async (reasonId) => {
    if (reasonId === 'other') {
      // For "Other", just select it and show text input
      setSelectedReason(reasonId);
      setError('');
      return;
    }

    // For predefined reasons, immediately disqualify
    setSaving(true);
    setError('');

    try {
      const reasonLabel = DISQUALIFY_REASONS.find(r => r.id === reasonId)?.label || reasonId;

      await onConfirm({
        reasonCategory: reasonId,
        reasonLabel,
        notes: ''
      });

      setSelectedReason('');
      setOtherText('');
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to disqualify deal');
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setSelectedReason('');
      setOtherText('');
      setError('');
      onClose();
    }
  };

  return (
    // UI-BUG-1 FIX 2025-12-09: Raised z-index from 80 to 170 to render ABOVE DealDetailsModal (z-[160])
    <div className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center z-[170] md:p-4">
      <div
        ref={containerRef}
        className="modal-content bg-gradient-to-br from-gray-900 to-black border border-amber-500/30 rounded-none md:rounded-2xl w-full md:max-w-2xl h-full md:h-auto overflow-y-auto overflow-x-hidden p-6 shadow-2xl pb-safe"
        style={{
          maxHeight: '100dvh',
          paddingBottom: 'max(env(safe-area-inset-bottom, 20px), 20px)'
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disqualify-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 id="disqualify-modal-title" className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Ban className="w-6 h-6 text-amber-400" />
              </div>
              Disqualify this deal
            </h3>
            <p className="text-sm text-gray-400 mt-2">
              {dealName}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-white transition disabled:opacity-50 touch-target rounded-lg"
            aria-label="Close disqualify modal"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <p className="text-sm text-amber-200">
            This deal will be removed from your active pipeline but kept for future reference.
            You can reopen it later from Pipeline Health → Inactive Deals.
          </p>
        </div>

        {/* UX FRICTION FIX: One-click reasons (except "Other") */}
        <div className="space-y-3 mb-6">
          <label className="block text-sm font-medium text-white mb-2">
            Reason for disqualification <span className="text-amber-400">*</span>
          </label>
          {DISQUALIFY_REASONS.map(reason => (
            <button
              key={reason.id}
              onClick={() => handleReasonClick(reason.id)}
              disabled={saving}
              className={`w-full p-4 min-h-touch rounded-xl border-2 transition-all text-left flex items-center gap-3 disabled:opacity-50 ${
                selectedReason === reason.id
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-gray-700 bg-gray-800/30 hover:border-amber-500/30'
              }`}
              aria-label={reason.id === 'other'
                ? `Select ${reason.label} to provide custom reason`
                : `Disqualify deal: ${reason.label}`}
              aria-pressed={selectedReason === reason.id}
            >
              <span className="text-2xl">{reason.icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-white">
                  {reason.label}
                </p>
                {reason.id !== 'other' && (
                  <p className="text-xs text-gray-400 mt-0.5">Click to disqualify</p>
                )}
              </div>
              {selectedReason === reason.id && reason.id === 'other' && (
                <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {saving && reason.id !== 'other' && (
                <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              )}
            </button>
          ))}

          {/* Notes field - always visible but required only for "Other" */}
          <div className="mt-4">
            <label htmlFor="disqualify-notes" className="block text-sm font-medium text-white mb-2">
              Additional notes {selectedReason === 'other' && <span className="text-amber-400">*</span>}
            </label>
            <textarea
              id="disqualify-notes"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder={selectedReason === 'other' ? 'Please provide details...' : 'Optional additional context...'}
              maxLength={500}
              rows={3}
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition resize-none"
              aria-invalid={error && selectedReason === 'other' ? 'true' : 'false'}
              aria-describedby="disqualify-notes-counter"
            />
            <p id="disqualify-notes-counter" className="text-xs text-gray-400 mt-1">
              {otherText.length}/500 characters
            </p>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* UX FRICTION FIX: Only show submit button for "Other" reason */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            disabled={saving}
            className="flex-1 px-4 py-3 min-h-touch border border-gray-700 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800/50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          {selectedReason === 'other' && (
            <button
              onClick={handleSubmit}
              disabled={saving || !otherText.trim()}
              title={!otherText.trim() ? 'Please provide details' : `Disqualify ${dealName}`}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-3 min-h-touch rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Disqualifying...
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4" />
                  Disqualify Deal
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

DisqualifyModal.displayName = 'DisqualifyModal';
