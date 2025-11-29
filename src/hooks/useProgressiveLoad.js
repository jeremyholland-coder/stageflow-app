/**
 * useProgressiveLoad Hook
 *
 * Progressively loads large datasets in chunks to prevent UI blocking.
 * Shows initial data immediately, then loads more in background.
 *
 * NEXT-LEVEL FIX: Eliminates "blank screen" on large data loads
 *
 * Features:
 * - Initial fast load (first 50 items)
 * - Background progressive loading
 * - Infinite scroll support
 * - Virtual scrolling optimization
 * - Loading state management
 *
 * Usage:
 * ```javascript
 * const { data, hasMore, loadMore, isLoading, isLoadingMore } = useProgressiveLoad({
 *   fetchFn: async (offset, limit) => {
 *     return await api.get(`/deals?offset=${offset}&limit=${limit}`);
 *   },
 *   initialChunkSize: 50,
 *   chunkSize: 100,
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for progressive data loading
 *
 * @param {object} options - Configuration options
 * @param {Function} options.fetchFn - Function to fetch data chunk (offset, limit) => Promise<data[]>
 * @param {number} options.initialChunkSize - Size of first chunk (default: 50)
 * @param {number} options.chunkSize - Size of subsequent chunks (default: 100)
 * @param {boolean} options.autoLoadNext - Automatically load next chunk after initial (default: false)
 * @param {number} options.autoLoadDelay - Delay before auto-loading next chunk (default: 500ms)
 * @param {Function} options.onError - Error callback
 * @returns {object} - { data, hasMore, loadMore, isLoading, isLoadingMore, refresh, total }
 */
export function useProgressiveLoad(options) {
  const {
    fetchFn,
    initialChunkSize = 50,
    chunkSize = 100,
    autoLoadNext = false,
    autoLoadDelay = 500,
    onError,
  } = options;

  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(null);

  const offsetRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const autoLoadTimeoutRef = useRef(null);

  /**
   * Load next chunk of data
   */
  const loadMore = useCallback(async (reset = false) => {
    if (reset) {
      offsetRef.current = 0;
      isInitialLoadRef.current = true;
      setData([]);
      setHasMore(true);
      setIsLoading(true);
    } else if (!hasMore || isLoadingMore) {
      return; // Don't load if no more data or already loading
    }

    try {
      const isInitial = isInitialLoadRef.current;
      const currentChunkSize = isInitial ? initialChunkSize : chunkSize;

      if (isInitial) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      setError(null);

      // Fetch chunk
      const result = await fetchFn(offsetRef.current, currentChunkSize);

      // Handle different response formats
      let items = [];
      let totalCount = null;

      if (Array.isArray(result)) {
        items = result;
      } else if (result && result.data) {
        if (Array.isArray(result.data)) {
          items = result.data;
        } else if (result.data.items && Array.isArray(result.data.items)) {
          items = result.data.items;
          totalCount = result.data.total || result.data.count || null;
        }
      }

      // Update state
      setData(prev => reset ? items : [...prev, ...items]);
      offsetRef.current += items.length;

      // Check if there's more data
      if (totalCount !== null) {
        setTotal(totalCount);
        setHasMore(offsetRef.current < totalCount);
      } else {
        // If no total count, assume more data exists if we got a full chunk
        setHasMore(items.length === currentChunkSize);
      }

      if (isInitial) {
        isInitialLoadRef.current = false;
        setIsLoading(false);

        // Auto-load next chunk if enabled
        if (autoLoadNext && items.length === currentChunkSize) {
          autoLoadTimeoutRef.current = setTimeout(() => {
            loadMore(false);
          }, autoLoadDelay);
        }
      } else {
        setIsLoadingMore(false);
      }

    } catch (err) {
      console.error('[ProgressiveLoad] Error loading data:', err);
      setError(err);
      setIsLoading(false);
      setIsLoadingMore(false);

      if (onError) {
        onError(err);
      }
    }
  }, [fetchFn, initialChunkSize, chunkSize, hasMore, isLoadingMore, autoLoadNext, autoLoadDelay, onError]);

  /**
   * Refresh data (reload from beginning)
   */
  const refresh = useCallback(() => {
    return loadMore(true);
  }, [loadMore]);

  // Initial load
  useEffect(() => {
    loadMore(true);

    return () => {
      // Cleanup auto-load timeout
      if (autoLoadTimeoutRef.current) {
        clearTimeout(autoLoadTimeoutRef.current);
      }
    };
  }, [fetchFn]); // Only re-run if fetchFn changes

  return {
    data,
    hasMore,
    loadMore: () => loadMore(false),
    isLoading,
    isLoadingMore,
    refresh,
    total,
    error,
  };
}

/**
 * Hook for infinite scroll with progressive loading
 *
 * @param {object} options - Same as useProgressiveLoad, plus scroll options
 * @returns {object} - Same as useProgressiveLoad, plus { scrollRef, isNearBottom }
 */
export function useInfiniteScroll(options) {
  const {
    threshold = 0.8, // Load more when 80% scrolled
    ...progressiveOptions
  } = options;

  const progressive = useProgressiveLoad({
    ...progressiveOptions,
    autoLoadNext: false, // Controlled by scroll instead
  });

  const scrollRef = useRef(null);
  const [isNearBottom, setIsNearBottom] = useState(false);

  // Handle scroll events
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      setIsNearBottom(scrollPercentage >= threshold);

      // Auto-load more when near bottom
      if (scrollPercentage >= threshold && progressive.hasMore && !progressive.isLoadingMore) {
        progressive.loadMore();
      }
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [threshold, progressive.hasMore, progressive.isLoadingMore, progressive.loadMore]);

  return {
    ...progressive,
    scrollRef,
    isNearBottom,
  };
}

/**
 * Hook for virtualized progressive loading (for very large lists)
 *
 * @param {object} options - Configuration options
 * @returns {object} - { visibleData, loadMore, isLoading, ... }
 */
export function useVirtualizedLoad(options) {
  const {
    itemHeight, // Height of each item in pixels
    containerHeight, // Height of scroll container
    overscan = 3, // Number of extra items to render above/below viewport
    ...progressiveOptions
  } = options;

  const progressive = useProgressiveLoad(progressiveOptions);
  const [scrollTop, setScrollTop] = useState(0);

  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    progressive.data.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleData = progressive.data.slice(startIndex, endIndex).map((item, i) => ({
    ...item,
    _index: startIndex + i,
    _offset: (startIndex + i) * itemHeight,
  }));

  const totalHeight = progressive.data.length * itemHeight;

  const handleScroll = useCallback((event) => {
    setScrollTop(event.target.scrollTop);

    // Load more when near bottom
    const { scrollTop, scrollHeight, clientHeight } = event.target;
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

    if (scrollPercentage >= 0.8 && progressive.hasMore && !progressive.isLoadingMore) {
      progressive.loadMore();
    }
  }, [progressive.hasMore, progressive.isLoadingMore, progressive.loadMore]);

  return {
    ...progressive,
    visibleData,
    totalHeight,
    handleScroll,
    startIndex,
    endIndex,
  };
}

export default useProgressiveLoad;
