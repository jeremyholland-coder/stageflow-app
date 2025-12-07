/**
 * TanStack Query Client Configuration
 * Area 4 - Caching for Production Hardening
 *
 * Provides centralized query configuration with:
 * - Stale-while-revalidate semantics
 * - Automatic retry with exponential backoff
 * - Sentry integration for error tracking
 * - Offline-aware caching
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import { QueryClient } from '@tanstack/react-query';
import { addBreadcrumb, trackEvent } from './sentry';
import { logger } from './logger';

/**
 * Default stale times for different data types
 */
export const STALE_TIMES = {
  deals: 30 * 1000,        // 30 seconds for deals (frequently updated)
  dealDetails: 30 * 1000,  // 30 seconds for individual deal
  analytics: 60 * 1000,    // 60 seconds for analytics (less frequently updated)
  pipelines: 5 * 60 * 1000, // 5 minutes for pipeline config (rarely changes)
  user: 5 * 60 * 1000,     // 5 minutes for user data
};

/**
 * Retry configuration
 * Only retry on network errors, not on 4xx errors
 */
const shouldRetry = (failureCount, error) => {
  // Don't retry on auth errors
  if (error?.status === 401 || error?.status === 403) {
    return false;
  }

  // Don't retry on not found
  if (error?.status === 404) {
    return false;
  }

  // Don't retry on rate limits (let user wait)
  if (error?.status === 429) {
    return false;
  }

  // Don't retry on offline errors
  if (error?.code === 'OFFLINE' || error?.isOffline) {
    return false;
  }

  // Retry up to 2 times for network/server errors
  return failureCount < 2;
};

/**
 * Global error handler for queries
 */
const onQueryError = (error, query) => {
  // Log to console
  logger.error('[QueryClient] Query failed:', {
    queryKey: query.queryKey,
    error: error.message,
  });

  // Add Sentry breadcrumb
  addBreadcrumb('Query error', {
    category: 'query',
    queryKey: JSON.stringify(query.queryKey),
    error: error.message,
  });

  // Track event for monitoring
  if (error?.status >= 500) {
    trackEvent('query_server_error', {
      queryKey: JSON.stringify(query.queryKey),
      status: error.status,
    });
  }
};

/**
 * Global success handler for tracking cache hits
 */
const onQuerySuccess = (data, query) => {
  if (import.meta.env.DEV) {
    logger.debug('[QueryClient] Query success:', {
      queryKey: query.queryKey,
      dataSize: Array.isArray(data) ? data.length : 'object',
    });
  }
};

/**
 * Create the QueryClient instance
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time - data considered fresh for this duration
      staleTime: STALE_TIMES.deals,

      // Cache time - how long to keep data in cache after component unmounts
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime in v4)

      // Retry configuration
      retry: shouldRetry,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),

      // Refetch configuration
      refetchOnWindowFocus: true,  // Refetch when tab becomes active
      refetchOnReconnect: true,    // Refetch when network reconnects
      refetchOnMount: true,        // Refetch when component mounts if stale

      // Network mode - important for offline support
      networkMode: 'offlineFirst', // Use cache first, then network

      // Structural sharing for performance
      structuralSharing: true,
    },
    mutations: {
      // Retry mutations once on network errors
      retry: 1,
      retryDelay: 1000,

      // Network mode for mutations
      networkMode: 'online', // Mutations require network
    },
  },
});

// Set up global error handler
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.query.state.status === 'error') {
    onQueryError(event.query.state.error, event.query);
  }
  if (event.type === 'updated' && event.query.state.status === 'success') {
    onQuerySuccess(event.query.state.data, event.query);
  }
});

/**
 * Helper to invalidate all queries for an organization
 * Use when switching orgs or after major data changes
 */
export const invalidateOrgQueries = (orgId) => {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key.includes(orgId);
    },
  });
};

/**
 * Helper to clear all cached data
 * Use on logout or org switch
 */
export const clearQueryCache = () => {
  queryClient.clear();
  logger.log('[QueryClient] Cache cleared');
};

export default queryClient;
