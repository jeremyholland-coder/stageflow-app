import React, { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

/**
 * MaintenanceBanner - Shows when deployments are in progress
 *
 * Displays a banner to users when the app is being updated,
 * preventing confusion from temporary errors during deployment.
 *
 * Usage:
 * 1. Set MAINTENANCE_MODE=true in Netlify env before deploy
 * 2. Deploy new version
 * 3. Set MAINTENANCE_MODE=false after deploy completes
 */
export const MaintenanceBanner = () => {
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check for maintenance mode flag
    const checkMaintenanceMode = async () => {
      try {
        // Option 1: Check via a lightweight API endpoint
        const response = await fetch('/.netlify/functions/health-check', {
          method: 'HEAD',
          cache: 'no-cache',
          credentials: 'include' // Include HttpOnly auth cookies
        });

        // Check for maintenance header
        const maintenanceHeader = response.headers.get('X-Maintenance-Mode');
        if (maintenanceHeader === 'true') {
          setIsMaintenanceMode(true);
        }
      } catch (error) {
        // If health check fails, could indicate deployment in progress
        console.warn('Health check failed - possible maintenance mode');
      }
    };

    checkMaintenanceMode();

    // Poll every 10 seconds during maintenance
    const interval = setInterval(checkMaintenanceMode, 10000);

    return () => clearInterval(interval);
  }, []);

  // REMOVED: Auto-reload countdown
  // User can manually click "Refresh Now" button when ready

  if (!isMaintenanceMode || isDismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-[#F39C12] to-[#E67E22] text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Icon and message */}
          <div className="flex items-center gap-3 flex-1">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                We're upgrading StageFlow
              </p>
              <p className="text-xs text-white/90">
                Your data is safe. Please refresh when you're ready.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              title="Reload to get the latest version of StageFlow"
              className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Now
            </button>
            <button
              onClick={() => setIsDismissed(true)}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
