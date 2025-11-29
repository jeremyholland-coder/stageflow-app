// Simplified API Key Validator - No Entropy Checks
// Replaces overly restrictive validation

import { LLM_PROVIDERS } from './llm-providers';

export class ApiKeyValidator {
  validateProvider(key, providerId) {
    const provider = LLM_PROVIDERS[providerId];
    if (!provider) {
      return { valid: false, error: 'Unknown provider' };
    }

    // Use provider-specific validation
    if (!provider.validateFormat(key)) {
      return { 
        valid: false, 
        error: `Invalid ${provider.displayName} API key format` 
      };
    }

    return { valid: true };
  }

  detectProvider(key) {
    if (!key || typeof key !== 'string') return null;
    
    // Try each provider's validation
    for (const [id, provider] of Object.entries(LLM_PROVIDERS)) {
      if (provider.validateFormat(key)) {
        return id;
      }
    }
    
    return null;
  }
}

export const apiKeyValidator = new ApiKeyValidator();

// Legacy function for backward compatibility
export function validateNewApiKey(key) {
  const provider = apiKeyValidator.detectProvider(key);
  if (!provider) {
    return { valid: false, error: 'Unrecognized API key format' };
  }
  
  const result = apiKeyValidator.validateProvider(key, provider);
  return {
    valid: result.valid,
    provider: provider,
    error: result.error
  };
}

export default ApiKeyValidator;