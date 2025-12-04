/**
 * UNIFIED PROVIDER SELECTION
 *
 * Single source of truth for AI provider selection across all endpoints.
 * Implements task-type affinity scoring with connection-order tie-breaking.
 *
 * CANONICAL PATH: All AI provider selection MUST go through this module.
 *
 * @author StageFlow Engineering
 * @date 2025-12-02
 */

import { ProviderType, PROVIDER_DISPLAY_NAMES } from './ai-orchestrator';

// Provider configuration from database
export interface AIProvider {
  id: string;
  organization_id: string;
  provider_type: ProviderType;
  model: string | null;
  display_name: string | null;
  api_key_encrypted: string;
  active: boolean;
  connection_order?: number;
  created_at: string;
}

// Task types for affinity-based routing
export type TaskType =
  | 'coaching'
  | 'planning'
  | 'chart_insight'
  | 'text_analysis'
  | 'image_suitable'
  | 'general'
  | 'default';

/**
 * Task-specific model preferences (affinity scores)
 *
 * Higher score = better fit for the task type.
 * These scores are multiplied by 10 and added to negative connection_order
 * for final scoring: score = (affinity * 10) - connection_order
 *
 * This means:
 * - Task affinity is the PRIMARY factor (not tie-breaker)
 * - Earlier connections (lower connection_order) win ties
 *
 * FIX 2025-12-04: Removed xAI/Grok - only 3 providers supported
 */
const TASK_MODEL_AFFINITY: Record<TaskType, Record<ProviderType, number>> = {
  // Coaching: Claude excels at nuanced, empathetic responses
  coaching: {
    anthropic: 5,
    openai: 3,
    google: 2
  },
  // Planning: GPT excels at structured multi-step guidance
  planning: {
    openai: 5,
    anthropic: 4,
    google: 2
  },
  // Chart insights: GPT for structured data, Gemini for visualization
  chart_insight: {
    openai: 4,
    google: 3,
    anthropic: 2
  },
  // Text analysis: GPT best for RevOps analysis
  text_analysis: {
    openai: 4,
    anthropic: 3,
    google: 2
  },
  // Image suitable: Gemini excels at visual content
  image_suitable: {
    google: 5,
    openai: 3,
    anthropic: 2
  },
  // General: GPT as default all-rounder
  general: {
    openai: 4,
    anthropic: 3,
    google: 2
  },
  // Default fallback (same as general)
  default: {
    openai: 3,
    anthropic: 3,
    google: 2
  }
};

/**
 * Model tier definitions for secondary scoring
 * Premium = 3, Standard = 2, Economy = 1, Unknown = 0
 * FIX 2025-12-04: Removed xAI/Grok models - deprecated provider
 */
const MODEL_TIERS: Record<string, number> = {
  // OpenAI
  'gpt-5': 3,
  'gpt-5-mini': 2,
  'gpt-4.1': 2,
  'gpt-4.1-mini': 1,
  'gpt-4o-mini': 1,
  'gpt-4o': 2,
  'gpt-4-turbo': 2,
  // Anthropic
  'claude-sonnet-4-5-20250929': 3,
  'claude-opus-4-1-20250805': 3,
  'claude-sonnet-3-7-20250219': 2,
  'claude-haiku-4-5-20251001': 1,
  'claude-3-5-sonnet-20241022': 2,
  // Google
  'gemini-2.5-pro': 3,
  'gemini-2.5-flash': 2,
  'gemini-2.5-flash-lite': 1,
  'gemini-1.5-pro': 2
};

/**
 * Get model tier (used as secondary scoring factor)
 */
function getModelTier(modelName: string | null): number {
  if (!modelName) return 0;
  return MODEL_TIERS[modelName] || 0;
}

/**
 * Normalize task type to match affinity keys
 */
function normalizeTaskType(taskType: string): TaskType {
  const normalized = taskType.toLowerCase();

  if (normalized === 'plan_my_day') return 'planning';
  if (normalized === 'chart') return 'chart_insight';
  if (normalized === 'image') return 'image_suitable';
  if (normalized === 'analysis') return 'text_analysis';

  // Check if it's a valid TaskType
  if (normalized in TASK_MODEL_AFFINITY) {
    return normalized as TaskType;
  }

  return 'default';
}

/**
 * SELECT THE BEST PROVIDER
 *
 * This is the CANONICAL function for provider selection.
 * All AI endpoints should use this function.
 *
 * Scoring formula:
 *   score = (task_affinity * 10) + model_tier - connection_order
 *
 * This ensures:
 * 1. Task affinity is the PRIMARY factor
 * 2. Model tier adds slight preference for better models
 * 3. Connection order breaks ties (earlier = preferred)
 *
 * @param providers - Active providers for the organization
 * @param taskType - The type of task being performed
 * @returns The best provider, or null if none available
 */
export function selectProvider(
  providers: AIProvider[],
  taskType: string = 'default'
): AIProvider | null {
  // Filter to active providers only
  const activeProviders = providers.filter(p => p.active);

  if (activeProviders.length === 0) return null;
  if (activeProviders.length === 1) return activeProviders[0];

  const normalizedTaskType = normalizeTaskType(taskType);
  const affinityMap = TASK_MODEL_AFFINITY[normalizedTaskType] || TASK_MODEL_AFFINITY.default;

  // Score each provider
  const scored = activeProviders.map((provider, index) => {
    const affinity = affinityMap[provider.provider_type] || 1;
    const tier = getModelTier(provider.model);
    // Use connection_order if available, otherwise use array index (first = 0)
    const connectionOrder = provider.connection_order ?? index;

    // Score: affinity is primary (x10), tier is secondary, connection order breaks ties
    const score = (affinity * 10) + tier - (connectionOrder * 0.1);

    return { provider, score, affinity, tier };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const selected = scored[0];
  console.log(
    `[select-provider] Task: ${normalizedTaskType}, ` +
    `Selected: ${selected.provider.provider_type} ` +
    `(affinity=${selected.affinity}, tier=${selected.tier}, score=${selected.score.toFixed(1)})`
  );

  return selected.provider;
}

/**
 * Build a fallback chain for the given task type
 *
 * Returns providers sorted by preference for the task,
 * with the best provider first.
 *
 * @param providers - Active providers for the organization
 * @param taskType - The type of task being performed
 * @returns Array of providers in fallback order
 */
export function buildFallbackChain(
  providers: AIProvider[],
  taskType: string = 'default'
): AIProvider[] {
  const activeProviders = providers.filter(p => p.active);

  if (activeProviders.length === 0) return [];
  if (activeProviders.length === 1) return activeProviders;

  const normalizedTaskType = normalizeTaskType(taskType);
  const affinityMap = TASK_MODEL_AFFINITY[normalizedTaskType] || TASK_MODEL_AFFINITY.default;

  // Score and sort all providers
  return [...activeProviders].sort((a, b) => {
    const aAffinity = affinityMap[a.provider_type] || 1;
    const bAffinity = affinityMap[b.provider_type] || 1;
    const aTier = getModelTier(a.model);
    const bTier = getModelTier(b.model);
    const aOrder = a.connection_order ?? 999;
    const bOrder = b.connection_order ?? 999;

    const aScore = (aAffinity * 10) + aTier - (aOrder * 0.1);
    const bScore = (bAffinity * 10) + bTier - (bOrder * 0.1);

    return bScore - aScore;
  });
}

/**
 * Get the display name for a provider type
 */
export function getProviderDisplayName(providerType: ProviderType | string): string {
  return PROVIDER_DISPLAY_NAMES[providerType as ProviderType] || providerType;
}

// Export affinity map for testing/debugging
export { TASK_MODEL_AFFINITY, MODEL_TIERS };
