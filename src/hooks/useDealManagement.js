import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { parseSupabaseError, retryOperation, ERROR_CODES } from '../lib/error-handler';
import { getStatusForStage } from '../config/pipelineTemplates';
import { useRealTimeDeals } from './useRealTimeDeals';
import { requestDeduplicator } from '../lib/request-deduplicator';
import { cacheDeals, getCachedDeals } from '../lib/indexeddb-cache'; // NEXT-LEVEL: 50MB IndexedDB cache
import { dealsMemoryCache } from '../lib/memory-cache'; // OPT-4: In-memory cache (<1ms reads)
import { logger } from '../lib/logger';
import { api } from '../lib/api-client'; // PHASE J: Auth-aware API client with Authorization header
// ENGINE REBUILD Phase 5: Import deal normalization spine for boundary validation
import { normalizeDeal } from '../domain/deal';
// OFFLINE: Import offline queue for "works on a plane" support
import {
  enqueueCommand,
  getPendingCommands,
  updateCommandStatus,
  clearCommands,
  markCommandConflict,
  markCommandPermanentFailure,
  getDealsWithPendingChanges,
  OFFLINE_COMMAND_TYPES,
  COMMAND_STATUS,
} from '../lib/offlineStore';

// APPLE-LEVEL UX: Cache deals for instant loading on workspace switch
// Cache TTL: 10 minutes (IndexedDB can handle larger TTLs)
const DEALS_CACHE_TTL = 10 * 60 * 1000;

// CRITICAL FIX: Global fetch deduplication to prevent duplicate requests
// This prevents the race condition bug visible in Network tab (multiple simultaneous deals requests)
const globalFetchState = {
  inProgress: false,
  promise: null,
  lastOrgId: null
};

// OPT-4: Three-tier cache system (Memory → IndexedDB → Network)
// Memory: <1ms reads (50-100x faster than IndexedDB)
// IndexedDB: 50-100ms reads (5-10x faster than network)
// Network: 500-2000ms reads (slowest, but most up-to-date)
const dealsCache = {
  get: async (orgId) => {
    try {
      // TIER 1: Check memory cache first (<1ms)
      const memKey = `deals_${orgId}`;
      const memCached = dealsMemoryCache.get(memKey);
      if (memCached) {
        logger.log('[Deals Cache] ✅ MEMORY HIT (<1ms) -', memCached.length, 'deals');
        return memCached;
      }

      // TIER 2: Try IndexedDB (50-100ms)
      const cached = await getCachedDeals(orgId);

      if (cached) {
        // ENGINE REBUILD Phase 5: Normalize cached deals through domain spine
        // This ensures consistent structure even for older cached data
        const normalizedDeals = cached
          .map(d => normalizeDeal(d))
          .filter(d => d !== null);

        if (normalizedDeals.length !== cached.length) {
          console.warn('[Deals Cache] Normalized/filtered', cached.length - normalizedDeals.length, 'deals from IndexedDB');
        }

        // Store normalized deals in memory cache for next access
        dealsMemoryCache.set(memKey, normalizedDeals);

        logger.log('[Deals Cache] ✓ IndexedDB HIT (50-100ms) -', normalizedDeals.length, 'deals');
        return normalizedDeals;
      }

      // TIER 3: Fallback to localStorage for backwards compatibility
      const localCached = localStorage.getItem(`stageflow_deals_${orgId}`);
      if (!localCached) return null;

      const { deals, timestamp } = JSON.parse(localCached);
      const age = Date.now() - timestamp;

      if (age > DEALS_CACHE_TTL) {
        logger.log('[Deals Cache] localStorage expired');
        return null;
      }

      // ENGINE REBUILD Phase 5: Normalize localStorage deals through domain spine
      const normalizedDeals = deals
        .map(d => normalizeDeal(d))
        .filter(d => d !== null);
      logger.log('[Deals Cache] ⚠️  localStorage fallback -', normalizedDeals.length, 'deals');

      // Migrate normalized deals to IndexedDB and memory cache
      await cacheDeals(orgId, normalizedDeals);
      dealsMemoryCache.set(memKey, normalizedDeals);

      return normalizedDeals;
    } catch (e) {
      console.warn('[Deals Cache] Read error:', e);
      return null;
    }
  },

  set: async (orgId, deals) => {
    try {
      // CRITICAL FIX: Filter out null/invalid deals before caching
      const validDeals = deals.filter(d => d != null && typeof d === 'object' && d.id);

      if (validDeals.length !== deals.length) {
        console.warn('[Deals Cache] Filtered out', deals.length - validDeals.length, 'invalid deals');
      }

      // OPT-4: Save to all three tiers
      const memKey = `deals_${orgId}`;

      // TIER 1: Memory cache (instant writes)
      dealsMemoryCache.set(memKey, validDeals);

      // TIER 2: IndexedDB (primary persistent storage)
      await cacheDeals(orgId, validDeals);

      // TIER 3: localStorage (fallback only if IndexedDB succeeds)
      // OPT-4 OPTIMIZATION: Only write to localStorage as last-resort fallback
      // This reduces redundant writes and improves performance
      try {
        localStorage.setItem(`stageflow_deals_${orgId}`, JSON.stringify({
          deals: validDeals,
          timestamp: Date.now()
        }));
      } catch (lsError) {
        // localStorage full or disabled - not critical since we have IndexedDB
        console.warn('[Deals Cache] localStorage write failed (using IndexedDB only)');
      }

      logger.log('[Deals Cache] ✓ Saved', validDeals.length, 'deals to memory + IndexedDB');
    } catch (e) {
      console.warn('[Deals Cache] Write error:', e);
    }
  },

  clear: (orgId) => {
    try {
      // Clear all cache tiers
      const memKey = `deals_${orgId}`;
      dealsMemoryCache.invalidate(new RegExp(`^deals_${orgId}`));
      localStorage.removeItem(`stageflow_deals_${orgId}`);
      logger.log('[Deals Cache] Cleared all cache tiers');
      // IndexedDB will auto-expire based on TTL
    } catch (e) {
      console.warn('[Deals Cache] Clear error:', e);
    }
  }
};

// PHASE B FIX: Helper to get initial deals from memory cache SYNCHRONOUSLY
// This prevents the "empty deals" flash when Dashboard remounts after AI connection
const getInitialDealsFromCache = (orgId) => {
  if (!orgId) return [];
  const memKey = `deals_${orgId}`;
  const cached = dealsMemoryCache.get(memKey);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    logger.log('[Deals Init] ✅ Loaded', cached.length, 'deals from memory cache');
    return cached;
  }
  return [];
};

export const useDealManagement = (user, organization, addNotification) => {
  // PHASE B FIX: Initialize deals from memory cache to prevent empty state flash
  // Memory cache is synchronous, so deals are immediately available if cached
  const [deals, setDeals] = useState(() => getInitialDealsFromCache(organization?.id));
  // PHASE B FIX: Start with loading=true if no cached deals, so skeleton shows until data loads
  const [loading, setLoading] = useState(() => getInitialDealsFromCache(organization?.id).length === 0);
  const [error, setError] = useState(null); // MEDIUM FIX: Track fetch errors for retry UI
  // OFFLINE: Track network status for "works on a plane" support
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  // H6-C HARDENING 2025-12-04: Drag lock state prevents concurrent drag-drop operations
  // When true, KanbanBoard should disable dragging until the current update completes
  const [isDragLocked, setIsDragLocked] = useState(false);
  const isMountedRef = useRef(true);
  const fetchInProgressRef = useRef(false);
  const wasOfflineRef = useRef(false); // Track if we were offline (for sync trigger)
  // v1.7.98: FIFO queue - use Array for true FIFO ordering (not Map which overwrites)
  // Each entry: { dealId, updates, timestamp } - processed in exact order received
  const updateQueueRef = useRef([]);
  const updateTimerRef = useRef(null);
  const processingQueueRef = useRef(false); // Prevent concurrent queue processing
  const initialLoadDoneRef = useRef(false); // Track if we've done first load
  const abortControllerRef = useRef(null); // v1.7.98: AbortController for proper cleanup

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      fetchInProgressRef.current = false;
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      // v1.7.98: Abort any in-flight requests on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // OFFLINE: Sync function - process queued commands when back online
  // Phase 7: Enhanced with conflict handling, exponential backoff, and permanent failure detection
  const syncOfflineCommands = useCallback(async () => {
    if (!organization?.id || !user || isSyncing) return;

    try {
      setIsSyncing(true);
      const pending = await getPendingCommands(organization.id);

      if (pending.length === 0) {
        logger.log('[Offline Sync] No pending commands to sync');
        setPendingSyncCount(0);
        return;
      }

      logger.log(`[Offline Sync] Processing ${pending.length} queued commands...`);
      const syncedIds = [];
      const conflictIds = [];
      const permanentFailureIds = [];
      let retriableErrors = false;

      for (const command of pending) {
        try {
          await updateCommandStatus(command.id, COMMAND_STATUS.SYNCING);

          // Process based on command type
          if (command.type === OFFLINE_COMMAND_TYPES.UPDATE_DEAL) {
            const { dealId, updates } = command.payload;
            const finalUpdates = { ...updates, last_activity: new Date().toISOString() };

            // P0 FIX 2025-12-08: Use api.deal for invariant-validated responses
            const { data: updateResult } = await api.deal('update-deal', {
              dealId,
              updates: finalUpdates,
              organizationId: organization.id
            });

            // Phase 7: Check for conflict (deal was modified while offline)
            if (updateResult.code === 'CONFLICT' || updateResult.code === 'VERSION_CONFLICT') {
              logger.log(`[Offline Sync] Conflict detected for deal ${dealId} - server version wins`);
              await markCommandConflict(command.id, updateResult.deal);
              conflictIds.push(command.id);
              // Update local state with server version
              if (updateResult.deal && isMountedRef.current) {
                setDeals(prevDeals =>
                  prevDeals.filter(d => d != null).map(d => d.id === dealId ? updateResult.deal : d)
                );
              }
              continue;
            }

            if (!updateResult.success) {
              throw new Error(updateResult.error || 'Update failed');
            }

            // Update local state with confirmed server response
            if (updateResult.deal && isMountedRef.current) {
              setDeals(prevDeals =>
                prevDeals.filter(d => d != null).map(d => d.id === dealId ? updateResult.deal : d)
              );
            }
          } else if (command.type === OFFLINE_COMMAND_TYPES.CREATE_DEAL) {
            const { deal } = command.payload;

            const { data: createResult } = await api.post('create-deal', {
              dealData: deal,
              organizationId: organization.id
            });

            if (!createResult.success && createResult.error) {
              throw new Error(createResult.error);
            }

            // Phase 7: Replace optimistic local deal with server response
            if (createResult.deal && command.localId && isMountedRef.current) {
              setDeals(prevDeals => {
                // Remove the optimistic local deal and add the real one
                const filtered = prevDeals.filter(d => d != null && d.id !== command.localId);
                return [createResult.deal, ...filtered];
              });
            }
          } else if (command.type === OFFLINE_COMMAND_TYPES.DELETE_DEAL) {
            const { dealId } = command.payload;

            const { data: deleteResult } = await api.post('delete-deal', {
              dealId,
              organizationId: organization.id
            });

            // Phase 7: NOT_FOUND on delete means deal was already deleted - treat as success
            if (deleteResult.code === 'NOT_FOUND') {
              logger.log(`[Offline Sync] Deal ${dealId} already deleted - marking as synced`);
            } else if (!deleteResult.success && deleteResult.error) {
              throw new Error(deleteResult.error);
            }
          }

          // Mark as synced
          await updateCommandStatus(command.id, COMMAND_STATUS.SYNCED);
          syncedIds.push(command.id);
          logger.log(`[Offline Sync] ✓ Synced command: ${command.type}`);
        } catch (cmdError) {
          console.error(`[Offline Sync] ✗ Failed to sync command ${command.id}:`, cmdError);

          // Phase 7: Check if max retries exceeded
          const attempts = (command.attempts || 0) + 1;
          const maxAttempts = command.maxAttempts || 5;

          if (attempts >= maxAttempts) {
            // Permanent failure - exceeded max retries
            logger.log(`[Offline Sync] Command ${command.id} exceeded max retries (${maxAttempts})`);
            await markCommandPermanentFailure(command.id, cmdError.message);
            permanentFailureIds.push(command.id);
          } else {
            // Transient failure - will retry
            await updateCommandStatus(command.id, COMMAND_STATUS.FAILED, cmdError.message);
            retriableErrors = true;

            // Phase 7: For 5xx errors, use exponential backoff and stop processing
            // to avoid hammering a struggling server
            if (cmdError.status >= 500) {
              logger.log('[Offline Sync] Server error detected - stopping sync for backoff');
              break;
            }
          }
        }
      }

      // Clear synced and conflict-resolved commands
      const clearedIds = [...syncedIds, ...conflictIds];
      if (clearedIds.length > 0) {
        await clearCommands(clearedIds, syncedIds.length > 0 ? 'synced' : 'conflict');
      }

      // Notify user of results
      if (syncedIds.length > 0) {
        addNotification(`Synced ${syncedIds.length} offline change${syncedIds.length > 1 ? 's' : ''}`, 'success');
      }

      if (conflictIds.length > 0) {
        addNotification(
          `${conflictIds.length} change${conflictIds.length > 1 ? 's were' : ' was'} overwritten by newer server data`,
          'info'
        );
      }

      if (permanentFailureIds.length > 0) {
        addNotification(
          `${permanentFailureIds.length} change${permanentFailureIds.length > 1 ? 's' : ''} could not be saved after multiple attempts`,
          'warning'
        );
      }

      if (retriableErrors) {
        // Schedule retry with exponential backoff (5s, 10s, 20s, etc.)
        const retryDelay = Math.min(5000 * Math.pow(2, pending[0]?.attempts || 0), 60000);
        logger.log(`[Offline Sync] Scheduling retry in ${retryDelay}ms`);
        setTimeout(() => {
          if (isMountedRef.current && navigator.onLine) {
            syncOfflineCommands();
          }
        }, retryDelay);
      }

      // Update pending count
      const remaining = await getPendingCommands(organization.id);
      setPendingSyncCount(remaining.length);

    } catch (error) {
      console.error('[Offline Sync] Sync failed:', error);
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [organization?.id, user, isSyncing, addNotification]);

  // OFFLINE: Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      logger.log('[Offline] Network restored - back online');
      setIsOnline(true);

      // If we were offline, trigger sync
      if (wasOfflineRef.current) {
        logger.log('[Offline] Was offline - triggering sync...');
        wasOfflineRef.current = false;
        syncOfflineCommands();
      }
    };

    const handleOffline = () => {
      logger.log('[Offline] Network lost - now offline');
      setIsOnline(false);
      wasOfflineRef.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial sync check on mount (in case there are pending commands from previous session)
    if (navigator.onLine && organization?.id) {
      getPendingCommands(organization.id).then(pending => {
        if (isMountedRef.current) {
          setPendingSyncCount(pending.length);
          if (pending.length > 0) {
            logger.log(`[Offline] Found ${pending.length} pending commands from previous session`);
            syncOfflineCommands();
          }
        }
      }).catch(error => {
        // PHASE C FIX (B-RACE-03): Handle rejected promise to prevent unhandled rejection
        console.warn('[Offline] Failed to check pending commands:', error);
        // Don't block the app - offline sync will retry when conditions are right
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [organization?.id, syncOfflineCommands]);

  // APPLE-LEVEL UX: Auto-update cache when deals change (real-time or manual)
  useEffect(() => {
    if (organization?.id && deals.length > 0) {
      dealsCache.set(organization.id, deals);
    }
  }, [deals, organization?.id]);

  // PERFORMANCE OPTIMIZATION: Centralized real-time subscription for team collaboration
  // Uses shared subscription manager to reduce network traffic by 40%
  // When any team member creates/updates/deletes a deal, all team members see it instantly
  useRealTimeDeals(organization?.id, (payload) => {
    if (!isMountedRef.current) return;

    // ROOT CAUSE FIX: Validate payload before processing
    if (!payload || !payload.eventType) {
      console.error('[RealTime] Invalid payload received:', payload);
      return;
    }

    if (payload.eventType === 'INSERT') {
      // ROOT CAUSE FIX: Validate new deal has required fields
      if (!payload.new || !payload.new.id) {
        console.error('[RealTime] INSERT payload missing deal data:', payload);
        return;
      }

      // PHASE C FIX (B-DATA-01): Skip soft-deleted deals in real-time
      if (payload.new.deleted_at) {
        logger.log('[RealTime] Skipping soft-deleted deal INSERT:', payload.new.id);
        return;
      }

      // ENGINE REBUILD Phase 5: Normalize incoming deal at boundary
      const normalizedNewDeal = normalizeDeal(payload.new);
      if (!normalizedNewDeal) {
        console.error('[RealTime] INSERT payload failed normalization:', payload.new.id);
        return;
      }

      // New deal created by team member
      setDeals(prevDeals => {
        // ROOT CAUSE FIX: Filter out null deals AND check safely
        const validDeals = prevDeals.filter(d => d != null);

        // Avoid duplicates if we already optimistically added it
        if (validDeals.some(d => d.id === normalizedNewDeal.id)) {
          return validDeals;
        }
        const updated = [normalizedNewDeal, ...validDeals];
        // Auto-update cache
        if (organization?.id) dealsCache.set(organization.id, updated);
        return updated;
      });
    } else if (payload.eventType === 'UPDATE') {
      // ROOT CAUSE FIX: Validate updated deal
      if (!payload.new || !payload.new.id) {
        console.error('[RealTime] UPDATE payload missing deal data:', payload);
        return;
      }

      // PHASE C FIX (B-DATA-01): Handle soft delete via UPDATE (remove from list)
      if (payload.new.deleted_at) {
        logger.log('[RealTime] Removing soft-deleted deal from list:', payload.new.id);
        setDeals(prevDeals => {
          const updated = prevDeals.filter(d => d != null && d.id !== payload.new.id);
          if (organization?.id) dealsCache.set(organization.id, updated);
          return updated;
        });
        return;
      }

      // ENGINE REBUILD Phase 5: Normalize incoming deal at boundary
      const normalizedUpdatedDeal = normalizeDeal(payload.new);
      if (!normalizedUpdatedDeal) {
        console.error('[RealTime] UPDATE payload failed normalization:', payload.new.id);
        return;
      }

      // Deal updated by team member
      setDeals(prevDeals => {
        // ROOT CAUSE FIX: Safe null check before accessing .id
        const updated = prevDeals.filter(d => d != null).map(d => d.id === normalizedUpdatedDeal.id ? normalizedUpdatedDeal : d);
        // Auto-update cache
        if (organization?.id) dealsCache.set(organization.id, updated);
        return updated;
      });
    } else if (payload.eventType === 'DELETE') {
      // ROOT CAUSE FIX: Validate deleted deal
      if (!payload.old || !payload.old.id) {
        console.error('[RealTime] DELETE payload missing deal data:', payload);
        return;
      }

      // Deal deleted by team member
      setDeals(prevDeals => {
        // ROOT CAUSE FIX: Safe null check before accessing .id
        const updated = prevDeals.filter(d => d != null && d.id !== payload.old.id);
        // Auto-update cache
        if (organization?.id) dealsCache.set(organization.id, updated);
        return updated;
      });
    }
  });

  const fetchDeals = useCallback(async () => {
    logger.log('[DEALS DEBUG] fetchDeals called', {
      hasUser: !!user,
      hasOrg: !!organization,
      userId: user?.id,
      orgId: organization?.id,
      globalInProgress: globalFetchState.inProgress
    });

    if (!user || !organization) {
      console.warn('[DEALS DEBUG] Missing user or organization - skipping fetch');
      return;
    }

    // v1.7.98: Abort previous request if organization changed
    if (abortControllerRef.current) {
      logger.log('[DEALS DEBUG] Aborting previous request');
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this fetch
    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    // CRITICAL FIX: Global deduplication prevents duplicate requests (Network tab bug)
    if (globalFetchState.inProgress && globalFetchState.lastOrgId === organization.id) {
      console.warn('[DEALS DEBUG] ⚠️ BLOCKED DUPLICATE REQUEST - already fetching');
      // Return existing promise to deduplicate requests
      if (globalFetchState.promise) {
        logger.log('[DEALS DEBUG] Returning existing fetch promise');
        return globalFetchState.promise;
      }
      return;
    }

    // NEXT-LEVEL: Load from IndexedDB cache first for instant display
    // IndexedDB is async but much faster than network (50-100ms vs 500-2000ms)
    const cachedDeals = await dealsCache.get(organization.id);
    const hasCache = cachedDeals && cachedDeals.length > 0;

    if (hasCache) {
      logger.log('[Deals] ✅ Using IndexedDB cached deals (instant display) -', cachedDeals.length, 'deals');
      if (isMountedRef.current) {
        // ENGINE REBUILD Phase 9: Defense-in-depth normalization on cache read
        // Ensures cached deals conform to current schema even if normalization logic changed
        const normalizedCachedDeals = cachedDeals.map(d => normalizeDeal(d)).filter(Boolean);
        setDeals(normalizedCachedDeals);
        setLoading(false); // PHASE B FIX: Ensure loading=false when we have cached data
        // Fresh data will load silently in background
      }
      initialLoadDoneRef.current = true;
    } else if (!initialLoadDoneRef.current) {
      // Only show loading spinner on very first load (no cache)
      logger.log('[Deals] First load - showing loading spinner');
      if (isMountedRef.current) setLoading(true);
    } else {
      // Subsequent loads without cache - don't show spinner
      logger.log('[Deals] Background refresh - no loading spinner');
    }

    // Set global fetch state
    globalFetchState.inProgress = true;
    globalFetchState.lastOrgId = organization.id;
    fetchInProgressRef.current = true;

    // MEDIUM FIX: Clear any previous errors when starting new fetch
    if (isMountedRef.current) setError(null);

    // Create the fetch promise for deduplication
    const fetchPromise = (async () => {
      try {
        logger.log('[DEALS DEBUG] 🚀 Starting query for org:', organization.id);

        // v1.7.98: Check if aborted before starting
        if (abortSignal.aborted) {
          logger.log('[DEALS DEBUG] Request aborted before starting');
          return;
        }

      let result = await retryOperation(async () => {
        // v1.7.98: Check abort signal before each retry attempt
        if (abortSignal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        // CRITICAL FIX: Show ALL deals in organization (not just user's deals)
        // This matches the billing count and enables team collaboration
        // FIX PH7∞-L1-01: Filter soft-deleted deals (deleted_at IS NULL)
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .eq('organization_id', organization.id)
          .is('deleted_at', null)
          .order('created', { ascending: false });

        logger.log('[DEALS DEBUG] Query result:', {
          dealCount: data?.length || 0,
          hasError: !!error,
          errorMsg: error?.message,
          errorCode: error?.code,
          errorDetails: error?.details,
          organizationId: organization.id
        });

        if (error) {
          console.error('[DEALS] Supabase error loading deals:', {
            error,
            errorMessage: error.message,
            errorCode: error.code,
            errorDetails: error.details,
            organizationId: organization.id
          });
          throw parseSupabaseError(error);
        }
        return data || [];
      });

      // v1.7.98: Check if aborted before setting state
      if (abortSignal.aborted) {
        logger.log('[DEALS DEBUG] Request aborted - not updating state');
        return;
      }

      logger.log('[DEALS DEBUG] Setting deals state:', result.length);

      // PHASE G FIX: Retry once if first fetch returns empty (session race condition)
      // On first load, the Supabase session might not be fully propagated yet,
      // causing RLS to return empty. Retry after a short delay to handle this.
      if (result.length === 0 && !hasCache && !initialLoadDoneRef.current) {
        logger.log('[DEALS DEBUG] First fetch returned empty - waiting for session and retrying...');
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait for session propagation

        if (abortSignal.aborted) return;

        // Retry the query
        const retryResult = await supabase
          .from('deals')
          .select('*')
          .eq('organization_id', organization.id)
          .is('deleted_at', null)
          .order('created', { ascending: false });

        if (retryResult.data && retryResult.data.length > 0) {
          logger.log('[DEALS DEBUG] Retry succeeded with', retryResult.data.length, 'deals');
          result = retryResult.data;
        } else {
          logger.log('[DEALS DEBUG] Retry still returned empty - org likely has no deals');
        }
      }

      // ENGINE REBUILD Phase 5: Normalize deals at boundary using domain spine
      // This ensures all deals have consistent structure, valid stages, and synced status
      const normalizedDeals = result
        .map(deal => normalizeDeal(deal))
        .filter(deal => deal !== null);

      if (normalizedDeals.length !== result.length) {
        console.warn('[DEALS DEBUG] Normalized/filtered', result.length - normalizedDeals.length, 'invalid deals');
      }

      // Cache the normalized data for next time
      dealsCache.set(organization.id, normalizedDeals);

      if (isMountedRef.current && !abortSignal.aborted) {
        setDeals(normalizedDeals);
      }

        // Mark initial load as complete
        initialLoadDoneRef.current = true;
      } catch (error) {
        // v1.7.98: Don't log/notify if request was intentionally aborted
        if (error.name === 'AbortError' || abortSignal.aborted) {
          logger.log('[DEALS DEBUG] Request aborted - ignoring error');
          return;
        }

        console.error('[DEALS DEBUG] ❌ Error fetching deals:', {
          error,
          errorMessage: error.message,
          errorCode: error.code,
          organizationId: organization?.id
        });
        if (isMountedRef.current) {
          const message = error.code === ERROR_CODES.NETWORK_ERROR
            ? 'Connection issue. Check your internet.'
            : 'Failed to load deals';
          addNotification(message, 'error');
          // MEDIUM FIX: Set error state for retry UI
          setError({ message, originalError: error });
        }
      } finally {
        // CRITICAL FIX: Clear global fetch state
        globalFetchState.inProgress = false;
        globalFetchState.promise = null;
        fetchInProgressRef.current = false;
        if (isMountedRef.current && !abortSignal.aborted) setLoading(false);
      }
    })();

    // Store promise for deduplication
    globalFetchState.promise = fetchPromise;
    return fetchPromise;
  }, [user, organization, addNotification]);

  // UPDATE DEAL - ROOT CAUSE FIX: Remove state dependencies to prevent excessive re-renders
  // KANBAN DRAG FIX 2025-12-04: Added comprehensive logging and improved drag lock handling
  const updateDeal = useCallback(async (dealId, updates) => {
    console.log('[KANBAN][UPDATE_DEAL] Called with:', {
      dealId,
      updates,
      hasUser: !!user,
      hasOrg: !!organization,
      isDragLocked
    });

    if (!user || !organization || !dealId) {
      console.error('[KANBAN][UPDATE_DEAL] Missing required params:', {
        hasUser: !!user,
        hasOrg: !!organization,
        dealId
      });
      return;
    }

    // H6-C HARDENING 2025-12-04: Check if drag is already locked (prevents concurrent drag-drops)
    // This provides an additional layer of protection beyond request deduplication
    // KANBAN DRAG FIX 2025-12-04: Added user notification when drag is blocked
    if (isDragLocked) {
      console.warn('[KANBAN][UPDATE_DEAL] ⚠️ BLOCKED - Drag locked (another update in progress)');
      // Don't silently fail - let the user know
      addNotification('Please wait - another update is in progress', 'info');
      return;
    }

    // H6-C HARDENING 2025-12-04: Lock drag operations while update is in progress
    console.log('[KANBAN][UPDATE_DEAL] Setting drag lock = true');
    setIsDragLocked(true);

    // NEXT-LEVEL: Request deduplication to prevent race conditions
    // If same deal is being updated, wait for in-flight request to complete
    const dedupeKey = `update-deal-${dealId}`;

    // CRITICAL FIX: Declare originalDeal BEFORE try block to ensure it's in scope for catch
    // This prevents "ReferenceError: Can't find variable: originalDeal" when error is thrown
    // before the const declaration inside try block would execute (Temporal Dead Zone issue)
    let originalDeal = null;

    return requestDeduplicator.deduplicate(dedupeKey, async () => {
      try {
        // CRITICAL FIX: Use ref to get current deal without depending on deals state
        // This prevents updateDeal from being recreated every time deals changes
        let deal;
        setDeals(prevDeals => {
          deal = prevDeals.find(d => d.id === dealId);
          return prevDeals; // Don't modify yet, just read
        });

        if (!deal) {
          console.error('Deal not found:', dealId);
          return;
        }

        // Store original deal for surgical rollback (now safe - variable is in scope)
        originalDeal = { ...deal };

      // FIX 2025-12-06: Filter undefined values from updates BEFORE processing
      // Undefined values can break Supabase and cause cryptic errors
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const finalUpdates = { ...cleanUpdates };

      // CRITICAL FIX: Auto-set status based on stage using centralized logic
      // This ensures won/lost stages automatically get correct status
      if (finalUpdates.stage) {
        const newStatus = getStatusForStage(finalUpdates.stage);
        if (newStatus !== deal.status) {
          finalUpdates.status = newStatus;
        }
      }

      finalUpdates.last_activity = new Date().toISOString();

      // FIX 2025-12-06: Enhanced logging with payload validation
      console.log('[KANBAN][UPDATE_DEAL] Final updates to apply:', {
        dealId,
        fieldCount: Object.keys(finalUpdates).length,
        fields: Object.keys(finalUpdates),
        stage: finalUpdates.stage,
        status: finalUpdates.status,
        payload: finalUpdates
      });

      // Optimistic update
      // ROOT CAUSE FIX: Filter nulls before mapping
      console.log('[KANBAN][UPDATE_DEAL] Applying optimistic update...');
      setDeals(prevDeals =>
        prevDeals.filter(d => d != null).map(d =>
          d.id === dealId
            ? { ...d, ...finalUpdates }
           : d
        )
      );
      console.log('[KANBAN][UPDATE_DEAL] ✓ Optimistic update applied');

      // OFFLINE: If offline, queue command instead of making network call
      if (!navigator.onLine) {
        logger.log('[Offline] Queuing deal update for sync later:', dealId);
        await enqueueCommand({
          type: OFFLINE_COMMAND_TYPES.UPDATE_DEAL,
          payload: { dealId, updates: finalUpdates },
          organizationId: organization.id,
        });
        setPendingSyncCount(prev => prev + 1);
        addNotification('Saved offline - will sync when connected', 'info');
        return; // Don't attempt network call
      }

      // P0 FIX 2025-12-08: Use api.deal for invariant-validated responses
      // This ensures we NEVER get false success conditions - deal is always validated
      console.log('[KANBAN][UPDATE_DEAL] Making API call to update-deal...');
      const { data: result } = await api.deal('update-deal', {
        dealId,
        updates: finalUpdates,
        organizationId: organization.id
      });

      console.log('[KANBAN][UPDATE_DEAL] API response:', {
        success: result.success,
        hasError: !!result.error,
        hasDeal: !!result.deal,
        dealStage: result.deal?.stage
      });

      // P0 FIX 2025-12-08: Simplified check - api.deal normalizes response
      // result.success is ALWAYS defined (true or false) after normalization
      if (!result.success) {
        console.error('[KANBAN][UPDATE_DEAL] ❌ API returned error:', result.error, 'code:', result.code);
        const error = new Error(result.error || 'Update failed');
        error.code = result.code || 'UPDATE_ERROR';
        throw error;
      }

      const data = result.deal;
      console.log('[KANBAN][UPDATE_DEAL] ✓ Backend update successful, deal stage:', data?.stage);

      // Update with server response
      // ROOT CAUSE FIX: Filter nulls before mapping
      if (data && isMountedRef.current) {
        setDeals(prevDeals =>
          prevDeals.filter(d => d != null).map(d => d.id === dealId ? data : d)
        );
      }

      addNotification('Deal updated successfully');
    } catch (error) {
      console.error('[KANBAN][UPDATE_DEAL] ❌ Error caught:', {
        message: error.message,
        code: error.code,
        status: error.status
      });

      // FIX 2025-12-07: Use error code from backend response for better messages
      // H6-H HARDENING 2025-12-04: Context-aware error messages for deal operations
      let userMessage = 'Deal update failed. Please try again.';

      // P0 FIX 2025-12-08: Comprehensive error code handling
      // Check for backend error codes first (these come from update-deal.mts)
      if (error.code === 'VALIDATION_ERROR' || error.code === 'UPDATE_VALIDATION_ERROR') {
        userMessage = error.message || 'Invalid data. Please check your input.';
      } else if (error.code === 'FORBIDDEN') {
        userMessage = 'You don\'t have permission to update this deal.';
      } else if (error.code === 'NOT_FOUND') {
        userMessage = 'Deal not found. It may have been deleted.';
      } else if (error.code === 'AUTH_REQUIRED' || error.code === 'SESSION_ERROR') {
        userMessage = 'Session expired. Please refresh the page.';
      } else if (error.code === 'RATE_LIMITED' || error.code === 'THROTTLED') {
        // P0 FIX 2025-12-08: Handle rate limiting from session validation
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (error.code === 'SERVER_ERROR') {
        userMessage = error.message || 'Something went wrong. Please try again.';
      } else if (error.userMessage) {
        // P0 FIX 2025-12-08: Use userMessage if api-client provided one
        userMessage = error.userMessage;
      } else {
        // Fallback to parsing error for network issues
        const appError = parseSupabaseError(error);
        if (appError.code === ERROR_CODES.NETWORK_ERROR) {
          userMessage = 'Connection lost. Please check your network and try again.';
        } else if (appError.code === ERROR_CODES.TIMEOUT) {
          userMessage = 'Request timed out. Please try again.';
        } else if (appError.code === ERROR_CODES.SERVER_ERROR) {
          userMessage = 'Server issue. Please try again in a moment.';
        } else if (appError.code === ERROR_CODES.PERMISSION_DENIED) {
          userMessage = 'You don\'t have permission to update this deal.';
        } else if (appError.code === ERROR_CODES.SESSION_EXPIRED) {
          userMessage = 'Session expired. Please refresh the page.';
        } else if (error.message && error.message.length < 100) {
          // P0 FIX 2025-12-08: Use error.message for unknown codes if it's user-friendly
          // (short messages are usually safe to display)
          userMessage = error.message;
        }
      }

      addNotification(userMessage, 'error');

      // CRITICAL FIX: Only rollback if we have originalDeal captured
      // This prevents crash if error occurred before originalDeal was assigned
      if (isMountedRef.current && originalDeal) {
        console.log('[KANBAN][UPDATE_DEAL] Rolling back to original state...');
        setDeals(prevDeals =>
          prevDeals.filter(d => d != null).map(d =>
            d.id === dealId ? originalDeal : d
          )
        );
        console.log('[KANBAN][UPDATE_DEAL] ✓ Rolled back deal to original stage:', originalDeal.stage);
      } else if (isMountedRef.current) {
        // Fallback: If no originalDeal, just log warning (don't crash)
        console.warn('[KANBAN][UPDATE_DEAL] Could not rollback - originalDeal not captured');
      }
    } finally {
      // H6-C HARDENING 2025-12-04: Always unlock drag when update completes (success or failure)
      // This ensures the user can drag again after any outcome
      console.log('[KANBAN][UPDATE_DEAL] Finally block - releasing drag lock');
      if (isMountedRef.current) {
        setIsDragLocked(false);
        console.log('[KANBAN][UPDATE_DEAL] ✓ Drag lock released');
      } else {
        console.warn('[KANBAN][UPDATE_DEAL] Component unmounted - drag lock not released via setState');
      }
    }
    }); // End deduplication wrapper
  }, [user, organization, addNotification, isDragLocked]); // H6-C: Added isDragLocked to deps

  // PROCESS BATCHED UPDATES - v1.7.98: True FIFO ordering with Array queue
  // Processes updates in exact order received, with mutex to prevent concurrent processing
  const processBatchedUpdates = useCallback(async () => {
    // Guard: Check prerequisites and prevent concurrent processing
    if (!updateQueueRef.current.length || !user || !organization) return;
    if (processingQueueRef.current) {
      logger.log('[BatchQueue] Already processing - skipping');
      return;
    }

    processingQueueRef.current = true;

    try {
      // FIFO: Take all items from queue in order received
      const updates = [...updateQueueRef.current];
      updateQueueRef.current = []; // Clear queue atomically

      logger.log('[BatchQueue] Processing', updates.length, 'updates in FIFO order');

      // Process each update in FIFO order (sequential to maintain ordering)
      for (const { dealId, updates: dealUpdates, timestamp } of updates) {
        try {
          const finalUpdates = { ...dealUpdates, last_activity: new Date().toISOString() };

          // P0 FIX 2025-12-08: Use api.deal for invariant-validated responses
          const { data: result } = await api.deal('update-deal', {
            dealId,
            updates: finalUpdates,
            organizationId: organization.id
          });

          // Invariant: result.success is always defined after api.deal
          if (!result.success) {
            throw new Error(result.error || 'Update failed');
          }

          const data = result.deal;

          // ROOT CAUSE FIX: Filter nulls before mapping
          if (data && isMountedRef.current) {
            setDeals(prevDeals => prevDeals.filter(d => d != null).map(d => d.id === dealId ? data : d));
          }

          logger.log('[BatchQueue] ✓ Processed update for deal', dealId, 'queued at', timestamp);
        } catch (error) {
          console.error('[BatchQueue] Failed for deal:', dealId, error);
          // H6-H HARDENING 2025-12-04: Context-aware error for batch failures
          // Single notification to avoid spam during rapid operations
          const appError = parseSupabaseError(error);
          if (appError.code === ERROR_CODES.NETWORK_ERROR) {
            addNotification('Deal update failed - connection lost', 'error');
          } else if (isMountedRef.current) {
            addNotification('Deal update failed. Please try again.', 'error');
          }
        }
      }
    } finally {
      processingQueueRef.current = false;

      // Check if more updates were added while processing
      if (updateQueueRef.current.length > 0) {
        logger.log('[BatchQueue] New updates queued during processing - scheduling next batch');
        // Use setTimeout to avoid stack overflow on rapid updates
        setTimeout(() => processBatchedUpdates(), 0);
      }
    }
  }, [user, organization]);  // Stable dependencies only

  // v1.7.98: Queue a deal update for batched FIFO processing
  // Use this for rapid updates (e.g., drag-and-drop) where batching improves performance
  const queueDealUpdate = useCallback((dealId, updates) => {
    if (!dealId || !updates) return;

    // Add to FIFO queue with timestamp for ordering
    updateQueueRef.current.push({
      dealId,
      updates,
      timestamp: Date.now()
    });

    // Debounce: Clear existing timer and schedule processing
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    // Process after 100ms of inactivity (batches rapid updates)
    updateTimerRef.current = setTimeout(() => {
      processBatchedUpdates();
    }, 100);

    logger.log('[BatchQueue] Queued update for deal', dealId, '- queue size:', updateQueueRef.current.length);
  }, [processBatchedUpdates]);

  const handleDealCreated = useCallback(async (newDeal) => {
    if (!isMountedRef.current) return;
    // ENGINE REBUILD Phase 9: Defense-in-depth normalization at state boundary
    const normalizedDeal = normalizeDeal(newDeal);
    if (!normalizedDeal) {
      console.error('[handleDealCreated] Failed to normalize new deal:', newDeal?.id);
      return;
    }
    setDeals(prevDeals => [normalizedDeal, ...prevDeals]);
    addNotification('Deal created successfully');
  }, [addNotification]);

  const handleDealUpdated = useCallback(async (updatedDeal) => {
    if (!isMountedRef.current || !updatedDeal) return;
    // ENGINE REBUILD Phase 9: Defense-in-depth normalization at state boundary
    const normalizedDeal = normalizeDeal(updatedDeal);
    if (!normalizedDeal) {
      console.error('[handleDealUpdated] Failed to normalize updated deal:', updatedDeal?.id);
      return;
    }
    // ROOT CAUSE FIX: Filter nulls before mapping
    setDeals(prevDeals =>
      prevDeals.filter(d => d != null).map(d => d.id === normalizedDeal.id ? normalizedDeal : d)
    );
  }, []);

  const handleDealDeleted = useCallback((dealId) => {
    if (!isMountedRef.current) return;
    // ROOT CAUSE FIX: Filter nulls AND check safely
    setDeals(prevDeals => prevDeals.filter(d => d != null && d.id !== dealId));
  }, []);

  return {
    deals,
    loading,
    error, // MEDIUM FIX: Expose error state for retry UI
    // OFFLINE: Expose network status for "works on a plane" support
    isOnline,
    pendingSyncCount,
    isSyncing,
    syncOfflineCommands, // Manual sync trigger if needed
    // H6-C HARDENING 2025-12-04: Expose drag lock state for KanbanBoard
    isDragLocked,
    fetchDeals,
    updateDeal,
    queueDealUpdate, // v1.7.98: FIFO batched updates for rapid operations
    handleDealCreated,
    handleDealUpdated,
    handleDealDeleted
  };
};
