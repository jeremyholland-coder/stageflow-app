/**
 * AI MODEL CONFIGURATION
 *
 * Centralized definition of supported AI models per provider.
 * Used for validation when saving providers and for UI model selection.
 *
 * TASK 4: Ensures user-selected models are actually supported.
 *
 * @author StageFlow Engineering
 * @date 2025-12-02
 */

/**
 * Provider types
 * FIX 2025-12-04: Only 3 providers (removed xAI/Grok)
 */
export type ProviderType = 'openai' | 'anthropic' | 'google';

/**
 * Model definition with metadata
 */
export interface ModelDefinition {
  id: string;
  name: string;
  tier: 'premium' | 'standard' | 'economy';
  isDefault?: boolean;
}

/**
 * Supported models by provider
 *
 * Each provider has a list of models that:
 * 1. Are supported by the provider's API
 * 2. We have tested and verified work with StageFlow
 * 3. Are available for user selection
 *
 * MAINTENANCE NOTE: Update this when providers release new models
 * or deprecate old ones.
 */
export const SUPPORTED_MODELS: Record<ProviderType, ModelDefinition[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'standard', isDefault: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'economy' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tier: 'premium' },
    // Future models (placeholders - enable when available)
    // { id: 'gpt-5', name: 'GPT-5', tier: 'premium' },
  ],

  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', tier: 'standard', isDefault: true },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', tier: 'economy' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', tier: 'premium' },
    // Newer versions (enable when available)
    // { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', tier: 'premium' },
  ],

  google: [
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', tier: 'standard', isDefault: true },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', tier: 'economy' },
    // { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'premium' },
  ]
  // FIX 2025-12-04: Removed xAI/Grok - deprecated provider
};

/**
 * Get all model IDs for a provider
 */
export function getModelIds(providerType: ProviderType): string[] {
  const models = SUPPORTED_MODELS[providerType];
  return models ? models.map(m => m.id) : [];
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(providerType: ProviderType): string | null {
  const models = SUPPORTED_MODELS[providerType];
  if (!models || models.length === 0) return null;

  const defaultModel = models.find(m => m.isDefault);
  return defaultModel?.id || models[0].id;
}

/**
 * Validate that a model is supported for a provider
 *
 * @param providerType - The provider type
 * @param modelId - The model ID to validate
 * @returns { valid: boolean, error?: string, suggestedModel?: string }
 */
export function validateModel(
  providerType: ProviderType,
  modelId: string | null | undefined
): { valid: boolean; error?: string; suggestedModel?: string } {
  // Null/empty model is allowed - will use default
  if (!modelId) {
    return { valid: true };
  }

  const models = SUPPORTED_MODELS[providerType];
  if (!models) {
    return {
      valid: false,
      error: `Unknown provider type: ${providerType}`
    };
  }

  const modelIds = models.map(m => m.id);

  if (modelIds.includes(modelId)) {
    return { valid: true };
  }

  // Model not found - suggest the default
  const defaultModel = getDefaultModel(providerType);

  return {
    valid: false,
    error: `Model "${modelId}" is not supported for ${providerType}. Supported models: ${modelIds.join(', ')}`,
    suggestedModel: defaultModel || undefined
  };
}

/**
 * Get model display name
 */
export function getModelDisplayName(providerType: ProviderType, modelId: string): string {
  const models = SUPPORTED_MODELS[providerType];
  if (!models) return modelId;

  const model = models.find(m => m.id === modelId);
  return model?.name || modelId;
}

/**
 * Get model tier for scoring
 */
export function getModelTierScore(providerType: ProviderType, modelId: string | null): number {
  if (!modelId) return 1; // Default tier

  const models = SUPPORTED_MODELS[providerType];
  if (!models) return 1;

  const model = models.find(m => m.id === modelId);
  if (!model) return 1;

  switch (model.tier) {
    case 'premium': return 3;
    case 'standard': return 2;
    case 'economy': return 1;
    default: return 1;
  }
}

/**
 * Export models list for frontend consumption (safe to expose)
 */
export function getModelsForUI(providerType: ProviderType): Array<{ id: string; name: string }> {
  const models = SUPPORTED_MODELS[providerType];
  if (!models) return [];

  return models.map(m => ({
    id: m.id,
    name: m.name
  }));
}

export default {
  SUPPORTED_MODELS,
  getModelIds,
  getDefaultModel,
  validateModel,
  getModelDisplayName,
  getModelTierScore,
  getModelsForUI
};
