/**
 * Onboarding Hooks - TanStack Query integration for onboarding state
 * Area 6 - First-Run Onboarding Experience
 * Phase 8 - Onboarding Polish
 *
 * Provides:
 * - useOnboarding: Fetch onboarding checklist state
 * - useCompleteOnboardingItem: Mark an item as complete
 * - useDismissOnboarding: Dismiss onboarding entirely
 * - Telemetry events for onboarding milestones
 *
 * Works with:
 * - React Query caching
 * - Offline mode (gracefully handles network errors)
 * - Auto-completion inference from backend
 * - Phase 5 telemetry system
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
import { trackEvent } from '../lib/sentry';

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
 * Phase 8: Polished founder-focused microcopy
 *
 * Each item answers: What? Why? What next?
 */
export const ONBOARDING_LABELS = {
  [ONBOARDING_ITEMS.CREATE_FIRST_DEAL]: {
    title: 'Add your first deal',
    description: 'Every closed deal starts here. Track prospects from first touch to signed contract.',
    action: 'Add Deal',
  },
  [ONBOARDING_ITEMS.MOVE_DEAL]: {
    title: 'Move a deal forward',
    description: 'Drag deals between stages as they progress. StageFlow tracks velocity automatically.',
    action: 'View Pipeline',
  },
  [ONBOARDING_ITEMS.CONFIGURE_AI]: {
    title: 'Unlock AI coaching',
    description: 'Connect OpenAI or Anthropic to get personalized deal insights and daily priorities.',
    action: 'Connect AI',
  },
  [ONBOARDING_ITEMS.RUN_PLAN_MY_DAY]: {
    title: 'Get your daily game plan',
    description: 'AI analyzes your pipeline and tells you exactly which deals need attention today.',
    action: 'Plan My Day',
  },
};

/**
 * Microcopy variants for experienced users (lighter onboarding)
 * Phase 8: Adaptive onboarding
 */
export const ONBOARDING_LABELS_EXPERIENCED = {
  [ONBOARDING_ITEMS.CREATE_FIRST_DEAL]: {
    title: 'Add your first deal here',
    description: 'You know the drill. Get your pipeline started.',
    action: 'Add Deal',
  },
  [ONBOARDING_ITEMS.MOVE_DEAL]: {
    title: 'Move deals between stages',
    description: 'Same drag-and-drop you\'re used to.',
    action: 'View Pipeline',
  },
  [ONBOARDING_ITEMS.CONFIGURE_AI]: {
    title: 'Connect your AI provider',
    description: 'Set up AI for coaching and daily priorities.',
    action: 'Connect AI',
  },
  [ONBOARDING_ITEMS.RUN_PLAN_MY_DAY]: {
    title: 'Try Plan My Day',
    description: 'Let AI prioritize your deals for today.',
    action: 'Plan My Day',
  },
};

/**
 * Onboarding telemetry event names (Phase 8)
 * These are tracked to measure onboarding funnel effectiveness
 */
export const ONBOARDING_EVENTS = {
  STARTED: 'onboarding_started',
  COMPLETED: 'onboarding_completed',
  ITEM_COMPLETED: 'onboarding_item_completed',
  DISMISSED: 'onboarding_dismissed',
  FIRST_DEAL_CREATED: 'first_deal_created',
  FIRST_PLAN_MY_DAY_RUN: 'first_plan_my_day_run',
  FIRST_AI_QUERY: 'first_ai_assistant_query',
};

/**
 * Track an onboarding milestone event
 * Phase 8: Telemetry integration
 */
const trackOnboardingEvent = (eventName, metadata = {}) => {
  logger.debug('[Onboarding] Tracking event:', eventName, metadata);
  trackEvent(eventName, {
    source: 'onboarding',
    timestamp: new Date().toISOString(),
    ...metadata,
  });
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

    onSuccess: (updatedState, { itemId }) => {
      // Update cache with server response
      queryClient.setQueryData(queryKeys.onboarding.state(orgId), updatedState);

      // Announce completion for accessibility
      const completedCount = updatedState.checklist.filter((i) => i.completed).length;
      const totalCount = updatedState.checklist.length;
      announce(`Onboarding step completed. ${completedCount} of ${totalCount} steps done.`);

      // Track item completion telemetry (Phase 8)
      trackOnboardingEvent(ONBOARDING_EVENTS.ITEM_COMPLETED, {
        itemId,
        completedCount,
        totalCount,
        progress: Math.round((completedCount / totalCount) * 100),
      });

      // Track specific milestone events
      if (itemId === ONBOARDING_ITEMS.CREATE_FIRST_DEAL) {
        trackOnboardingEvent(ONBOARDING_EVENTS.FIRST_DEAL_CREATED, { orgId });
      } else if (itemId === ONBOARDING_ITEMS.RUN_PLAN_MY_DAY) {
        trackOnboardingEvent(ONBOARDING_EVENTS.FIRST_PLAN_MY_DAY_RUN, { orgId });
      }

      // Track full completion
      if (completedCount === totalCount) {
        trackOnboardingEvent(ONBOARDING_EVENTS.COMPLETED, {
          orgId,
          totalItems: totalCount,
        });
      }
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

      // Track dismissal telemetry (Phase 8)
      const completedCount = updatedState.checklist?.filter((i) => i.completed).length || 0;
      const totalCount = updatedState.checklist?.length || 0;
      trackOnboardingEvent(ONBOARDING_EVENTS.DISMISSED, {
        orgId,
        completedCount,
        totalCount,
        progress: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      });
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

// Export trackOnboardingEvent for use by other components (e.g., AI assistant)
export { trackOnboardingEvent };

export default {
  useOnboarding,
  useCompleteOnboardingItem,
  useDismissOnboarding,
  useInvalidateOnboarding,
  useOnboardingProgress,
  ONBOARDING_ITEMS,
  ONBOARDING_LABELS,
  ONBOARDING_LABELS_EXPERIENCED,
  ONBOARDING_EVENTS,
  trackOnboardingEvent,
};
