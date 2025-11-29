/**
 * SECURITY UTILITY: Cleanup expired rate limit entries from Netlify Blobs
 *
 * Can be triggered:
 * 1. Manually: POST to /.netlify/functions/cleanup-rate-limits
 * 2. Scheduled: Via Netlify's scheduled functions (add to netlify.toml)
 *
 * Removes entries where resetTime < now to prevent blob storage bloat
 */

import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 7: Add authentication to admin cleanup function
  if (shouldUseNewAuth('cleanup-rate-limits')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      // Note: Scheduled functions bypass this check (no auth headers)
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        await requireAuth(req);
      }
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  }
  // LEGACY AUTH PATH: No authentication (allows both manual and scheduled execution)

  try {
    // Get the rate-limits blob store
    const store = getStore('rate-limits');
    const now = Date.now();

    // List all entries
    const { blobs } = await store.list();

    let deletedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    console.log(`[RateLimitCleanup] Starting cleanup of ${blobs.length} entries...`);

    // Check each entry
    for (const blob of blobs) {
      try {
        // Get the entry metadata
        const data = await store.get(blob.key, { type: 'json' });

        if (data && typeof data === 'object' && 'resetTime' in data) {
          const resetTime = (data as { resetTime: number }).resetTime;

          // Delete if expired
          if (now > resetTime) {
            await store.delete(blob.key);
            deletedCount++;
          } else {
            skippedCount++;
          }
        } else {
          // Invalid format, delete it
          await store.delete(blob.key);
          deletedCount++;
        }
      } catch (error) {
        console.error(`[RateLimitCleanup] Error processing ${blob.key}:`, error);
        errorCount++;
      }
    }

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        total: blobs.length,
        deleted: deletedCount,
        active: skippedCount,
        errors: errorCount
      }
    };

    console.log('[RateLimitCleanup] Cleanup complete:', result.stats);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('[RateLimitCleanup] Fatal error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Cleanup failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers }
    );
  }
};

// Note: Scheduled functions cannot specify custom path
// This function runs on schedule defined in netlify.toml
// Can also be manually triggered via: /.netlify/functions/cleanup-rate-limits
