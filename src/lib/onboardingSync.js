/**
 * Onboarding Progress Sync
 * Syncs onboarding progress across devices using Supabase
 * Provides real-time collaboration and persistence
 *
 * CRITICAL FIX: Now uses unified onboardingStorage instead of direct localStorage
 */

import { supabase } from './supabase';
import { onboardingStorage } from './onboardingStorage';

export class OnboardingSync {
  constructor() {
    this.subscription = null;
    this.syncEnabled = true;
    this.pendingSync = null;
  }

  /**
   * Initialize sync for a user
   */
  async initialize(userId) {
    if (!userId) return;

    try {
      // CRITICAL FIX: Use local storage only for initialization
      // Server sync happens in background via saveProgress
      // This avoids 401 errors on page load
      const localProgress = this.getLocalProgress(userId);

      // Subscribe to real-time updates
      if (this.syncEnabled) {
        this.subscribeToChanges(userId);
      }

      return localProgress;
    } catch (error) {
      console.error('Failed to initialize onboarding sync:', error);
      // Fallback to local-only mode
      this.syncEnabled = false;
      return this.getLocalProgress(userId);
    }
  }

  /**
   * Fetch progress from backend (HttpOnly cookie auth)
   * FIX v1.7.83 (#8): Use backend endpoint instead of direct Supabase query to avoid 401
   */
  async fetchProgress(userId) {
    try {
      const response = await fetch('/.netlify/functions/onboarding-progress-fetch', {
        method: 'GET',
        credentials: 'include', // Include HttpOnly cookies
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // If 401, user not authenticated - return null (will use local only)
        if (response.status === 401) {
          console.warn('[OnboardingSync] Not authenticated - using local progress only');
          return null;
        }
        throw new Error(`Failed to fetch progress: ${response.status}`);
      }

      const { data } = await response.json();

      return data ? {
        completed: data.completed_steps || [],
        dismissed: data.dismissed || false,
        lastUpdated: data.updated_at,
        currentStep: data.current_step || 0
      } : null;
    } catch (error) {
      console.error('Failed to fetch progress:', error);
      return null;
    }
  }

  /**
   * Save progress to both unified storage and Supabase
   * CRITICAL FIX: Uses onboardingStorage instead of direct localStorage
   */
  async saveProgress(userId, progress) {
    // Save locally first (instant) using unified storage
    onboardingStorage.setState(userId, {
      completed: progress.completed,
      dismissed: progress.dismissed,
      currentStep: progress.currentStep || 0
    });

    // Debounce remote save (avoid excessive writes)
    if (this.pendingSync) {
      clearTimeout(this.pendingSync);
    }

    this.pendingSync = setTimeout(async () => {
      if (!this.syncEnabled) return;

      try {
        // CRITICAL FIX v1.7.85: Use backend endpoint with HttpOnly cookie auth
        // This fixes 401 errors when trying to save directly from frontend
        const response = await fetch('/.netlify/functions/onboarding-progress-save', {
          method: 'POST',
          credentials: 'include', // Include HttpOnly cookies
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            completed_steps: progress.completed || [],
            dismissed: progress.dismissed || false,
            current_step: progress.currentStep || 0
          })
        });

        if (!response.ok) {
          // FIX v1.7.85: Handle 401 gracefully - user not authenticated yet
          // This is NORMAL for new signups who haven't completed onboarding
          // Don't throw errors or disable sync - just skip silently
          if (response.status === 401) {
            console.warn('[OnboardingSync] Not authenticated yet - will retry later');
            // Don't disable sync - user might authenticate soon
            return;
          }

          // For other errors, log but don't crash
          try {
            const error = await response.json();
            console.error('[OnboardingSync] Failed to sync progress:', error);
          } catch (parseError) {
            console.error('[OnboardingSync] Failed to sync progress (status:', response.status, ')');
          }
        }
      } catch (error) {
        // CRITICAL FIX v1.7.85: Catch all errors to prevent React crashes
        // Network errors, timeouts, etc. should not crash the app
        console.warn('[OnboardingSync] Sync error (non-fatal):', error.message || error);
        // Keep sync enabled - will retry on next save
      }
    }, 1000); // 1 second debounce
  }

  /**
   * Get progress from unified storage
   * CRITICAL FIX: Uses onboardingStorage instead of direct localStorage
   */
  getLocalProgress(userId) {
    const state = onboardingStorage.getState(userId);

    if (state) {
      return {
        completed: state.completed || [],
        dismissed: state.dismissed || false,
        currentStep: state.currentStep || 0,
        lastUpdated: state.lastUpdated
      };
    }

    return null;
  }

  /**
   * Merge local and server progress (server wins on conflicts)
   */
  mergeProgress(local, server) {
    if (!local && !server) return null;
    if (!local) return server;
    if (!server) return local;

    // Server is source of truth if it's newer
    const localDate = local.lastUpdated ? new Date(local.lastUpdated) : new Date(0);
    const serverDate = server.lastUpdated ? new Date(server.lastUpdated) : new Date(0);

    if (serverDate >= localDate) {
      return server;
    } else {
      // Local is newer, use it but will sync to server
      return local;
    }
  }

  /**
   * Subscribe to real-time changes from other devices
   */
  subscribeToChanges(userId) {
    if (!this.syncEnabled || this.subscription) return;

    this.subscription = supabase
      .channel(`onboarding_${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'onboarding_progress',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        // Another device updated progress
        const newProgress = {
          completed: payload.new.completed_steps || [],
          dismissed: payload.new.dismissed || false,
          currentStep: payload.new.current_step || 0
        };

        // CRITICAL FIX: Update unified storage instead of direct localStorage
        onboardingStorage.setState(userId, newProgress);

        // Dispatch event for components to react
        window.dispatchEvent(new CustomEvent('onboarding:synced', {
          detail: newProgress
        }));
      })
      .subscribe();
  }

  /**
   * Ensure table exists (would normally be done via migration)
   */
  async ensureTableExists() {
    // This is a fallback check - the table should be created via migration
    // In production, you'd have a proper migration file
    try {
      const { error } = await supabase
        .from('onboarding_progress')
        .select('user_id')
        .limit(1);

      // If no error or "no rows" error, table exists
      if (!error || error.code === 'PGRST116') {
        return true;
      }

      // Table might not exist
      console.warn('onboarding_progress table may not exist:', error);
      return false;
    } catch (error) {
      console.error('Table check failed:', error);
      return false;
    }
  }

  /**
   * Cleanup subscriptions
   */
  cleanup() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    if (this.pendingSync) {
      clearTimeout(this.pendingSync);
      this.pendingSync = null;
    }
  }

  /**
   * Disable sync (fallback to local-only mode)
   */
  disable() {
    this.syncEnabled = false;
    this.cleanup();
  }

  /**
   * Enable sync
   */
  enable() {
    this.syncEnabled = true;
  }
}

// Singleton instance
export const onboardingSync = new OnboardingSync();
