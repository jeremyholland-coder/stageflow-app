import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook for managing user's hidden stages and custom stage order
 * Stores preferences in user_preferences table
 */
export const useStageVisibility = (userId, organizationId) => {
  const [hiddenStageIds, setHiddenStageIds] = useState([]);
  const [stageOrder, setStageOrder] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load user's stage visibility preferences
  useEffect(() => {
    if (!userId || !organizationId) return;

    const loadPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('hidden_stage_ids, stage_order')
          .eq('user_id', userId)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading stage visibility preferences:', error);
        }

        if (data) {
          setHiddenStageIds(data.hidden_stage_ids || []);
          setStageOrder(data.stage_order || []);
        }
      } catch (error) {
        console.error('Error in loadPreferences:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, [userId, organizationId]);

  // Hide a stage
  const hideStage = useCallback(async (stageId) => {
    if (!userId || !organizationId) return;

    const newHiddenStageIds = [...hiddenStageIds, stageId];
    setHiddenStageIds(newHiddenStageIds);

    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: userId,
          organization_id: organizationId,
          hidden_stage_ids: newHiddenStageIds
        }, {
          onConflict: 'user_id,organization_id'
        });

      if (error) {
        console.error('Error hiding stage:', error);
        // Revert on error
        setHiddenStageIds(hiddenStageIds);
      }
    } catch (error) {
      console.error('Error in hideStage:', error);
      setHiddenStageIds(hiddenStageIds);
    }
  }, [userId, organizationId, hiddenStageIds]);

  // Unhide a stage
  const unhideStage = useCallback(async (stageId) => {
    if (!userId || !organizationId) return;

    const newHiddenStageIds = hiddenStageIds.filter(id => id !== stageId);
    setHiddenStageIds(newHiddenStageIds);

    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: userId,
          organization_id: organizationId,
          hidden_stage_ids: newHiddenStageIds
        }, {
          onConflict: 'user_id,organization_id'
        });

      if (error) {
        console.error('Error unhiding stage:', error);
        // Revert on error
        setHiddenStageIds(hiddenStageIds);
      }
    } catch (error) {
      console.error('Error in unhideStage:', error);
      setHiddenStageIds(hiddenStageIds);
    }
  }, [userId, organizationId, hiddenStageIds]);

  // Update stage order
  const updateStageOrder = useCallback(async (newOrder) => {
    if (!userId || !organizationId) return;

    setStageOrder(newOrder);

    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: userId,
          organization_id: organizationId,
          stage_order: newOrder
        }, {
          onConflict: 'user_id,organization_id'
        });

      if (error) {
        console.error('Error updating stage order:', error);
        // Revert on error
        setStageOrder(stageOrder);
      }
    } catch (error) {
      console.error('Error in updateStageOrder:', error);
      setStageOrder(stageOrder);
    }
  }, [userId, organizationId, stageOrder]);

  // Filter stages based on hidden IDs
  const filterVisibleStages = useCallback((stages) => {
    if (!stages) return [];
    return stages.filter(stage => !hiddenStageIds.includes(stage.id));
  }, [hiddenStageIds]);

  // Apply custom order to stages
  const applyStageOrder = useCallback((stages) => {
    if (!stages || stages.length === 0) return [];
    if (!stageOrder || stageOrder.length === 0) return stages;

    // Create a map for quick lookup
    const stageMap = new Map(stages.map(stage => [stage.id, stage]));

    // First, add stages in custom order
    const orderedStages = stageOrder
      .map(id => stageMap.get(id))
      .filter(Boolean);

    // Then add any stages not in custom order (new stages)
    const orderedIds = new Set(stageOrder);
    const unorderedStages = stages.filter(stage => !orderedIds.has(stage.id));

    return [...orderedStages, ...unorderedStages];
  }, [stageOrder]);

  return {
    hiddenStageIds,
    stageOrder,
    loading,
    hideStage,
    unhideStage,
    updateStageOrder,
    filterVisibleStages,
    applyStageOrder
  };
};
