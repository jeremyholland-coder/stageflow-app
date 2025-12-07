/**
 * QueryProvider - TanStack Query Provider for StageFlow
 * Area 4 - Caching for Production Hardening
 *
 * Wraps the app with QueryClientProvider for:
 * - Centralized query caching
 * - Automatic refetching
 * - Stale-while-revalidate semantics
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';

/**
 * QueryProvider - Wrap app with TanStack Query
 */
export function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export default QueryProvider;
