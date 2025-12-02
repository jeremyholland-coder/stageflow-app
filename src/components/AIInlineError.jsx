import React from 'react';
import { AlertTriangle, RefreshCw, Settings, ChevronRight } from 'lucide-react';

/**
 * TASK 3: Unified AI Inline Error UI Component
 *
 * A clean, minimal error display for AI-related errors.
 * Replaces scattered error text and ad-hoc buttons with a consistent,
 * Apple-clean design that matches StageFlow's visual language.
 *
 * Features:
 * - Subtle border and soft background (not loud/alarming)
 * - Single message line
 * - Optional primary action button (retry or navigate)
 * - Consistent styling across all AI error surfaces
 *
 * @author StageFlow Engineering
 */

/**
 * AIInlineError Component
 *
 * @param {Object} props
 * @param {string} props.message - User-friendly error message
 * @param {Object} [props.action] - Optional action button
 * @param {string} props.action.label - Button label text
 * @param {Function} [props.action.onClick] - Click handler for in-place actions (e.g., retry)
 * @param {string} [props.action.path] - Navigation path (e.g., /settings?tab=ai)
 * @param {'error'|'warning'|'info'} [props.severity='error'] - Visual severity level
 * @param {string} [props.className] - Additional CSS classes
 * @param {Function} [props.onDismiss] - Optional dismiss handler
 */
export const AIInlineError = ({
  message,
  action,
  severity = 'error',
  className = '',
  onDismiss
}) => {
  // Severity-based styling
  const severityStyles = {
    error: {
      container: 'bg-rose-500/5 border-rose-500/20',
      icon: 'text-rose-400',
      text: 'text-rose-200',
      button: 'text-rose-400 hover:text-rose-300 hover:bg-rose-500/10'
    },
    warning: {
      container: 'bg-amber-500/5 border-amber-500/20',
      icon: 'text-amber-400',
      text: 'text-amber-200',
      button: 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
    },
    info: {
      container: 'bg-blue-500/5 border-blue-500/20',
      icon: 'text-blue-400',
      text: 'text-blue-200',
      button: 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'
    }
  };

  const styles = severityStyles[severity] || severityStyles.error;

  // Determine action icon
  const getActionIcon = () => {
    if (!action) return null;
    if (action.path) return <ChevronRight className="w-3.5 h-3.5 ml-0.5" />;
    return <RefreshCw className="w-3 h-3 ml-1" />;
  };

  // Handle action click
  const handleActionClick = () => {
    if (action?.onClick) {
      action.onClick();
    } else if (action?.path) {
      // Navigate using window.location for simplicity
      // In a real app, use React Router's navigate
      window.location.href = action.path;
    }
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3
        border rounded-xl
        ${styles.container}
        ${className}
      `}
      role="alert"
    >
      {/* Icon */}
      <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${styles.icon}`} />

      {/* Message */}
      <p className={`text-sm flex-1 ${styles.text}`}>
        {message}
      </p>

      {/* Action button */}
      {action?.label && (
        <button
          onClick={handleActionClick}
          className={`
            flex items-center gap-0.5
            text-xs font-medium
            px-2.5 py-1.5 rounded-lg
            transition-all duration-200
            ${styles.button}
          `}
        >
          {action.label}
          {getActionIcon()}
        </button>
      )}

      {/* Dismiss button (optional) */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white/50 ml-1"
          aria-label="Dismiss"
        >
          <span className="text-lg leading-none">&times;</span>
        </button>
      )}
    </div>
  );
};

/**
 * AIInlineErrorCompact - Smaller version for tighter spaces
 */
export const AIInlineErrorCompact = ({
  message,
  action,
  severity = 'error',
  className = ''
}) => {
  const severityStyles = {
    error: 'text-rose-300',
    warning: 'text-amber-300',
    info: 'text-blue-300'
  };

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <AlertTriangle className={`w-3.5 h-3.5 ${severityStyles[severity]}`} />
      <span className={severityStyles[severity]}>{message}</span>
      {action?.label && (
        <button
          onClick={action.onClick}
          className="text-white/50 hover:text-white/70 underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

/**
 * Helper hook to create error props from classification
 *
 * @param {Object} error - Error object
 * @param {Object} options - Options
 * @param {Function} options.onRetry - Retry handler
 * @param {Function} options.onNavigate - Navigate handler (receives path)
 * @returns {Object} Props for AIInlineError
 */
export function useErrorProps(error, { onRetry, onNavigate } = {}) {
  if (!error) return null;

  // Import dynamically to avoid circular deps
  const { classifyError, getErrorMessage, getErrorAction } = require('../lib/ai-error-codes');

  const classification = classifyError(error);
  const message = getErrorMessage(classification.code, error?.data);
  const actionInfo = getErrorAction(classification.code, classification.retryable);

  let action = null;
  if (actionInfo.type === 'retry' && onRetry) {
    action = { label: actionInfo.label, onClick: onRetry };
  } else if (actionInfo.type === 'settings' && onNavigate) {
    action = { label: actionInfo.label, onClick: () => onNavigate('/settings?tab=ai') };
  }

  return {
    message,
    action,
    severity: classification.severity
  };
}

export default AIInlineError;
