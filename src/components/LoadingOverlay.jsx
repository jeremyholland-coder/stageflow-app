import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

/**
 * LoadingOverlay Component
 *
 * Enhanced loading overlay with timeout detection and recovery options.
 * Prevents infinite loading circles by showing helpful messages and retry options.
 *
 * CRITICAL for new user onboarding - ensures users never get stuck on loading screens.
 */
export default function LoadingOverlay({
  message = 'Loading...',
  timeoutMs = 15000,
  onTimeout,
  onRetry,
  showRetry = true
}) {
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const startTime = Date.now();

    // Update elapsed time every second
    const intervalId = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    // Set timeout warning
    const timeoutId = setTimeout(() => {
      setIsTimedOut(true);

      if (onTimeout) {
        onTimeout({
          duration: timeoutMs,
          message,
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [timeoutMs, message, onTimeout]);

  const seconds = Math.floor(elapsedTime / 1000);
  const showSlowWarning = seconds >= 5 && !isTimedOut;

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-[9999] p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-4 w-full max-w-md p-6 sm:p-8 bg-gradient-to-br from-gray-900 to-black rounded-2xl shadow-2xl border border-teal-500/30 my-auto">
        {!isTimedOut ? (
          <>
            {/* Loading spinner */}
            <Loader2 className="w-12 h-12 animate-spin text-teal-500" />

            {/* Loading message */}
            <div className="text-center">
              <p className="text-base font-medium text-white mb-1">
                {message}
              </p>

              {/* Slow loading warning */}
              {showSlowWarning && (
                <p className="text-sm text-yellow-400 flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  This is taking longer than expected...
                </p>
              )}

              {/* Elapsed time (after 3 seconds) */}
              {seconds >= 3 && (
                <p className="text-xs text-gray-400 mt-2">
                  {seconds}s elapsed
                </p>
              )}
            </div>

            {/* Mobile-specific tip */}
            {showSlowWarning && (
              <p className="text-xs text-center text-gray-400 max-w-xs">
                Tip: Check your internet connection or try again in a moment
              </p>
            )}
          </>
        ) : (
          <>
            {/* Timeout error */}
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/20 ring-2 ring-red-500/10">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-semibold text-white mb-2">
                Loading Timed Out
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                This is taking longer than expected. This could be due to:
              </p>
              <ul className="text-xs text-left text-gray-400 space-y-1 mb-4">
                <li>• Slow internet connection</li>
                <li>• Temporary server issue</li>
                <li>• Network connectivity problem</li>
              </ul>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              {showRetry && onRetry && (
                <button
                  onClick={onRetry}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 sm:py-3 bg-teal-500 hover:bg-teal-600 text-white font-semibold rounded-lg shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all min-h-[48px] touch-manipulation"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}

              <button
                onClick={() => window.location.reload()}
                title="Reload the page and try loading again"
                className="flex-1 px-4 py-3.5 sm:py-3 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 font-medium rounded-lg hover:scale-[1.02] active:scale-[0.98] transition-all min-h-[48px] touch-manipulation"
              >
                Reload Page
              </button>
            </div>

            {/* Contact support */}
            <p className="text-xs text-center text-gray-400">
              Still having issues?{' '}
              <a
                href="mailto:support@stageflow.com"
                className="text-teal-400 hover:text-teal-300 hover:underline"
              >
                Contact support
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
