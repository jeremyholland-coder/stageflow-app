/**
 * Global Timer Manager
 *
 * CRITICAL FIX: Prevents memory leaks from global setInterval/setTimeout calls
 *
 * Problem: Module-level timers (memory-cache.js, indexeddb-cache.js) run forever
 * with no cleanup mechanism, causing memory accumulation over time.
 *
 * Solution: Centralized timer registry with lifecycle management
 * - Track all timers with unique IDs
 * - Provide cleanup method for app teardown
 * - Support conditional timers (DEV only, etc.)
 *
 * Usage:
 * ```
 * import { timerManager } from './timerManager';
 *
 * // Instead of: setInterval(() => {...}, 5000)
 * timerManager.setInterval('cache-cleanup', () => {...}, 5000);
 *
 * // Cleanup all timers on app unmount
 * timerManager.cleanup();
 * ```
 */

import { logger } from './logger';

class TimerManager {
  constructor() {
    this.timers = new Map();
    this.timeouts = new Map();
  }

  /**
   * Register and start an interval timer
   * @param {string} id - Unique identifier for this timer
   * @param {Function} callback - Function to execute on each interval
   * @param {number} delay - Delay in milliseconds
   * @param {Object} options - Optional configuration
   * @param {boolean} options.devOnly - Only run in development mode
   * @returns {number} Timer ID (or null if skipped due to devOnly)
   */
  setInterval(id, callback, delay, options = {}) {
    // Skip if devOnly and not in development
    if (options.devOnly && !import.meta.env.DEV) {
      logger.debug(`[TimerManager] Skipping DEV-only timer: ${id}`);
      return null;
    }

    // Clear existing timer with same ID
    if (this.timers.has(id)) {
      logger.warn(`[TimerManager] Replacing existing timer: ${id}`);
      this.clearInterval(id);
    }

    // Start new timer
    const timerId = setInterval(callback, delay);
    this.timers.set(id, {
      id: timerId,
      type: 'interval',
      callback,
      delay,
      createdAt: Date.now()
    });

    logger.debug(`[TimerManager] Started interval timer: ${id} (every ${delay}ms)`);
    return timerId;
  }

  /**
   * Register and start a timeout timer
   * @param {string} id - Unique identifier for this timer
   * @param {Function} callback - Function to execute after delay
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timer ID
   */
  setTimeout(id, callback, delay) {
    // Clear existing timeout with same ID
    if (this.timeouts.has(id)) {
      logger.warn(`[TimerManager] Replacing existing timeout: ${id}`);
      this.clearTimeout(id);
    }

    // Start new timeout
    const timerId = setTimeout(() => {
      callback();
      // Auto-remove after execution
      this.timeouts.delete(id);
    }, delay);

    this.timeouts.set(id, {
      id: timerId,
      type: 'timeout',
      callback,
      delay,
      createdAt: Date.now()
    });

    logger.debug(`[TimerManager] Started timeout timer: ${id} (in ${delay}ms)`);
    return timerId;
  }

  /**
   * Clear a specific interval timer
   * @param {string} id - Timer identifier
   * @returns {boolean} True if timer was found and cleared
   */
  clearInterval(id) {
    const timer = this.timers.get(id);
    if (!timer) {
      return false;
    }

    clearInterval(timer.id);
    this.timers.delete(id);
    logger.debug(`[TimerManager] Cleared interval timer: ${id}`);
    return true;
  }

  /**
   * Clear a specific timeout timer
   * @param {string} id - Timer identifier
   * @returns {boolean} True if timer was found and cleared
   */
  clearTimeout(id) {
    const timer = this.timeouts.get(id);
    if (!timer) {
      return false;
    }

    clearTimeout(timer.id);
    this.timeouts.delete(id);
    logger.debug(`[TimerManager] Cleared timeout timer: ${id}`);
    return true;
  }

  /**
   * Clear all timers (intervals and timeouts)
   * Call this on app unmount or cleanup
   */
  cleanup() {
    let count = 0;

    // Clear all intervals
    for (const [id, timer] of this.timers) {
      clearInterval(timer.id);
      count++;
    }
    this.timers.clear();

    // Clear all timeouts
    for (const [id, timer] of this.timeouts) {
      clearTimeout(timer.id);
      count++;
    }
    this.timeouts.clear();

    if (count > 0) {
      logger.info(`[TimerManager] Cleaned up ${count} timer(s)`);
    }
  }

  /**
   * Get statistics about active timers
   * @returns {Object} Timer statistics
   */
  getStats() {
    return {
      activeIntervals: this.timers.size,
      activeTimeouts: this.timeouts.size,
      total: this.timers.size + this.timeouts.size,
      intervals: Array.from(this.timers.keys()),
      timeouts: Array.from(this.timeouts.keys())
    };
  }

  /**
   * Log current timer status (for debugging)
   */
  logStatus() {
    const stats = this.getStats();
    logger.info('[TimerManager] Status:', stats);

    if (stats.activeIntervals > 0) {
      logger.info('[TimerManager] Active intervals:', stats.intervals);
    }
    if (stats.activeTimeouts > 0) {
      logger.info('[TimerManager] Active timeouts:', stats.timeouts);
    }
  }
}

// Export singleton instance
export const timerManager = new TimerManager();

// CRITICAL FIX #14: Lazy initialization to prevent TDZ errors in production
let cleanupListenerInitialized = false;

/**
 * Initialize cleanup listener for page unload
 * MUST be called from App.jsx after modules load to prevent TDZ errors
 */
export function initTimerManager() {
  if (cleanupListenerInitialized || typeof window === 'undefined') return;
  cleanupListenerInitialized = true;

  // Cleanup on page unload (safety net)
  window.addEventListener('beforeunload', () => {
    timerManager.cleanup();
  });

  logger.debug('[TimerManager] Initialized cleanup listener');
}

export default timerManager;
