import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { captureError } from '../lib/sentry';
// Phase 2: Unified error handling integration
import { normalizeError, UNIFIED_ERROR_CODES } from '../lib/unified-errors';

/**
 * PRODUCTION-GRADE ERROR BOUNDARY
 *
 * Phase 2: Integrated with unified error handling system
 *
 * SECURITY: Never exposes stack traces, error messages, or internal details to users in production.
 * Only shows safe, user-friendly recovery UI.
 *
 * Error details are:
 * - Logged to console (server-side monitoring picks these up)
 * - Sent to Sentry if configured
 * - Stored in state for development-only display
 * - Normalized through unified error system for consistent messaging
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null, // Unique ID for support reference
      normalizedError: null, // Phase 2: Unified error format
    };
  }

  static getDerivedStateFromError(error) {
    // Generate unique error ID for support reference (safe to show users)
    const errorId = `SF-${Date.now().toString(36).toUpperCase()}`;
    // Phase 2: Normalize error for consistent messaging
    const normalizedError = normalizeError(error, 'ErrorBoundary');
    return { hasError: true, errorId, normalizedError };
  }

  componentDidCatch(error, errorInfo) {
    // SECURITY: Only log to console (picked up by monitoring tools)
    // Never expose to users in production
    console.error('[ErrorBoundary] Caught error:', {
      message: error?.message,
      name: error?.name,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      errorId: this.state.errorId,
      // Phase 2: Include normalized code for telemetry
      normalizedCode: this.state.normalizedError?.code,
    });

    // Store for development display only
    this.setState({
      error,
      errorInfo
    });

    // Send to Sentry (Phase 1 - Observability)
    // Only sends: errorId, error type/name, component stack (NO PII)
    captureError(error, {
      errorId: this.state.errorId,
      componentStack: errorInfo?.componentStack,
      errorBoundary: true,
      // Phase 2: Include normalized error code
      normalizedCode: this.state.normalizedError?.code,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, errorId: null, normalizedError: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, errorId: null, normalizedError: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Check if custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // PRODUCTION-SAFE: Only show generic error UI
      // Development mode shows additional details for debugging
      const isDev = import.meta.env?.DEV || process.env.NODE_ENV === 'development';

      // Phase 2: Use normalized error for Apple-grade messaging
      const { normalizedError } = this.state;
      const errorTitle = normalizedError?.title || 'Something Went Wrong';
      const errorMessage = normalizedError?.message || 'We hit an unexpected snag, but your data is safe.';
      const recoveryGuidance = normalizedError?.recovery || 'Try reloading the page.';

      return (
        <div className="min-h-screen bg-black/95 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-gray-900 to-black rounded-2xl p-8 max-w-lg w-full shadow-2xl border border-rose-500/20">
            {/* Error Icon */}
            <div className="flex items-center justify-center mb-6">
              <div className="w-20 h-20 bg-rose-500/10 ring-2 ring-rose-500/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-rose-400" />
              </div>
            </div>

            {/* Error Title - Apple-grade messaging from unified system */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-rose-100 mb-2">
                {errorTitle}
              </h1>
              <p className="text-gray-400">
                {errorMessage}
              </p>
            </div>

            {/* Recovery Guidance - Phase 2 Apple UX */}
            {recoveryGuidance && (
              <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-gray-700">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">What to do</p>
                <p className="text-sm text-gray-300">{recoveryGuidance}</p>
              </div>
            )}

            {/* Error Reference ID - Safe to show users for support */}
            <div className="bg-gray-800/30 rounded-lg p-3 mb-6 border border-gray-700/50 text-center">
              <p className="text-xs text-gray-500 mb-1">Reference ID</p>
              <p className="text-sm font-mono text-gray-400">{this.state.errorId}</p>
            </div>

            {/* Development-Only Error Details */}
            {isDev && this.state.error && (
              <div className="bg-red-900/20 rounded-lg p-4 mb-6 border border-red-500/30">
                <h3 className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wider">
                  Development Only - Hidden in Production
                </h3>
                <p className="text-xs text-red-400/80 mb-1">
                  Unified Code: <span className="font-mono">{normalizedError?.code}</span>
                </p>
                <p className="text-xs font-mono text-red-300 mb-2 break-words">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-400 cursor-pointer hover:text-red-300 transition">
                      Component Stack
                    </summary>
                    <pre className="text-xs text-red-400/70 mt-2 overflow-auto max-h-32 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={this.handleGoHome}
                title="Go to Dashboard"
                className="flex-1 border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
              >
                <Home className="w-5 h-5" />
                Dashboard
              </button>
              <button
                onClick={this.handleReset}
                title="Reload the application"
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20 hover:shadow-rose-500/40 hover:scale-[1.02] active:scale-[0.98]"
              >
                <RefreshCw className="w-5 h-5" />
                Reload
              </button>
            </div>

            {/* Help Text */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <p className="text-xs text-center text-gray-500">
                If this keeps happening, contact support with reference ID <span className="font-mono text-gray-400">{this.state.errorId}</span>
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
