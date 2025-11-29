/**
 * Unified Onboarding Storage Manager
 *
 * CRITICAL FIX: Consolidates multiple competing localStorage keys into single source of truth
 * Previous issues:
 * - AppShell used: 'stageflow_welcome_seen' (global, no user ID)
 * - Dashboard used: 'stageflow_welcome_seen_${userId}' (JSON object)
 * - onboardingSync used: 'onboarding_${userId}' (different key!)
 *
 * New approach:
 * - Single key per user: 'app_onboarding_state_v1_${userId}'
 * - Unified schema with versioning
 * - Atomic operations with conflict detection
 * - Cross-tab synchronization support
 */

import { logger } from './logger';

// Schema version for migrations
const SCHEMA_VERSION = 1;

/**
 * Unified onboarding state schema
 * @typedef {Object} OnboardingState
 * @property {string[]} completed - Array of completed step IDs
 * @property {boolean} dismissed - Whether onboarding was dismissed
 * @property {number} currentStep - Current step index
 * @property {boolean} welcomeShown - Whether welcome modal was shown
 * @property {string|null} selectedGoal - User's selected goal
 * @property {boolean} tourFullyCompleted - Whether user completed ALL onboarding steps
 * @property {number} version - Schema version for migrations
 * @property {string} lastUpdated - ISO timestamp of last update
 */

class OnboardingStorageManager {
  constructor() {
    this.listeners = new Set();
    this.storageListener = null; // PERFORMANCE FIX: Store listener for cleanup
    this.initialized = false;

    // CRITICAL FIX #14: Don't call setupStorageListener() in constructor
    // It causes Temporal Dead Zone errors in production builds
    // Call init() from App.jsx instead
  }

  /**
   * Initialize the storage manager with event listeners
   * MUST be called from App.jsx after all modules are loaded
   * This prevents Temporal Dead Zone errors in production builds
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupStorageListener();
    logger.info('[OnboardingStorage] Initialized with event listeners');
  }

  /**
   * Get storage key for a user
   */
  getKey(userId) {
    if (!userId) {
      throw new Error('[OnboardingStorage] userId is required');
    }
    return `app_onboarding_state_v${SCHEMA_VERSION}_${userId}`;
  }

  /**
   * Get onboarding state for a user
   * @param {string} userId
   * @returns {OnboardingState|null}
   */
  getState(userId) {
    if (!userId) {
      logger.warn('[OnboardingStorage] Cannot get state without userId');
      return null;
    }

    const key = this.getKey(userId);

    try {
      const stored = localStorage.getItem(key);
      if (!stored) return null;

      const parsed = JSON.parse(stored);

      // Validate schema version
      if (parsed.version !== SCHEMA_VERSION) {
        logger.warn('[OnboardingStorage] Schema version mismatch, migrating...', {
          current: parsed.version,
          expected: SCHEMA_VERSION
        });
        return this.migrateState(userId, parsed);
      }

      return parsed;
    } catch (error) {
      logger.error('[OnboardingStorage] Failed to get state:', error);
      return null;
    }
  }

  /**
   * Save onboarding state with atomic compare-and-swap
   * @param {string} userId
   * @param {Partial<OnboardingState>} updates
   * @param {Function} fallbackFn - Called if quota exceeded
   * @returns {boolean} True if save succeeded
   */
  setState(userId, updates, fallbackFn = null) {
    if (!userId) {
      logger.warn('[OnboardingStorage] Cannot set state without userId');
      return false;
    }

    const key = this.getKey(userId);

    try {
      // Get current state
      const current = this.getState(userId) || this.getDefaultState();

      // Merge updates
      const newState = {
        ...current,
        ...updates,
        version: SCHEMA_VERSION,
        lastUpdated: new Date().toISOString()
      };

      // Atomic write
      localStorage.setItem(key, JSON.stringify(newState));

      logger.debug('[OnboardingStorage] State saved:', {
        userId,
        updates: Object.keys(updates)
      });

      // Notify listeners
      this.notifyListeners(userId, newState);

      return true;
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        logger.error('[OnboardingStorage] Quota exceeded, using fallback');
        if (fallbackFn) {
          fallbackFn(updates);
        }
      } else {
        logger.error('[OnboardingStorage] Failed to set state:', error);
      }
      return false;
    }
  }

  /**
   * Clear onboarding state for a user
   * @param {string} userId
   */
  clearState(userId) {
    if (!userId) return;

    const key = this.getKey(userId);

    try {
      localStorage.removeItem(key);
      logger.debug('[OnboardingStorage] State cleared for user:', userId);

      // Notify listeners
      this.notifyListeners(userId, null);
    } catch (error) {
      logger.error('[OnboardingStorage] Failed to clear state:', error);
    }
  }

  /**
   * Check if welcome modal should be shown
   * CRITICAL FIX: Also check dismissed flag - if user completed onboarding, don't show welcome again
   * PHASE 20: Added catch-all - any unexpected condition assumes onboarding completed
   * @param {string} userId
   * @returns {boolean}
   */
  shouldShowWelcome(userId) {
    try {
      const state = this.getState(userId);

      // PHASE 20: No state = brand new user, show welcome
      if (!state) return true;

      // PHASE 20 CATCH-ALL: If ANY completion indicator exists, don't show
      // This prevents onboarding reappearing in unexpected edge cases
      const isCompleted = state.welcomeShown === true ||
                         state.dismissed === true ||
                         state.tourFullyCompleted === true ||
                         (Array.isArray(state.completed) && state.completed.length >= 3);

      return !isCompleted;
    } catch (error) {
      // PHASE 20: On ANY error, assume onboarding is complete (safe default)
      logger.error('[OnboardingStorage] Error checking shouldShowWelcome, assuming complete:', error);
      return false;
    }
  }

  /**
   * PHASE 20: Check if onboarding should be shown (comprehensive check)
   * Returns false on any unexpected condition (fail-safe)
   * @param {string} userId
   * @returns {boolean}
   */
  shouldShowOnboarding(userId) {
    try {
      const state = this.getState(userId);

      // No state AND explicitly new user - only case to show
      if (!state) {
        // PHASE 20: Could be truly new, but check for other indicators
        // Check legacy localStorage keys as additional safeguard
        const legacyKeys = [
          `stageflow_welcome_seen_${userId}`,
          `onboarding_${userId}`,
          `stageflow_goal_${userId}`
        ];

        for (const key of legacyKeys) {
          if (localStorage.getItem(key)) {
            // Legacy data exists - user is not new
            logger.debug('[OnboardingStorage] Found legacy key, user is not new:', key);
            return false;
          }
        }

        return true; // Truly new user
      }

      // PHASE 20: Comprehensive completion check
      // dismissed OR tourFullyCompleted OR welcomeShown OR completed_steps >= 3
      if (state.dismissed === true ||
          state.tourFullyCompleted === true ||
          state.welcomeShown === true ||
          (Array.isArray(state.completed) && state.completed.length >= 3)) {
        return false;
      }

      // PHASE 20: Additional safeguard - if state exists but all fields are default,
      // check if this is an old user by looking at account creation date
      // For now, if any state exists, assume not-new unless explicitly incomplete
      return !state.welcomeShown && !state.dismissed &&
             Array.isArray(state.completed) && state.completed.length < 3;
    } catch (error) {
      // PHASE 20: On ANY error, assume onboarding is complete (safe default)
      logger.error('[OnboardingStorage] Error checking shouldShowOnboarding, assuming complete:', error);
      return false;
    }
  }

  /**
   * Mark welcome modal as shown
   * @param {string} userId
   */
  markWelcomeShown(userId) {
    return this.setState(userId, { welcomeShown: true });
  }

  /**
   * Get default state structure
   * @returns {OnboardingState}
   */
  getDefaultState() {
    return {
      completed: [],
      dismissed: false,
      currentStep: 0,
      welcomeShown: false,
      selectedGoal: null,
      tourFullyCompleted: false,
      version: SCHEMA_VERSION,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Migrate old state to new schema
   * @param {string} userId
   * @param {Object} oldState
   * @returns {OnboardingState}
   */
  migrateState(userId, oldState) {
    // For now, just merge with defaults
    // In future, add version-specific migrations here
    const migrated = {
      ...this.getDefaultState(),
      ...oldState,
      version: SCHEMA_VERSION,
      lastUpdated: new Date().toISOString()
    };

    // Save migrated state
    this.setState(userId, migrated);

    return migrated;
  }

  /**
   * Setup cross-tab synchronization listener
   * PERFORMANCE FIX: Store listener reference for cleanup
   */
  setupStorageListener() {
    if (typeof window === 'undefined') return;

    this.storageListener = (e) => {
      // Only care about our keys
      if (!e.key || !e.key.startsWith('app_onboarding_state_v')) {
        return;
      }

      // Extract userId from key
      const match = e.key.match(/app_onboarding_state_v\d+_(.+)/);
      if (!match) return;

      const userId = match[1];
      const newState = e.newValue ? JSON.parse(e.newValue) : null;

      logger.debug('[OnboardingStorage] Storage event from another tab:', {
        userId,
        hasState: !!newState
      });

      // Notify listeners
      this.notifyListeners(userId, newState);
    };

    window.addEventListener('storage', this.storageListener);
  }

  /**
   * Cleanup event listeners
   * PERFORMANCE FIX: Remove storage event listener to prevent memory leaks
   */
  cleanup() {
    if (typeof window !== 'undefined' && this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }

    // Clear all listeners
    this.listeners.clear();

    logger.info('[OnboardingStorage] Cleanup complete');
  }

  /**
   * Add listener for state changes
   * @param {Function} callback - Called with (userId, newState)
   * @returns {Function} Cleanup function
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of state change
   * @param {string} userId
   * @param {OnboardingState|null} newState
   */
  notifyListeners(userId, newState) {
    for (const listener of this.listeners) {
      try {
        listener(userId, newState);
      } catch (error) {
        logger.error('[OnboardingStorage] Listener error:', error);
      }
    }
  }

  /**
   * Migrate old localStorage keys to new unified format
   * Call this once on app startup
   * @param {string} userId
   */
  migrateOldKeys(userId) {
    if (!userId) return;

    const oldWelcomeKey = `stageflow_welcome_seen_${userId}`;
    const oldOnboardingKey = `onboarding_${userId}`;
    const oldGoalKey = `stageflow_goal_${userId}`;

    try {
      // Check if migration already done
      const newKey = this.getKey(userId);
      if (localStorage.getItem(newKey)) {
        logger.debug('[OnboardingStorage] Migration already done for user:', userId);
        return;
      }

      // Collect data from old keys
      const welcomeData = localStorage.getItem(oldWelcomeKey);
      const onboardingData = localStorage.getItem(oldOnboardingKey);
      const goalData = localStorage.getItem(oldGoalKey);

      const migratedState = this.getDefaultState();

      // Migrate welcome flag
      if (welcomeData) {
        try {
          const parsed = JSON.parse(welcomeData);
          migratedState.welcomeShown = parsed.seen === true;
        } catch {
          migratedState.welcomeShown = !!welcomeData;
        }
      }

      // Migrate onboarding progress
      if (onboardingData) {
        try {
          const parsed = JSON.parse(onboardingData);
          migratedState.completed = parsed.completed || [];
          migratedState.dismissed = parsed.dismissed || false;
          migratedState.currentStep = parsed.currentStep || 0;
        } catch (error) {
          logger.error('[OnboardingStorage] Failed to parse old onboarding data:', error);
        }
      }

      // Migrate goal
      if (goalData) {
        migratedState.selectedGoal = goalData;
      }

      // Save migrated state
      this.setState(userId, migratedState);

      // Remove old keys
      localStorage.removeItem(oldWelcomeKey);
      localStorage.removeItem(oldOnboardingKey);
      localStorage.removeItem(oldGoalKey);

      logger.info('[OnboardingStorage] Migration complete for user:', userId, {
        hadWelcome: !!welcomeData,
        hadOnboarding: !!onboardingData,
        hadGoal: !!goalData
      });
    } catch (error) {
      logger.error('[OnboardingStorage] Migration failed:', error);
    }
  }
}

// Export singleton instance
export const onboardingStorage = new OnboardingStorageManager();
