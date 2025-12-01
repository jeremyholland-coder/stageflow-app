/**
 * useActivationState - APMDOS (Adaptive Plan My Day Onboarding System)
 *
 * Determines user's activation state for adaptive Plan My Day content.
 * Uses EXISTING data sources only - no new tables, queries, or RPCs.
 *
 * States:
 * - STATE_A: No AI connected → Show AI setup prompt
 * - STATE_B: No deals → Show onboarding wizard
 * - STATE_C: < 5 deals → Show activation tasks
 * - STATE_D: Has goals → Show goal summary bar
 * - STATE_E: Fully activated → Show full coaching
 *
 * @author StageFlow Engineering
 */

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// localStorage keys for feature discovery tracking
// PLAN_MY_DAY_UX: Updated to match exact spec keys (no prefix)
const LS_PREFIX = ''; // Empty prefix - keys stored directly as specified
const FEATURE_KEYS = {
  CREATE_DEALS: 'tip_create_deals_dismissed',
  IMPORT_CLIENTS: 'tip_import_clients_dismissed',
  GOALS: 'tip_goals_dismissed',
  TEAM: 'tip_team_dismissed'
};

/**
 * Check if user has seen a feature tip
 */
export const hasSeenFeature = (featureKey) => {
  try {
    return localStorage.getItem(`${LS_PREFIX}${featureKey}`) === 'true';
  } catch {
    return false;
  }
};

/**
 * Mark a feature tip as seen
 */
export const markFeatureSeen = (featureKey) => {
  try {
    localStorage.setItem(`${LS_PREFIX}${featureKey}`, 'true');
  } catch {
    // localStorage unavailable - fail silently
  }
};

/**
 * Main activation state hook
 *
 * @param {object} params
 * @param {object} params.user - Current user from context
 * @param {object} params.organization - Current organization
 * @param {array} params.deals - Deals array (already loaded by parent)
 * @param {boolean} params.hasAIProvider - Whether AI is connected (from useAIProviderStatus)
 * @returns {object} Activation state and helpers
 */
export const useActivationState = ({ user, organization, deals = [], hasAIProvider = false }) => {
  const [targets, setTargets] = useState(null);
  const [teamCount, setTeamCount] = useState(1);
  const [loadingTargets, setLoadingTargets] = useState(true);

  // Load user targets (for goal summary bar)
  useEffect(() => {
    const loadTargets = async () => {
      if (!organization?.id || !user?.id) {
        setLoadingTargets(false);
        return;
      }

      try {
        // Try user_targets first
        const { data: userTarget, error } = await supabase
          .from('user_targets')
          .select('annual_target, quarterly_target, monthly_target')
          .eq('user_id', user.id)
          .eq('organization_id', organization.id)
          .maybeSingle();

        if (!error && userTarget) {
          setTargets(userTarget);
        } else {
          // Fallback to organization_targets
          const { data: orgTarget } = await supabase
            .from('organization_targets')
            .select('annual_target, quarterly_target, monthly_target')
            .eq('organization_id', organization.id)
            .maybeSingle();

          if (orgTarget) {
            setTargets(orgTarget);
          }
        }
      } catch (err) {
        console.error('[useActivationState] Error loading targets:', err);
      } finally {
        setLoadingTargets(false);
      }
    };

    loadTargets();
  }, [organization?.id, user?.id]);

  // Load team count (for team-related tips)
  useEffect(() => {
    const loadTeamCount = async () => {
      if (!organization?.id) return;

      try {
        const { count } = await supabase
          .from('team_members')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization.id);

        if (count !== null) {
          setTeamCount(Math.max(count, 1));
        }
      } catch (err) {
        console.error('[useActivationState] Error loading team count:', err);
      }
    };

    loadTeamCount();
  }, [organization?.id]);

  // Compute activation state
  const activationState = useMemo(() => {
    const dealCount = deals?.length || 0;
    const hasDeals = dealCount > 0;
    const hasFewDeals = dealCount > 0 && dealCount < 5;
    const hasGoals = !!(targets?.annual_target || targets?.quarterly_target || targets?.monthly_target);
    const hasTeam = teamCount > 1;

    // Calculate goal progress (for STATE_D)
    let goalProgress = null;
    if (hasGoals && deals) {
      const wonDeals = deals.filter(d => d.status === 'won' || d.stage === 'closed_won');
      const now = new Date();

      // Monthly progress
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlyRevenue = wonDeals
        .filter(d => new Date(d.closed_at || d.last_activity) >= startOfMonth)
        .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

      // Quarterly progress
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const startOfQuarter = new Date(now.getFullYear(), quarterMonth, 1);
      const quarterlyRevenue = wonDeals
        .filter(d => new Date(d.closed_at || d.last_activity) >= startOfQuarter)
        .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

      // Annual progress
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const annualRevenue = wonDeals
        .filter(d => new Date(d.closed_at || d.last_activity) >= startOfYear)
        .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

      // Calculate percentages and pace status
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dayOfMonth = now.getDate();
      const monthPace = dayOfMonth / daysInMonth;

      const daysInQuarter = Math.floor((new Date(now.getFullYear(), quarterMonth + 3, 0) - startOfQuarter) / (1000 * 60 * 60 * 24)) + 1;
      const dayOfQuarter = Math.floor((now - startOfQuarter) / (1000 * 60 * 60 * 24)) + 1;
      const quarterPace = dayOfQuarter / daysInQuarter;

      const daysInYear = 365;
      const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
      const yearPace = dayOfYear / daysInYear;

      goalProgress = {
        monthly: targets?.monthly_target ? {
          current: monthlyRevenue,
          target: targets.monthly_target,
          percent: Math.round((monthlyRevenue / targets.monthly_target) * 100),
          status: (monthlyRevenue / targets.monthly_target) >= monthPace ? 'on_track' :
                  (monthlyRevenue / targets.monthly_target) >= (monthPace * 0.7) ? 'at_risk' : 'behind'
        } : null,
        quarterly: targets?.quarterly_target ? {
          current: quarterlyRevenue,
          target: targets.quarterly_target,
          percent: Math.round((quarterlyRevenue / targets.quarterly_target) * 100),
          status: (quarterlyRevenue / targets.quarterly_target) >= quarterPace ? 'on_track' :
                  (quarterlyRevenue / targets.quarterly_target) >= (quarterPace * 0.7) ? 'at_risk' : 'behind'
        } : null,
        annual: targets?.annual_target ? {
          current: annualRevenue,
          target: targets.annual_target,
          percent: Math.round((annualRevenue / targets.annual_target) * 100),
          status: (annualRevenue / targets.annual_target) >= yearPace ? 'on_track' :
                  (annualRevenue / targets.annual_target) >= (yearPace * 0.7) ? 'at_risk' : 'behind'
        } : null
      };
    }

    // Determine primary state (in priority order)
    let primaryState = 'E'; // Default: fully activated
    if (!hasAIProvider) primaryState = 'A';
    else if (!hasDeals) primaryState = 'B';
    else if (hasFewDeals) primaryState = 'C';
    else if (hasGoals) primaryState = 'D';

    // PLAN_MY_DAY_UX: Smart Onboarding Helper Tips
    // iPhone-style mini tips shown based on user's activation state
    // Each tip is dismissed individually via "Got it" button
    const availableTips = [];

    // Create Deals Tip - Show if user has 0 deals
    if (!hasDeals && !hasSeenFeature(FEATURE_KEYS.CREATE_DEALS)) {
      availableTips.push({
        id: FEATURE_KEYS.CREATE_DEALS,
        text: 'You can add deals from inside each Kanban column by clicking the + icon.',
        dismiss: () => markFeatureSeen(FEATURE_KEYS.CREATE_DEALS)
      });
    }

    // Import Clients Tip - Show if user has few/no deals (suggests CSV import)
    if (dealCount < 3 && !hasSeenFeature(FEATURE_KEYS.IMPORT_CLIENTS)) {
      availableTips.push({
        id: FEATURE_KEYS.IMPORT_CLIENTS,
        text: 'Import a CSV of past or current clients to instantly jumpstart your pipeline.',
        dismiss: () => markFeatureSeen(FEATURE_KEYS.IMPORT_CLIENTS)
      });
    }

    // Set Goals Tip - Show if user has no goals set
    if (!hasGoals && !hasSeenFeature(FEATURE_KEYS.GOALS)) {
      availableTips.push({
        id: FEATURE_KEYS.GOALS,
        text: 'Set your monthly, quarterly, and annual targets for personalized AI coaching.',
        dismiss: () => markFeatureSeen(FEATURE_KEYS.GOALS)
      });
    }

    // Invite Team Tip - Show if user has no team members
    if (!hasTeam && !hasSeenFeature(FEATURE_KEYS.TEAM)) {
      availableTips.push({
        id: FEATURE_KEYS.TEAM,
        text: 'Invite team members so you can assign deals, track performance, and collaborate.',
        dismiss: () => markFeatureSeen(FEATURE_KEYS.TEAM)
      });
    }

    return {
      // Primary state identifier
      state: primaryState,

      // Individual flags
      hasAIProvider,
      hasDeals,
      hasFewDeals,
      hasGoals,
      hasTeam,

      // Counts
      dealCount,
      teamCount,

      // Goal progress (for STATE_D summary bar)
      goalProgress,
      targets,

      // Feature discovery tips
      tips: availableTips,

      // Loading state
      loading: loadingTargets,

      // Helper checks
      isNewUser: !hasAIProvider || !hasDeals,
      isActivating: hasFewDeals,
      isFullyActivated: primaryState === 'D' || primaryState === 'E'
    };
  }, [deals, hasAIProvider, targets, teamCount, loadingTargets]);

  return activationState;
};

export { FEATURE_KEYS };
export default useActivationState;
