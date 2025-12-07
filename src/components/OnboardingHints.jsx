/**
 * OnboardingHints - Contextual micro hints for first-run experience
 * Area 6 - First-Run Onboarding Experience
 *
 * Provides subtle, contextual hints instead of heavy product tours:
 * - AISetupHint: Shown when no AI provider is configured
 * - PlanMyDayHint: Shown when Plan My Day hasn't been used
 * - EmptyPipelineHint: Enhanced empty state for Kanban
 *
 * These are designed to be Notion/Linear-level subtle, not annoying.
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React, { memo } from 'react';
import { Sparkles, Bot, Plus, Lightbulb, ArrowRight } from 'lucide-react';
import { useOnboardingProgress, ONBOARDING_ITEMS } from '../hooks/useOnboarding';

/**
 * AISetupHint - Shown in AI surfaces when no provider is configured
 */
export const AISetupHint = memo(({ orgId, onOpenSettings }) => {
  const { checklist } = useOnboardingProgress(orgId);

  // Check if AI provider is configured
  const aiConfigured = checklist.find(
    (item) => item.id === ONBOARDING_ITEMS.CONFIGURE_AI
  )?.completed;

  // Don't show if already configured
  if (aiConfigured) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-white mb-1">Connect an AI provider</h4>
          <p className="text-sm text-gray-400 mb-3">
            Enable AI-powered insights, deal analysis, and Plan My Day by connecting your OpenAI, Anthropic, or other AI provider.
          </p>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-2 text-sm font-medium text-purple-400 hover:text-purple-300 transition"
            >
              Open AI Settings
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

AISetupHint.displayName = 'AISetupHint';

/**
 * PlanMyDayHint - Shown when Plan My Day hasn't been used
 */
export const PlanMyDayHint = memo(({ orgId, onRunPlanMyDay }) => {
  const { checklist } = useOnboardingProgress(orgId);

  // Check if AI provider is configured first
  const aiConfigured = checklist.find(
    (item) => item.id === ONBOARDING_ITEMS.CONFIGURE_AI
  )?.completed;

  // Check if Plan My Day has been used
  const planMyDayUsed = checklist.find(
    (item) => item.id === ONBOARDING_ITEMS.RUN_PLAN_MY_DAY
  )?.completed;

  // Don't show if Plan My Day already used, or if AI isn't configured
  if (planMyDayUsed || !aiConfigured) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-teal-900/20 to-emerald-900/20 border border-teal-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-white mb-1">Not sure what to work on next?</h4>
          <p className="text-sm text-gray-400 mb-3">
            Plan My Day uses AI to analyze your pipeline and suggest which deals need attention today.
          </p>
          {onRunPlanMyDay && (
            <button
              onClick={onRunPlanMyDay}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-medium transition"
            >
              <Sparkles className="w-4 h-4" />
              Plan My Day
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

PlanMyDayHint.displayName = 'PlanMyDayHint';

/**
 * EmptyPipelineHint - Enhanced empty state for Kanban when no deals exist
 */
export const EmptyPipelineHint = memo(({ onCreateDeal }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-24 h-24 bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-dashed border-teal-500/40 rounded-2xl flex items-center justify-center mb-6">
        <Plus className="w-12 h-12 text-teal-400/60" />
      </div>

      <h3 className="text-xl font-semibold text-white mb-2">Your pipeline is empty</h3>
      <p className="text-gray-400 text-center max-w-md mb-6">
        Create your first deal to start tracking your sales pipeline.
        StageFlow will help you manage and close deals faster.
      </p>

      {onCreateDeal && (
        <button
          onClick={onCreateDeal}
          className="inline-flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold transition shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-5 h-5" />
          Create Your First Deal
        </button>
      )}

      <div className="mt-8 flex items-center gap-6 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          <span>Tip: Import deals from a CSV to get started quickly</span>
        </div>
      </div>
    </div>
  );
});

EmptyPipelineHint.displayName = 'EmptyPipelineHint';

/**
 * FirstDealSuccessHint - Shown after creating the first deal
 */
export const FirstDealSuccessHint = memo(({ onClose }) => {
  return (
    <div className="bg-gradient-to-br from-emerald-900/20 to-teal-900/20 border border-emerald-500/30 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-white mb-1">Great start!</h4>
          <p className="text-sm text-gray-400">
            Your first deal is in the pipeline. Try dragging it to the next stage to see how StageFlow tracks your progress.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
});

FirstDealSuccessHint.displayName = 'FirstDealSuccessHint';

export default {
  AISetupHint,
  PlanMyDayHint,
  EmptyPipelineHint,
  FirstDealSuccessHint,
};
