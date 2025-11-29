/**
 * Page Visibility API
 * Prevents unnecessary reloads and API calls when tab is not visible
 * This fixes the 5-second delay when switching between Mac workspaces
 *
 * CRITICAL FIX #14: Lazy initialization to prevent TDZ errors in production
 */

let isPageVisible = true; // Default to visible (safe assumption)
const visibilityListeners = new Set();
let initialized = false;

/**
 * Initialize page visibility tracking
 * MUST be called after DOM is ready to prevent TDZ errors
 */
function initPageVisibility() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;

  // Set initial state
  isPageVisible = !document.hidden;

  // Track page visibility state
  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;

    // Notify all listeners
    visibilityListeners.forEach(callback => {
      callback(isPageVisible);
    });
  });

  // Handle page freeze/resume (bfcache support)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      // Page was restored from bfcache (back-forward cache)
      isPageVisible = true;
      visibilityListeners.forEach(callback => callback(true));
    }
  });

  window.addEventListener('pagehide', () => {
    // Page is being hidden (do nothing, listeners will be notified by visibilitychange)
  });
}

export const pageVisibility = {
  /**
   * Initialize page visibility tracking (call once on app mount)
   */
  init: initPageVisibility,

  /**
   * Check if page is currently visible
   */
  isVisible: () => {
    initPageVisibility(); // Auto-initialize if not already done
    return isPageVisible;
  },

  /**
   * Add listener for visibility changes
   * @param {Function} callback - Called with (isVisible: boolean)
   * @returns {Function} Cleanup function to remove listener
   */
  addListener: (callback) => {
    initPageVisibility(); // Auto-initialize if not already done
    visibilityListeners.add(callback);
    return () => visibilityListeners.delete(callback);
  },

  /**
   * Run callback only when page is visible
   * Returns false if page is hidden (skip operation)
   */
  whenVisible: (callback) => {
    initPageVisibility(); // Auto-initialize if not already done
    if (isPageVisible) {
      callback();
      return true;
    }
    return false;
  }
};
