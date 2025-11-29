/**
 * AI Offline Cache - Store and retrieve AI insights for offline access
 *
 * "Works on a plane" - Keep AI insights available when offline
 *
 * Features:
 * - Cache last AI insight per quick action type
 * - Store summary text, chart type, and timestamp
 * - Graceful error handling (never crashes the app)
 * - localStorage-based for simplicity in v1
 *
 * @author StageFlow Engineering
 * @date November 25, 2025
 */

import { logger } from './logger';

const CACHE_KEY_PREFIX = 'stageflow_ai_insights';
const MAX_INSIGHTS = 10; // Keep last 10 insights per org
// OFFLINE-01 FIX: TTL for cached insights (24 hours in milliseconds)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Get the cache key for an organization
 * @param {string} orgId - Organization ID
 * @returns {string} Cache key
 */
function getCacheKey(orgId) {
  return `${CACHE_KEY_PREFIX}:${orgId}`;
}

/**
 * Save an AI insight to local cache
 *
 * @param {string} orgId - Organization ID
 * @param {string} quickActionId - Quick action type (e.g. 'weekly_trends', 'goal_progress')
 * @param {Object} payload - Insight data
 * @param {string} payload.summaryText - Short summary of the AI response
 * @param {string} [payload.chartType] - Type of chart if applicable
 * @param {Object} [payload.chartData] - Chart data if applicable (kept small)
 * @param {Object} [payload.metrics] - Performance metrics if applicable
 */
export function saveAIInsight(orgId, quickActionId, payload) {
  if (!orgId || !quickActionId || !payload) {
    logger.log('[AI Cache] Missing required params for saveAIInsight');
    return;
  }

  try {
    const cacheKey = getCacheKey(orgId);
    let cache = {};

    // Load existing cache
    const existing = localStorage.getItem(cacheKey);
    if (existing) {
      try {
        cache = JSON.parse(existing);
      } catch (parseError) {
        // Corrupted cache, start fresh
        logger.log('[AI Cache] Corrupted cache, starting fresh');
        cache = {};
      }
    }

    // Ensure insights array exists
    if (!cache.insights) {
      cache.insights = {};
    }

    // Store the insight by quick action ID
    cache.insights[quickActionId] = {
      summaryText: payload.summaryText || '',
      chartType: payload.chartType || null,
      chartData: payload.chartData || null,
      metrics: payload.metrics || null,
      timestamp: new Date().toISOString(),
    };

    // Track the most recent insight globally
    cache.lastInsight = {
      quickActionId,
      ...cache.insights[quickActionId],
    };

    // Prune old insights if we have too many
    const insightKeys = Object.keys(cache.insights);
    if (insightKeys.length > MAX_INSIGHTS) {
      // Sort by timestamp and keep only the newest
      const sorted = insightKeys
        .map(key => ({ key, ts: cache.insights[key].timestamp }))
        .sort((a, b) => new Date(b.ts) - new Date(a.ts))
        .slice(0, MAX_INSIGHTS);

      const newInsights = {};
      sorted.forEach(({ key }) => {
        newInsights[key] = cache.insights[key];
      });
      cache.insights = newInsights;
    }

    // CACHE-01 FIX: Wrap setItem in try-catch to handle quota exceeded
    try {
      localStorage.setItem(cacheKey, JSON.stringify(cache));
      logger.log(`[AI Cache] Saved insight for ${quickActionId}`);
    } catch (storageError) {
      // Handle QuotaExceededError by pruning old insights
      if (storageError.name === 'QuotaExceededError' || storageError.code === 22) {
        console.warn('[AI Cache] Storage quota exceeded, pruning old insights');
        // Clear this org's cache and try again with just the new insight
        try {
          localStorage.removeItem(cacheKey);
          const freshCache = {
            insights: { [quickActionId]: cache.insights[quickActionId] },
            lastInsight: cache.lastInsight
          };
          localStorage.setItem(cacheKey, JSON.stringify(freshCache));
        } catch (retryError) {
          console.warn('[AI Cache] Failed to save after prune:', retryError);
        }
      } else {
        console.warn('[AI Cache] Storage error:', storageError);
      }
    }
  } catch (error) {
    // Fail silently - never crash the app
    console.warn('[AI Cache] Failed to save insight:', error);
  }
}

/**
 * Load the last AI insight from cache
 *
 * @param {string} orgId - Organization ID
 * @param {string} [quickActionId] - Optional: get insight for specific quick action
 * @returns {Object|null} Insight data or null if not found
 */
export function loadLastAIInsight(orgId, quickActionId = null) {
  if (!orgId) {
    return null;
  }

  // OFFLINE-01 FIX: Helper to check if insight is within TTL
  const isWithinTTL = (timestamp) => {
    if (!timestamp) return false;
    const age = Date.now() - new Date(timestamp).getTime();
    return age < CACHE_TTL_MS;
  };

  try {
    const cacheKey = getCacheKey(orgId);
    const existing = localStorage.getItem(cacheKey);

    if (!existing) {
      return null;
    }

    const cache = JSON.parse(existing);

    // If specific quick action requested
    if (quickActionId && cache.insights?.[quickActionId]) {
      const insight = cache.insights[quickActionId];
      // OFFLINE-01 FIX: Check TTL before returning
      if (!isWithinTTL(insight.timestamp)) {
        logger.log(`[AI Cache] Insight for ${quickActionId} expired (TTL exceeded)`);
        return null;
      }
      return {
        quickActionId,
        ...insight,
      };
    }

    // Return the most recent insight (if within TTL)
    if (cache.lastInsight) {
      // OFFLINE-01 FIX: Check TTL before returning
      if (!isWithinTTL(cache.lastInsight.timestamp)) {
        logger.log('[AI Cache] Last insight expired (TTL exceeded)');
        return null;
      }
      return cache.lastInsight;
    }

    // Fallback: find the most recent insight by timestamp (within TTL)
    if (cache.insights) {
      const entries = Object.entries(cache.insights);
      if (entries.length > 0) {
        // OFFLINE-01 FIX: Filter to only valid (within TTL) insights
        const validEntries = entries.filter(([, value]) => isWithinTTL(value.timestamp));
        if (validEntries.length > 0) {
          const [key, value] = validEntries.sort((a, b) =>
            new Date(b[1].timestamp) - new Date(a[1].timestamp)
          )[0];
          return { quickActionId: key, ...value };
        }
      }
    }

    return null;
  } catch (error) {
    // Fail silently - never crash the app
    console.warn('[AI Cache] Failed to load insight:', error);
    return null;
  }
}

/**
 * Load all cached AI insights for an organization
 *
 * @param {string} orgId - Organization ID
 * @returns {Object} Object with all cached insights
 */
export function loadAllAIInsights(orgId) {
  if (!orgId) {
    return { insights: {}, lastInsight: null };
  }

  try {
    const cacheKey = getCacheKey(orgId);
    const existing = localStorage.getItem(cacheKey);

    if (!existing) {
      return { insights: {}, lastInsight: null };
    }

    return JSON.parse(existing);
  } catch (error) {
    console.warn('[AI Cache] Failed to load all insights:', error);
    return { insights: {}, lastInsight: null };
  }
}

/**
 * Clear all cached AI insights for an organization
 *
 * @param {string} orgId - Organization ID
 */
export function clearAIInsights(orgId) {
  if (!orgId) return;

  try {
    const cacheKey = getCacheKey(orgId);
    localStorage.removeItem(cacheKey);
    logger.log('[AI Cache] Cleared all insights');
  } catch (error) {
    console.warn('[AI Cache] Failed to clear insights:', error);
  }
}

/**
 * Extract a short summary from an AI response
 * Takes the first 1-2 sentences or truncates at ~200 chars
 *
 * @param {string} fullResponse - Full AI response text
 * @returns {string} Short summary
 */
export function extractSummary(fullResponse) {
  if (!fullResponse || typeof fullResponse !== 'string') {
    return '';
  }

  // Remove markdown formatting for cleaner summary
  const cleaned = fullResponse
    .replace(/#{1,6}\s/g, '') // Remove headers
    .replace(/\*\*/g, '') // Remove bold
    .replace(/\*/g, '') // Remove italic
    .replace(/`/g, '') // Remove code
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim();

  // Find first 1-2 sentences
  const sentenceEnd = /[.!?]\s/;
  let summary = '';
  let sentences = 0;
  let currentPos = 0;

  while (sentences < 2 && currentPos < cleaned.length) {
    const match = cleaned.slice(currentPos).match(sentenceEnd);
    if (match) {
      summary += cleaned.slice(currentPos, currentPos + match.index + 1);
      currentPos += match.index + match[0].length;
      sentences++;
    } else {
      // No more sentence endings found
      summary += cleaned.slice(currentPos);
      break;
    }
  }

  // Truncate if still too long
  if (summary.length > 250) {
    summary = summary.slice(0, 247) + '...';
  }

  return summary.trim();
}

export default {
  saveAIInsight,
  loadLastAIInsight,
  loadAllAIInsights,
  clearAIInsights,
  extractSummary,
};
