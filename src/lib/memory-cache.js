/**
 * OPT-4: In-Memory Cache Layer
 *
 * Bridges gap between component renders and IndexedDB
 * IndexedDB is slow (50-100ms) for frequent reads
 * Memory cache gives <1ms for repeated access
 *
 * Use cases:
 * - Deal lists rendered multiple times (Dashboard, Kanban, modals)
 * - Organization data accessed by multiple components
 * - Pipeline stages used across views
 *
 * PERFORMANCE IMPACT:
 * - IndexedDB read: 50-100ms
 * - Memory cache read: <1ms (50-100x faster)
 * - Reduces main thread blocking on re-renders
 */

import { logger } from './logger';
import { timerManager } from './timerManager';

class MemoryCache {
  constructor(ttl = 5 * 60 * 1000, name = 'MemoryCache') {
    this.cache = new Map();
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
    this.name = name;

    // CRITICAL FIX #14: Timer setup moved to initMemoryCaches()
    // Cannot call timerManager.setInterval() in constructor because
    // it causes Temporal Dead Zone errors in production builds
  }

  /**
   * Set a value in cache with optional custom TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} customTtl - Optional custom TTL in milliseconds
   */
  set(key, value, customTtl = null) {
    const ttl = customTtl || this.ttl;
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and is fresh
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Clear entire cache
   */
  clear() {
    const count = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.log(`[MemCache] Cleared ${count} entries`);
  }

  /**
   * Invalidate entries matching a pattern
   * @param {RegExp|string} pattern - Pattern to match keys against
   */
  invalidate(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.log(`[MemCache] Invalidated ${count} entries matching ${pattern}`);
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate.toFixed(1) + '%'
    };
  }

  /**
   * Remove expired entries (automatic cleanup)
   * Called periodically to prevent memory bloat
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.log(`[MemCache] Cleaned up ${removed} expired entries`);
    }

    return removed;
  }
}

// Singleton instances for different data types
export const dealsMemoryCache = new MemoryCache(5 * 60 * 1000, 'deals'); // 5 min TTL
export const organizationMemoryCache = new MemoryCache(10 * 60 * 1000, 'organization'); // 10 min TTL
export const pipelineMemoryCache = new MemoryCache(10 * 60 * 1000, 'pipeline'); // 10 min TTL
export const userMemoryCache = new MemoryCache(15 * 60 * 1000, 'user'); // 15 min TTL

// CRITICAL FIX #14: Lazy initialization to prevent TDZ errors in production
// Store listener reference for cleanup
let storageListener = null;
let initialized = false;

/**
 * Initialize memory caches with timers and event listeners
 * MUST be called from App.jsx after all modules are loaded
 * This prevents Temporal Dead Zone errors in production builds
 */
export function initMemoryCaches() {
  if (initialized) return;
  initialized = true;

  // PERFORMANCE FIX: Set up stats logging for each cache (dev only)
  // This was moved from the constructor to prevent TDZ errors
  [
    { cache: dealsMemoryCache, name: 'deals' },
    { cache: organizationMemoryCache, name: 'organization' },
    { cache: pipelineMemoryCache, name: 'pipeline' },
    { cache: userMemoryCache, name: 'user' }
  ].forEach(({ cache, name }) => {
    timerManager.setInterval(
      `memcache-stats-${name}`,
      () => {
        const total = cache.hits + cache.misses;
        if (total > 0) {
          const hitRate = ((cache.hits / total) * 100).toFixed(1);
          logger.log(`[MemCache:${name}] Stats - Hit rate: ${hitRate}% (${cache.hits} hits, ${cache.misses} misses, ${cache.cache.size} entries)`);
        }
      },
      5 * 60 * 1000,
      { devOnly: true }
    );
  });

  // PERFORMANCE FIX: Use TimerManager for proper cleanup
  // Automatic cleanup every 2 minutes
  timerManager.setInterval('memcache-cleanup-all', () => {
    dealsMemoryCache.cleanup();
    organizationMemoryCache.cleanup();
    pipelineMemoryCache.cleanup();
    userMemoryCache.cleanup();
  }, 2 * 60 * 1000);

  // PERFORMANCE FIX: Clear all caches when user logs out (listen for storage event)
  if (typeof window !== 'undefined') {
    storageListener = (e) => {
      if (e.key === 'stageflow_session' && !e.newValue) {
        // Session cleared - user logged out
        dealsMemoryCache.clear();
        organizationMemoryCache.clear();
        pipelineMemoryCache.clear();
        userMemoryCache.clear();
      }
    };
    window.addEventListener('storage', storageListener);
  }

  logger.info('[MemoryCache] Initialized with timers and event listeners');
}

/**
 * Cleanup all memory caches and event listeners
 * Call this on app unmount to prevent memory leaks
 */
export function cleanupMemoryCaches() {
  dealsMemoryCache.clear();
  organizationMemoryCache.clear();
  pipelineMemoryCache.clear();
  userMemoryCache.clear();

  // Remove storage event listener
  if (typeof window !== 'undefined' && storageListener) {
    window.removeEventListener('storage', storageListener);
    storageListener = null;
  }

  logger.info('[MemoryCache] Global cleanup complete');
}

export default MemoryCache;
