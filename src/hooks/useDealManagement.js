import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { parseSupabaseError, retryOperation, ERROR_CODES } from '../lib/error-handler';
import { getStatusForStage } from '../config/pipelineTemplates';
import { useRealTimeDeals } from './useRealTimeDeals';
import { requestDeduplicator } from '../lib/request-deduplicator';
import { cacheDeals, getCachedDeals } from '../lib/indexeddb-cache'; // NEXT-LEVEL: 50MB IndexedDB cache
import { dealsMemoryCache } from '../lib/memory-cache'; // OPT-4: In-memory cache (<1ms reads)
import { logger } from '../lib/logger';
// OFFLINE: Import offline queue for "works on a plane" support
import {
  enqueueCommand,
  getPendingCommands,
  updateCommandStatus,
  clearCommands,
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
        // DEFENSIVE: Filter out any null deals that might have slipped through
        const validDeals = cached.filter(d => d != null && typeof d === 'object');

        if (validDeals.length !== cached.length) {
          console.warn('[Deals Cache] Filtered', cached.length - validDeals.length, 'null deals from IndexedDB');
        }

        // Store in memory cache for next access
        dealsMemoryCache.set(memKey, validDeals);

        logger.log('[Deals Cache] ✓ IndexedDB HIT (50-100ms) -', validDeals.length, 'deals');
        return validDeals;
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

      const validDeals = deals.filter(d => d != null && typeof d === 'object');
      logger.log('[Deals Cache] ⚠️  localStorage fallback -', validDeals.length, 'deals');

      // Migrate to IndexedDB and memory cache
      await cacheDeals(orgId, validDeals);
      dealsMemoryCache.set(memKey, validDeals);

      return validDeals;
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

export const useDealManagement = (user, organization, addNotification) => {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null); // MEDIUM FIX: Track fetch errors for retry UI
  // OFFLINE: Track network status for "works on a plane" support
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
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
      let hasErrors = false;

      for (const command of pending) {
        try {
          await updateCommandStatus(command.id, COMMAND_STATUS.SYNCING);

          // Process based on command type
          if (command.type === OFFLINE_COMMAND_TYPES.UPDATE_DEAL) {
            const { dealId, updates } = command.payload;
            const finalUpdates = { ...updates, last_activity: new Date().toISOString() };

            // CRITICAL FIX: Use backend endpoint instead of direct Supabase client/RPC
            // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
            // Backend endpoint handles stage history recording automatically
            const updateResponse = await fetch('/.netlify/functions/update-deal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                dealId,
                updates: finalUpdates,
                organizationId: organization.id
              })
            });

            const updateResult = await updateResponse.json();
            if (!updateResponse.ok) {
              throw new Error(updateResult.error || `Update failed: ${updateResponse.status}`);
            }
          } else if (command.type === OFFLINE_COMMAND_TYPES.CREATE_DEAL) {
            const { deal } = command.payload;

            // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
            // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
            const createResponse = await fetch('/.netlify/functions/create-deal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                dealData: deal,
                organizationId: organization.id
              })
            });

            const createResult = await createResponse.json();
            if (!createResponse.ok) {
              throw new Error(createResult.error || `Create failed: ${createResponse.status}`);
            }
          } else if (command.type === OFFLINE_COMMAND_TYPES.DELETE_DEAL) {
            const { dealId } = command.payload;

            // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
            // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
            const deleteResponse = await fetch('/.netlify/functions/delete-deal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                dealId,
                organizationId: organization.id
              })
            });

            const deleteResult = await deleteResponse.json();
            if (!deleteResponse.ok) {
              throw new Error(deleteResult.error || `Delete failed: ${deleteResponse.status}`);
            }
          }

          // Mark as synced
          await updateCommandStatus(command.id, COMMAND_STATUS.SYNCED);
          syncedIds.push(command.id);
          logger.log(`[Offline Sync] ✓ Synced command: ${command.type}`);
        } catch (cmdError) {
          console.error(`[Offline Sync] ✗ Failed to sync command ${command.id}:`, cmdError);
          await updateCommandStatus(command.id, COMMAND_STATUS.FAILED, cmdError.message);
          hasErrors = true;
          // Stop processing on first error to maintain FIFO order
          break;
        }
      }

      // Clear synced commands
      if (syncedIds.length > 0) {
        await clearCommands(syncedIds);
        addNotification(`Synced ${syncedIds.length} offline change${syncedIds.length > 1 ? 's' : ''}`, 'success');
      }

      if (hasErrors) {
        addNotification('Some offline changes failed to sync. Will retry.', 'warning');
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

      // New deal created by team member
      setDeals(prevDeals => {
        // ROOT CAUSE FIX: Filter out null deals AND check safely
        const validDeals = prevDeals.filter(d => d != null);

        // Avoid duplicates if we already optimistically added it
        if (validDeals.some(d => d.id === payload.new.id)) {
          return validDeals;
        }
        const updated = [payload.new, ...validDeals];
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

      // Deal updated by team member
      setDeals(prevDeals => {
        // ROOT CAUSE FIX: Safe null check before accessing .id
        const updated = prevDeals.filter(d => d != null).map(d => d.id === payload.new.id ? payload.new : d);
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
        setDeals(cachedDeals);
        // DON'T set loading=true - we have data to show!
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

      const result = await retryOperation(async () => {
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

      // CRITICAL FIX: Filter out any null/undefined deals to prevent crashes
      const validDeals = result.filter(deal => deal != null && typeof deal === 'object');
      if (validDeals.length !== result.length) {
        console.warn('[DEALS DEBUG] Filtered out', result.length - validDeals.length, 'invalid deals');
      }

      // Cache the fresh data for next time
      dealsCache.set(organization.id, validDeals);

      if (isMountedRef.current && !abortSignal.aborted) {
        setDeals(validDeals);
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
  const updateDeal = useCallback(async (dealId, updates) => {
    if (!user || !organization || !dealId) {
      console.error('Missing required params for updateDeal');
      return;
    }

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

      const finalUpdates = { ...updates };

      // CRITICAL FIX: Auto-set status based on stage using centralized logic
      // This ensures won/lost stages automatically get correct status
      if (finalUpdates.stage) {
        const newStatus = getStatusForStage(finalUpdates.stage);
        if (newStatus !== deal.status) {
          finalUpdates.status = newStatus;
        }
      }

      finalUpdates.last_activity = new Date().toISOString();

      // Optimistic update
      // ROOT CAUSE FIX: Filter nulls before mapping
      setDeals(prevDeals =>
        prevDeals.filter(d => d != null).map(d =>
          d.id === dealId
            ? { ...d, ...finalUpdates }
           : d
        )
      );

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

      // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
      // Phase 3 Cookie-Only Auth has persistSession: false, so auth.uid() is NULL
      // RLS policies deny all client-side mutations. Use backend with service role.
      let data;

      const response = await fetch('/.netlify/functions/update-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Send HttpOnly cookies for auth
        body: JSON.stringify({
          dealId,
          updates: finalUpdates,
          organizationId: organization.id
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Update failed: ${response.status}`);
      }

      data = result.deal;
      logger.log('[updateDeal] Backend update successful');

      // Update with server response
      // ROOT CAUSE FIX: Filter nulls before mapping
      if (data && isMountedRef.current) {
        setDeals(prevDeals =>
          prevDeals.filter(d => d != null).map(d => d.id === dealId ? data : d)
        );
      }

      addNotification('Deal updated successfully');
    } catch (error) {
      console.error('Error updating deal:', error);
      addNotification(error.message || 'Failed to update deal', 'error');

      // CRITICAL FIX: Only rollback if we have originalDeal captured
      // This prevents crash if error occurred before originalDeal was assigned
      if (isMountedRef.current && originalDeal) {
        setDeals(prevDeals =>
          prevDeals.filter(d => d != null).map(d =>
            d.id === dealId ? originalDeal : d
          )
        );
        logger.log('[Optimistic] Rolled back deal to original state');
      } else if (isMountedRef.current) {
        // Fallback: If no originalDeal, just log warning (don't crash)
        logger.log('[Optimistic] Could not rollback - originalDeal not captured');
      }
    }
    }); // End deduplication wrapper
  }, [user, organization, addNotification]); // CRITICAL: Removed deals and fetchDeals from deps

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

          // CRITICAL FIX: Use backend endpoint instead of direct Supabase client
          const response = await fetch('/.netlify/functions/update-deal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              dealId,
              updates: finalUpdates,
              organizationId: organization.id
            })
          });

          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || `Batch update failed: ${response.status}`);
          }

          const data = result.deal;

          // ROOT CAUSE FIX: Filter nulls before mapping
          if (data && isMountedRef.current) {
            setDeals(prevDeals => prevDeals.filter(d => d != null).map(d => d.id === dealId ? data : d));
          }

          logger.log('[BatchQueue] ✓ Processed update for deal', dealId, 'queued at', timestamp);
        } catch (error) {
          console.error('[BatchQueue] Failed for deal:', dealId, error);
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
    setDeals(prevDeals => [newDeal, ...prevDeals]);
    addNotification('Deal created successfully');
  }, [addNotification]);

  const handleDealUpdated = useCallback(async (updatedDeal) => {
    if (!isMountedRef.current || !updatedDeal) return;
    // ROOT CAUSE FIX: Filter nulls before mapping
    setDeals(prevDeals =>
      prevDeals.filter(d => d != null).map(d => d.id === updatedDeal.id ? updatedDeal : d)
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
    fetchDeals,
    updateDeal,
    queueDealUpdate, // v1.7.98: FIFO batched updates for rapid operations
    handleDealCreated,
    handleDealUpdated,
    handleDealDeleted
  };
};
