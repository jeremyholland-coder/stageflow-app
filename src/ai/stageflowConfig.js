/**
 * StageFlow AI Configuration
 *
 * Centralized AI configuration for consistent styling and behavior
 * across all AI-powered features.
 *
 * @author StageFlow Engineering
 */

/**
 * StageFlow AI System Prompt Rules
 * These rules are enforced across all AI interactions
 */
export const STAGEFLOW_AI_RULES = {
  // Tone and style
  noEmojis: true,
  professionalTone: true,
  concise: true,

  // Output format
  useBullets: true,
  useHeadings: true,
  maxParagraphLength: 4, // sentences

  // Section structure for Plan My Day
  sections: [
    { id: 'summary', label: 'Summary', required: true },
    { id: 'priority_deals', label: 'Priority Deals', required: true },
    { id: 'risks', label: 'Risks', required: false },
    { id: 'suggestions', label: 'Suggestions', required: true }
  ]
};

/**
 * Sanitize AI text output
 * Removes emojis, excessive whitespace, and cleans formatting
 *
 * @param {string} text - Raw AI output text
 * @returns {string} Sanitized text
 */
export function sanitizeAIText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove emojis and emoji-like characters
  // This regex covers most Unicode emoji ranges
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{2934}-\u{2935}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2600}-\u{2604}]|[\u{260E}]|[\u{2611}]|[\u{2614}-\u{2615}]|[\u{2618}]|[\u{261D}]|[\u{2620}]|[\u{2622}-\u{2623}]|[\u{2626}]|[\u{262A}]|[\u{262E}-\u{262F}]|[\u{2638}-\u{263A}]|[\u{2640}]|[\u{2642}]|[\u{2648}-\u{2653}]|[\u{265F}-\u{2660}]|[\u{2663}]|[\u{2665}-\u{2666}]|[\u{2668}]|[\u{267B}]|[\u{267E}-\u{267F}]|[\u{2692}-\u{2697}]|[\u{2699}]|[\u{269B}-\u{269C}]|[\u{26A0}-\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26B0}-\u{26B1}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26C8}]|[\u{26CE}]|[\u{26CF}]|[\u{26D1}]|[\u{26D3}-\u{26D4}]|[\u{26E9}-\u{26EA}]|[\u{26F0}-\u{26F5}]|[\u{26F7}-\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]/gu;

  let sanitized = text.replace(emojiRegex, '');

  // Remove common text emoticons
  const textEmoticonRegex = /[:;][-']?[)D(P|/\\oO3><]/g;
  sanitized = sanitized.replace(textEmoticonRegex, '');

  // Clean up excessive whitespace
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ');

  // Trim leading/trailing whitespace from each line
  sanitized = sanitized.split('\n').map(line => line.trim()).join('\n');

  // Trim overall
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Parse structured AI response for Mission Control
 * Extracts sections from AI narrative text
 *
 * @param {string} text - AI response text
 * @returns {Object} Parsed sections { summary, priorityDeals, risks, suggestions }
 */
export function parseAIResponseSections(text) {
  if (!text || typeof text !== 'string') {
    return { summary: '', priorityDeals: [], risks: [], suggestions: [] };
  }

  const sanitized = sanitizeAIText(text);

  // Split by common section headers
  const sections = {
    summary: '',
    priorityDeals: [],
    risks: [],
    suggestions: []
  };

  // Look for summary (first paragraph before any headers)
  const summaryMatch = sanitized.match(/^([\s\S]*?)(?=\n(?:#{1,3}|\*\*|Priority|Risk|Suggestion|Deal|Action))/i);
  if (summaryMatch) {
    sections.summary = summaryMatch[1].trim();
  } else {
    // Take first 3 sentences as summary
    const sentences = sanitized.split(/[.!?]+/).slice(0, 3);
    sections.summary = sentences.join('. ').trim() + '.';
  }

  // Extract priority deals (bullet points after "Priority" or "Deal" headers)
  const priorityMatch = sanitized.match(/(?:Priority|Deals?|Closest)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (priorityMatch) {
    priorityMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.priorityDeals.includes(cleanBullet)) {
            sections.priorityDeals.push(cleanBullet);
          }
        });
      }
    });
  }

  // Extract risks
  const riskMatch = sanitized.match(/(?:Risk|At[\s-]?Risk|Warning|Concern)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (riskMatch) {
    riskMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.risks.includes(cleanBullet)) {
            sections.risks.push(cleanBullet);
          }
        });
      }
    });
  }

  // Extract suggestions
  const suggestionMatch = sanitized.match(/(?:Suggestion|Recommend|Action|Next[\s-]?Step)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (suggestionMatch) {
    suggestionMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.suggestions.includes(cleanBullet)) {
            sections.suggestions.push(cleanBullet);
          }
        });
      }
    });
  }

  return sections;
}

/**
 * Format currency value
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Format percentage value
 * @param {number} value - Numeric percentage (0-100)
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)}%`;
}

/**
 * Provider Fallback Configuration
 *
 * Defines the order in which AI providers should be tried if the primary fails.
 * The provider IDs must match the provider_type values in the ai_providers table.
 *
 * PHASE 18: Updated to prioritize ChatGPT (best all-arounder for RevOps)
 * followed by Claude (best coaching), Gemini (strong fallback)
 * FIX 2025-12-04: Removed Grok/xAI - deprecated provider
 */
export const PROVIDER_FALLBACK_ORDER = ['gpt4o', 'claude', 'gemini'];

/**
 * Task-Type-Based Provider Chains
 *
 * Different tasks have different optimal providers based on their strengths:
 * - ChatGPT (GPT-4o): Best for RevOps analysis, planning, structured tasks
 * - Claude: Best for coaching, insights, long-context understanding
 * - Gemini: Strong fallback, good analytics
 * FIX 2025-12-04: Removed Grok/xAI - deprecated provider
 */
export const TASK_PROVIDER_CHAINS = {
  // Image/chart/visual generation - Gemini excels
  image: ['gemini', 'gpt4o', 'claude'],
  chart: ['gemini', 'gpt4o', 'claude'],

  // Coaching/insight tasks - Claude excels at tone and reasoning
  coaching: ['claude', 'gpt4o', 'gemini'],

  // Planning/analysis tasks - ChatGPT excels at structured output
  planning: ['gpt4o', 'claude', 'gemini'],
  analysis: ['gpt4o', 'claude', 'gemini'],

  // General Q&A - ChatGPT as default brain
  general: ['gpt4o', 'claude', 'gemini'],

  // Default fallback (same as global)
  default: ['gpt4o', 'claude', 'gemini']
};

/**
 * Provider ID mapping to display names
 * Used for user-friendly messages when showing which provider was used
 * FIX 2025-12-04: Removed Grok/xAI - deprecated provider
 */
export const PROVIDER_DISPLAY_NAMES = {
  'anthropic': 'Claude',
  'claude': 'Claude',
  'openai': 'ChatGPT',
  'gpt4o': 'ChatGPT',
  'google': 'Gemini',
  'gemini': 'Gemini'
};

/**
 * Error patterns that indicate a provider-specific failure
 * These patterns help detect "soft failures" where the API returns 200 but with an error message
 */
export const PROVIDER_ERROR_PATTERNS = [
  "I'm unable to connect to",
  "API key needs credits or permissions",
  "Invalid API key",
  "rate limit exceeded",
  "quota exceeded",
  "authentication failed",
  "unauthorized"
];

/**
 * Map provider_type values to internal fallback IDs
 * The ai_providers table uses 'openai' for ChatGPT, etc.
 * FIX 2025-12-04: Removed Grok/xAI - deprecated provider
 */
export const PROVIDER_TYPE_TO_FALLBACK_ID = {
  'openai': 'gpt4o',
  'anthropic': 'claude',
  'google': 'gemini'
};

/**
 * Map fallback IDs back to provider_type for API calls
 * FIX 2025-12-04: Removed Grok/xAI - deprecated provider
 */
export const FALLBACK_ID_TO_PROVIDER_TYPE = {
  'gpt4o': 'openai',
  'claude': 'anthropic',
  'gemini': 'google'
};

/**
 * Get the appropriate fallback order for a given task type
 *
 * @param {string} taskType - The type of task (image, chart, coaching, planning, analysis, general)
 * @returns {Array} Ordered array of fallback IDs for this task type
 */
export function getTaskFallbackOrder(taskType) {
  if (!taskType) return PROVIDER_FALLBACK_ORDER;

  // Normalize task type
  const normalizedType = taskType.toLowerCase();

  // Map task types to their optimal chains
  if (normalizedType === 'image' || normalizedType === 'image_suitable') {
    return TASK_PROVIDER_CHAINS.image;
  }
  if (normalizedType === 'chart' || normalizedType === 'chart_insight') {
    return TASK_PROVIDER_CHAINS.chart;
  }
  if (normalizedType === 'coaching') {
    return TASK_PROVIDER_CHAINS.coaching;
  }
  if (normalizedType === 'planning' || normalizedType === 'plan_my_day') {
    return TASK_PROVIDER_CHAINS.planning;
  }
  if (normalizedType === 'analysis' || normalizedType === 'text_analysis') {
    return TASK_PROVIDER_CHAINS.analysis;
  }

  // Default to global fallback order
  return TASK_PROVIDER_CHAINS.default || PROVIDER_FALLBACK_ORDER;
}

/**
 * Get an ordered list of providers to try, starting with the primary
 *
 * @param {string} primaryProvider - The user's preferred/default provider_type (e.g., 'openai', 'anthropic')
 * @param {Array} connectedProviders - Array of connected provider objects from Supabase
 * @param {string} taskType - Optional task type for task-aware provider selection
 * @returns {Array} Ordered array of provider_type values to try
 */
export function getProviderFallbackChain(primaryProvider, connectedProviders, taskType = null) {
  if (!connectedProviders || !Array.isArray(connectedProviders)) {
    return primaryProvider ? [primaryProvider] : [];
  }

  // Filter to only active/connected providers
  const activeProviders = connectedProviders.filter(p => p && p.active !== false);

  // Get the set of connected provider_type values
  const connectedTypes = new Set(activeProviders.map(p => p.provider_type));

  // Build the fallback chain
  const chain = [];

  // PHASE 18: Get task-specific fallback order if taskType provided
  const fallbackOrder = taskType
    ? getTaskFallbackOrder(taskType)
    : PROVIDER_FALLBACK_ORDER;

  // Start with primary if it's connected (unless task routing overrides)
  if (primaryProvider && connectedTypes.has(primaryProvider) && !taskType) {
    chain.push(primaryProvider);
  }

  // Add remaining providers in priority order (task-aware or global)
  for (const fallbackId of fallbackOrder) {
    const providerType = FALLBACK_ID_TO_PROVIDER_TYPE[fallbackId];
    if (providerType && connectedTypes.has(providerType) && !chain.includes(providerType)) {
      chain.push(providerType);
    }
  }

  return chain;
}

/**
 * Check if an AI response indicates a provider-specific failure
 * These are "soft" failures where the API returns 200 but the response is an error message
 *
 * @param {string} responseText - The text content of the AI response
 * @returns {boolean} True if the response appears to be a provider error
 */
export function isProviderErrorResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return false;
  }

  const lowerText = responseText.toLowerCase();
  return PROVIDER_ERROR_PATTERNS.some(pattern =>
    lowerText.includes(pattern.toLowerCase())
  );
}

/**
 * Get the display name for a provider type
 *
 * @param {string} providerType - The provider_type value (e.g., 'openai', 'anthropic', 'google')
 * @returns {string} Human-readable provider name
 */
export function getProviderDisplayName(providerType) {
  return PROVIDER_DISPLAY_NAMES[providerType] || providerType || 'AI';
}

export default {
  STAGEFLOW_AI_RULES,
  sanitizeAIText,
  parseAIResponseSections,
  formatCurrency,
  formatPercentage,
  // Provider fallback exports
  PROVIDER_FALLBACK_ORDER,
  TASK_PROVIDER_CHAINS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ERROR_PATTERNS,
  PROVIDER_TYPE_TO_FALLBACK_ID,
  FALLBACK_ID_TO_PROVIDER_TYPE,
  getTaskFallbackOrder,
  getProviderFallbackChain,
  isProviderErrorResponse,
  getProviderDisplayName
};
