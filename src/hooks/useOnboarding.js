/**
 * Onboarding Hooks - TanStack Query integration for onboarding state
 * Area 6 - First-Run Onboarding Experience
 *
 * Provides:
 * - useOnboarding: Fetch onboarding checklist state
 * - useCompleteOnboardingItem: Mark an item as complete
 * - useDismissOnboarding: Dismiss onboarding entirely
 *
 * Works with:
 * - React Query caching
 * - Offline mode (gracefully handles network errors)
 * - Auto-completion inference from backend
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/queryKeys';
import { STALE_TIMES } from '../lib/queryClient';
import { logger } from '../lib/logger';
import { announce } from '../lib/accessibility';

/**
 * Onboarding checklist item IDs
 */
export const ONBOARDING_ITEMS = {
  CREATE_FIRST_DEAL: 'create_first_deal',
  MOVE_DEAL: 'move_deal_in_pipeline',
  CONFIGURE_AI: 'configure_ai_provider',
  RUN_PLAN_MY_DAY: 'run_plan_my_day',
};

/**
 * Human-readable labels for onboarding items
 */
export const ONBOARDING_LABELS = {
  [ONBOARDING_ITEMS.CREATE_FIRST_DEAL]: {
    title: 'Create your first deal',
    description: 'Add a deal to start tracking your sales pipeline',
    action: 'Create Deal',
  },
  [ONBOARDING_ITEMS.MOVE_DEAL]: {
    title: 'Move a deal to the next stage',
    description: 'Drag a deal card or use the stage selector',
    action: 'Go to Pipeline',
  },
  [ONBOARDING_ITEMS.CONFIGURE_AI]: {
    title: 'Connect an AI provider',
    description: 'Enable AI-powered insights and Plan My Day',
    action: 'Open AI Settings',
  },
  [ONBOARDING_ITEMS.RUN_PLAN_MY_DAY]: {
    title: 'Run Plan My Day',
    description: 'Get AI-powered daily priorities and focus areas',
    action: 'Plan My Day',
  },
};

/**
 * Fetch onboarding state from backend
 */
const fetchOnboardingState = async (orgId) => {
  if (!orgId) {
    throw new Error('Organization ID required');
  }

  logger.debug('[Onboarding] Fetching state for org:', orgId);

  const { data } = await api.get(`get-onboarding-state?orgId=${orgId}`);

  if (!data.success) {
    throw new Error(data.error || 'Failed to fetch onboarding state');
  }

  return data.onboarding;
};

/**
 * Hook: Fetch onboarding state
 *
 * @param {string} orgId - Organization ID
 * @param {object} options - Additional query options
 */
export function useOnboarding(orgId, options = {}) {
  return useQuery({
    queryKey: queryKeys.onboarding.state(orgId),
    queryFn: () => fetchOnboardingState(orgId),
    staleTime: 60 * 1000, // 1 minute - onboarding changes infrequently
    enabled: !!orgId,
    retry: 1, // Don't retry too much for onboarding
    ...options,
  });
}

/**
 * Hook: Complete an onboarding item
 *
 * @param {string} orgId - Organization ID
 */
export function useCompleteOnboardingItem(orgId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId }) => {
      logger.debug('[Onboarding] Completing item:', itemId);

      const { data } = await api.post('update-onboarding-state', {
        orgId,
        itemId,
      });

      if (!data.success) {
        throw new Error(data.error || 'Failed to complete onboarding item');
      }

      return data.onboarding;
    },

    // Optimistic update
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.onboarding.state(orgId) });

      const previousState = queryClient.getQueryData(queryKeys.onboarding.state(orgId));

      // Optimistically mark the item as complete
      queryClient.setQueryData(queryKeys.onboarding.state(orgId), (old) => {
        if (!old) return old;

        const updatedChecklist = old.checklist.map((item) =>
          item.id === itemId
            ? { ...item, completed: true, completedAt: new Date().toISOString() }
            : item
        );

        return { ...old, checklist: updatedChecklist };
      });

      return { previousState };
    },

    onError: (error, variables, context) => {
      logger.error('[Onboarding] Complete item failed:', error);

      if (context?.previousState) {
        queryClient.setQueryData(queryKeys.onboarding.state(orgId), context.previousState);
      }
    },

    onSuccess: (updatedState) => {
      // Update cache with server response
      queryClient.setQueryData(queryKeys.onboarding.state(orgId), updatedState);

      // Announce completion for accessibility
      const completedCount = updatedState.checklist.filter((i) => i.completed).length;
      const totalCount = updatedState.checklist.length;
      announce(`Onboarding step completed. ${completedCount} of ${totalCount} steps done.`);
    },
  });
}

/**
 * Hook: Dismiss onboarding
 *
 * @param {string} orgId - Organization ID
 */
export function useDismissOnboarding(orgId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      logger.debug('[Onboarding] Dismissing onboarding');

      const { data } = await api.post('update-onboarding-state', {
        orgId,
        dismissed: true,
      });

      if (!data.success) {
        throw new Error(data.error || 'Failed to dismiss onboarding');
      }

      return data.onboarding;
    },

    // Optimistic update
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.onboarding.state(orgId) });

      const previousState = queryClient.getQueryData(queryKeys.onboarding.state(orgId));

      queryClient.setQueryData(queryKeys.onboarding.state(orgId), (old) => {
        if (!old) return old;
        return { ...old, dismissed: true };
      });

      return { previousState };
    },

    onError: (error, variables, context) => {
      logger.error('[Onboarding] Dismiss failed:', error);

      if (context?.previousState) {
        queryClient.setQueryData(queryKeys.onboarding.state(orgId), context.previousState);
      }
    },

    onSuccess: (updatedState) => {
      queryClient.setQueryData(queryKeys.onboarding.state(orgId), updatedState);
      announce('Onboarding dismissed. You can access help anytime from Settings.');
    },
  });
}

/**
 * Hook: Invalidate onboarding cache (call after actions that might complete items)
 */
export function useInvalidateOnboarding() {
  const queryClient = useQueryClient();

  return (orgId) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.state(orgId) });
  };
}

/**
 * Hook: Get onboarding progress summary
 * Derives progress from the full onboarding state
 */
export function useOnboardingProgress(orgId) {
  const { data: onboarding, isLoading, error } = useOnboarding(orgId);

  if (!onboarding || onboarding.dismissed) {
    return {
      isLoading,
      error,
      showOnboarding: false,
      completedCount: 0,
      totalCount: 0,
      progress: 100,
      checklist: [],
    };
  }

  const completedCount = onboarding.checklist.filter((i) => i.completed).length;
  const totalCount = onboarding.checklist.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    isLoading,
    error,
    showOnboarding: !onboarding.dismissed && completedCount < totalCount,
    completedCount,
    totalCount,
    progress,
    checklist: onboarding.checklist,
  };
}

export default {
  useOnboarding,
  useCompleteOnboardingItem,
  useDismissOnboarding,
  useInvalidateOnboarding,
  useOnboardingProgress,
  ONBOARDING_ITEMS,
  ONBOARDING_LABELS,
};
