/**
 * Analytics Query Hooks - TanStack Query integration for analytics
 * Area 4 - Caching for Production Hardening
 *
 * Provides cached queries for:
 * - Pipeline summary (totals, conversion)
 * - Revenue forecast
 * - Stage breakdown
 * - Team performance
 *
 * Analytics are less frequently updated, so use longer stale times.
 *
 * @author StageFlow Engineering
 * @date December 2025
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { STALE_TIMES } from '../lib/queryClient';
import { logger } from '../lib/logger';

/**
 * Fetch pipeline summary analytics
 * Calculates totals, stage counts, conversion rates from deals
 */
const fetchPipelineSummary = async (orgId) => {
  if (!orgId) {
    throw new Error('Organization ID required');
  }

  logger.debug('[AnalyticsQuery] Fetching pipeline summary for org:', orgId);

  // Fetch all active deals
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, stage, status, value, probability, created, last_activity')
    .eq('organization_id', orgId)
    .is('deleted_at', null);

  if (error) {
    logger.error('[AnalyticsQuery] Fetch error:', error);
    throw error;
  }

  const validDeals = deals || [];

  // Calculate summary metrics
  const totalDeals = validDeals.length;
  const totalValue = validDeals.reduce((sum, deal) => sum + (deal.value || 0), 0);
  const weightedValue = validDeals.reduce((sum, deal) => {
    const probability = deal.probability || 0;
    return sum + (deal.value || 0) * (probability / 100);
  }, 0);

  // Stage breakdown
  const stageMap = {};
  validDeals.forEach(deal => {
    const stage = deal.stage || 'unknown';
    if (!stageMap[stage]) {
      stageMap[stage] = { count: 0, value: 0 };
    }
    stageMap[stage].count++;
    stageMap[stage].value += deal.value || 0;
  });

  // Status breakdown
  const statusCounts = {
    active: validDeals.filter(d => d.status === 'active').length,
    won: validDeals.filter(d => d.status === 'won').length,
    lost: validDeals.filter(d => d.status === 'lost').length,
    stale: validDeals.filter(d => d.status === 'stale').length,
  };

  // Win rate
  const closedDeals = statusCounts.won + statusCounts.lost;
  const winRate = closedDeals > 0 ? (statusCounts.won / closedDeals) * 100 : 0;

  const summary = {
    totalDeals,
    totalValue,
    weightedValue,
    stageBreakdown: stageMap,
    statusCounts,
    winRate: Math.round(winRate * 10) / 10, // Round to 1 decimal
    activeDeals: statusCounts.active,
    closedDeals,
    lastUpdated: new Date().toISOString(),
  };

  logger.debug('[AnalyticsQuery] Pipeline summary:', summary);

  return summary;
};

/**
 * Fetch revenue forecast
 * Projects revenue based on deal probabilities and expected close dates
 */
const fetchRevenueForecast = async (orgId) => {
  if (!orgId) {
    throw new Error('Organization ID required');
  }

  logger.debug('[AnalyticsQuery] Fetching revenue forecast for org:', orgId);

  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, value, probability, expected_close_date, status')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'active');

  if (error) {
    logger.error('[AnalyticsQuery] Fetch error:', error);
    throw error;
  }

  const validDeals = deals || [];
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const threeMonthsOut = new Date(now.getFullYear(), now.getMonth() + 3, 1);

  // Categorize by expected close
  const thisMonthDeals = validDeals.filter(d => {
    if (!d.expected_close_date) return false;
    const closeDate = new Date(d.expected_close_date);
    return closeDate >= thisMonth && closeDate < nextMonth;
  });

  const nextMonthDeals = validDeals.filter(d => {
    if (!d.expected_close_date) return false;
    const closeDate = new Date(d.expected_close_date);
    return closeDate >= nextMonth && closeDate < threeMonthsOut;
  });

  const calculateForecast = (deals) => ({
    count: deals.length,
    totalValue: deals.reduce((sum, d) => sum + (d.value || 0), 0),
    weightedValue: deals.reduce((sum, d) => {
      const prob = d.probability || 0;
      return sum + (d.value || 0) * (prob / 100);
    }, 0),
  });

  return {
    thisMonth: calculateForecast(thisMonthDeals),
    nextThreeMonths: calculateForecast(nextMonthDeals),
    totalPipeline: calculateForecast(validDeals),
    lastUpdated: new Date().toISOString(),
  };
};

/**
 * Fetch monthly goals/targets
 */
const fetchMonthlyGoals = async (orgId) => {
  if (!orgId) {
    throw new Error('Organization ID required');
  }

  logger.debug('[AnalyticsQuery] Fetching monthly goals for org:', orgId);

  // Get organization settings for targets
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('monthly_revenue_target, monthly_deal_target')
    .eq('id', orgId)
    .single();

  if (orgError) {
    logger.error('[AnalyticsQuery] Org fetch error:', orgError);
    throw orgError;
  }

  // Get this month's won deals
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: wonDeals, error: dealsError } = await supabase
    .from('deals')
    .select('id, value')
    .eq('organization_id', orgId)
    .eq('status', 'won')
    .gte('last_activity', thisMonthStart);

  if (dealsError) {
    logger.error('[AnalyticsQuery] Won deals fetch error:', dealsError);
    throw dealsError;
  }

  const validWonDeals = wonDeals || [];
  const wonValue = validWonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const wonCount = validWonDeals.length;

  const revenueTarget = org?.monthly_revenue_target || 0;
  const dealTarget = org?.monthly_deal_target || 0;

  return {
    revenueTarget,
    revenueActual: wonValue,
    revenueProgress: revenueTarget > 0 ? Math.round((wonValue / revenueTarget) * 100) : 0,
    dealTarget,
    dealActual: wonCount,
    dealProgress: dealTarget > 0 ? Math.round((wonCount / dealTarget) * 100) : 0,
    lastUpdated: new Date().toISOString(),
  };
};

/**
 * Hook: Pipeline summary analytics
 */
export function usePipelineSummary(orgId, options = {}) {
  return useQuery({
    queryKey: queryKeys.analytics.pipelineSummary(orgId),
    queryFn: () => fetchPipelineSummary(orgId),
    staleTime: STALE_TIMES.analytics,
    enabled: !!orgId,
    ...options,
  });
}

/**
 * Hook: Revenue forecast
 */
export function useRevenueForecast(orgId, options = {}) {
  return useQuery({
    queryKey: queryKeys.analytics.revenueForecast(orgId),
    queryFn: () => fetchRevenueForecast(orgId),
    staleTime: STALE_TIMES.analytics,
    enabled: !!orgId,
    ...options,
  });
}

/**
 * Hook: Monthly goals/targets
 */
export function useMonthlyGoals(orgId, options = {}) {
  return useQuery({
    queryKey: queryKeys.analytics.monthlyGoals(orgId),
    queryFn: () => fetchMonthlyGoals(orgId),
    staleTime: STALE_TIMES.analytics,
    enabled: !!orgId,
    ...options,
  });
}

/**
 * Hook: Stage breakdown (derived from pipeline summary)
 */
export function useStageBreakdown(orgId) {
  const { data: summary, ...rest } = usePipelineSummary(orgId);

  return {
    ...rest,
    data: summary?.stageBreakdown || {},
  };
}

/**
 * Hook: Invalidate all analytics for org
 * Call after major data changes
 */
export function useInvalidateAnalytics() {
  const queryClient = useQueryClient();

  return (orgId) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.pipelineSummary(orgId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.revenueForecast(orgId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.monthlyGoals(orgId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.stageBreakdown(orgId) });
  };
}

/**
 * Hook: Prefetch analytics for org
 */
export function usePrefetchAnalytics(orgId) {
  const queryClient = useQueryClient();

  const prefetch = () => {
    if (!orgId) return;

    queryClient.prefetchQuery({
      queryKey: queryKeys.analytics.pipelineSummary(orgId),
      queryFn: () => fetchPipelineSummary(orgId),
      staleTime: STALE_TIMES.analytics,
    });
  };

  return prefetch;
}

export default {
  usePipelineSummary,
  useRevenueForecast,
  useMonthlyGoals,
  useStageBreakdown,
  useInvalidateAnalytics,
  usePrefetchAnalytics,
};
