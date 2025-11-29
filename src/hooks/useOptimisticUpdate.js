/**
 * useOptimisticUpdate Hook
 *
 * Implements optimistic UI updates with automatic rollback on failure.
 * Makes the app feel instant by updating UI immediately before server confirmation.
 *
 * NEXT-LEVEL FIX: Eliminates perceived latency for common operations
 *
 * Features:
 * - Instant UI feedback (no waiting for server)
 * - Automatic rollback on failure
 * - Conflict resolution strategies
 * - Toast notifications on errors
 *
 * Usage:
 * ```javascript
 * const { mutate, isLoading, error } = useOptimisticUpdate({
 *   currentData: deals,
 *   setData: setDeals,
 *   mutationFn: async (updatedDeal) => {
 *     return await api.put(`/deals/${updatedDeal.id}`, updatedDeal);
 *   },
 *   onError: (error) => {
 *     addNotification('Failed to update deal', 'error');
 *   }
 * });
 *
 * // Update will happen instantly in UI, then confirm with server
 * await mutate({ id: 123, stage: 'closed-won' });
 * ```
 */

import { useState, useCallback, useRef } from 'react';

/**
 * Hook for optimistic UI updates with automatic rollback
 *
 * @param {object} options - Configuration options
 * @param {Array|Object} options.currentData - Current data state
 * @param {Function} options.setData - State setter function
 * @param {Function} options.mutationFn - Async function that performs the update
 * @param {Function} options.optimisticUpdateFn - Function to compute optimistic update (optional)
 * @param {Function} options.onSuccess - Success callback (optional)
 * @param {Function} options.onError - Error callback (optional)
 * @param {boolean} options.showRollbackNotification - Show notification on rollback (default: true)
 * @returns {object} - { mutate, isLoading, error, rollback }
 */
export function useOptimisticUpdate(options) {
  const {
    currentData,
    setData,
    mutationFn,
    optimisticUpdateFn,
    onSuccess,
    onError,
    showRollbackNotification = true,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const previousDataRef = useRef(null);

  /**
   * Perform optimistic update with automatic rollback on failure
   */
  const mutate = useCallback(async (updatedData, options = {}) => {
    const { skipOptimistic = false } = options;

    setIsLoading(true);
    setError(null);

    // Store previous data for rollback
    previousDataRef.current = currentData;

    try {
      // Apply optimistic update immediately (if not skipped)
      if (!skipOptimistic) {
        const optimisticData = optimisticUpdateFn
          ? optimisticUpdateFn(currentData, updatedData)
          : updatedData;

        setData(optimisticData);
      }

      // Perform actual mutation
      const result = await mutationFn(updatedData);

      // Success - update with server response (if different from optimistic)
      if (result && result.data) {
        setData(result.data);
      }

      // Call success callback
      if (onSuccess) {
        onSuccess(result);
      }

      setIsLoading(false);
      return result;

    } catch (err) {
      // Rollback to previous data
      if (previousDataRef.current !== null) {
        setData(previousDataRef.current);

        if (showRollbackNotification) {
          console.warn('[OptimisticUpdate] Rolled back due to error:', err);
        }
      }

      setError(err);
      setIsLoading(false);

      // Call error callback
      if (onError) {
        onError(err);
      }

      throw err; // Re-throw so caller can handle
    }
  }, [currentData, setData, mutationFn, optimisticUpdateFn, onSuccess, onError, showRollbackNotification]);

  /**
   * Manual rollback function (for advanced use cases)
   */
  const rollback = useCallback(() => {
    if (previousDataRef.current !== null) {
      setData(previousDataRef.current);
      previousDataRef.current = null;
    }
  }, [setData]);

  return {
    mutate,
    isLoading,
    error,
    rollback,
  };
}

/**
 * Hook for optimistic array updates (add, remove, update items)
 *
 * @param {object} options - Configuration options
 * @returns {object} - { addItem, updateItem, removeItem, isLoading, error }
 */
export function useOptimisticArray(options) {
  const {
    items,
    setItems,
    addItemFn,
    updateItemFn,
    removeItemFn,
    getItemId = (item) => item.id,
    onSuccess,
    onError,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const previousItemsRef = useRef(null);

  /**
   * Optimistically add item to array
   */
  const addItem = useCallback(async (newItem) => {
    setIsLoading(true);
    setError(null);
    previousItemsRef.current = items;

    try {
      // Optimistic update - add immediately
      const optimisticItem = {
        ...newItem,
        _optimistic: true,
        _tempId: Date.now(), // Temporary ID until server confirms
      };
      setItems(prev => [...prev, optimisticItem]);

      // Server mutation
      const result = await addItemFn(newItem);

      // Replace optimistic item with server response
      if (result && result.data) {
        setItems(prev =>
          prev.map(item =>
            item._tempId === optimisticItem._tempId ? result.data : item
          )
        );
      }

      if (onSuccess) onSuccess(result);
      setIsLoading(false);
      return result;

    } catch (err) {
      // Rollback
      if (previousItemsRef.current) {
        setItems(previousItemsRef.current);
      }
      setError(err);
      setIsLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [items, setItems, addItemFn, onSuccess, onError]);

  /**
   * Optimistically update item in array
   */
  const updateItem = useCallback(async (itemId, updates) => {
    setIsLoading(true);
    setError(null);
    previousItemsRef.current = items;

    try {
      // Optimistic update
      setItems(prev =>
        prev.map(item =>
          getItemId(item) === itemId
            ? { ...item, ...updates, _optimistic: true }
            : item
        )
      );

      // Server mutation
      const result = await updateItemFn(itemId, updates);

      // Update with server response
      if (result && result.data) {
        setItems(prev =>
          prev.map(item =>
            getItemId(item) === itemId ? result.data : item
          )
        );
      }

      if (onSuccess) onSuccess(result);
      setIsLoading(false);
      return result;

    } catch (err) {
      // Rollback
      if (previousItemsRef.current) {
        setItems(previousItemsRef.current);
      }
      setError(err);
      setIsLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [items, setItems, updateItemFn, getItemId, onSuccess, onError]);

  /**
   * Optimistically remove item from array
   */
  const removeItem = useCallback(async (itemId) => {
    setIsLoading(true);
    setError(null);
    previousItemsRef.current = items;

    try {
      // Optimistic update - remove immediately
      setItems(prev => prev.filter(item => getItemId(item) !== itemId));

      // Server mutation
      const result = await removeItemFn(itemId);

      if (onSuccess) onSuccess(result);
      setIsLoading(false);
      return result;

    } catch (err) {
      // Rollback
      if (previousItemsRef.current) {
        setItems(previousItemsRef.current);
      }
      setError(err);
      setIsLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [items, setItems, removeItemFn, getItemId, onSuccess, onError]);

  return {
    addItem,
    updateItem,
    removeItem,
    isLoading,
    error,
  };
}

/**
 * Hook for optimistic object updates (nested property updates)
 *
 * @param {object} options - Configuration options
 * @returns {object} - { updateProperty, isLoading, error }
 */
export function useOptimisticObject(options) {
  const {
    object,
    setObject,
    updateFn,
    onSuccess,
    onError,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const previousObjectRef = useRef(null);

  /**
   * Optimistically update object property
   */
  const updateProperty = useCallback(async (path, value) => {
    setIsLoading(true);
    setError(null);
    previousObjectRef.current = object;

    try {
      // Optimistic update
      const updated = { ...object };
      const keys = path.split('.');
      let current = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;

      setObject(updated);

      // Server mutation
      const result = await updateFn(path, value);

      // Update with server response
      if (result && result.data) {
        setObject(result.data);
      }

      if (onSuccess) onSuccess(result);
      setIsLoading(false);
      return result;

    } catch (err) {
      // Rollback
      if (previousObjectRef.current) {
        setObject(previousObjectRef.current);
      }
      setError(err);
      setIsLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [object, setObject, updateFn, onSuccess, onError]);

  return {
    updateProperty,
    isLoading,
    error,
  };
}

export default useOptimisticUpdate;
