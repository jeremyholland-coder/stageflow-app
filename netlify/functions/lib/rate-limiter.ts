/**
 * Rate Limiter for Netlify Functions
 * Area 2 - Rate Limiting & Abuse Protection
 *
 * Two rate limiting approaches:
 * 1. IP-based (legacy): Uses Netlify Blobs for anonymous/IP rate limiting
 * 2. User+Org based (new): Uses Supabase rate_limits table for authenticated users
 *
 * Features:
 * - Multiple time windows (minute, hour, day)
 * - Per-user and per-org tracking
 * - Correlation ID integration for observability
 * - Fail-open on errors (don't break user experience)
 */

import { getStore } from '@netlify/blobs';
import type { Context } from "@netlify/functions";
import { getSupabaseClient } from './supabase-pool';
import { requireAuth } from './auth-middleware';
import { ERROR_CODES } from './with-error-boundary';
import {
  RateLimitBucket,
  getRateLimitMessage,
  getRetryAfterSeconds,
} from './rate-limit-config';
import {
  extractCorrelationId,
  trackTelemetryEvent,
} from './telemetry';

// ============================================================================
// TYPES
// ============================================================================

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RequestLog {
  count: number;
  resetTime: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  bucket: string;
  limit: number;
  windowSeconds: number;
  retryAfterSeconds?: number;
}

export interface RateLimitOptions {
  /** Rate limit buckets to check */
  buckets: RateLimitBucket[];
  /** Buckets that should use org-wide counting (default: per user+org) */
  orgWideBuckets?: string[];
}

// ============================================================================
// LEGACY IP-BASED RATE LIMITING (Netlify Blobs)
// ============================================================================

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

// Preset configurations (legacy IP-based)
// SECURITY FIX (HIGH-SEC-3): Improved rate limiting to prevent brute force
export const RATE_LIMITS = {
  API: rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 100 }),        // 100/15min
  AUTH: rateLimit({ windowMs: 5 * 60 * 1000, maxRequests: 3 }),          // 3/5min (was 5/min = 300/hour, now 3/5min = 36/hour)
  LLM: rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),              // 10/min
  WEBHOOK: rateLimit({ windowMs: 60 * 1000, maxRequests: 60 }),          // 60/min
};

// ============================================================================
// NEW USER+ORG BASED RATE LIMITING (Supabase)
// ============================================================================

/**
 * Calculate the window start time for a given window size
 * Floors current time to the nearest window boundary
 */
export function getCurrentWindowStart(windowSeconds: number): Date {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return new Date(windowStart);
}

/**
 * Increment counter and check if rate limit is exceeded
 * Uses Supabase for distributed state across function instances
 */
export async function incrementAndCheckRateLimit(
  userId: string,
  organizationId: string,
  bucket: RateLimitBucket,
  isOrgWide: boolean = false
): Promise<RateLimitResult> {
  const supabase = getSupabaseClient();
  const windowStart = getCurrentWindowStart(bucket.windowSeconds);

  // For org-wide buckets, use a placeholder user ID to count org-wide
  const effectiveUserId = isOrgWide ? '00000000-0000-0000-0000-000000000000' : userId;

  try {
    // First, try to get existing record
    const { data: existing } = await supabase
      .from('rate_limits')
      .select('count')
      .eq('user_id', effectiveUserId)
      .eq('organization_id', organizationId)
      .eq('bucket', bucket.bucket)
      .eq('window_start', windowStart.toISOString())
      .eq('window_seconds', bucket.windowSeconds)
      .single();

    let newCount: number;

    if (existing) {
      // Update existing record
      newCount = existing.count + 1;
      await supabase
        .from('rate_limits')
        .update({ count: newCount, updated_at: new Date().toISOString() })
        .eq('user_id', effectiveUserId)
        .eq('organization_id', organizationId)
        .eq('bucket', bucket.bucket)
        .eq('window_start', windowStart.toISOString())
        .eq('window_seconds', bucket.windowSeconds);
    } else {
      // Insert new record
      newCount = 1;
      const { error } = await supabase
        .from('rate_limits')
        .insert({
          user_id: effectiveUserId,
          organization_id: organizationId,
          bucket: bucket.bucket,
          window_start: windowStart.toISOString(),
          window_seconds: bucket.windowSeconds,
          count: 1,
        });

      // If conflict (race condition), try increment again
      if (error?.code === '23505') {
        return incrementAndCheckRateLimit(userId, organizationId, bucket, isOrgWide);
      }
    }

    const allowed = newCount <= bucket.limit;

    return {
      allowed,
      remaining: Math.max(0, bucket.limit - newCount),
      bucket: bucket.bucket,
      limit: bucket.limit,
      windowSeconds: bucket.windowSeconds,
      retryAfterSeconds: allowed ? undefined : getRetryAfterSeconds(bucket),
    };
  } catch (error) {
    console.error('[RateLimit] Exception in incrementAndCheckRateLimit:', error);
    // Fail-open: allow request on error
    return {
      allowed: true,
      remaining: bucket.limit,
      bucket: bucket.bucket,
      limit: bucket.limit,
      windowSeconds: bucket.windowSeconds,
    };
  }
}

/**
 * Check multiple rate limit buckets
 * Returns the first exceeded bucket, or null if all pass
 */
export async function checkRateLimits(
  userId: string,
  organizationId: string,
  buckets: RateLimitBucket[],
  orgWideBuckets: string[] = []
): Promise<{ allowed: boolean; exceededBucket?: RateLimitResult }> {
  for (const bucket of buckets) {
    const isOrgWide = orgWideBuckets.includes(bucket.bucket);
    const result = await incrementAndCheckRateLimit(
      userId,
      organizationId,
      bucket,
      isOrgWide
    );

    if (!result.allowed) {
      return { allowed: false, exceededBucket: result };
    }
  }

  return { allowed: true };
}

// ============================================================================
// RATE LIMIT WRAPPER (withRateLimit)
// ============================================================================

/**
 * Handler function type (matches Netlify function signature)
 */
type HandlerFunction = (
  request: Request,
  context: Context
) => Promise<Response>;

/**
 * Get CORS headers
 */
function getCorsHeaders(request: Request): Record<string, string> {
  const ALLOWED_ORIGINS = [
    'https://stageflow.startupstage.com',
    'https://stageflow-rev-ops.netlify.app',
    'http://localhost:5173',
    'http://localhost:8888',
  ];

  const origin = request.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Create rate limit error response
 */
function createRateLimitResponse(
  result: RateLimitResult,
  bucket: RateLimitBucket,
  correlationId: string,
  corsHeaders: Record<string, string>
): Response {
  const message = getRateLimitMessage(bucket);
  const retryAfter = result.retryAfterSeconds || getRetryAfterSeconds(bucket);

  return new Response(JSON.stringify({
    ok: false,
    success: false,
    code: ERROR_CODES.RATE_LIMITED,
    errorCode: 'RATE_LIMITED',
    message,
    retryable: true,
    retryAfterSeconds: retryAfter,
    rateLimit: {
      bucket: result.bucket,
      limit: result.limit,
      remaining: result.remaining,
      windowSeconds: result.windowSeconds,
    },
  }), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
      'Retry-After': String(retryAfter),
    },
  });
}

/**
 * Rate limiting middleware wrapper for Netlify Functions
 *
 * Usage:
 * ```typescript
 * import { withRateLimit } from './lib/rate-limiter';
 * import { RATE_LIMIT_GROUPS } from './lib/rate-limit-config';
 *
 * export default withRateLimit(
 *   async (request, context) => {
 *     // Your handler logic
 *   },
 *   { buckets: RATE_LIMIT_GROUPS.aiGeneric }
 * );
 * ```
 */
export function withRateLimit(
  handler: HandlerFunction,
  options: RateLimitOptions
): HandlerFunction {
  const { buckets, orgWideBuckets = [] } = options;

  return async (request: Request, context: Context): Promise<Response> => {
    const correlationId = extractCorrelationId(request);
    const corsHeaders = getCorsHeaders(request);

    // Skip rate limiting for OPTIONS (preflight)
    if (request.method === 'OPTIONS') {
      return handler(request, context);
    }

    try {
      // Get authenticated user
      const user = await requireAuth(request);
      const userId = user.id;

      // Get organization from team_members
      const supabase = getSupabaseClient();
      const { data: membership } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', userId)
        .single();

      if (!membership?.organization_id) {
        console.error('[RateLimit] No organization found for user:', userId);
        // Allow request if we can't determine org (don't block due to data issues)
        return handler(request, context);
      }

      const organizationId = membership.organization_id;

      // Check all rate limits
      const { allowed, exceededBucket } = await checkRateLimits(
        userId,
        organizationId,
        buckets,
        orgWideBuckets
      );

      if (!allowed && exceededBucket) {
        // Log rate limit hit
        console.warn('[RateLimit] Blocked request', {
          bucket: exceededBucket.bucket,
          userId,
          organizationId,
          correlationId,
          limit: exceededBucket.limit,
          remaining: exceededBucket.remaining,
        });

        // Track telemetry event
        trackTelemetryEvent('rate_limit_exceeded', correlationId, {
          bucket: exceededBucket.bucket,
          limit: exceededBucket.limit,
        });

        // Find the bucket config for the message
        const bucketConfig = buckets.find(b => b.bucket === exceededBucket.bucket);

        return createRateLimitResponse(
          exceededBucket,
          bucketConfig || buckets[0],
          correlationId,
          corsHeaders
        );
      }

      // Rate limit passed, execute handler
      return handler(request, context);

    } catch (error: any) {
      // Auth errors should pass through (let the handler deal with them)
      if (error.statusCode === 401 || error.code === 'UNAUTHORIZED') {
        return handler(request, context);
      }

      console.error('[RateLimit] Error in rate limit check:', {
        correlationId,
        error: error.message,
      });

      // Fail-open: allow request on unexpected errors
      return handler(request, context);
    }
  };
}

// ============================================================================
// CLEANUP UTILITY
// ============================================================================

/**
 * Clean up old rate limit entries (call periodically via scheduled function)
 * Removes entries older than 7 days to prevent table bloat
 */
export async function cleanupOldRateLimits(): Promise<{ deleted: number }> {
  const supabase = getSupabaseClient();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);

  const { data, error } = await supabase
    .from('rate_limits')
    .delete()
    .lt('window_start', cutoffDate.toISOString())
    .select('id');

  if (error) {
    console.error('[RateLimit] Cleanup error:', error);
    return { deleted: 0 };
  }

  const deleted = data?.length || 0;
  console.log(`[RateLimit] Cleaned up ${deleted} old entries`);
  return { deleted };
}

export default withRateLimit;
