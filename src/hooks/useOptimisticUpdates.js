import { useState, useCallback, useRef } from 'react';

/**
 * Hook for optimistic UI updates
 * Updates UI immediately, syncs with server in background, rolls back on error
 *
 * @example
 * const { optimisticData, applyOptimisticUpdate, cancelOptimisticUpdate } = useOptimisticUpdates(initialData);
 *
 * // Update UI immediately
 * const updateId = applyOptimisticUpdate(
 *   updatedData,
 *   async () => {
 *     await supabase.from('table').update(changes);
 *   }
 * );
 */
export const useOptimisticUpdates = (initialData, options = {}) => {
  const {
    onSuccess = () => {},
    onError = () => {},
    onRollback = () => {},
  } = options;

  const [optimisticData, setOptimisticData] = useState(initialData);
  const [pendingUpdates, setPendingUpdates] = useState(new Map());
  const updateCounter = useRef(0);

  /**
   * Apply an optimistic update
   * @param {*} newData - The optimistically updated data
   * @param {Function} serverUpdate - Async function that performs the server update
   * @param {*} previousData - Optional previous data for rollback (defaults to current data)
   * @returns {string} updateId - ID to cancel the update if needed
   */
  const applyOptimisticUpdate = useCallback(async (newData, serverUpdate, previousData = null) => {
    const updateId = `update_${Date.now()}_${updateCounter.current++}`;
    const rollbackData = previousData || optimisticData;

    // 1. UPDATE UI IMMEDIATELY (optimistic)
    setOptimisticData(newData);

    // 2. Track pending operation
    setPendingUpdates(prev => new Map(prev).set(updateId, {
      newData,
      rollbackData,
      timestamp: Date.now()
    }));

    try {
      // 3. Perform server update in background
      await serverUpdate();

      // 4. Success - remove from pending
      setPendingUpdates(prev => {
        const updated = new Map(prev);
        updated.delete(updateId);
        return updated;
      });

      onSuccess(newData);
      return { success: true, updateId };

    } catch (error) {
      console.error('Optimistic update failed, rolling back:', error);

      // 5. ROLLBACK on failure
      setOptimisticData(rollbackData);

      setPendingUpdates(prev => {
        const updated = new Map(prev);
        updated.delete(updateId);
        return updated;
      });

      onError(error);
      onRollback(rollbackData);

      return { success: false, error, updateId };
    }
  }, [optimisticData, onSuccess, onError, onRollback]);

  /**
   * Cancel a pending optimistic update (rollback immediately)
   * @param {string} updateId - The ID returned from applyOptimisticUpdate
   */
  const cancelOptimisticUpdate = useCallback((updateId) => {
    const pending = pendingUpdates.get(updateId);
    if (pending) {
      setOptimisticData(pending.rollbackData);
      setPendingUpdates(prev => {
        const updated = new Map(prev);
        updated.delete(updateId);
        return updated;
      });
      onRollback(pending.rollbackData);
    }
  }, [pendingUpdates, onRollback]);

  /**
   * Check if there are any pending updates
   */
  const hasPendingUpdates = pendingUpdates.size > 0;

  /**
   * Get count of pending updates
   */
  const pendingCount = pendingUpdates.size;

  /**
   * Reset optimistic data to a specific value
   * (useful when receiving fresh data from server)
   */
  const resetOptimisticData = useCallback((newData) => {
    setOptimisticData(newData);
    // Clear all pending updates since we have fresh server data
    setPendingUpdates(new Map());
  }, []);

  return {
    optimisticData,
    applyOptimisticUpdate,
    cancelOptimisticUpdate,
    hasPendingUpdates,
    pendingCount,
    pendingUpdates,
    resetOptimisticData
  };
};

/**
 * Hook for optimistic array updates (e.g., lists of deals, users, etc.)
 * Provides helper methods for common array operations
 */
export const useOptimisticArray = (initialArray, options = {}) => {
  const { optimisticData, applyOptimisticUpdate, ...rest } = useOptimisticUpdates(initialArray, options);

  /**
   * Optimistically update a single item in the array
   */
  const updateItem = useCallback(async (itemId, updates, serverUpdate, idKey = 'id') => {
    const previousArray = optimisticData;
    const newArray = optimisticData.map(item =>
      item[idKey] === itemId ? { ...item, ...updates } : item
    );

    return applyOptimisticUpdate(newArray, serverUpdate, previousArray);
  }, [optimisticData, applyOptimisticUpdate]);

  /**
   * Optimistically add a new item to the array
   */
  const addItem = useCallback(async (newItem, serverUpdate) => {
    const previousArray = optimisticData;
    const newArray = [...optimisticData, newItem];

    return applyOptimisticUpdate(newArray, serverUpdate, previousArray);
  }, [optimisticData, applyOptimisticUpdate]);

  /**
   * Optimistically remove an item from the array
   */
  const removeItem = useCallback(async (itemId, serverUpdate, idKey = 'id') => {
    const previousArray = optimisticData;
    const newArray = optimisticData.filter(item => item[idKey] !== itemId);

    return applyOptimisticUpdate(newArray, serverUpdate, previousArray);
  }, [optimisticData, applyOptimisticUpdate]);

  /**
   * Optimistically move an item within the array (e.g., drag-and-drop)
   */
  const moveItem = useCallback(async (itemId, newIndex, serverUpdate, idKey = 'id') => {
    const previousArray = optimisticData;
    const currentIndex = optimisticData.findIndex(item => item[idKey] === itemId);

    if (currentIndex === -1) {
      console.error('Item not found for move operation');
      return { success: false, error: 'Item not found' };
    }

    const newArray = [...optimisticData];
    const [movedItem] = newArray.splice(currentIndex, 1);
    newArray.splice(newIndex, 0, movedItem);

    return applyOptimisticUpdate(newArray, serverUpdate, previousArray);
  }, [optimisticData, applyOptimisticUpdate]);

  /**
   * Optimistically reorder items (e.g., drag-and-drop between columns)
   */
  const reorderItems = useCallback(async (reorderedArray, serverUpdate) => {
    const previousArray = optimisticData;
    return applyOptimisticUpdate(reorderedArray, serverUpdate, previousArray);
  }, [optimisticData, applyOptimisticUpdate]);

  return {
    items: optimisticData,
    updateItem,
    addItem,
    removeItem,
    moveItem,
    reorderItems,
    ...rest
  };
};

export default useOptimisticUpdates;
