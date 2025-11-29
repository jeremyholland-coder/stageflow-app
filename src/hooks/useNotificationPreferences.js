import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api-client';

/**
 * Custom hook for managing notification preferences
 * Fetches and updates user notification preferences via Netlify functions
 */
export const useNotificationPreferences = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Load notification preferences from the server
   */
  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: response } = await api.get('notification-preferences-get');

      if (response.error) {
        throw new Error(response.error);
      }

      setData(response);
    } catch (err) {
      console.error('[useNotificationPreferences] Load error:', err);
      setError(err.userMessage || err.message || 'Failed to load notification preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  /**
   * Save notification preferences
   *
   * @param {Array} preferences - Array of preference objects:
   *   [{ categoryCode, enabled, channel_email, channel_in_app, channel_push }]
   * @returns {Object} { success: boolean, error?: string }
   */
  const savePreferences = async (preferences) => {
    if (!preferences || !Array.isArray(preferences)) {
      return { success: false, error: 'Invalid preferences format' };
    }

    setSaving(true);
    setError(null);

    try {
      const { data: response } = await api.post('notification-preferences-update', {
        preferences
      });

      if (response.error) {
        throw new Error(response.error);
      }

      // Update local state with the response
      setData(response);

      return { success: true };
    } catch (err) {
      console.error('[useNotificationPreferences] Save error:', err);
      const errorMessage = err.userMessage || err.message || 'Failed to save notification preferences';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setSaving(false);
    }
  };

  /**
   * Update a single category preference locally (for optimistic UI)
   * Call savePreferences() to persist changes
   */
  const updateCategoryLocally = (categoryCode, updates) => {
    if (!data?.categories) return;

    setData(prev => ({
      ...prev,
      categories: prev.categories.map(cat => {
        if (cat.code === categoryCode) {
          return {
            ...cat,
            userPreference: {
              ...cat.userPreference,
              ...updates
            }
          };
        }
        return cat;
      })
    }));
  };

  /**
   * Get the list of categories with merged preferences
   */
  const categories = data?.categories || [];

  /**
   * Check if a specific category is enabled
   */
  const isCategoryEnabled = (categoryCode) => {
    const cat = categories.find(c => c.code === categoryCode);
    return cat?.userPreference?.enabled ?? cat?.default_enabled ?? true;
  };

  /**
   * Check if email channel is enabled for a category
   */
  const isEmailEnabled = (categoryCode) => {
    const cat = categories.find(c => c.code === categoryCode);
    return cat?.userPreference?.channel_email ?? true;
  };

  /**
   * Check if in-app channel is enabled for a category
   */
  const isInAppEnabled = (categoryCode) => {
    const cat = categories.find(c => c.code === categoryCode);
    return cat?.userPreference?.channel_in_app ?? true;
  };

  return {
    // Data
    categories,
    data,

    // State
    loading,
    saving,
    error,

    // Actions
    savePreferences,
    updateCategoryLocally,
    reload: loadPreferences,

    // Helpers
    isCategoryEnabled,
    isEmailEnabled,
    isInAppEnabled
  };
};

export default useNotificationPreferences;
