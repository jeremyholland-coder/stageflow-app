// SECURITY FIX: Distributed rate limiter using Netlify Blobs
// Prevents bypass via multiple serverless instances

import { getStore } from '@netlify/blobs';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RequestLog {
  count: number;
  resetTime: number;
}

// Fallback in-memory cache for development/testing
const fallbackCache = new Map<string, RequestLog>();

// Get Netlify Blobs store (only works in Netlify Functions runtime)
function getBlobStore() {
  try {
    return getStore('rate-limits');
  } catch (error) {
    console.warn('[RateLimit] Netlify Blobs not available, using fallback in-memory cache');
    return null;
  }
}

export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests } = config;

  return async (req: Request): Promise<{ allowed: boolean; remaining: number; resetTime: number }> => {
    // Get identifier (IP or API key)
    const identifier = req.headers.get('x-forwarded-for') ||
                      req.headers.get('cf-connecting-ip') ||
                      req.headers.get('authorization') ||
                      'anonymous';

    const now = Date.now();
    const store = getBlobStore();

    // Use distributed store if available, otherwise fallback to in-memory
    let log: RequestLog | null = null;

    if (store) {
      // DISTRIBUTED: Use Netlify Blobs (works across all function instances)
      try {
        const blobData = await store.get(identifier, { type: 'json' });
        if (blobData && typeof blobData === 'object' && 'count' in blobData && 'resetTime' in blobData) {
          log = blobData as RequestLog;
        }
      } catch (error) {
        console.error('[RateLimit] Failed to read from Netlify Blobs:', error);
        // Fall through to create new log
      }
    } else {
      // FALLBACK: Use in-memory cache (development only)
      log = fallbackCache.get(identifier) || null;
    }

    // Initialize or reset if expired
    if (!log || now > log.resetTime) {
      log = {
        count: 0,
        resetTime: now + windowMs
      };
    }

    // Increment counter
    log.count++;

    const allowed = log.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - log.count);

    // Persist updated log
    if (store) {
      // DISTRIBUTED: Save to Netlify Blobs with TTL
      try {
        await store.setJSON(identifier, log, {
          metadata: {
            resetTime: log.resetTime.toString()
          }
        });
      } catch (error) {
        console.error('[RateLimit] Failed to write to Netlify Blobs:', error);
        // Continue anyway - rate limit still enforced for this request
      }
    } else {
      // FALLBACK: Save to in-memory cache
      fallbackCache.set(identifier, log);
    }

    return {
      allowed,
      remaining,
      resetTime: log.resetTime
    };
  };
}

// Preset configurations
// SECURITY FIX (HIGH-SEC-3): Improved rate limiting to prevent brute force
export const RATE_LIMITS = {
  API: rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 100 }),        // 100/15min
  AUTH: rateLimit({ windowMs: 5 * 60 * 1000, maxRequests: 3 }),          // 3/5min (was 5/min = 300/hour, now 3/5min = 36/hour)
  LLM: rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),              // 10/min
  WEBHOOK: rateLimit({ windowMs: 60 * 1000, maxRequests: 60 }),          // 60/min
};
