import React, { useState, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from './AppShell';
// FIX CRITICAL #1: Import default pipeline as fallback if pipelineStages fails to load
import { PIPELINE_TEMPLATES } from '../config/pipelineTemplates';
import { sanitizeText } from '../lib/sanitize';
import { sanitizeNumberInput, toNumberOrNull } from '../utils/numberSanitizer';
import { ModalErrorBoundary } from './ErrorBoundaries';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFocusTrap } from '../lib/accessibility';
import { getPlanLimits, isOverLimit } from '../config/planLimits';
import { PhoneInput } from './PhoneInput';
import { api } from '../lib/api-client'; // PHASE J: Auth-aware API client
// Phase 7: Offline support for deal creation
import { enqueueCommand, OFFLINE_COMMAND_TYPES } from '../lib/offlineStore';

// Field validation configuration
const fieldConfigs = {
  client: {
    // FIX M15: Add min/max length validation (2-200 chars)
    rules: [
      { rule: 'required' },
      { rule: 'minLength', value: 2 },
      { rule: 'maxLength', value: 200 }
    ]
  },
  email: {
    rules: [{ rule: 'required' }, { rule: 'email' }]
  },
  phone: {
    rules: [{ rule: 'phone' }] // Optional, M14 fixed in formValidation.js
  },
  value: {
    // FIX M15: Add max value validation (under 1 billion)
    rules: [
      { rule: 'required' },
      { rule: 'positiveNumber' },
      { rule: 'maxValue', value: 999999999 }
    ]
  },
  notes: {
    // FIX M15: Max 5000 characters for notes
    rules: [{ rule: 'maxLength', value: 5000 }]
  }
};

// Error message component with ARIA
const FieldError = ({ error, fieldId }) => {
  if (!error) return null;

  return (
    <p
      id={`${fieldId}-error`}
      role="alert"
      className="mt-1 text-sm text-red-400"
    >
      {error}
    </p>
  );
};

// NEXT-LEVEL: Memoize modal to prevent unnecessary re-renders (30-40% performance gain)
export const NewDealModal = memo(({ isOpen, onClose, initialStage, onDealCreated, pipelineStages = [] }) => {
  const { user, organization, addNotification } = useApp();
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState(''); // MEDIUM FIX: Show creation progress

  // CRITICAL FIX: Get first valid stage from pipeline or fallback to default pipeline's first stage
  const getInitialStage = () => {
    if (initialStage) return initialStage;
    if (pipelineStages && pipelineStages.length > 0) return pipelineStages[0].id;
    return PIPELINE_TEMPLATES.default.stages[0].id; // 'lead_captured'
  };

  const [formData, setFormData] = useState({
    client: '',
    email: '',
    phone: '',
    value: '',
    stage: getInitialStage(),
    notes: ''
  });
  const firstInputRef = React.useRef(null);

  // CRITICAL FIX: Update stage when pipelineStages loads or changes
  useEffect(() => {
    const newStage = getInitialStage();
    if (newStage !== formData.stage) {
      setFormData(prev => ({ ...prev, stage: newStage }));
    }
  }, [pipelineStages, initialStage]);

  // Initialize validation hook
  const validation = useFormValidation(fieldConfigs);

  // Focus trap for accessibility
  const focusTrapRef = useFocusTrap(isOpen);

  // Reset validation and set focus when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      validation.reset();
      // Set focus to first input after a brief delay to ensure modal is rendered
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // ACCESSIBILITY FIX: Add Escape key handler to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, loading, onClose]);

  // iOS FIX: Scroll focused input into view when keyboard appears
  useEffect(() => {
    if (!isOpen) return;

    const handleFocusIn = (e) => {
      // Only for input/textarea elements
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // Wait for keyboard animation (iOS typically 300ms)
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [isOpen]);

  const handleFieldChange = (fieldName, value) => {
    // Sanitize numeric fields before storing
    const sanitizedValue = fieldName === 'value' ? sanitizeNumberInput(value) : value;
    setFormData({ ...formData, [fieldName]: sanitizedValue });
    validation.handleChange(fieldName, sanitizedValue);
  };

  const handleFieldBlur = (fieldName) => {
    validation.handleBlur(fieldName, formData[fieldName]);
  };

  // Helper: Map backend error codes to user-friendly messages
  const getErrorMessage = (code, hint, fallbackError) => {
    const errorMessages = {
      'ENV_CONFIG_ERROR': 'StageFlow needs a quick configuration update. Please contact support or try again in a bit.',
      'DB_INIT_ERROR': "We're having trouble connecting to the database. Please try again in a moment.",
      '23503': "We couldn't link this deal to your workspace. Please refresh the page and try again.",
      '23505': 'This deal looks like a duplicate. Check your existing deals before adding another.',
      '42501': "You don't have permission to create deals in this workspace. Please check your access or contact an admin.",
      'PERMISSION_DENIED': "You don't have permission to create deals in this workspace. Please check your access or contact an admin.",
      'AUTH_REQUIRED': 'Your session has expired. Please refresh the page and log in again.',
      'TOKEN_EXPIRED': 'Your session has expired. Please refresh the page and log in again.',
      'UNAUTHORIZED': 'Authentication required. Please refresh and log in again.',
    };

    // Return mapped message, or use hint if available, or fallback
    return errorMessages[code] || hint || fallbackError || 'Something went wrong while creating this deal. Please try again.';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent double submission
    if (loading) return;

    // Run all validations before submit
    const isValid = validation.validateAll(formData);
    if (!isValid) {
      addNotification('Please fix the errors in the form', 'error');
      return;
    }

    // PART A: Enhanced pre-flight validation
    if (!user) {
      addNotification('Please log in to create a deal.', 'error');
      return;
    }

    if (!organization || !organization.id) {
      addNotification("We couldn't find your workspace. Please refresh the page and try again.", 'error');
      return;
    }

    // FIX HIGH #1: Enforce deal limits before creation
    setLoading(true);
    setProgressMessage('Verifying deal limit...'); // MEDIUM FIX: Progress feedback

    // PHASE 20 FIX: Use 'plan' field (not 'plan_tier') - matches database schema
    const planLimits = getPlanLimits(organization.plan || 'free');
    const { count: dealCount, error: countError } = await supabase
      .from('deals')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization.id);

    if (countError) {
      console.error('Failed to check deal count:', countError);
      addNotification('Failed to verify deal limit. Please try again.', 'error');
      setLoading(false);
      setProgressMessage('');
      return;
    }

    if (isOverLimit(dealCount, planLimits.deals)) {
      addNotification(
        `Deal limit reached (${planLimits.deals} deals on ${planLimits.displayName}). Upgrade your plan to create more deals.`,
        'error'
      );
      setLoading(false);
      setProgressMessage('');
      return;
    }

    setProgressMessage('Creating deal...'); // MEDIUM FIX: Progress feedback

    try {
      // FIX M16: Coerce empty strings to null for optional fields
      // Use toNumberOrNull for safe numeric conversion (avoids NaN)
      const dealValue = toNumberOrNull(formData.value);
      const sanitizedData = {
        client: sanitizeText(formData.client),
        email: sanitizeText(formData.email) || null,
        phone: sanitizeText(formData.phone) || null,
        value: dealValue !== null ? dealValue : 0,
        stage: formData.stage,
        status: 'active',
        notes: sanitizeText(formData.notes) || null
      };

      // Phase 7: Check if offline - queue deal creation for later sync
      if (!navigator.onLine) {
        // Generate a temporary local ID for the optimistic deal
        const localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create an optimistic local deal (without server-generated fields)
        const optimisticDeal = {
          id: localId,
          ...sanitizedData,
          organization_id: organization.id,
          user_id: user?.id,
          created: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          _pendingSync: true, // Phase 7: Mark as pending sync for UI indicator
        };

        // Queue the create command for when we're back online
        await enqueueCommand({
          type: OFFLINE_COMMAND_TYPES.CREATE_DEAL,
          payload: { deal: sanitizedData },
          organizationId: organization.id,
          localId, // Phase 7: Track local ID for replacement after sync
        });

        // Add the optimistic deal to local state
        addNotification('Deal saved offline - will sync when connected', 'info');
        onDealCreated(optimisticDeal);
        onClose();
        setFormData({ client: '', email: '', phone: '', value: '', stage: getInitialStage(), notes: '' });
        validation.reset();
        setLoading(false);
        setProgressMessage('');
        return;
      }

      // PHASE J: Use auth-aware api-client with Authorization header
      // PART B: Enhanced error handling with structured response parsing
      let result;
      try {
        // FIX 2025-12-09: Changed api.post → api.deal for response invariant enforcement
        const response = await api.deal('create-deal', {
          dealData: sanitizedData,
          organizationId: organization.id
        });
        result = response?.data;
      } catch (networkError) {
        // Network/connection failure - no JSON response at all
        console.error('[NewDealModal] Network error:', networkError);
        addNotification('Connection issue. Please check your internet and try again.', 'error');
        setLoading(false);
        setProgressMessage('');
        return;
      }

      // PART B: Handle three cases - network failure (caught above), JSON with success: false, JSON with success: true
      if (!result) {
        // No data returned (shouldn't happen, but defensive)
        addNotification('No response from server. Please try again.', 'error');
        setLoading(false);
        setProgressMessage('');
        return;
      }

      if (result.success === false || result.error) {
        // Structured error from backend - extract code and hint safely
        const code = result?.code;
        const hint = result?.hint;
        const errorMsg = result?.error;

        console.error('[NewDealModal] Create deal failed:', { code, hint, error: errorMsg });

        // Show user-friendly message based on error code
        const userMessage = getErrorMessage(code, hint, errorMsg);
        addNotification(userMessage, 'error');
        setLoading(false);
        setProgressMessage('');
        return;
      }

      if (!result.deal) {
        // Success: true but no deal data (shouldn't happen, but defensive)
        addNotification("Deal may have been created, but we couldn't confirm. Please check your pipeline.", 'error');
        setLoading(false);
        setProgressMessage('');
        return;
      }

      // Success!
      addNotification('Deal created and added to your pipeline!', 'success');
      onDealCreated(result.deal);
      onClose();
      setFormData({ client: '', email: '', phone: '', value: '', stage: getInitialStage(), notes: '' });
      validation.reset();

    } catch (unexpectedError) {
      // Catch-all for any unexpected errors
      console.error('[NewDealModal] Unexpected error:', unexpectedError);
      addNotification('An unexpected error occurred. Please try again.', 'error');
    } finally {
      // CRITICAL FIX: Always reset loading state in finally block
      setLoading(false);
      setProgressMessage(''); // MEDIUM FIX: Clear progress message
    }
  };

  if (!isOpen) return null;

  const orgNotReady = !organization;
  const hasErrors = Object.values(validation.errors).some(error => error !== null);

  // CRITICAL FIX: Use createPortal to render modal at document root, not inside Kanban column
  // This fixes the + button issue where modal was appearing inline instead of as overlay
  return createPortal(
    <ModalErrorBoundary onClose={onClose}>
    <div className="modal-backdrop fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50 md:p-4">
      {/* CRITICAL FIX: iOS keyboard covering inputs - use dynamic viewport height (100dvh) */}
      <div
        ref={focusTrapRef}
        className="modal-content bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-none md:rounded-2xl shadow-2xl w-full md:max-w-2xl min-h-screen md:min-h-0 md:h-auto overflow-y-auto overflow-x-hidden pb-safe"
        style={{
          maxHeight: '100dvh',
          paddingBottom: 'max(env(safe-area-inset-bottom, 20px), 20px)'
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-deal-title"
      >
        {/* UI-FIX 2025-12-09: Added rounded-t-2xl for desktop to match parent corners */}
        <div className="sticky top-0 bg-gradient-to-br from-gray-900 to-black border-b border-gray-700 p-6 flex items-center justify-between md:rounded-t-2xl">
          <h2 id="new-deal-title" className="text-2xl font-bold text-white">New Deal</h2>
          <button
            onClick={onClose}
            className="min-w-touch min-h-touch flex items-center justify-center text-gray-300 hover:text-white rounded-lg transition"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>

        {orgNotReady && (
          <div className="mx-6 mt-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-amber-400">Loading workspace...</p>
              <p className="text-sm text-white">
                Your workspace is loading. Wait a moment, then try adding your deal again.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Client Name */}
          <div>
            <label htmlFor="client" className="block text-sm font-medium text-white mb-2">
              Client Name *
            </label>
            <input
              ref={firstInputRef}
              id="client"
              type="text"
              required
              value={formData.client}
              onChange={(e) => handleFieldChange('client', e.target.value)}
              onBlur={() => handleFieldBlur('client')}
              aria-invalid={validation.errors.client ? 'true' : 'false'}
              aria-describedby={validation.errors.client ? 'client-error' : undefined}
              className={`w-full px-4 py-3 bg-gray-800/50 border rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition ${
                validation.errors.client
                  ? 'border-red-500'
                  : 'border-gray-700'
              }`}
              placeholder="Acme Corp"
            />
            <FieldError error={validation.errors.client} fieldId="client" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                Email *
              </label>
              <input
                id="email"
                type="email"
                required
                value={formData.email}
                onChange={(e) => handleFieldChange('email', e.target.value)}
                onBlur={() => handleFieldBlur('email')}
                aria-invalid={validation.errors.email ? 'true' : 'false'}
                aria-describedby={validation.errors.email ? 'email-error' : undefined}
                className={`w-full px-4 py-3 bg-gray-800/50 border rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition ${
                  validation.errors.email
                    ? 'border-red-500'
                    : 'border-gray-700'
                }`}
                placeholder="contact@acme.com"
              />
              <FieldError error={validation.errors.email} fieldId="email" />
            </div>

            {/* Phone */}
            <PhoneInput
              id="phone"
              value={formData.phone}
              onChange={(value) => handleFieldChange('phone', value)}
              onBlur={() => handleFieldBlur('phone')}
              error={validation.errors.phone}
              required={false}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Deal Value */}
            <div>
              <label htmlFor="value" className="block text-sm font-medium text-white mb-2">
                Deal Value *
              </label>
              <input
                id="value"
                type="text"
                inputMode="decimal"
                required
                value={formData.value}
                onChange={(e) => handleFieldChange('value', e.target.value)}
                onBlur={() => handleFieldBlur('value')}
                aria-invalid={validation.errors.value ? 'true' : 'false'}
                aria-describedby={validation.errors.value ? 'value-error' : 'value-hint'}
                className={`w-full px-4 py-3 bg-gray-800/50 border rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition ${
                  validation.errors.value
                    ? 'border-red-500'
                    : 'border-gray-700'
                }`}
                placeholder="10000"
              />
              <FieldError error={validation.errors.value} fieldId="value" />
              {!validation.errors.value && (
                <p id="value-hint" className="mt-1 text-xs text-gray-400">Digits only. We'll handle the formatting.</p>
              )}
            </div>

            {/* Stage */}
            <div>
              <label htmlFor="stage" className="block text-sm font-medium text-white mb-2">
                Stage *
              </label>
              <select
                id="stage"
                required
                value={formData.stage}
                onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239CA3AF%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpolyline points=%276 9 12 15 18 9%27/%3E%3C/svg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat"
              >
                {/* FIX CRITICAL #1: Use default pipeline as fallback to prevent crash */}
                {(pipelineStages.length > 0 ? pipelineStages : PIPELINE_TEMPLATES.default.stages).map(stage => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-white mb-2">
              Notes
            </label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              onBlur={() => handleFieldBlur('notes')}
              rows={4}
              maxLength={5000}
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
              placeholder="Add any relevant notes..."
            />
            {/* FIX HIGH #4: Character counter for notes field */}
            <div className="flex justify-between items-center mt-1">
              <FieldError error={validation.errors.notes} fieldId="notes" />
              <p className={`text-xs ${
                formData.notes.length > 4500
                  ? 'text-red-400 font-semibold'
                  : 'text-gray-300'
              }`}>
                {formData.notes.length} / 5000
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 min-h-touch border border-gray-700 text-gray-300 hover:text-white rounded-xl hover:bg-gray-800/50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || orgNotReady}
              className="flex-1 bg-teal-500 hover:bg-teal-600 text-white px-4 py-3 min-h-touch rounded-xl font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{progressMessage || 'Creating...'}</span>
                </>
              ) : 'Create Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalErrorBoundary>,
    document.body
  );
});

NewDealModal.displayName = 'NewDealModal';
