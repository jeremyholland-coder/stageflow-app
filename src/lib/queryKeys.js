/**
 * Query Keys - Centralized key definitions for TanStack Query
 * Area 4 - Caching for Production Hardening
 *
 * Consistent query keys enable:
 * - Reliable cache invalidation
 * - Predictable cache lookups
 * - Easy debugging
 *
 * Key structure: ['resource', 'scope', ...identifiers]
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

export const queryKeys = {
  // =========================================================================
  // DEALS
  // =========================================================================

  /**
   * All deals queries - use for broad invalidation
   */
  deals: {
    all: ['deals'],

    /**
     * Deals by organization (all pipelines)
     */
    byOrg: (orgId) => ['deals', 'org', orgId],

    /**
     * Deals by pipeline
     */
    byPipeline: (orgId, pipelineId) => ['deals', 'pipeline', orgId, pipelineId],

    /**
     * Single deal by ID
     */
    detail: (orgId, dealId) => ['deals', 'detail', orgId, dealId],

    /**
     * Deals by stage
     */
    byStage: (orgId, stageId) => ['deals', 'stage', orgId, stageId],

    /**
     * Recently updated deals
     */
    recent: (orgId) => ['deals', 'recent', orgId],
  },

  // =========================================================================
  // ANALYTICS
  // =========================================================================

  analytics: {
    all: ['analytics'],

    /**
     * Pipeline summary (totals, conversion rates)
     */
    pipelineSummary: (orgId) => ['analytics', 'pipeline', orgId],

    /**
     * Stage breakdown
     */
    stageBreakdown: (orgId) => ['analytics', 'stages', orgId],

    /**
     * Revenue forecast
     */
    revenueForecast: (orgId) => ['analytics', 'forecast', orgId],

    /**
     * Disqualified deals summary
     */
    disqualifiedSummary: (orgId) => ['analytics', 'disqualified', orgId],

    /**
     * Team performance
     */
    teamPerformance: (orgId) => ['analytics', 'team', orgId],

    /**
     * Monthly targets/goals
     */
    monthlyGoals: (orgId) => ['analytics', 'goals', orgId],

    /**
     * Activity feed / timeline
     */
    activityFeed: (orgId) => ['analytics', 'activity', orgId],
  },

  // =========================================================================
  // PIPELINES
  // =========================================================================

  pipelines: {
    all: ['pipelines'],

    /**
     * Pipelines by organization
     */
    byOrg: (orgId) => ['pipelines', 'org', orgId],

    /**
     * Single pipeline with stages
     */
    detail: (orgId, pipelineId) => ['pipelines', 'detail', orgId, pipelineId],

    /**
     * Pipeline stages
     */
    stages: (orgId, pipelineId) => ['pipelines', 'stages', orgId, pipelineId],
  },

  // =========================================================================
  // TEAM / USERS
  // =========================================================================

  team: {
    all: ['team'],

    /**
     * Team members for organization
     */
    members: (orgId) => ['team', 'members', orgId],

    /**
     * Single user profile
     */
    user: (userId) => ['team', 'user', userId],
  },

  // =========================================================================
  // ORGANIZATION
  // =========================================================================

  organization: {
    all: ['organization'],

    /**
     * Organization details
     */
    detail: (orgId) => ['organization', 'detail', orgId],

    /**
     * Organization settings
     */
    settings: (orgId) => ['organization', 'settings', orgId],
  },

  // =========================================================================
  // AI
  // =========================================================================

  ai: {
    all: ['ai'],

    /**
     * AI providers status
     */
    providers: (orgId) => ['ai', 'providers', orgId],

    /**
     * AI usage stats
     */
    usage: (orgId) => ['ai', 'usage', orgId],
  },

  // =========================================================================
  // ONBOARDING
  // =========================================================================

  onboarding: {
    all: ['onboarding'],

    /**
     * Onboarding state for user/org
     */
    state: (orgId) => ['onboarding', 'state', orgId],
  },
};

export default queryKeys;
