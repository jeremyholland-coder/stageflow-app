import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getDefaultCardOrder } from '../config/dashboardCards';

/**
 * Custom hook for managing dashboard card preferences
 * Handles user preferences merged with organization defaults
 */
export const useDashboardPreferences = (userId, organizationId) => {
  const [preferences, setPreferences] = useState(null);
  const [orgDefaults, setOrgDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /**
   * Load user preferences and organization defaults
   */
  const loadPreferences = useCallback(async () => {
    if (!userId || !organizationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // CRITICAL FIX: Use maybeSingle() instead of single() to prevent 406 errors
      // .single() throws 406 when 0 rows found, .maybeSingle() returns null
      // This prevents dashboard crashes when tables don't exist yet

      // Load organization defaults
      const { data: orgData, error: orgError } = await supabase
        .from('organization_card_defaults')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (orgError) {
        console.warn('Failed to load org defaults:', orgError);
        // Don't throw - fall back to defaults
      }

      // Load user preferences
      const { data: userData, error: userError } = await supabase
        .from('dashboard_card_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (userError) {
        console.warn('Failed to load user preferences:', userError);
        // Don't throw - fall back to defaults
      }

      // Merge preferences: user overrides org defaults
      const merged = mergePreferences(userData, orgData);

      setOrgDefaults(orgData);
      setPreferences(merged);
    } catch (error) {
      console.error('Error loading dashboard preferences:', error);
      // Fallback to defaults if loading fails
      setPreferences(getDefaultPreferences());
    } finally {
      setLoading(false);
    }
  }, [userId, organizationId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  /**
   * Merge user preferences with org defaults
   */
  const mergePreferences = (userPrefs, orgPrefs) => {
    const defaults = getDefaultPreferences();

    // If user is using org defaults or has no preferences, use org defaults
    if (!userPrefs || userPrefs.use_org_defaults) {
      return {
        show_dashboard_stats: orgPrefs?.show_dashboard_stats ?? defaults.show_dashboard_stats,
        show_revenue_targets: orgPrefs?.show_revenue_targets ?? defaults.show_revenue_targets,
        show_ai_insights: orgPrefs?.show_ai_insights ?? defaults.show_ai_insights,
        show_pipeline_health: orgPrefs?.show_pipeline_health ?? defaults.show_pipeline_health,
        card_order: orgPrefs?.card_order ?? defaults.card_order,
        use_org_defaults: true
      };
    }

    // User has custom preferences, use them
    return {
      show_dashboard_stats: userPrefs.show_dashboard_stats ?? orgPrefs?.show_dashboard_stats ?? defaults.show_dashboard_stats,
      show_revenue_targets: userPrefs.show_revenue_targets ?? orgPrefs?.show_revenue_targets ?? defaults.show_revenue_targets,
      show_ai_insights: userPrefs.show_ai_insights ?? orgPrefs?.show_ai_insights ?? defaults.show_ai_insights,
      show_pipeline_health: userPrefs.show_pipeline_health ?? orgPrefs?.show_pipeline_health ?? defaults.show_pipeline_health,
      card_order: userPrefs.card_order ?? orgPrefs?.card_order ?? defaults.card_order,
      use_org_defaults: false
    };
  };

  /**
   * Get default preferences (all cards visible, default order)
   */
  const getDefaultPreferences = () => ({
    show_dashboard_stats: true,
    show_revenue_targets: true,
    show_ai_insights: true,
    show_pipeline_health: true,
    card_order: getDefaultCardOrder(),
    use_org_defaults: true
  });

  /**
   * Save user preferences
   */
  const savePreferences = async (newPreferences) => {
    if (!userId || !organizationId) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('dashboard_card_preferences')
        .upsert({
          user_id: userId,
          organization_id: organizationId,
          show_dashboard_stats: newPreferences.show_dashboard_stats,
          show_revenue_targets: newPreferences.show_revenue_targets,
          show_ai_insights: newPreferences.show_ai_insights,
          show_pipeline_health: newPreferences.show_pipeline_health,
          card_order: newPreferences.card_order,
          use_org_defaults: newPreferences.use_org_defaults,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,organization_id'
        });

      if (error) throw error;

      // Reload preferences to get merged view
      await loadPreferences();
      return { success: true };
    } catch (error) {
      console.error('Error saving dashboard preferences:', error);
      return { success: false, error };
    } finally {
      setSaving(false);
    }
  };

  /**
   * Save organization defaults (admin only)
   */
  const saveOrgDefaults = async (newDefaults) => {
    if (!organizationId) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('organization_card_defaults')
        .upsert({
          organization_id: organizationId,
          show_dashboard_stats: newDefaults.show_dashboard_stats,
          show_revenue_targets: newDefaults.show_revenue_targets,
          show_ai_insights: newDefaults.show_ai_insights,
          show_pipeline_health: newDefaults.show_pipeline_health,
          card_order: newDefaults.card_order,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'organization_id'
        });

      if (error) throw error;

      // Reload preferences
      await loadPreferences();
      return { success: true };
    } catch (error) {
      console.error('Error saving organization defaults:', error);
      return { success: false, error };
    } finally {
      setSaving(false);
    }
  };

  /**
   * Reset to organization defaults
   */
  const resetToOrgDefaults = async () => {
    return await savePreferences({
      ...preferences,
      use_org_defaults: true
    });
  };

  return {
    preferences,
    orgDefaults,
    loading,
    saving,
    savePreferences,
    saveOrgDefaults,
    resetToOrgDefaults,
    reload: loadPreferences
  };
};
