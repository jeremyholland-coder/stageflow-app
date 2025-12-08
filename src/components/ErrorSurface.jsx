/**
 * ErrorSurface Component
 *
 * Phase 2: Apple UX Error Handling & User Trust Layer
 *
 * A unified, Apple-grade error display component that provides:
 * - Calm, human-friendly error messages
 * - Clear recovery guidance
 * - Appropriate visual severity
 * - Actionable buttons (retry, navigate, dismiss)
 *
 * VARIANTS:
 * - inline: Slim banner for in-context errors
 * - card: Larger card for significant errors
 * - fullscreen: Full page for critical blocking errors
 * - toast: Brief notification (auto-dismiss)
 *
 * @author StageFlow Engineering
 * @phase Phase 2 - Error Handling & User Trust Layer
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronRight,
  X,
  Wifi,
  WifiOff,
  Clock,
  LogIn,
  Settings,
  Home,
  ArrowUpCircle
} from 'lucide-react';
import {
  normalizeError,
  UNIFIED_ERROR_CODES,
  ERROR_SEVERITY,
} from '../lib/unified-errors';

// ============================================================================
// SEVERITY STYLING
// ============================================================================

const severityStyles = {
  [ERROR_SEVERITY.INFO]: {
    container: 'bg-blue-500/5 border-blue-500/20',
    icon: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    title: 'text-blue-100',
    text: 'text-blue-200/80',
    button: 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300',
    primaryButton: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
  [ERROR_SEVERITY.WARNING]: {
    container: 'bg-amber-500/5 border-amber-500/20',
    icon: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    title: 'text-amber-100',
    text: 'text-amber-200/80',
    button: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300',
    primaryButton: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  [ERROR_SEVERITY.ERROR]: {
    container: 'bg-rose-500/5 border-rose-500/20',
    icon: 'text-rose-400',
    iconBg: 'bg-rose-500/10',
    title: 'text-rose-100',
    text: 'text-rose-200/80',
    button: 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300',
    primaryButton: 'bg-rose-500 hover:bg-rose-600 text-white',
  },
  [ERROR_SEVERITY.CRITICAL]: {
    container: 'bg-red-500/10 border-red-500/30',
    icon: 'text-red-400',
    iconBg: 'bg-red-500/15',
    title: 'text-red-100',
    text: 'text-red-200/80',
    button: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300',
    primaryButton: 'bg-red-500 hover:bg-red-600 text-white',
  },
};

// ============================================================================
// ICON MAPPING
// ============================================================================

function getErrorIcon(code, severity) {
  // Specific icons for certain error types
  if (code === UNIFIED_ERROR_CODES.OFFLINE) return WifiOff;
  if (code === UNIFIED_ERROR_CODES.NETWORK_ERROR) return Wifi;
  if (code === UNIFIED_ERROR_CODES.TIMEOUT) return Clock;
  if (code === UNIFIED_ERROR_CODES.RATE_LIMITED) return Clock;
  if (code === UNIFIED_ERROR_CODES.QUOTA_EXCEEDED) return ArrowUpCircle;
  if (code === UNIFIED_ERROR_CODES.AI_LIMIT_REACHED) return ArrowUpCircle;

  // Auth errors
  if ([
    UNIFIED_ERROR_CODES.AUTH_REQUIRED,
    UNIFIED_ERROR_CODES.SESSION_EXPIRED,
    UNIFIED_ERROR_CODES.SESSION_ERROR,
    UNIFIED_ERROR_CODES.UNAUTHORIZED,
    UNIFIED_ERROR_CODES.INVALID_TOKEN,
  ].includes(code)) {
    return LogIn;
  }

  // Settings errors
  if ([
    UNIFIED_ERROR_CODES.INVALID_API_KEY,
    UNIFIED_ERROR_CODES.NO_PROVIDERS,
  ].includes(code)) {
    return Settings;
  }

  // Default by severity
  return severity === ERROR_SEVERITY.ERROR || severity === ERROR_SEVERITY.CRITICAL
    ? XCircle
    : AlertTriangle;
}

// ============================================================================
// INLINE VARIANT
// ============================================================================

function ErrorSurfaceInline({
  error,
  onRetry,
  onDismiss,
  onNavigate,
  className = '',
  showRecovery = true,
}) {
  const normalizedError = normalizeError(error);
  const styles = severityStyles[normalizedError.severity] || severityStyles[ERROR_SEVERITY.ERROR];
  const Icon = getErrorIcon(normalizedError.code, normalizedError.severity);

  const handleAction = useCallback(() => {
    const { action } = normalizedError;
    if (action.type === 'retry' && onRetry) {
      onRetry();
    } else if (action.type === 'navigate' && onNavigate) {
      onNavigate(action.path);
    } else if (action.type === 'auth' && onNavigate) {
      onNavigate('/login');
    } else if (action.type === 'dismiss' && onDismiss) {
      onDismiss();
    }
  }, [normalizedError, onRetry, onNavigate, onDismiss]);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3
        border rounded-xl
        ${styles.container}
        ${className}
      `}
      role="alert"
      aria-live="polite"
    >
      {/* Icon */}
      <div className={`p-2 rounded-lg ${styles.iconBg}`}>
        <Icon className={`w-4 h-4 flex-shrink-0 ${styles.icon}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${styles.title}`}>
          {normalizedError.title}
        </p>
        <p className={`text-xs ${styles.text} mt-0.5 truncate`}>
          {normalizedError.message}
        </p>
        {showRecovery && normalizedError.recovery && (
          <p className={`text-xs ${styles.text} opacity-70 mt-1`}>
            {normalizedError.recovery}
          </p>
        )}
      </div>

      {/* Action button */}
      {normalizedError.action.label && normalizedError.action.type !== 'wait' && normalizedError.action.type !== 'none' && (
        <button
          onClick={handleAction}
          className={`
            flex items-center gap-1
            text-xs font-medium
            px-3 py-2 rounded-lg
            transition-all duration-200
            ${styles.button}
          `}
        >
          {normalizedError.action.label}
          {normalizedError.action.type === 'retry' && <RefreshCw className="w-3 h-3 ml-0.5" />}
          {normalizedError.action.type === 'navigate' && <ChevronRight className="w-3 h-3" />}
        </button>
      )}

      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white/50 p-1 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// CARD VARIANT
// ============================================================================

function ErrorSurfaceCard({
  error,
  onRetry,
  onDismiss,
  onNavigate,
  className = '',
}) {
  const normalizedError = normalizeError(error);
  const styles = severityStyles[normalizedError.severity] || severityStyles[ERROR_SEVERITY.ERROR];
  const Icon = getErrorIcon(normalizedError.code, normalizedError.severity);

  const handleAction = useCallback(() => {
    const { action } = normalizedError;
    if (action.type === 'retry' && onRetry) {
      onRetry();
    } else if (action.type === 'navigate' && onNavigate) {
      onNavigate(action.path);
    } else if (action.type === 'auth' && onNavigate) {
      onNavigate('/login');
    }
  }, [normalizedError, onRetry, onNavigate]);

  return (
    <div
      className={`
        border rounded-2xl p-6
        ${styles.container}
        ${className}
      `}
      role="alert"
      aria-live="assertive"
    >
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl ${styles.iconBg}`}>
          <Icon className={`w-6 h-6 ${styles.icon}`} />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className={`text-lg font-semibold ${styles.title}`}>
            {normalizedError.title}
          </h3>
          <p className={`text-sm ${styles.text} mt-1`}>
            {normalizedError.message}
          </p>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-white/30 hover:text-white/50 p-1 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Recovery guidance */}
      {normalizedError.recovery && (
        <div className={`mt-4 p-3 rounded-lg bg-white/5 border border-white/10`}>
          <p className="text-xs text-white/50 uppercase tracking-wider mb-1">What to do</p>
          <p className={`text-sm ${styles.text}`}>{normalizedError.recovery}</p>
        </div>
      )}

      {/* Actions */}
      {normalizedError.action.label && normalizedError.action.type !== 'wait' && normalizedError.action.type !== 'none' && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleAction}
            className={`
              flex-1 flex items-center justify-center gap-2
              px-4 py-2.5 rounded-xl
              text-sm font-medium
              transition-all duration-200
              ${styles.primaryButton}
            `}
          >
            {normalizedError.action.type === 'retry' && <RefreshCw className="w-4 h-4" />}
            {normalizedError.action.type === 'auth' && <LogIn className="w-4 h-4" />}
            {normalizedError.action.type === 'navigate' && <ChevronRight className="w-4 h-4" />}
            {normalizedError.action.label}
          </button>

          {onDismiss && normalizedError.action.type !== 'dismiss' && (
            <button
              onClick={onDismiss}
              className={`
                px-4 py-2.5 rounded-xl
                text-sm font-medium
                transition-all duration-200
                ${styles.button}
              `}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FULLSCREEN VARIANT
// ============================================================================

function ErrorSurfaceFullscreen({
  error,
  onRetry,
  onNavigate,
  errorId,
}) {
  const normalizedError = normalizeError(error);
  const styles = severityStyles[normalizedError.severity] || severityStyles[ERROR_SEVERITY.ERROR];
  const Icon = getErrorIcon(normalizedError.code, normalizedError.severity);

  const handlePrimaryAction = useCallback(() => {
    const { action } = normalizedError;
    if (action.type === 'retry' && onRetry) {
      onRetry();
    } else if (action.type === 'navigate' && onNavigate) {
      onNavigate(action.path);
    } else if (action.type === 'auth' && onNavigate) {
      onNavigate('/login');
    } else if (onRetry) {
      onRetry();
    }
  }, [normalizedError, onRetry, onNavigate]);

  const handleGoHome = useCallback(() => {
    if (onNavigate) {
      onNavigate('/');
    } else {
      window.location.href = '/';
    }
  }, [onNavigate]);

  return (
    <div className="min-h-screen bg-black/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-gradient-to-br from-gray-900 to-black rounded-2xl p-8 max-w-lg w-full shadow-2xl border ${styles.container.replace('bg-', 'border-').replace('/5', '/30')}`}>
        {/* Error Icon */}
        <div className="flex items-center justify-center mb-6">
          <div className={`w-20 h-20 ${styles.iconBg} ring-2 ring-white/5 rounded-full flex items-center justify-center`}>
            <Icon className={`w-10 h-10 ${styles.icon}`} />
          </div>
        </div>

        {/* Error Title */}
        <div className="text-center mb-6">
          <h1 className={`text-2xl font-bold ${styles.title} mb-2`}>
            {normalizedError.title}
          </h1>
          <p className="text-gray-400">
            {normalizedError.message}
          </p>
        </div>

        {/* Recovery guidance */}
        {normalizedError.recovery && (
          <div className="bg-gray-800/50 rounded-lg p-4 mb-6 border border-gray-700 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">What to do</p>
            <p className="text-sm text-gray-300">{normalizedError.recovery}</p>
          </div>
        )}

        {/* Error Reference ID */}
        {errorId && (
          <div className="bg-gray-800/30 rounded-lg p-3 mb-6 border border-gray-700/50 text-center">
            <p className="text-xs text-gray-500 mb-1">Reference ID</p>
            <p className="text-sm font-mono text-gray-400">{errorId}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleGoHome}
            className="flex-1 border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5" />
            Dashboard
          </button>
          <button
            onClick={handlePrimaryAction}
            className={`flex-1 ${styles.primaryButton} py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98]`}
          >
            {normalizedError.action.type === 'retry' && <RefreshCw className="w-5 h-5" />}
            {normalizedError.action.type === 'auth' && <LogIn className="w-5 h-5" />}
            {normalizedError.action.label || 'Try Again'}
          </button>
        </div>

        {/* Help Text */}
        {errorId && (
          <div className="mt-6 pt-6 border-t border-gray-700">
            <p className="text-xs text-center text-gray-500">
              If this keeps happening, contact support with reference ID <span className="font-mono text-gray-400">{errorId}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TOAST VARIANT
// ============================================================================

function ErrorSurfaceToast({
  error,
  onDismiss,
  onRetry,
  duration = 5000,
  className = '',
}) {
  const [isVisible, setIsVisible] = useState(true);
  const normalizedError = normalizeError(error);
  const styles = severityStyles[normalizedError.severity] || severityStyles[ERROR_SEVERITY.ERROR];
  const Icon = getErrorIcon(normalizedError.code, normalizedError.severity);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onDismiss?.(), 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  if (!isVisible) return null;

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3
        bg-gray-900 border rounded-xl shadow-2xl
        ${styles.container.replace('bg-', 'border-')}
        animate-in slide-in-from-bottom-4 fade-in duration-300
        ${className}
      `}
      role="alert"
      aria-live="polite"
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${styles.icon}`} />

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${styles.title}`}>
          {normalizedError.title}
        </p>
        <p className={`text-xs ${styles.text} truncate`}>
          {normalizedError.message}
        </p>
      </div>

      {normalizedError.retryable && onRetry && (
        <button
          onClick={onRetry}
          className={`text-xs font-medium ${styles.button} px-2 py-1 rounded`}
        >
          Retry
        </button>
      )}

      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onDismiss?.(), 300);
        }}
        className="text-white/30 hover:text-white/50"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * ErrorSurface - Unified Error Display Component
 *
 * @param {Object} props
 * @param {Error|Object|string} props.error - The error to display
 * @param {'inline'|'card'|'fullscreen'|'toast'} [props.variant='inline'] - Display variant
 * @param {Function} [props.onRetry] - Callback when retry is clicked
 * @param {Function} [props.onDismiss] - Callback when dismissed
 * @param {Function} [props.onNavigate] - Callback for navigation (receives path)
 * @param {string} [props.errorId] - Reference ID for support (fullscreen only)
 * @param {number} [props.duration] - Auto-dismiss duration in ms (toast only)
 * @param {boolean} [props.showRecovery] - Show recovery guidance (inline only)
 * @param {string} [props.className] - Additional CSS classes
 */
export function ErrorSurface({
  error,
  variant = 'inline',
  onRetry,
  onDismiss,
  onNavigate,
  errorId,
  duration,
  showRecovery = true,
  className = '',
}) {
  // Handle no error
  if (!error) return null;

  // Render appropriate variant
  switch (variant) {
    case 'fullscreen':
      return (
        <ErrorSurfaceFullscreen
          error={error}
          onRetry={onRetry}
          onNavigate={onNavigate}
          errorId={errorId}
        />
      );

    case 'card':
      return (
        <ErrorSurfaceCard
          error={error}
          onRetry={onRetry}
          onDismiss={onDismiss}
          onNavigate={onNavigate}
          className={className}
        />
      );

    case 'toast':
      return (
        <ErrorSurfaceToast
          error={error}
          onDismiss={onDismiss}
          onRetry={onRetry}
          duration={duration}
          className={className}
        />
      );

    case 'inline':
    default:
      return (
        <ErrorSurfaceInline
          error={error}
          onRetry={onRetry}
          onDismiss={onDismiss}
          onNavigate={onNavigate}
          showRecovery={showRecovery}
          className={className}
        />
      );
  }
}

// ============================================================================
// COMPACT VARIANT (for tight spaces)
// ============================================================================

export function ErrorSurfaceCompact({
  error,
  onRetry,
  className = '',
}) {
  const normalizedError = normalizeError(error);
  const styles = severityStyles[normalizedError.severity] || severityStyles[ERROR_SEVERITY.ERROR];
  const Icon = getErrorIcon(normalizedError.code, normalizedError.severity);

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <Icon className={`w-3.5 h-3.5 ${styles.icon}`} />
      <span className={styles.text}>{normalizedError.message}</span>
      {normalizedError.retryable && onRetry && (
        <button
          onClick={onRetry}
          className="text-white/50 hover:text-white/70 underline underline-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ============================================================================
// HOOK FOR EASY ERROR STATE MANAGEMENT
// ============================================================================

/**
 * Hook for managing error state with ErrorSurface
 *
 * @returns {{ error, setError, clearError, ErrorDisplay }}
 */
export function useErrorSurface(defaultVariant = 'inline') {
  const [error, setError] = useState(null);

  const clearError = useCallback(() => setError(null), []);

  const ErrorDisplay = useCallback(({ variant = defaultVariant, ...props }) => {
    if (!error) return null;
    return (
      <ErrorSurface
        error={error}
        variant={variant}
        onDismiss={clearError}
        {...props}
      />
    );
  }, [error, clearError, defaultVariant]);

  return {
    error,
    setError,
    clearError,
    ErrorDisplay,
  };
}

export default ErrorSurface;
