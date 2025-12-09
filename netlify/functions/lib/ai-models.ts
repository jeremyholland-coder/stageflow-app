/**
 * AI MODEL CONFIGURATION
 *
 * P0 FIX 2025-12-09: REMOVED HARDCODED MODEL RESTRICTIONS
 *
 * Previous approach: Hardcoded list of "supported" models that blocked users
 * from using newer models until we updated code and redeployed.
 *
 * New approach:
 * - Accept ANY model ID the user provides
 * - Let the provider API be the source of truth for what's valid
 * - Keep "recommended" models for UI suggestions only (not enforcement)
 * - If provider rejects the model, surface that error clearly
 *
 * This means users can immediately use new models (gpt-5, claude-4, etc.)
 * as soon as their provider supports them - no StageFlow update needed.
 *
 * @author StageFlow Engineering
 */

/**
 * Provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'google';

/**
 * Model definition with metadata (for UI suggestions only)
 */
export interface ModelDefinition {
  id: string;
  name: string;
  tier: 'premium' | 'standard' | 'economy';
  isDefault?: boolean;
}

/**
 * RECOMMENDED models for UI display
 *
 * These are suggestions shown in the UI dropdown - NOT a restriction.
 * Users can also type custom model IDs directly.
 *
 * Update this list periodically to show the latest popular models,
 * but it's NOT blocking - users can use any model their provider supports.
 */
export const RECOMMENDED_MODELS: Record<ProviderType, ModelDefinition[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'standard', isDefault: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'economy' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tier: 'premium' },
    { id: 'o1-preview', name: 'o1 Preview', tier: 'premium' },
    { id: 'o1-mini', name: 'o1 Mini', tier: 'standard' },
  ],

  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', tier: 'standard', isDefault: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', tier: 'standard' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', tier: 'economy' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', tier: 'premium' },
  ],

  google: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'standard', isDefault: true },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', tier: 'standard' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', tier: 'economy' },
  ]
};

// Legacy export name for backwards compatibility
export const SUPPORTED_MODELS = RECOMMENDED_MODELS;

/**
 * Default models per provider
 * Used when user doesn't specify a model
 */
const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
};

/**
 * Get all recommended model IDs for a provider (for UI display)
 */
export function getModelIds(providerType: ProviderType): string[] {
  const models = RECOMMENDED_MODELS[providerType];
  return models ? models.map(m => m.id) : [];
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(providerType: ProviderType): string {
  return DEFAULT_MODELS[providerType] || 'gpt-4o';
}

/**
 * Validate a model ID
 *
 * P0 FIX 2025-12-09: NO LONGER REJECTS UNKNOWN MODELS
 *
 * We accept ANY model ID. The provider API will reject invalid models
 * with a clear error message. This allows users to use new models
 * immediately without waiting for StageFlow updates.
 *
 * @param providerType - The provider type
 * @param modelId - The model ID to validate
 * @returns Always returns { valid: true } - we don't gatekeep models
 */
export function validateModel(
  providerType: ProviderType,
  modelId: string | null | undefined
): { valid: boolean; error?: string; suggestedModel?: string } {
  // Empty model is valid - will use default
  if (!modelId) {
    return { valid: true };
  }

  // Unknown provider type - still allow, let runtime handle it
  if (!RECOMMENDED_MODELS[providerType]) {
    console.warn(`[ai-models] Unknown provider type: ${providerType}, allowing model: ${modelId}`);
    return { valid: true };
  }

  // P0 FIX: Accept ANY model ID - let the provider API validate
  // This allows users to use new models immediately
  const isRecommended = RECOMMENDED_MODELS[providerType]?.some(m => m.id === modelId);
  if (!isRecommended) {
    console.info(`[ai-models] Custom model "${modelId}" for ${providerType} - not in recommended list but allowing`);
  }

  return { valid: true };
}

/**
 * Get model display name
 * Returns the model ID if not in recommended list (user-provided custom model)
 */
export function getModelDisplayName(providerType: ProviderType, modelId: string): string {
  const models = RECOMMENDED_MODELS[providerType];
  if (!models) return modelId;

  const model = models.find(m => m.id === modelId);
  return model?.name || modelId; // Return raw ID for custom models
}

/**
 * Get model tier for scoring
 * Custom models get standard tier by default
 */
export function getModelTierScore(providerType: ProviderType, modelId: string | null): number {
  if (!modelId) return 2; // Default to standard

  const models = RECOMMENDED_MODELS[providerType];
  if (!models) return 2;

  const model = models.find(m => m.id === modelId);
  if (!model) return 2; // Custom models get standard tier

  switch (model.tier) {
    case 'premium': return 3;
    case 'standard': return 2;
    case 'economy': return 1;
    default: return 2;
  }
}

/**
 * Get recommended models for UI display
 * Includes a hint that users can enter custom model IDs
 */
export function getModelsForUI(providerType: ProviderType): Array<{ id: string; name: string; isCustom?: boolean }> {
  const models = RECOMMENDED_MODELS[providerType];
  if (!models) return [];

  return [
    ...models.map(m => ({
      id: m.id,
      name: m.name
    })),
    // Add a "custom" option hint
    { id: 'custom', name: '+ Enter custom model ID', isCustom: true }
  ];
}

/**
 * Check if a model is in the recommended list
 * (for analytics/logging only, not for blocking)
 */
export function isRecommendedModel(providerType: ProviderType, modelId: string): boolean {
  const models = RECOMMENDED_MODELS[providerType];
  return models?.some(m => m.id === modelId) ?? false;
}

export default {
  SUPPORTED_MODELS: RECOMMENDED_MODELS, // Legacy alias
  RECOMMENDED_MODELS,
  DEFAULT_MODELS,
  getModelIds,
  getDefaultModel,
  validateModel,
  getModelDisplayName,
  getModelTierScore,
  getModelsForUI,
  isRecommendedModel
};
