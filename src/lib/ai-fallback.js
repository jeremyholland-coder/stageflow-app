/**
 * AI Provider Fallback Logic
 *
 * Implements frontend fallback when the primary AI provider fails.
 * Only uses providers that the user has explicitly connected.
 *
 * @module ai-fallback
 */

import {
  getProviderFallbackChain,
  isProviderErrorResponse,
  getProviderDisplayName
} from '../ai/stageflowConfig';

/**
 * Fetch the list of connected AI providers for an organization
 *
 * @param {string} organizationId - The organization ID
 * @returns {Promise<Array>} Array of connected provider objects
 */
export async function fetchConnectedProviders(organizationId) {
  if (!organizationId) {
    console.warn('[ai-fallback] No organization ID provided');
    return [];
  }

  try {
    const response = await fetch('/.netlify/functions/get-ai-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ organization_id: organizationId })
    });

    if (!response.ok) {
      console.error('[ai-fallback] Failed to fetch providers:', response.status);
      return [];
    }

    const result = await response.json();
    return result.providers || [];
  } catch (error) {
    console.error('[ai-fallback] Error fetching providers:', error);
    return [];
  }
}

/**
 * Make a non-streaming AI request to a specific provider
 *
 * @param {Object} options - Request options
 * @param {string} options.message - The user's message/query
 * @param {Array} options.deals - Deal data to provide context
 * @param {Array} options.conversationHistory - Previous messages
 * @param {string} options.providerType - The provider_type to use (e.g., 'xai', 'openai')
 * @param {Array} options.aiSignals - Optional AI signals for personalization
 * @returns {Promise<Object>} The AI response
 */
async function makeAIRequest(options) {
  const {
    message,
    deals = [],
    conversationHistory = [],
    providerType,
    aiSignals = []
  } = options;

  const response = await fetch('/.netlify/functions/ai-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message,
      deals,
      conversationHistory,
      preferredProvider: providerType,
      aiSignals
    })
  });

  // Handle HTTP errors
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = errorData;
    throw error;
  }

  return response.json();
}

/**
 * Run an AI query with automatic fallback to other connected providers
 *
 * This function:
 * 1. Gets the list of connected providers
 * 2. Builds a fallback chain starting with the primary provider
 * 3. Tries each provider until one succeeds
 * 4. Returns the response with metadata about which provider was used
 *
 * @param {Object} options - Query options
 * @param {string} options.message - The user's message/query
 * @param {Array} options.deals - Deal data for context
 * @param {Array} options.conversationHistory - Previous conversation messages
 * @param {string} options.primaryProvider - The user's preferred provider_type
 * @param {string} options.organizationId - The organization ID
 * @param {Array} options.connectedProviders - Pre-fetched list of connected providers (optional)
 * @param {Array} options.aiSignals - AI signals for personalization (optional)
 * @returns {Promise<Object>} Response object with:
 *   - response: The AI response text
 *   - provider: Display name of the provider that responded
 *   - providerTypeUsed: The provider_type that was actually used
 *   - originalProvider: The original/primary provider_type that was attempted first
 *   - fallbackOccurred: Boolean indicating if fallback was needed
 *   - chartData, chartType, chartTitle: Optional chart data
 *   - performanceContext: Optional performance metrics
 */
export async function runAIQueryWithFallback(options) {
  const {
    message,
    deals = [],
    conversationHistory = [],
    primaryProvider,
    organizationId,
    connectedProviders: preloadedProviders,
    aiSignals = []
  } = options;

  // Get connected providers (use preloaded if available)
  const connectedProviders = preloadedProviders || await fetchConnectedProviders(organizationId);

  if (!connectedProviders || connectedProviders.length === 0) {
    throw new Error('No AI provider configured. Please connect an AI provider in Integrations settings.');
  }

  // Determine the primary provider to try first
  // If no explicit primary, use the first connected provider
  const effectivePrimary = primaryProvider ||
    (connectedProviders.length > 0 ? connectedProviders[0].provider_type : null);

  // Build the fallback chain
  const fallbackChain = getProviderFallbackChain(effectivePrimary, connectedProviders);

  if (fallbackChain.length === 0) {
    throw new Error('No valid providers in fallback chain. Please check your AI provider configuration.');
  }

  // Track the original provider for fallback messaging
  const originalProvider = fallbackChain[0];
  let lastError = null;
  let attemptedProviders = [];

  // Try each provider in the chain
  for (const providerType of fallbackChain) {
    attemptedProviders.push(providerType);

    try {
      console.debug(`[ai-fallback] Trying provider: ${providerType}`);

      const result = await makeAIRequest({
        message,
        deals,
        conversationHistory,
        providerType,
        aiSignals
      });

      // Check for soft failures (200 response but error message content)
      if (result.response && isProviderErrorResponse(result.response)) {
        console.warn(`[ai-fallback] Provider ${providerType} returned error response, trying next`);
        lastError = new Error(result.response);
        lastError.providerType = providerType;
        lastError.isSoftFailure = true;
        continue; // Try next provider
      }

      // Success! Return with fallback metadata
      const fallbackOccurred = providerType !== originalProvider;

      return {
        ...result,
        providerTypeUsed: providerType,
        originalProvider: originalProvider,
        fallbackOccurred: fallbackOccurred,
        attemptedProviders: attemptedProviders,
        // Override provider display name to match actual provider used
        provider: getProviderDisplayName(providerType)
      };

    } catch (error) {
      console.warn(`[ai-fallback] Provider ${providerType} failed:`, error.message);
      lastError = error;
      lastError.providerType = providerType;

      // Check for limit reached - don't fallback for this
      if (error.data?.error === 'AI_LIMIT_REACHED' || error.data?.limitReached) {
        throw error; // Propagate limit errors directly
      }

      // Check for auth errors - don't fallback for this either
      if (error.status === 401 || error.status === 403) {
        // Only throw if this is a user auth error, not provider auth
        if (!error.data?.error?.includes('API key')) {
          throw error;
        }
      }

      // Continue to next provider
    }
  }

  // All providers failed
  const allFailedError = new Error(
    "I wasn't able to get a response from any of your connected AI providers. Please check your API keys or try again in a few minutes."
  );
  allFailedError.attemptedProviders = attemptedProviders;
  allFailedError.lastError = lastError;
  allFailedError.isAllProvidersFailed = true;

  throw allFailedError;
}

/**
 * Generate a user-friendly fallback notice message
 *
 * @param {string} originalProvider - The provider_type that was originally tried
 * @param {string} usedProvider - The provider_type that actually responded
 * @returns {string} A short, neutral message explaining the fallback
 */
export function generateFallbackNotice(originalProvider, usedProvider) {
  const originalName = getProviderDisplayName(originalProvider);
  const usedName = getProviderDisplayName(usedProvider);

  return `${originalName} is unavailable right now, so I answered using ${usedName} instead.`;
}

/**
 * Generate an all-providers-failed error message
 *
 * @param {Array} attemptedProviders - List of provider_types that were tried
 * @returns {string} A clear error message for the user
 */
export function generateAllFailedMessage(attemptedProviders = []) {
  if (attemptedProviders.length === 1) {
    const providerName = getProviderDisplayName(attemptedProviders[0]);
    return `I'm unable to connect to ${providerName} right now. Please check your API key or try again in a few minutes.`;
  }

  return "I wasn't able to get a response from any of your connected AI providers. Please check your API keys or try again in a few minutes.";
}

export default {
  fetchConnectedProviders,
  runAIQueryWithFallback,
  generateFallbackNotice,
  generateAllFailedMessage
};
