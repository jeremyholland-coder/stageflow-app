/**
 * PROVIDER HEALTH CACHE
 *
 * In-memory cache for AI provider configurations to reduce database reads.
 * Each AI call was hitting the ai_providers table; now we cache per-org with 60s TTL.
 *
 * WHY 60s TTL:
 * - Fast enough that provider changes (add/remove/update) reflect within a minute
 * - Slow enough to eliminate redundant DB reads during active AI sessions
 * - Matches typical user interaction patterns (multiple queries in quick succession)
 *
 * CACHE ISOLATION:
 * - Keyed by organization_id to prevent cross-org data leakage
 * - Each org has its own independent cache entry and TTL
 *
 * HOW TO INVALIDATE:
 * - Call invalidateProviderCache(orgId) after provider updates in save-ai-provider.mts
 * - Or wait for natural TTL expiration (60s)
 *
 * @author StageFlow Engineering
 * @date 2025-12-02
 */

import { createClient } from '@supabase/supabase-js';

// Cache TTL in milliseconds (60 seconds)
const CACHE_TTL_MS = 60 * 1000;

/**
 * P0 FIX 2025-12-04: Custom error for provider fetch failures
 * This allows callers to distinguish between "no providers" (empty array)
 * and "failed to fetch providers" (error thrown)
 */
export class ProviderFetchError extends Error {
  code: string;
  originalError?: any;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'ProviderFetchError';
    this.code = 'PROVIDER_FETCH_FAILED';
    this.originalError = originalError;
  }
}

// Maximum cache size to prevent memory leaks (100 orgs)
const MAX_CACHE_SIZE = 100;

// Cached provider structure
interface CachedProvider {
  id: string;
  organization_id: string;
  provider_type: string;
  model: string | null;
  display_name: string | null;
  api_key_encrypted: string;
  active: boolean;
  created_at: string;
  connection_order?: number;
}

// Cache entry with timestamp
interface CacheEntry {
  providers: CachedProvider[];
  timestamp: number;
}

// In-memory cache keyed by organization_id
const providerCache = new Map<string, CacheEntry>();

/**
 * Check if a cache entry is still valid
 */
function isCacheValid(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Get cached providers for an organization
 *
 * @param orgId - Organization ID
 * @returns Cached providers or null if cache miss/expired
 */
export function getCachedProviders(orgId: string): CachedProvider[] | null {
  const entry = providerCache.get(orgId);

  if (isCacheValid(entry)) {
    console.debug(`[provider-cache] Cache HIT for org ${orgId.slice(0, 8)}...`);
    return entry!.providers;
  }

  console.debug(`[provider-cache] Cache MISS for org ${orgId.slice(0, 8)}...`);
  return null;
}

/**
 * Set cached providers for an organization
 *
 * @param orgId - Organization ID
 * @param providers - List of active providers
 */
export function setCachedProviders(orgId: string, providers: CachedProvider[]): void {
  // Enforce max cache size to prevent memory leaks
  if (providerCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first key in Map maintains insertion order)
    const oldestKey = providerCache.keys().next().value;
    if (oldestKey) {
      providerCache.delete(oldestKey);
      console.debug(`[provider-cache] Evicted oldest entry for org ${oldestKey.slice(0, 8)}...`);
    }
  }

  providerCache.set(orgId, {
    providers,
    timestamp: Date.now()
  });

  console.debug(`[provider-cache] Cached ${providers.length} providers for org ${orgId.slice(0, 8)}...`);
}

/**
 * Invalidate cache for a specific organization
 * Call this after provider updates (add/remove/modify)
 *
 * @param orgId - Organization ID to invalidate
 */
export function invalidateProviderCache(orgId: string): void {
  if (providerCache.has(orgId)) {
    providerCache.delete(orgId);
    console.debug(`[provider-cache] Invalidated cache for org ${orgId.slice(0, 8)}...`);
  }
}

/**
 * Clear entire cache (useful for testing or emergency reset)
 */
export function clearProviderCache(): void {
  providerCache.clear();
  console.debug('[provider-cache] Cleared all cached entries');
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return {
    size: providerCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS
  };
}

/**
 * Fetch providers with caching
 *
 * This is the main entry point - use this instead of direct DB queries.
 * It checks cache first, falls back to DB, and updates cache on miss.
 *
 * @param supabase - Supabase client instance
 * @param orgId - Organization ID
 * @returns Array of active providers
 */
export async function getProvidersWithCache(
  supabase: ReturnType<typeof createClient>,
  orgId: string
): Promise<CachedProvider[]> {
  // Check cache first
  const cached = getCachedProviders(orgId);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - fetch from database
  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('organization_id', orgId)
    .eq('active', true)
    .order('created_at', { ascending: true }); // First connected = first in array

  if (error) {
    // P0 FIX 2025-12-04: THROW instead of returning []
    // This allows callers to distinguish "no providers" from "fetch failed"
    console.error('[provider-cache] Error fetching providers:', error);
    throw new ProviderFetchError(
      `Failed to fetch AI providers: ${error.message || 'Database error'}`,
      error
    );
  }

  const providers = data || [];

  // Update cache
  setCachedProviders(orgId, providers);

  return providers;
}

export default {
  getCachedProviders,
  setCachedProviders,
  invalidateProviderCache,
  clearProviderCache,
  getCacheStats,
  getProvidersWithCache,
  ProviderFetchError
};
