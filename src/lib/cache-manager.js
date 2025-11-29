/**
 * Cache Manager - Handles localStorage cache versioning
 * Automatically clears stale caches when app version changes
 *
 * Version is fetched from /version.json (generated at build time from package.json)
 */
import { logger } from './logger';

const VERSION_KEY = 'stageflow_version';

export const initializeCache = async () => {
  try {
    // Fetch current version from build artifact (generated from package.json)
    let APP_VERSION = '1.7.2'; // Fallback
    try {
      const response = await fetch('/version.json');
      const versionData = await response.json();
      APP_VERSION = versionData.version;
    } catch (fetchError) {
      console.warn('[Cache] Could not fetch version.json, using fallback');
    }

    const storedVersion = localStorage.getItem(VERSION_KEY);

    if (storedVersion !== APP_VERSION) {
      logger.log('[Cache] Version mismatch, clearing cache...', {
        stored: storedVersion,
        current: APP_VERSION
      });

      // Clear all caches except auth tokens
      const keysToPreserve = [
        'sb-wogloqkryhasahoiajvt-auth-token',
        'supabase.auth.token'
      ];

      Object.keys(localStorage).forEach(key => {
        if (!keysToPreserve.some(preserve => key.includes(preserve))) {
          localStorage.removeItem(key);
        }
      });

      // Set new version
      localStorage.setItem(VERSION_KEY, APP_VERSION);
      logger.log('[Cache] Cache cleared, version updated to', APP_VERSION);

      return true; // Cache was cleared
    }

    return false; // Cache is current
  } catch (error) {
    console.error('[Cache] Error managing cache:', error);
    return false;
  }
};

export const clearAllCaches = () => {
  try {
    localStorage.clear();
    sessionStorage.clear();
    logger.log('[Cache] All caches cleared manually');

    // DO NOT RELOAD - causes flash and confusion
    // window.location.reload();
  } catch (error) {
    console.error('[Cache] Error clearing caches:', error);
  }
};

export const getCacheVersion = () => {
  return localStorage.getItem(VERSION_KEY) || 'unknown';
};
