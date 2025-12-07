/**
 * NetworkStatusContext - Global network status for offline mode
 *
 * Area 3 - Offline Mode: Provides app-wide access to network status
 *
 * Features:
 * - Real-time online/offline detection
 * - Global access via useNetworkStatus() hook
 * - Sync trigger when coming back online
 * - Pending sync count for UI indicators
 * - Telemetry integration for observability
 *
 * Usage:
 * const { isOnline, isSyncing, pendingSyncCount, syncNow } = useNetworkStatus();
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getPendingCommandCount } from '../lib/offlineStore';
import { logger } from '../lib/logger';
import { trackEvent, addBreadcrumb } from '../lib/sentry';

// Context
const NetworkStatusContext = createContext(null);

/**
 * Hook to access network status from any component
 */
export function useNetworkStatus() {
  const context = useContext(NetworkStatusContext);
  if (!context) {
    // Graceful fallback if used outside provider
    return {
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: false,
      pendingSyncCount: 0,
      wasOffline: false,
      syncNow: () => Promise.resolve(),
      lastOnlineAt: null,
      lastOfflineAt: null,
    };
  }
  return context;
}

/**
 * NetworkStatusProvider - Wraps the app to provide global network status
 */
export function NetworkStatusProvider({ children, organizationId, onSync }) {
  // State
  const [isOnline, setIsOnline] = useState(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [lastOnlineAt, setLastOnlineAt] = useState(null);
  const [lastOfflineAt, setLastOfflineAt] = useState(null);

  // Refs
  const wasOfflineRef = useRef(false);
  const isMountedRef = useRef(true);
  const syncInProgressRef = useRef(false);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    if (!organizationId || !isMountedRef.current) return;

    try {
      const count = await getPendingCommandCount(organizationId);
      if (isMountedRef.current) {
        setPendingSyncCount(count);
      }
    } catch (error) {
      console.warn('[NetworkStatus] Failed to get pending count:', error);
    }
  }, [organizationId]);

  // Sync function - called when coming back online
  const syncNow = useCallback(async () => {
    if (syncInProgressRef.current || !isMountedRef.current) {
      return;
    }

    syncInProgressRef.current = true;
    setIsSyncing(true);

    // Telemetry: Log sync start
    const startCount = pendingSyncCount;
    logger.log('[Offline] Flushing offline queue', { queueSize: startCount });
    addBreadcrumb('Flushing offline queue', { category: 'offline', queueSize: startCount });

    try {
      // Call the provided sync function (from useDealManagement)
      if (onSync) {
        await onSync();
      }

      // Update pending count after sync
      await updatePendingCount();

      // Telemetry: Log sync complete
      const endCount = await getPendingCommandCount(organizationId);
      const syncedCount = startCount - endCount;

      logger.log('[Offline] Sync complete', {
        syncedCount,
        remainingCount: endCount,
      });

      addBreadcrumb('Offline sync complete', {
        category: 'offline',
        syncedCount,
        remainingCount: endCount,
      });

      trackEvent('offline_sync_complete', {
        syncedCount,
        remainingCount: endCount,
      });

    } catch (error) {
      console.error('[NetworkStatus] Sync failed:', error);

      addBreadcrumb('Offline sync failed', {
        category: 'offline',
        error: error.message,
      });

    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
        syncInProgressRef.current = false;
      }
    }
  }, [onSync, organizationId, pendingSyncCount, updatePendingCount]);

  // Handle online event
  const handleOnline = useCallback(() => {
    logger.log('[Offline] Network restored - back online');
    setIsOnline(true);
    setLastOnlineAt(new Date());

    // Telemetry
    addBreadcrumb('Network restored', {
      category: 'offline',
      wasOffline: wasOfflineRef.current,
    });

    trackEvent('network_online', {
      wasOffline: wasOfflineRef.current,
    });

    // If we were offline, trigger sync
    if (wasOfflineRef.current) {
      logger.log('[Offline] Was offline - triggering sync...');
      wasOfflineRef.current = false;
      syncNow();
    }
  }, [syncNow]);

  // Handle offline event
  const handleOffline = useCallback(() => {
    logger.log('[Offline] Network lost - now offline');
    setIsOnline(false);
    setLastOfflineAt(new Date());
    wasOfflineRef.current = true;

    // Telemetry
    addBreadcrumb('Network lost', { category: 'offline' });

    trackEvent('network_offline', {});
  }, []);

  // Set up event listeners
  useEffect(() => {
    isMountedRef.current = true;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial status check
    const currentlyOnline = navigator.onLine;
    setIsOnline(currentlyOnline);

    if (!currentlyOnline) {
      wasOfflineRef.current = true;
      setLastOfflineAt(new Date());
    }

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  // Update pending count when org changes or on mount
  useEffect(() => {
    updatePendingCount();
  }, [updatePendingCount]);

  // Re-check pending count when coming back online
  useEffect(() => {
    if (isOnline) {
      updatePendingCount();
    }
  }, [isOnline, updatePendingCount]);

  // Context value
  const value = {
    isOnline,
    isSyncing,
    pendingSyncCount,
    wasOffline: wasOfflineRef.current,
    syncNow,
    lastOnlineAt,
    lastOfflineAt,
    refreshPendingCount: updatePendingCount,
  };

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export default NetworkStatusProvider;
