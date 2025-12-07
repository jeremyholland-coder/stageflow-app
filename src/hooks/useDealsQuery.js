/**
 * Deals Query Hooks - TanStack Query integration for deals
 * Area 4 - Caching for Production Hardening
 *
 * Provides:
 * - useDealsByOrg: Fetch all deals for an organization
 * - useDealById: Fetch single deal details
 * - useDealMutations: Mutations with cache invalidation
 *
 * Works alongside existing:
 * - Three-tier cache (Memory → IndexedDB → localStorage)
 * - Offline queue (offlineStore)
 * - Real-time subscriptions
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/queryKeys';
import { STALE_TIMES } from '../lib/queryClient';
import { logger } from '../lib/logger';
import { addBreadcrumb } from '../lib/sentry';

/**
 * Fetch all deals for an organization
 * Uses direct Supabase query for best performance
 */
const fetchDealsByOrg = async (orgId) => {
  if (!orgId) {
    throw new Error('Organization ID required');
  }

  logger.debug('[DealsQuery] Fetching deals for org:', orgId);

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('created', { ascending: false });

  if (error) {
    logger.error('[DealsQuery] Fetch error:', error);
    throw error;
  }

  // Filter out any null/invalid deals
  const validDeals = (data || []).filter(deal => deal != null && typeof deal === 'object');

  logger.debug('[DealsQuery] Fetched', validDeals.length, 'deals');

  return validDeals;
};

/**
 * Fetch single deal by ID
 */
const fetchDealById = async (orgId, dealId) => {
  if (!orgId || !dealId) {
    throw new Error('Organization ID and Deal ID required');
  }

  logger.debug('[DealsQuery] Fetching deal:', dealId);

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .single();

  if (error) {
    logger.error('[DealsQuery] Fetch error:', error);
    throw error;
  }

  return data;
};

/**
 * Hook: Fetch all deals for organization
 *
 * @param {string} orgId - Organization ID
 * @param {object} options - Additional query options
 */
export function useDealsByOrg(orgId, options = {}) {
  return useQuery({
    queryKey: queryKeys.deals.byOrg(orgId),
    queryFn: () => fetchDealsByOrg(orgId),
    staleTime: STALE_TIMES.deals,
    enabled: !!orgId,
    ...options,
  });
}

/**
 * Hook: Fetch deals by stage (filtered from org deals)
 *
 * @param {string} orgId - Organization ID
 * @param {string} stageId - Stage ID to filter by
 */
export function useDealsByStage(orgId, stageId) {
  const { data: allDeals, ...rest } = useDealsByOrg(orgId);

  // Filter deals by stage client-side
  const deals = allDeals?.filter(deal => deal.stage === stageId) || [];

  return {
    ...rest,
    data: deals,
  };
}

/**
 * Hook: Fetch single deal
 *
 * @param {string} orgId - Organization ID
 * @param {string} dealId - Deal ID
 * @param {object} options - Additional query options
 */
export function useDealById(orgId, dealId, options = {}) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.deals.detail(orgId, dealId),
    queryFn: () => fetchDealById(orgId, dealId),
    staleTime: STALE_TIMES.dealDetails,
    enabled: !!orgId && !!dealId,

    // Use data from org deals cache if available
    initialData: () => {
      const orgDeals = queryClient.getQueryData(queryKeys.deals.byOrg(orgId));
      if (orgDeals) {
        return orgDeals.find(deal => deal.id === dealId);
      }
      return undefined;
    },
    initialDataUpdatedAt: () => {
      const state = queryClient.getQueryState(queryKeys.deals.byOrg(orgId));
      return state?.dataUpdatedAt;
    },

    ...options,
  });
}

/**
 * Hook: Deal mutations with cache invalidation
 *
 * Provides updateDeal, createDeal, deleteDeal with automatic cache updates
 */
export function useDealMutations(orgId) {
  const queryClient = useQueryClient();

  /**
   * Update deal mutation
   */
  const updateDeal = useMutation({
    mutationFn: async ({ dealId, updates }) => {
      logger.debug('[DealsQuery] Updating deal:', dealId, updates);

      // Add last_activity timestamp
      const finalUpdates = {
        ...updates,
        last_activity: new Date().toISOString(),
      };

      // Use api-client for auth headers and retry logic
      const { data } = await api.post('update-deal', {
        dealId,
        updates: finalUpdates,
        organizationId: orgId,
      });

      if (!data.success && data.error) {
        throw new Error(data.error);
      }

      return data.deal || data;
    },

    // Optimistic update
    onMutate: async ({ dealId, updates }) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.byOrg(orgId) });

      // Snapshot current data
      const previousDeals = queryClient.getQueryData(queryKeys.deals.byOrg(orgId));

      // Optimistically update
      queryClient.setQueryData(queryKeys.deals.byOrg(orgId), (old) => {
        if (!old) return old;
        return old.map(deal =>
          deal.id === dealId
            ? { ...deal, ...updates, last_activity: new Date().toISOString() }
            : deal
        );
      });

      // Also update detail cache if it exists
      queryClient.setQueryData(queryKeys.deals.detail(orgId, dealId), (old) => {
        if (!old) return old;
        return { ...old, ...updates, last_activity: new Date().toISOString() };
      });

      addBreadcrumb('Deal update (optimistic)', {
        category: 'mutation',
        dealId,
      });

      return { previousDeals };
    },

    // Rollback on error
    onError: (error, { dealId }, context) => {
      logger.error('[DealsQuery] Update failed, rolling back:', error);

      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.byOrg(orgId), context.previousDeals);
      }

      addBreadcrumb('Deal update failed', {
        category: 'mutation',
        dealId,
        error: error.message,
      });
    },

    // Refetch after mutation settles
    onSettled: (data, error, { dealId }) => {
      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.byOrg(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.detail(orgId, dealId) });

      // Also invalidate analytics since deal data changed
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.pipelineSummary(orgId) });
    },
  });

  /**
   * Move deal to new stage mutation
   */
  const moveDealStage = useMutation({
    mutationFn: async ({ dealId, newStage, newStatus }) => {
      logger.debug('[DealsQuery] Moving deal:', dealId, 'to stage:', newStage);

      const updates = {
        stage: newStage,
        status: newStatus || undefined,
        last_activity: new Date().toISOString(),
      };

      const { data } = await api.post('update-deal', {
        dealId,
        updates,
        organizationId: orgId,
      });

      if (!data.success && data.error) {
        throw new Error(data.error);
      }

      return data.deal || data;
    },

    // Optimistic update for instant UI feedback
    onMutate: async ({ dealId, newStage, newStatus }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.byOrg(orgId) });

      const previousDeals = queryClient.getQueryData(queryKeys.deals.byOrg(orgId));

      queryClient.setQueryData(queryKeys.deals.byOrg(orgId), (old) => {
        if (!old) return old;
        return old.map(deal =>
          deal.id === dealId
            ? { ...deal, stage: newStage, status: newStatus || deal.status, last_activity: new Date().toISOString() }
            : deal
        );
      });

      addBreadcrumb('Deal stage move (optimistic)', {
        category: 'mutation',
        dealId,
        newStage,
      });

      return { previousDeals };
    },

    onError: (error, { dealId }, context) => {
      logger.error('[DealsQuery] Move failed, rolling back:', error);

      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.byOrg(orgId), context.previousDeals);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.byOrg(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.pipelineSummary(orgId) });
    },
  });

  /**
   * Create deal mutation
   */
  const createDeal = useMutation({
    mutationFn: async (dealData) => {
      logger.debug('[DealsQuery] Creating deal:', dealData);

      const { data } = await api.post('create-deal', {
        dealData,
        organizationId: orgId,
      });

      if (!data.success && data.error) {
        throw new Error(data.error);
      }

      return data.deal || data;
    },

    onSuccess: (newDeal) => {
      // Add to cache
      queryClient.setQueryData(queryKeys.deals.byOrg(orgId), (old) => {
        if (!old) return [newDeal];
        return [newDeal, ...old];
      });

      addBreadcrumb('Deal created', {
        category: 'mutation',
        dealId: newDeal.id,
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.byOrg(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.pipelineSummary(orgId) });
    },
  });

  /**
   * Delete deal mutation (soft delete)
   */
  const deleteDeal = useMutation({
    mutationFn: async (dealId) => {
      logger.debug('[DealsQuery] Deleting deal:', dealId);

      const { data } = await api.post('delete-deal', {
        dealId,
        organizationId: orgId,
      });

      if (!data.success && data.error) {
        throw new Error(data.error);
      }

      return data;
    },

    onMutate: async (dealId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.byOrg(orgId) });

      const previousDeals = queryClient.getQueryData(queryKeys.deals.byOrg(orgId));

      // Remove from cache
      queryClient.setQueryData(queryKeys.deals.byOrg(orgId), (old) => {
        if (!old) return old;
        return old.filter(deal => deal.id !== dealId);
      });

      return { previousDeals };
    },

    onError: (error, dealId, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(queryKeys.deals.byOrg(orgId), context.previousDeals);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deals.byOrg(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.pipelineSummary(orgId) });
    },
  });

  return {
    updateDeal,
    moveDealStage,
    createDeal,
    deleteDeal,
  };
}

/**
 * Hook: Prefetch deals for organization
 * Call this before navigating to dashboard for instant load
 */
export function usePrefetchDeals(orgId) {
  const queryClient = useQueryClient();

  const prefetch = () => {
    if (!orgId) return;

    queryClient.prefetchQuery({
      queryKey: queryKeys.deals.byOrg(orgId),
      queryFn: () => fetchDealsByOrg(orgId),
      staleTime: STALE_TIMES.deals,
    });
  };

  return prefetch;
}

export default {
  useDealsByOrg,
  useDealsByStage,
  useDealById,
  useDealMutations,
  usePrefetchDeals,
};
