/**
 * OfflineSyncIndicator - Compact indicator for offline queue status
 *
 * Phase 7: Offline Resilience
 *
 * Shows a subtle pill indicator when:
 * - User is offline (red pulse)
 * - There are pending changes to sync (amber with count)
 * - Sync is in progress (teal spinning)
 *
 * Design: Calm, non-disruptive, Apple-style
 * Click to manually trigger sync (when online)
 */

import React from 'react';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import { useNetworkStatus } from '../context/NetworkStatusContext';

export const OfflineSyncIndicator = ({ className = '' }) => {
  const { isOnline, isSyncing, pendingSyncCount, syncNow } = useNetworkStatus();

  // Don't show anything if online with no pending changes
  if (isOnline && pendingSyncCount === 0 && !isSyncing) {
    return null;
  }

  // Offline state
  if (!isOnline) {
    return (
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/30 ${className}`}
        role="status"
        aria-live="polite"
      >
        <CloudOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
        <span className="text-xs font-medium text-rose-300">Offline</span>
      </div>
    );
  }

  // Syncing state
  if (isSyncing) {
    return (
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/20 border border-teal-500/30 ${className}`}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin" />
        <span className="text-xs font-medium text-teal-300">Syncing...</span>
      </div>
    );
  }

  // Pending changes state (online but has queued commands)
  if (pendingSyncCount > 0) {
    return (
      <button
        onClick={syncNow}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 transition-colors ${className}`}
        role="status"
        aria-live="polite"
        title={`${pendingSyncCount} change${pendingSyncCount > 1 ? 's' : ''} pending sync. Click to sync now.`}
      >
        <Cloud className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          {pendingSyncCount} pending
        </span>
      </button>
    );
  }

  return null;
};

export default OfflineSyncIndicator;
