/**
 * useOnlineStatus - Track network connectivity for offline support
 *
 * "Works on a plane" - Detect when user goes offline/online
 *
 * Features:
 * - Real-time online/offline detection
 * - Callbacks for state changes (onOnline, onOffline)
 * - Automatic sync trigger when coming back online
 * - Pending sync count for UI indicators
 *
 * Usage:
 * const { isOnline, pendingSyncCount } = useOnlineStatus({
 *   onOnline: () => syncOfflineCommands(),
 *   onOffline: () => { /* handle offline state */ },
 * });
 *
 * @author StageFlow Engineering
 * @date November 25, 2025
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPendingCommandCount } from '../lib/offlineStore';
import { logger } from '../lib/logger';

/**
 * Hook to track online/offline status
 *
 * @param {Object} options
 * @param {Function} options.onOnline - Callback when going online
 * @param {Function} options.onOffline - Callback when going offline
 * @param {string} options.organizationId - Org ID for pending count
 * @returns {Object} { isOnline, pendingSyncCount, wasOffline }
 */
export function useOnlineStatus({ onOnline, onOffline, organizationId } = {}) {
  const [isOnline, setIsOnline] = useState(() => {
    // SSR safety: default to true if navigator not available
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const wasOfflineRef = useRef(false);
  const isMountedRef = useRef(true);

  // Update pending count when org changes or online status changes
  const updatePendingCount = useCallback(async () => {
    if (!organizationId || !isMountedRef.current) return;

    try {
      const count = await getPendingCommandCount(organizationId);
      if (isMountedRef.current) {
        setPendingSyncCount(count);
      }
    } catch (error) {
      console.error('[useOnlineStatus] Failed to get pending count:', error);
    }
  }, [organizationId]);

  // Handle online event
  const handleOnline = useCallback(() => {
    logger.log('[Offline] Network restored - back online');
    setIsOnline(true);

    // If we were offline, trigger sync
    if (wasOfflineRef.current) {
      logger.log('[Offline] Was offline - triggering sync...');
      wasOfflineRef.current = false;

      // Update pending count
      updatePendingCount();

      // Call onOnline callback (typically triggers sync)
      if (onOnline) {
        onOnline();
      }
    }
  }, [onOnline, updatePendingCount]);

  // Handle offline event
  const handleOffline = useCallback(() => {
    logger.log('[Offline] Network lost - now offline');
    setIsOnline(false);
    wasOfflineRef.current = true;

    if (onOffline) {
      onOffline();
    }
  }, [onOffline]);

  // Set up event listeners
  useEffect(() => {
    isMountedRef.current = true;

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial status check
    const currentlyOnline = navigator.onLine;
    setIsOnline(currentlyOnline);

    if (!currentlyOnline) {
      wasOfflineRef.current = true;
    }

    // Initial pending count
    updatePendingCount();

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline, updatePendingCount]);

  // Re-check pending count when coming back online
  useEffect(() => {
    if (isOnline) {
      updatePendingCount();
    }
  }, [isOnline, updatePendingCount]);

  return {
    isOnline,
    pendingSyncCount,
    wasOffline: wasOfflineRef.current,
    refreshPendingCount: updatePendingCount,
  };
}

export default useOnlineStatus;
