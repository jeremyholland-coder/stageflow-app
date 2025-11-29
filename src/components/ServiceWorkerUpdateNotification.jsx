/**
 * ServiceWorkerUpdateNotification
 *
 * Notifies users when a new app version is available from the service worker.
 * Provides a "Refresh Now" button to load the update immediately.
 *
 * Integration with vite-plugin-pwa:
 * - Listens to service worker update events
 * - Shows banner when new version detected
 * - Triggers immediate refresh on user action
 */

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';

export const ServiceWorkerUpdateNotification = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState(null);
  const userApprovedRefresh = useRef(false);

  useEffect(() => {
    // Don't run in development (PWA is disabled)
    const isDev = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1';

    if (isDev) {
      return;
    }

    // Only run in browser (not SSR)
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let serviceWorkerReg = null;
    let updateFoundHandler = null;
    let refreshing = false;

    // CRITICAL FIX: Track worker instances and their handlers for proper cleanup
    const workerHandlers = new Map();

    // Listen for service worker updates
    const handleServiceWorkerUpdate = (reg) => {
      if (reg.waiting) {
        // New service worker is waiting to activate
        setUpdateAvailable(true);
        setRegistration(reg);
      }
    };

    // CRITICAL FIX: Only reload when user explicitly clicked "Refresh Now"
    // Prevents auto-reload on SW activation which logs users out
    const controllerChangeHandler = () => {
      if (!refreshing && userApprovedRefresh.current) {
        refreshing = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);

    // Check if there's already a waiting service worker
    navigator.serviceWorker.ready.then((reg) => {
      serviceWorkerReg = reg;

      if (reg.waiting) {
        handleServiceWorkerUpdate(reg);
      }

      // Listen for new service workers installing
      updateFoundHandler = () => {
        const newWorker = reg.installing;

        // CRITICAL FIX: Create handler and track it for cleanup
        const stateChangeHandler = () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker installed but waiting to activate
            handleServiceWorkerUpdate(reg);
          }
        };

        newWorker.addEventListener('statechange', stateChangeHandler);
        // CRITICAL FIX: Store worker-handler pair for cleanup
        workerHandlers.set(newWorker, stateChangeHandler);
      };
      reg.addEventListener('updatefound', updateFoundHandler);
    });

    return () => {
      // Cleanup listeners to prevent memory leaks
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
      if (serviceWorkerReg && updateFoundHandler) {
        serviceWorkerReg.removeEventListener('updatefound', updateFoundHandler);
      }

      // CRITICAL FIX: Clean up all worker statechange handlers
      workerHandlers.forEach((handler, worker) => {
        worker.removeEventListener('statechange', handler);
      });
      workerHandlers.clear();
    };
  }, []);

  const handleRefresh = () => {
    // Mark that user approved the refresh
    userApprovedRefresh.current = true;

    if (!registration?.waiting) {
      // Fallback: just reload
      window.location.reload();
      return;
    }

    // Tell waiting service worker to skip waiting and activate
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // The controllerchange event will trigger reload automatically (if user approved)
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
    // Update will still be available, just hide banner
    // On next navigation/reload, new version will activate
  };

  if (!updateAvailable) {
    return null;
  }

  return (
    // Fullscreen overlay - blocks interaction until user chooses action
    <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      {/* Update modal centered on screen */}
      <div className="max-w-md w-full bg-gradient-to-br from-gray-900 to-black rounded-2xl shadow-2xl border border-teal-500/30 p-8 animate-scale-in">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-teal-500/20 flex items-center justify-center ring-4 ring-teal-500/10">
            <RefreshCw className="w-10 h-10 text-teal-400 animate-pulse" />
          </div>
        </div>

        {/* Content */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-3">
            Update Available
          </h2>
          <p className="text-gray-400 leading-relaxed">
            A new version of StageFlow is ready. Refresh to get the latest features and improvements.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleRefresh}
            title="Refresh to load the latest version of StageFlow"
            className="w-full px-6 py-4 bg-teal-500 hover:bg-teal-600 text-white text-base font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh Now
          </button>
          <button
            onClick={handleDismiss}
            title="Continue using the current version and update later"
            className="w-full px-6 py-4 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50 text-base font-medium rounded-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            Update Later
          </button>
        </div>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-200 p-2 hover:bg-gray-800/50 rounded-lg"
          aria-label="Dismiss notification"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
