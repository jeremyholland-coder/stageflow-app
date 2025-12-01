import { lazy } from 'react';
import { BarChart3, Target, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { DashboardStats } from '../components/DashboardStats';
import { PipelineHealthDashboard } from '../components/PipelineHealthDashboard';

// PERFORMANCE: Lazy load heavy widgets to reduce main bundle size
const RevenueTargetsWidget = lazy(() => import('../components/RevenueTargetsWidget').then(m => ({ default: m.RevenueTargetsWidget })));
const GoalForecastWidget = lazy(() => import('../components/GoalForecastWidget').then(m => ({ default: m.GoalForecastWidget })));
// PHASE: Mission Control - Replace AIInsightsWidget with unified MissionControlPanel
const MissionControlPanel = lazy(() => import('../components/MissionControlPanel').then(m => ({ default: m.MissionControlPanel })));

/**
 * Dashboard Card Registry
 * Centralized configuration for all dashboard cards
 * Makes adding new cards easy and maintains consistency
 */

export const DASHBOARD_CARDS = {
  dashboard_stats: {
    id: 'dashboard_stats',
    label: 'Dashboard Statistics',
    description: 'Key metrics: total deals, win rate, conversion',
    component: DashboardStats,
    icon: BarChart3,
    defaultVisible: true,

    // Only show if user doesn't have AI provider
    isAvailable: ({ hasAIProvider }) => !hasAIProvider,

    // Props to pass to component
    getProps: ({ deals, currentUser }) => ({ deals, currentUser })
  },

  revenue_targets: {
    id: 'revenue_targets',
    label: 'Revenue Targets',
    description: 'Track progress toward personal and team goals',
    component: RevenueTargetsWidget,
    icon: Target,
    defaultVisible: true,

    // Always available (component self-hides if no targets)
    isAvailable: () => true,

    getProps: ({ organization, user }) => ({
      organization,
      userId: user?.id
    })
  },

  goal_forecast: {
    id: 'goal_forecast',
    label: 'AI Goal Forecast',
    description: 'AI-powered probability of hitting revenue goals',
    component: GoalForecastWidget,
    icon: Zap,
    defaultVisible: true,
    requiresFeature: 'Revenue targets set',

    // Show if user has targets set (component self-hides if not)
    isAvailable: () => true,

    getProps: ({ organization, user, deals }) => ({
      organization,
      userId: user?.id,
      deals
    })
  },

  ai_insights: {
    id: 'ai_insights',
    label: 'AI Mission Control',
    description: 'Unified AI panel with daily plan, tasks, performance, and coaching',
    component: MissionControlPanel,
    icon: Sparkles,
    defaultVisible: true,
    requiresFeature: 'AI provider connected',

    // Only show if user has AI provider
    isAvailable: ({ hasAIProvider, checkingAI }) => hasAIProvider && !checkingAI,

    getProps: ({ healthAlert, orphanedDealIds, onDismissAlert, deals, targets }) => ({
      healthAlert,
      orphanedDealIds,
      onDismissAlert,
      deals,
      targets: targets || {}
    })
  },

  pipeline_health: {
    id: 'pipeline_health',
    label: 'Pipeline Health Dashboard',
    description: 'Stage duration analytics and orphaned deals',
    component: PipelineHealthDashboard,
    icon: TrendingUp,
    defaultVisible: true,

    // Only show if user doesn't have AI provider
    isAvailable: ({ hasAIProvider, checkingAI }) => !hasAIProvider && !checkingAI,

    getProps: ({ deals, pipelineStages }) => ({
      deals,
      pipelineStages
    })
  }
};

/**
 * Get card configuration by ID
 */
export const getCardConfig = (cardId) => DASHBOARD_CARDS[cardId];

/**
 * Get all card IDs in default order
 * NOTE: dashboard_stats is rendered directly in Dashboard.jsx, not via card system
 * This prevents duplicate metric rows (FIX B1)
 */
export const getDefaultCardOrder = () => [
  'goal_forecast',
  'revenue_targets',
  'ai_insights',
  'pipeline_health'
];

/**
 * Check if a card should be rendered
 * @param {string} cardId - Card identifier
 * @param {object} preferences - User's card preferences
 * @param {object} context - Current app context (hasAIProvider, deals, etc.)
 * @returns {boolean} Whether card should be rendered
 */
export const shouldRenderCard = (cardId, preferences, context) => {
  const card = DASHBOARD_CARDS[cardId];
  if (!card) return false;

  // Check user preference (if explicitly false, hide)
  const userPref = preferences[`show_${cardId}`];
  if (userPref === false) return false;

  // Check if card is available in current context
  return card.isAvailable(context);
};
