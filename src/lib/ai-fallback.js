/**
 * AI Provider Fallback Logic
 *
 * Implements frontend fallback when the primary AI provider fails.
 * Only uses providers that the user has explicitly connected.
 *
 * QA FIX #5: Now includes retry with backoff for transient errors.
 * FIX 2025-12-03: Added ensureValidSession + Authorization header for reliable auth
 *
 * @module ai-fallback
 */

import {
  getProviderFallbackChain,
  getTaskFallbackOrder,
  isProviderErrorResponse,
  getProviderDisplayName,
  FALLBACK_ID_TO_PROVIDER_TYPE
} from '../ai/stageflowConfig';
// QA FIX #5: Import retry utilities
import { withRetry, isRetryableError } from './ai-retry';
// FIX 2025-12-03: Import auth utilities for proper Authorization header injection
import { supabase, ensureValidSession } from './supabase';

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
    // FIX 2025-12-03: Inject Authorization header for reliable auth
    await ensureValidSession();
    const { data: { session } } = await supabase.auth.getSession();

    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch('/.netlify/functions/get-ai-providers', {
      method: 'POST',
      headers,
      credentials: 'include', // Keep cookies as fallback
      body: JSON.stringify({ organization_id: organizationId })
    });

    if (!response.ok) {
      // FIX 2025-12-03: Detect auth errors vs provider errors
      if (response.status === 401 || response.status === 403) {
        console.warn('[ai-fallback] Auth error fetching providers - session may be expired');
        const error = new Error('Session expired');
        error.code = 'SESSION_ERROR';
        error.status = response.status;
        throw error;
      }
      console.error('[ai-fallback] Failed to fetch providers:', response.status);
      return [];
    }

    const result = await response.json();
    return result.providers || [];
  } catch (error) {
    // FIX 2025-12-03: Propagate auth errors instead of swallowing them
    if (error.code === 'SESSION_ERROR') {
      throw error;
    }
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
 * @param {string} options.providerType - The provider_type to use (e.g., 'openai', 'anthropic', 'google')
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

  // FIX 2025-12-03: Inject Authorization header for reliable auth
  await ensureValidSession();
  const { data: { session } } = await supabase.auth.getSession();

  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const response = await fetch('/.netlify/functions/ai-assistant', {
    method: 'POST',
    headers,
    credentials: 'include', // Keep cookies as fallback
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
    // FIX 2025-12-03: Mark auth errors with SESSION_ERROR code
    if (response.status === 401 || response.status === 403) {
      error.code = 'SESSION_ERROR';
    }
    throw error;
  }

  return response.json();
}

/**
 * Infer task type from message content for task-aware provider routing
 *
 * PHASE 18: Enables intelligent provider selection based on task characteristics
 *
 * @param {string} message - The user's message
 * @param {string} quickActionId - Optional quick action identifier
 * @returns {string} Task type: 'image', 'chart', 'coaching', 'planning', 'analysis', or 'general'
 */
function inferTaskType(message, quickActionId = null) {
  if (!message) return 'general';

  const messageLower = message.toLowerCase();

  // Quick action-based classification (most reliable)
  if (quickActionId) {
    // Chart/analytics quick actions
    const chartActions = ['weekly_trends', 'pipeline_flow', 'at_risk', 'revenue_forecast', 'goal_progress', 'velocity_booster', 'icp_analyzer', 'momentum_insights', 'flow_forecast'];
    if (chartActions.includes(quickActionId)) {
      return 'chart';
    }

    // Planning quick actions
    if (quickActionId === 'plan_my_day') {
      return 'planning';
    }

    // Coaching quick actions
    const coachingActions = ['deal_doctor', 'qualifier_coach', 'retention_master'];
    if (coachingActions.includes(quickActionId)) {
      return 'coaching';
    }
  }

  // Image/visual request detection
  const imageKeywords = ['image', 'graphic', 'slide', 'deck', 'presentation', 'visual summary', 'infographic', 'diagram', 'picture'];
  if (imageKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'image';
  }

  // Chart/analytics detection
  const chartKeywords = ['chart', 'graph', 'trend', 'forecast', 'pipeline flow', 'velocity', 'at risk', 'goal progress', 'weekly', 'monthly', 'distribution', 'breakdown', 'metrics', 'analytics', 'icp'];
  if (chartKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'chart';
  }

  // Planning detection (Plan My Day, daily action, etc.)
  const planningKeywords = ['plan my day', 'daily action', 'today', 'priorities', 'what should i', 'schedule', 'agenda', 'tasks for'];
  if (planningKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'planning';
  }

  // Coaching detection
  const coachingKeywords = ['coach', 'teach', 'help me', 'improve', 'how do i', 'strategy', 'qualification', 'discovery', 'negotiate', 'close', 'objection', 'stuck deal', 'stalled', 'blocked', 'advice', 'tips', 'best practice'];
  if (coachingKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'coaching';
  }

  // Analysis detection
  const analysisKeywords = ['analyze', 'analysis', 'review', 'assess', 'evaluate', 'summary', 'insight', 'pipeline', 'deals'];
  if (analysisKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'analysis';
  }

  // Default to general
  return 'general';
}

/**
 * Run an AI query with automatic fallback to other connected providers
 *
 * This function:
 * 1. Gets the list of connected providers
 * 2. PHASE 18: Infers task type for intelligent provider routing
 * 3. Builds a task-aware fallback chain starting with the optimal provider
 * 4. Tries each provider until one succeeds
 * 5. Returns the response with metadata about which provider was used
 *
 * @param {Object} options - Query options
 * @param {string} options.message - The user's message/query
 * @param {Array} options.deals - Deal data for context
 * @param {Array} options.conversationHistory - Previous conversation messages
 * @param {string} options.primaryProvider - The user's preferred provider_type
 * @param {string} options.organizationId - The organization ID
 * @param {Array} options.connectedProviders - Pre-fetched list of connected providers (optional)
 * @param {Array} options.aiSignals - AI signals for personalization (optional)
 * @param {string} options.taskType - Explicit task type override (optional)
 * @param {string} options.quickActionId - Quick action identifier for task inference (optional)
 * @returns {Promise<Object>} Response object with:
 *   - response: The AI response text
 *   - provider: Display name of the provider that responded
 *   - providerTypeUsed: The provider_type that was actually used
 *   - originalProvider: The original/primary provider_type that was attempted first
 *   - fallbackOccurred: Boolean indicating if fallback was needed
 *   - taskType: The inferred or explicit task type used for routing
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
    aiSignals = [],
    taskType: explicitTaskType = null,
    quickActionId = null
  } = options;

  // Get connected providers (use preloaded if available)
  const connectedProviders = preloadedProviders || await fetchConnectedProviders(organizationId);

  if (!connectedProviders || connectedProviders.length === 0) {
    throw new Error('No AI provider configured. Please connect an AI provider in Integrations settings.');
  }

  // PHASE 18: Infer task type for intelligent provider routing
  const taskType = explicitTaskType || inferTaskType(message, quickActionId);
  console.debug(`[ai-fallback] Task type inferred: ${taskType}`);

  // PHASE 18: Build task-aware fallback chain
  // If task type is provided, use task-specific routing; otherwise use global default
  const fallbackChain = getProviderFallbackChain(primaryProvider, connectedProviders, taskType);

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

      // FIX 2025-12-11: Check for explicit backend failure (ok: false)
      // Backend returns HTTP 200 with ok: false for AllProvidersFailedError
      // We must check this BEFORE checking response content
      if (result.ok === false) {
        console.warn(`[ai-fallback] Backend returned ok: false for ${providerType}`);

        // If there's a fallback plan, return it immediately (don't try other providers)
        // The backend already tried all providers and failed
        const fallbackPlan = result.fallbackPlan || result.error?.fallbackPlan;
        if (fallbackPlan && fallbackPlan.tasks && fallbackPlan.tasks.length > 0) {
          console.log('[ai-fallback] Backend failed but fallbackPlan available, returning it');
          return {
            response: null,
            fallbackPlan: fallbackPlan,
            provider: 'StageFlow (Fallback)',
            isFallback: true,
            isAllProvidersFailed: true,
            error: result.error,
            // Don't set response so CustomQueryView knows to use fallbackPlan
          };
        }

        // No fallback plan - throw error with user-friendly message
        const errorMessage = result.error?.message || result.message || 'AI providers temporarily unavailable';
        const error = new Error(errorMessage);
        error.isAllProvidersFailed = true;
        error.result = result;
        error.providersAttempted = result.providersAttempted || [providerType];
        throw error;
      }

      // Check for soft failures (200 response but error message content)
      if (result.response && isProviderErrorResponse(result.response)) {
        const isLastProvider = providerType === fallbackChain[fallbackChain.length - 1];

        // FIX 2025-12-03: If this is the LAST provider, return the response with soft failure metadata
        // instead of throwing ALL_PROVIDERS_FAILED. This ensures the user sees the provider's
        // error message (e.g., "Your API key needs credits") rather than a generic banner.
        if (isLastProvider) {
          console.warn(`[ai-fallback] Last provider ${providerType} returned soft failure - returning response with warning`);
          return {
            ...result,
            providerTypeUsed: providerType,
            originalProvider: originalProvider,
            fallbackOccurred: providerType !== originalProvider,
            attemptedProviders: attemptedProviders,
            taskType: taskType,
            provider: getProviderDisplayName(providerType),
            // Mark as soft failure so frontend can show appropriate warning
            isSoftFailure: true,
            softFailureMessage: `${getProviderDisplayName(providerType)} returned an error. Check your API key or try again.`
          };
        }

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
        // PHASE 18: Include task type used for routing
        taskType: taskType,
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

// PHASE 18: Export inferTaskType for use in other modules
export { inferTaskType };

/**
 * QA FIX #5: Run AI query with automatic retry for transient failures
 *
 * Wraps runAIQueryWithFallback with retry logic:
 * - Retries up to 2 times total (1 retry after initial failure)
 * - Uses 1s initial delay with exponential backoff
 * - Only retries on transient errors (network, timeout, 429)
 * - Does NOT retry on auth errors or invalid API keys
 *
 * @param {Object} options - Same options as runAIQueryWithFallback
 * @param {Object} retryOptions - Optional retry configuration
 * @param {Function} retryOptions.onRetryStart - Callback when retry starts: (attempt) => void
 * @returns {Promise<Object>} Response with { ...result, retryAttempts }
 */
export async function runAIQueryWithRetry(options, retryOptions = {}) {
  const { onRetryStart = null } = retryOptions;

  const result = await withRetry(
    () => runAIQueryWithFallback(options),
    {
      maxAttempts: 2,
      initialDelayMs: 1000,
      maxDelayMs: 3000,
      onRetry: (attempt, error, delayMs) => {
        console.log(`[ai-fallback] Retrying after ${delayMs}ms (attempt ${attempt})...`);
        if (onRetryStart) {
          onRetryStart(attempt);
        }
      },
      shouldRetry: isRetryableError
    }
  );

  if (result.success) {
    return {
      ...result.data,
      retryAttempts: result.attempts
    };
  }

  // Re-throw the error for the caller to handle
  const error = result.error;
  error.retryAttempts = result.attempts;
  error.wasRetried = result.attempts > 1;
  throw error;
}

export default {
  fetchConnectedProviders,
  runAIQueryWithFallback,
  runAIQueryWithRetry,
  generateFallbackNotice,
  generateAllFailedMessage,
  inferTaskType
};
