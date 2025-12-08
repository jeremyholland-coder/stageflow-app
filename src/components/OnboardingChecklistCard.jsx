/**
 * OnboardingChecklistCard - Lightweight first-run onboarding checklist
 * Area 6 - First-Run Onboarding Experience
 * Phase 8 - Onboarding Polish (Adaptive States)
 *
 * Displays a founder-friendly checklist to help new users get started:
 * - Create first deal
 * - Move deal through pipeline
 * - Configure AI provider
 * - Run Plan My Day
 *
 * Features:
 * - Auto-completes based on actual user actions
 * - Can be collapsed (session) or dismissed (permanent)
 * - Accessible with proper ARIA attributes
 * - Minimal, Notion/Linear-style design
 * - Adaptive: Lighter onboarding for experienced users
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { Check, ChevronDown, ChevronUp, X, Sparkles, Plus, ArrowRight, Settings, Rocket, Zap } from 'lucide-react';
import { useApp } from './AppShell';
import {
  useOnboardingProgress,
  useDismissOnboarding,
  ONBOARDING_ITEMS,
  ONBOARDING_LABELS,
  ONBOARDING_LABELS_EXPERIENCED,
  ONBOARDING_EVENTS,
  trackOnboardingEvent,
} from '../hooks/useOnboarding';
import { useActivationState, USER_EXPERIENCE_MODES } from '../hooks/useActivationState';
import { VIEWS } from '../lib/supabase';

/**
 * OnboardingChecklistCard - Main onboarding UI component
 */
export const OnboardingChecklistCard = memo(({ onOpenNewDeal, onOpenPlanMyDay }) => {
  const { organization, user, setActiveView } = useApp();
  const orgId = organization?.id;

  const {
    isLoading,
    showOnboarding,
    completedCount,
    totalCount,
    progress,
    checklist,
  } = useOnboardingProgress(orgId);

  // Get activation state for adaptive onboarding (Phase 8)
  const activationState = useActivationState({
    user,
    organization,
    deals: [], // We don't need deals for experience mode detection here
    hasAIProvider: false,
  });

  const dismissMutation = useDismissOnboarding(orgId);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const hasTrackedStartRef = useRef(false);

  // Track onboarding_started telemetry when first shown (Phase 8)
  useEffect(() => {
    if (showOnboarding && !hasTrackedStartRef.current && orgId) {
      hasTrackedStartRef.current = true;
      trackOnboardingEvent(ONBOARDING_EVENTS.STARTED, {
        orgId,
        experienceMode: activationState.experienceMode,
        totalItems: totalCount,
      });
    }
  }, [showOnboarding, orgId, activationState.experienceMode, totalCount]);

  // Determine which labels to use based on experience mode
  const isExperienced = activationState.isExperiencedUser;
  const labels = isExperienced ? ONBOARDING_LABELS_EXPERIENCED : ONBOARDING_LABELS;

  // Don't render if loading, no org, or onboarding is dismissed/complete
  if (isLoading || !orgId || !showOnboarding) {
    return null;
  }

  const handleDismiss = () => {
    dismissMutation.mutate();
  };

  const handleItemAction = (itemId) => {
    switch (itemId) {
      case ONBOARDING_ITEMS.CREATE_FIRST_DEAL:
        onOpenNewDeal?.();
        break;
      case ONBOARDING_ITEMS.MOVE_DEAL:
        setActiveView(VIEWS.DASHBOARD);
        break;
      case ONBOARDING_ITEMS.CONFIGURE_AI:
        setActiveView(VIEWS.SETTINGS);
        break;
      case ONBOARDING_ITEMS.RUN_PLAN_MY_DAY:
        onOpenPlanMyDay?.();
        break;
      default:
        break;
    }
  };

  const getItemIcon = (itemId, completed) => {
    if (completed) {
      return <Check className="w-4 h-4 text-emerald-400" />;
    }

    switch (itemId) {
      case ONBOARDING_ITEMS.CREATE_FIRST_DEAL:
        return <Plus className="w-4 h-4 text-teal-400" />;
      case ONBOARDING_ITEMS.MOVE_DEAL:
        return <ArrowRight className="w-4 h-4 text-teal-400" />;
      case ONBOARDING_ITEMS.CONFIGURE_AI:
        return <Settings className="w-4 h-4 text-teal-400" />;
      case ONBOARDING_ITEMS.RUN_PLAN_MY_DAY:
        return <Sparkles className="w-4 h-4 text-teal-400" />;
      default:
        return <Rocket className="w-4 h-4 text-teal-400" />;
    }
  };

  // Adaptive header copy (Phase 8)
  const headerCopy = isExperienced
    ? {
        title: 'Quick setup for this workspace',
        subtitle: `${completedCount} of ${totalCount} — you've done this before`,
        icon: Zap,
      }
    : {
        title: 'Get StageFlow working for you',
        subtitle: `${completedCount} of ${totalCount} steps complete`,
        icon: Rocket,
      };

  const HeaderIcon = headerCopy.icon;

  return (
    <section
      aria-labelledby="onboarding-title"
      className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl p-5 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <HeaderIcon className="w-5 h-5 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="onboarding-title"
              className="text-lg font-semibold text-white truncate"
            >
              {headerCopy.title}
            </h2>
            <p className="text-sm text-gray-400">
              {headerCopy.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 rounded-lg hover:bg-gray-800/50 transition text-gray-400 hover:text-white"
            aria-label={isCollapsed ? 'Expand checklist' : 'Collapse checklist'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronUp className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="p-2 rounded-lg hover:bg-gray-800/50 transition text-gray-400 hover:text-white"
            aria-label="Dismiss onboarding"
            title="I'm all set - dismiss this card"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-4 mb-4">
        <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Onboarding progress: ${progress}%`}
          />
        </div>
      </div>

      {/* Checklist Items */}
      {!isCollapsed && (
        <ul className="space-y-2" aria-label="Onboarding checklist">
          {checklist.map((item) => {
            const label = labels[item.id];
            if (!label) return null;

            return (
              <li
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-xl transition ${
                  item.completed
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'bg-gray-800/30 border border-gray-700/50 hover:bg-gray-800/50'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    item.completed ? 'bg-emerald-500/20' : 'bg-teal-500/10'
                  }`}
                >
                  {getItemIcon(item.id, item.completed)}
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={`font-medium ${
                      item.completed ? 'text-emerald-300 line-through' : 'text-white'
                    }`}
                  >
                    {label.title}
                  </p>
                  <p className="text-sm text-gray-400 truncate">{label.description}</p>
                </div>

                {!item.completed && (
                  <button
                    onClick={() => handleItemAction(item.id)}
                    className="px-3 py-1.5 text-sm font-medium text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 rounded-lg transition flex-shrink-0"
                  >
                    {label.action}
                  </button>
                )}

                {item.completed && (
                  <span className="text-xs text-emerald-400 flex-shrink-0">Done</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer */}
      {!isCollapsed && (
        <div className="mt-4 pt-4 border-t border-gray-700/50">
          <button
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            {dismissMutation.isPending
              ? 'Dismissing...'
              : isExperienced
              ? 'Skip setup — I know my way around'
              : "I'm all set — don't show this again"}
          </button>
        </div>
      )}
    </section>
  );
});

OnboardingChecklistCard.displayName = 'OnboardingChecklistCard';

export default OnboardingChecklistCard;
