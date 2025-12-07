/**
 * useUsageSummary Hook
 * Area 7 - Billing & Quotas
 *
 * Fetches usage summary from the backend for displaying
 * quota usage in the UsageAndLimitsCard component.
 */

import { useQuery } from '@tanstack/react-query';
import queryKeys from '../lib/queryKeys';
import { apiClient } from '../lib/api-client';

/**
 * Fetch usage summary from backend
 */
async function fetchUsageSummary() {
  const response = await apiClient.authenticated(
    '/.netlify/functions/get-usage-summary'
  );

  if (!response.ok) {
    throw new Error('Failed to fetch usage summary');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Unknown error');
  }

  return data;
}

/**
 * Hook to fetch and cache usage summary
 *
 * @param {Object} options - Query options
 * @returns {Object} Query result with usage data
 */
export function useUsageSummary(options = {}) {
  return useQuery({
    queryKey: queryKeys.billing.usageSummary(),
    queryFn: fetchUsageSummary,
    staleTime: 60 * 1000, // 1 minute (usage changes frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    retry: 2,
    ...options,
  });
}

export default useUsageSummary;
