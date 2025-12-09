import { createClient } from '@supabase/supabase-js';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';
import { decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';
// ENGINE REBUILD Phase 5: Centralized CORS config
import { buildCorsHeaders } from './lib/cors';
// ENGINE REBUILD Phase 5: AI error classification spine
import { classifyAIError, normalizeAIResponse, type AIErrorInfo } from './lib/ai-spine';
// M3 HARDENING 2025-12-04: Standardized error codes across all AI endpoints
import { AI_ERROR_CODES } from './lib/ai-error-codes';
// Phase 1 Telemetry: Request tracking and AI metrics
import {
  buildRequestContext,
  trackAICall,
  trackTelemetryEvent,
  TelemetryEvents,
  calculateDuration,
  type RequestContext,
} from './lib/telemetry';
// Phase 2 Rate Limiting: Per-user, per-org AI call limits
import {
  checkRateLimits,
  type RateLimitResult,
} from './lib/rate-limiter';
import {
  RATE_LIMIT_GROUPS,
  getRateLimitMessage,
  getRetryAfterSeconds,
  getBucketsForPlan,
  getPlanAwareRateLimitMessage,
} from './lib/rate-limit-config';
// Area 7: Plan-aware rate limiting
import { getOrgPlan } from './lib/get-org-plan';
import { ERROR_CODES } from './lib/with-error-boundary';
// DIAGNOSTICS 2025-12-04: Import environment verification
import { verifyProviderEnvironment } from './lib/provider-registry';

// ============================================================================
// [StageFlow][AI][DIAGNOSTICS] COLD-START ENVIRONMENT CHECK
// This runs ONCE when the function cold-starts to verify environment config
// ============================================================================
console.log("[StageFlow][AI][DIAGNOSTICS]", {
  // NOTE: AI provider keys are NOT env vars - they're stored encrypted in DB
  // These checks confirm they're NOT being read from env (which is correct)
  OPENAI_KEY_PRESENT: !!process.env.OPENAI_API_KEY,       // Should be FALSE
  ANTHROPIC_KEY_PRESENT: !!process.env.ANTHROPIC_API_KEY, // Should be FALSE
  GEMINI_KEY_PRESENT: !!process.env.GEMINI_API_KEY,       // Should be FALSE
  // These are the ACTUAL required env vars for AI functionality:
  ENCRYPTION_KEY_PRESENT: !!process.env.ENCRYPTION_KEY,   // CRITICAL - must be TRUE
  SUPABASE_URL_PRESENT: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
  SUPABASE_SERVICE_KEY_PRESENT: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  NODE_ENV: process.env.NODE_ENV,
  BUILD_TIMESTAMP: new Date().toISOString()
});
// CENTRALIZED CONFIG: Import thresholds from single source of truth
import { STAGNATION_THRESHOLDS } from '../../src/config/pipelineConfig';
// PHASE 3: Task-aware model selection
import { determineTaskType, TaskType } from './lib/ai-analytics';
// PHASE 5.3: Adaptive AI User Profile
import {
  AISignal,
  AIUserProfile,
  getAIUserProfile,
  updateUserProfileFromSignals,
  buildAdaptationPromptSnippet,
} from './lib/aiUserProfile';
// AI FALLBACK: Automatic provider failover chain
import {
  runWithFallback,
  sortProvidersForFallback,
  AllProvidersFailedError,
  PROVIDER_NAMES,
  logProviderAttempt
} from './lib/ai-fallback';
// UNIFIED PROVIDER SELECTION: Single source of truth for provider selection
import { selectProvider as unifiedSelectProvider } from './lib/select-provider';
// TASK 1: Provider health caching to reduce DB reads
// P0 FIX 2025-12-04: Import ProviderFetchError to distinguish fetch failures from "no providers"
import { getProvidersWithCache, invalidateProviderCache, ProviderFetchError } from './lib/provider-cache';
// PHASE 3: Non-AI fallback for Mission Control
import {
  buildMissionControlContext,
  buildBasicMissionControlPlan,
  formatBasicPlanAsText,
  MissionControlContext,
  BasicMissionControlPlan
} from './lib/mission-control-fallback';
// PHASE 1 2025-12-08: Invariant validation for AI responses
import {
  validateAIResponse,
  trackInvariantViolation
} from './lib/invariant-validator';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PERFORMANCE: Global cache for pipeline analysis (persists between function invocations)
const pipelineAnalysisCache = new Map<string, {
  analysis: any;
  dealsHash: string;
  timestamp: number;
}>();

// LEARNING ENGINE: Cache for performance metrics (refreshed every 5 minutes)
const performanceMetricsCache = new Map<string, {
  metrics: any;
  timestamp: number;
}>();

// Fetch performance metrics for AI context (Learning Engine v1)
async function getPerformanceContext(organizationId: string, userId: string): Promise<any> {
  const cacheKey = `${organizationId}:${userId}`;
  const cached = performanceMetricsCache.get(cacheKey);

  // Return cached if fresh (< 5 minutes)
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return cached.metrics;
  }

  try {
    // Fetch org-wide metrics
    const { data: orgMetrics } = await supabase
      .from('performance_metrics')
      .select('*')
      .eq('organization_id', organizationId)
      .is('user_id', null)
      .is('stage', null)
      .eq('period', 'last_90_days')
      .maybeSingle();

    // Fetch user-specific metrics
    const { data: userMetrics } = await supabase
      .from('performance_metrics')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .is('stage', null)
      .eq('period', 'last_90_days')
      .maybeSingle();

    // Fetch per-stage metrics
    const { data: stageMetrics } = await supabase
      .from('performance_metrics')
      .select('*')
      .eq('organization_id', organizationId)
      .is('user_id', null)
      .not('stage', 'is', null)
      .eq('period', 'last_90_days');

    // Build performance context
    const performanceContext = {
      orgWinRate: orgMetrics?.win_rate ? (orgMetrics.win_rate * 100).toFixed(1) : null,
      orgAvgDaysToClose: orgMetrics?.avg_days_to_close || null,
      userWinRate: userMetrics?.win_rate ? (userMetrics.win_rate * 100).toFixed(1) : null,
      userAvgDaysToClose: userMetrics?.avg_days_to_close || null,
      stageStats: {} as { [stage: string]: { winRate: string | null; avgDays: number | null } }
    };

    // Add stage-specific stats
    if (stageMetrics && stageMetrics.length > 0) {
      stageMetrics.forEach(s => {
        performanceContext.stageStats[s.stage] = {
          winRate: s.win_rate ? (s.win_rate * 100).toFixed(1) : null,
          avgDays: s.avg_days_in_stage || null
        };
      });
    }

    // Cache the results
    performanceMetricsCache.set(cacheKey, {
      metrics: performanceContext,
      timestamp: Date.now()
    });

    return performanceContext;
  } catch (error) {
    console.warn('[StageFlow][AI][WARN] Error fetching performance metrics (non-fatal):', error);
    return null;
  }
}

// Hash deals array to detect changes
function hashDeals(deals: any[]): string {
  // Create signature from deal IDs, stages, values, and last_activity timestamps
  const dealSignature = deals
    .map(d => `${d.id}:${d.stage}:${d.value || 0}:${d.last_activity || d.updated_at || ''}`)
    .sort() // Sort for consistent hashing
    .join('|');

  // Use Buffer to create a simple hash
  return Buffer.from(dealSignature).toString('base64').slice(0, 32);
}

// Get cached pipeline analysis if valid
function getCachedPipelineAnalysis(organizationId: string, deals: any[]): any | null {
  const cached = pipelineAnalysisCache.get(organizationId);

  if (!cached) return null;

  // Cache expires after 5 minutes
  if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
    pipelineAnalysisCache.delete(organizationId);
    return null;
  }

  // Check if deals have changed
  const currentHash = hashDeals(deals);
  if (cached.dealsHash !== currentHash) {
    return null;
  }

  return cached.analysis;
}

// Cache pipeline analysis for future requests
function setCachedPipelineAnalysis(organizationId: string, deals: any[], analysis: any): void {
  pipelineAnalysisCache.set(organizationId, {
    analysis,
    dealsHash: hashDeals(deals),
    timestamp: Date.now()
  });

  // Limit cache size to 100 organizations (prevent memory leak)
  if (pipelineAnalysisCache.size > 100) {
    const firstKey = pipelineAnalysisCache.keys().next().value;
    pipelineAnalysisCache.delete(firstKey);
  }
}

// Get all active AI providers for organization
// TASK 1: Now uses 60s cache to reduce DB reads
// FIX 2025-12-02: Sort by created_at ASCENDING (first connected = first tried)
async function getActiveProviders(organizationId: string): Promise<any[]> {
  // Use cached providers (60s TTL) to avoid hitting DB on every AI call
  return await getProvidersWithCache(supabase, organizationId);
}

// Analyze deals and create RICH context for AI
function analyzeDealsPipeline(deals: any[]): any {
  const now = new Date();
  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum: number, d: any) => sum + Number(d.value || 0), 0);

  // Categorize deals by stage (with null safety)
  const byStage = deals.reduce((acc: any, deal: any) => {
    if (!deal || !deal.stage) return acc; // Skip malformed deals
    acc[deal.stage] = acc[deal.stage] || { count: 0, value: 0, deals: [] };
    acc[deal.stage].count++;
    acc[deal.stage].value += Number(deal.value || 0);
    acc[deal.stage].deals.push(deal);
    return acc;
  }, {});

  // Categorize by status
  const byStatus = deals.reduce((acc: any, deal: any) => {
    acc[deal.status] = acc[deal.status] || { count: 0, value: 0 };
    acc[deal.status].count++;
    acc[deal.status].value += Number(deal.value || 0);
    return acc;
  }, {});

  const avgDealValue = totalDeals > 0 ? totalValue / totalDeals : 0;

  // STAGNATION DETECTION - Using centralized thresholds from pipelineConfig
  const stagnantDeals = deals.filter((d: any) => {
    if (!d || d.status !== 'active' || !d.created && !d.created_at) return false;
    const created = new Date(d.created || d.created_at);
    if (isNaN(created.getTime())) return false; // Invalid date
    const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    const threshold = STAGNATION_THRESHOLDS[d.stage as keyof typeof STAGNATION_THRESHOLDS] || STAGNATION_THRESHOLDS.default;
    return daysSinceCreated > threshold;
  });

  // HIGH VALUE deals at risk
  const highValueAtRisk = stagnantDeals.filter(d => d.value > 10000);

  // Calculate stage durations
  // P1 FIX: Add null date validation to prevent NaN results
  const stageDurations = Object.entries(byStage).map(([stage, data]: [string, any]) => {
    let validDeals = 0;
    const totalAge = data.deals.reduce((sum: number, d: any) => {
      const dateStr = d.created || d.created_at;
      if (!dateStr) return sum; // P1 FIX: Skip deals without dates
      const created = new Date(dateStr);
      if (isNaN(created.getTime())) return sum; // P1 FIX: Skip invalid dates
      validDeals++;
      return sum + Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    const avgAge = validDeals > 0 ? totalAge / validDeals : 0; // P1 FIX: Prevent division by zero

    return { stage, avgAge: Math.round(avgAge), count: data.count };
  });

  // Win rate calculation
  const wonDeals = deals.filter(d => d.status === 'won');
  const lostDeals = deals.filter(d => d.status === 'lost');
  const winRate = (wonDeals.length + lostDeals.length) > 0
    ? wonDeals.length / (wonDeals.length + lostDeals.length)
    : 0;

  return {
    totalDeals,
    totalValue,
    byStage,
    byStatus,
    avgDealValue,
    stagnantDeals: stagnantDeals.length,
    stagnantDealsList: stagnantDeals.map(d => ({ client: d.client, stage: d.stage, value: d.value || 0, age: Math.floor((now.getTime() - new Date(d.created || d.created_at).getTime()) / (1000 * 60 * 60 * 24)) })),
    highValueAtRisk: highValueAtRisk.length,
    highValueAtRiskList: highValueAtRisk.map(d => ({ client: d.client, stage: d.stage, value: d.value || 0 })),
    stageDurations,
    winRate: (winRate * 100).toFixed(1),
    conversionOpportunity: stagnantDeals.length > 0 ? `${stagnantDeals.length} deals are stagnant and losing momentum` : 'Pipeline velocity is healthy'
  };
}

// ANALYTICS: Calculate revenue forecast
function calculateRevenueForecast(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const daysRemaining = daysInMonth - daysPassed;

  // Calculate current month revenue (won deals)
  const currentRevenue = deals
    .filter(d => {
      if (d.status !== 'won') return false;
      const wonDate = new Date(d.last_activity || d.updated_at || d.created);
      return wonDate >= monthStart && wonDate <= now;
    })
    .reduce((sum, d) => sum + Number(d.value || 0), 0);

  // Calculate pipeline value (active deals weighted by confidence)
  const pipelineValue = deals
    .filter(d => d.status === 'active')
    .reduce((sum, d) => {
      const value = Number(d.value || 0);
      const confidence = d.confidence || 30; // Default to 30% if no confidence
      return sum + (value * (confidence / 100));
    }, 0);

  // Calculate run rate
  const dailyRunRate = daysPassed > 0 ? currentRevenue / daysPassed : 0;
  const projectedFromRunRate = currentRevenue + (dailyRunRate * daysRemaining);

  // Conservative forecast (weighted average)
  const conservativeForecast = currentRevenue + (pipelineValue * 0.3);

  // Aggressive forecast
  const aggressiveForecast = currentRevenue + (pipelineValue * 0.7);

  // Best estimate (balanced)
  const bestEstimate = currentRevenue + (pipelineValue * 0.5);

  return [
    { category: 'Closed', value: Math.round(currentRevenue), color: '#10B981' },
    { category: 'Conservative', value: Math.round(conservativeForecast - currentRevenue), color: '#F59E0B' },
    { category: 'Best Case', value: Math.round(bestEstimate - currentRevenue), color: '#3B82F6' },
    { category: 'Aggressive', value: Math.round(aggressiveForecast - currentRevenue), color: '#8B5CF6' }
  ];
}

// ANALYTICS: Calculate ICP analysis
function calculateICPAnalysis(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const wonDeals = deals.filter(d => d.status === 'won');
  if (wonDeals.length === 0) {
    return [];
  }

  // Analyze deal sizes
  const dealSizes = wonDeals.map(d => Number(d.value || 0)).filter(v => v > 0);
  const avgDealSize = dealSizes.reduce((a, b) => a + b, 0) / dealSizes.length;

  // Group by deal size ranges
  const small = wonDeals.filter(d => Number(d.value || 0) < avgDealSize * 0.5).length;
  const medium = wonDeals.filter(d => {
    const val = Number(d.value || 0);
    return val >= avgDealSize * 0.5 && val <= avgDealSize * 1.5;
  }).length;
  const large = wonDeals.filter(d => Number(d.value || 0) > avgDealSize * 1.5).length;

  return [
    { segment: 'Small Deals', count: small, percentage: Math.round((small / wonDeals.length) * 100) },
    { segment: 'Medium Deals', count: medium, percentage: Math.round((medium / wonDeals.length) * 100) },
    { segment: 'Large Deals', count: large, percentage: Math.round((large / wonDeals.length) * 100) }
  ];
}

// ANALYTICS: Calculate velocity analysis
function calculateVelocityAnalysis(deals: any[]): any[] {
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();

  // Calculate average age by stage for active deals
  const stageVelocity: { [key: string]: { totalDays: number; count: number } } = {};

  deals.filter(d => d.status === 'active').forEach(deal => {
    const created = new Date(deal.created || deal.created_at);
    const age = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

    if (!stageVelocity[deal.stage]) {
      stageVelocity[deal.stage] = { totalDays: 0, count: 0 };
    }
    stageVelocity[deal.stage].totalDays += age;
    stageVelocity[deal.stage].count++;
  });

  // Calculate average and format for chart
  return Object.keys(stageVelocity).map(stage => ({
    stage: stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    avgDays: Math.round(stageVelocity[stage].totalDays / stageVelocity[stage].count),
    count: stageVelocity[stage].count
  })).sort((a, b) => b.avgDays - a.avgDays).slice(0, 6); // Top 6 slowest stages
}

// ANALYTICS: Calculate weekly trends for chart visualization
function calculateWeeklyTrends(deals: any[]): any[] {
  // CRITICAL FIX: Handle empty deals array (new users with 0 deals)
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();
  const weeks = [];

  // Generate last 4 weeks
  for (let i = 3; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7 + 7));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekLabel = `Week ${4 - i}`;

    // Count deals added, closed, lost in this week
    const added = deals.filter(d => {
      const created = new Date(d.created || d.created_at);
      return created >= weekStart && created < weekEnd;
    }).length;

    const closed = deals.filter(d => {
      if (d.status !== 'won') return false;
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= weekStart && lastActivity < weekEnd;
    }).length;

    const lost = deals.filter(d => {
      if (d.status !== 'lost') return false;
      const lastActivity = new Date(d.last_activity || d.updated_at || d.created);
      return lastActivity >= weekStart && lastActivity < weekEnd;
    }).length;

    weeks.push({
      week: weekLabel,
      added,
      closed,
      lost
    });
  }

  return weeks;
}

// ANALYTICS: Calculate pipeline flow by stage
function calculatePipelineFlow(deals: any[]): any[] {
  // CRITICAL FIX: Handle empty deals array (new users with 0 deals)
  if (!deals || deals.length === 0) {
    return [];
  }

  const stageOrder = [
    'lead',
    'lead_captured',
    'contacted',
    'discovery',
    'proposal_sent',
    'negotiation',
    'verbal_commit',
    'contract_sent'
  ];

  const stageNames: { [key: string]: string } = {
    'lead': 'Lead',
    'lead_captured': 'Captured',
    'contacted': 'Contacted',
    'discovery': 'Discovery',
    'proposal_sent': 'Proposal',
    'negotiation': 'Negotiation',
    'verbal_commit': 'Verbal Commit',
    'contract_sent': 'Contract Sent'
  };

  // Count active deals and value by stage
  const activeDeals = deals.filter(d => d.status === 'active');

  const byStage = activeDeals.reduce((acc: any, deal: any) => {
    const stage = deal.stage || 'lead';
    if (!acc[stage]) {
      acc[stage] = { count: 0, value: 0 };
    }
    acc[stage].count++;
    acc[stage].value += Number(deal.value || 0);
    return acc;
  }, {});

  // Build flow data in stage order
  return stageOrder
    .filter(stage => byStage[stage]) // Only include stages with deals
    .map(stage => ({
      stage: stageNames[stage] || stage,
      count: byStage[stage].count,
      value: byStage[stage].value
    }));
}

// ANALYTICS: Calculate goal progress
async function calculateGoalProgress(deals: any[], organizationId: string, supabase: any): Promise<any[]> {
  // CRITICAL FIX: Handle empty deals array (new users with 0 deals)
  if (!deals || deals.length === 0) {
    return [];
  }

  try {
    // Get ALL revenue targets from user_targets
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM

    const { data: targets, error: targetError } = await supabase
      .from('user_targets')
      .select('monthly_revenue_target, quarterly_revenue_target, annual_revenue_target')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle(); // Use maybeSingle() to handle cases where no targets exist

    // If there's an error or no targets, return empty array
    if (targetError || !targets) {
      console.log('No user targets found for organization:', organizationId);
      return [];
    }

    const monthlyTarget = targets?.monthly_revenue_target || 0;
    const quarterlyTarget = targets?.quarterly_revenue_target || 0;
    const annualTarget = targets?.annual_revenue_target || 0;

    // Calculate current month revenue (won deals this month)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= monthStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    // Calculate current quarter revenue (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec)
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
    const quarterRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= quarterStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    // Calculate year-to-date revenue
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearRevenue = deals
      .filter(d => {
        if (d.status !== 'won') return false;
        const wonDate = new Date(d.last_activity || d.updated_at || d.created);
        return wonDate >= yearStart;
      })
      .reduce((sum, d) => sum + Number(d.value || 0), 0);

    const results = [];

    // Only include goals that are set (non-zero)
    if (monthlyTarget > 0) {
      results.push({
        period: 'Monthly',
        current: monthRevenue,
        target: monthlyTarget,
        percentage: Math.round((monthRevenue / monthlyTarget) * 100)
      });
    }

    if (quarterlyTarget > 0) {
      results.push({
        period: 'Quarterly',
        current: quarterRevenue,
        target: quarterlyTarget,
        percentage: Math.round((quarterRevenue / quarterlyTarget) * 100)
      });
    }

    if (annualTarget > 0) {
      results.push({
        period: 'Annual',
        current: yearRevenue,
        target: annualTarget,
        percentage: Math.round((yearRevenue / annualTarget) * 100)
      });
    }

    // If no targets are set, return empty array (user needs to set targets)
    return results;
  } catch (error) {
    console.error('Error calculating goal progress:', error);
    // Return empty array on error
    return [];
  }
}

// ANALYTICS: Calculate at-risk deals by severity
function calculateAtRiskDeals(deals: any[]): any[] {
  // CRITICAL FIX: Handle empty deals array (new users with 0 deals)
  if (!deals || deals.length === 0) {
    return [];
  }

  const now = new Date();

  // Using centralized thresholds from pipelineConfig
  const activeDeals = deals.filter(d => d.status === 'active');

  const atRisk = activeDeals.map(d => {
    const created = new Date(d.created || d.created_at);
    const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    const threshold = STAGNATION_THRESHOLDS[d.stage as keyof typeof STAGNATION_THRESHOLDS] || STAGNATION_THRESHOLDS.default;
    const daysOverdue = daysSinceCreated - threshold;

    return {
      ...d,
      daysSinceCreated,
      daysOverdue
    };
  }).filter(d => d.daysOverdue > 0);

  // Categorize by severity
  const critical = atRisk.filter(d => d.daysOverdue > 14); // Over 2 weeks overdue
  const warning = atRisk.filter(d => d.daysOverdue > 7 && d.daysOverdue <= 14); // 1-2 weeks overdue
  const attention = atRisk.filter(d => d.daysOverdue <= 7); // Up to 1 week overdue

  return [
    {
      category: 'Critical',
      count: critical.length,
      value: critical.reduce((sum, d) => sum + Number(d.value || 0), 0)
    },
    {
      category: 'Warning',
      count: warning.length,
      value: warning.reduce((sum, d) => sum + Number(d.value || 0), 0)
    },
    {
      category: 'Attention',
      count: attention.length,
      value: attention.reduce((sum, d) => sum + Number(d.value || 0), 0)
    }
  ];
}

// Call OpenAI/GPT
async function callOpenAI(apiKey: string, message: string, context: any, modelName?: string, conversationHistory: any[] = []): Promise<any> {
  // Build messages array with system prompt, conversation history, then current message
  // PHASE 5.1: Updated to Advisor persona with StageFlow philosophy
  const messages = [
    {
      role: 'system',
      content: `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. You provide clear, supportive guidance focused on building relationships and maintaining healthy deal momentum.

**YOUR CORE VALUES:**
- Partnership over transaction
- Professionalism over pressure
- Momentum over manipulation
- Relationship development over pure follow-up
- Ethical long-term success over short-term extraction
- Confidence, clarity, and craft

**FORBIDDEN LANGUAGE (NEVER USE):**
- Money-hungry phrases ("immediate money", "quick cash", "easy revenue")
- Hard-selling verbs ("push", "close now", "hammer", "pressure", "force")
- Shaming or guilt tactics
- Overly remedial "training wheel" language
- Salesy framing or manipulation tactics

**Current Pipeline Context:**
${JSON.stringify(context, null, 2)}

**Your Expertise:**
- Momentum Detection: Deals naturally have rhythms - help maintain healthy progression
- Relationship Prioritization: High-value partnerships deserve thoughtful attention
- Pattern Recognition: Win rate is ${context.winRate}% - identify what's working well
- Stage Awareness: Understand natural timelines for each stage

**LEARNING ENGINE - Historical Performance:**
${context.historicalPerformance ? `
- Organization Win Rate (90d): ${context.historicalPerformance.orgWinRate || 'Not yet calculated'}%
- Your Win Rate (90d): ${context.historicalPerformance.userWinRate || 'Not yet calculated'}%
- Avg Days to Close: ${context.historicalPerformance.avgDaysToClose || 'N/A'}
- This data helps personalize your guidance without being mentioned explicitly.
` : '- Historical metrics building. Using industry benchmarks.'}

**RESPONSE FORMAT:**
1. Clean, readable text - NO markdown syntax (##, ***, ---, etc.)
2. Use plain text emphasis (CAPS for key items)
3. Simple bullet points (•) or numbered lists
4. Professional, supportive tone
5. Brief responses - max 3-4 sentences when charts are shown
6. Reference charts instead of listing data

**RESPONSE GUIDELINES:**
1. Be SPECIFIC - name deals, stages, and values
2. Be SUPPORTIVE - offer constructive guidance, not pressure
3. BE CONCISE - charts show data, you provide insights
4. BE ENCOURAGING - celebrate progress and momentum
5. SUGGEST, don't demand - "Consider..." not "You must..."

**Momentum Awareness:**
${context.stagnantDeals > 0 ? `${context.stagnantDeals} deals may benefit from attention:\n${context.stagnantDealsList.map((d: any) => `• ${d.client}: $${(d.value || 0).toLocaleString()} in ${d.stage} (${d.age} days)`).join('\n')}` : '✓ Pipeline momentum looks healthy'}

${context.highValueAtRisk > 0 ? `\nHigh-value opportunities to nurture:\n${context.highValueAtRiskList.map((d: any) => `• ${d.client}: $${(d.value || 0).toLocaleString()} in ${d.stage}`).join('\n')}` : ''}
${context.visualInstructions || ''}
${context.adaptationSnippet || ''}
${context.taskMode === 'planning' ? `
**PLAN MY DAY MODE - FOLLOW THESE INSTRUCTIONS EXACTLY:**
Create a personalized daily action plan with these 4 sections:

SECTION 1: Closest to Close (20-30 min focus)
Review deals nearest to decision points. Focus on momentum - what's the next concrete step?

SECTION 2: Momentum Builders (45-60 min focus)
Identify newly added leads and deals needing movement. Focus on deals with activity potential.

SECTION 3: Relationship Development Touchpoints (10-20 min focus)
Surface existing customers due for check-in and long-tail relationships worth nurturing.

SECTION 4: Personal Workflow Insights (Conditional)
Share ONE brief insight about the user's work patterns based on their deal history.

End each section with a helpful question like "Want help with the next step?"
` : ''}
Focus on sustainable momentum and genuine relationship development.`
    }
  ];

  // Add conversation history (exclude provider metadata, only role and content)
  conversationHistory.forEach((msg: any) => {
    if (msg.role && msg.content) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }
  });

  // Add current user message
  messages.push({
    role: 'user',
    content: message
  });

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Pre-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'openai',
    model: modelName || 'gpt-4o',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyLength: apiKey?.length ?? 0,
    apiKeyPrefix: apiKey?.substring(0, 7) + '***', // "sk-proj" or "sk-..." prefix
    messageCount: messages.length,
    phase: 'CALLING'
  });

  const response = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'gpt-4o', // Use database model, fallback to gpt-4o
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'OpenAI API call'
  );

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Post-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'openai',
    model: modelName || 'gpt-4o',
    httpStatus: response.status,
    httpOk: response.ok,
    phase: 'RESPONSE_RECEIVED'
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[StageFlow][AI][PROVIDER_CALL][ERROR]", {
      provider: 'openai',
      httpStatus: response.status,
      errorBody: errorText?.substring(0, 200)
    });
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  // NULL CHECK: Validate response structure
  if (!data?.choices?.[0]?.message?.content) {
    throw new Error('OpenAI returned invalid response structure');
  }

  return {
    response: data.choices[0].message.content,
    provider: 'ChatGPT'
  };
}

// Call Anthropic/Claude
// PHASE 5.1: Updated to Advisor persona with StageFlow philosophy
async function callAnthropic(apiKey: string, message: string, context: any, modelName?: string, conversationHistory: any[] = []): Promise<any> {
  const systemPrompt = `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. You provide clear, supportive guidance focused on building relationships and maintaining healthy deal momentum.

**YOUR CORE VALUES:**
- Partnership over transaction
- Professionalism over pressure
- Momentum over manipulation
- Relationship development over pure follow-up
- Ethical long-term success over short-term extraction
- Confidence, clarity, and craft

**FORBIDDEN LANGUAGE (NEVER USE):**
- Money-hungry phrases ("immediate money", "quick cash", "easy revenue")
- Hard-selling verbs ("push", "close now", "hammer", "pressure", "force")
- Shaming or guilt tactics
- Overly remedial "training wheel" language
- Salesy framing or manipulation tactics

**Current Pipeline Context:**
${JSON.stringify(context, null, 2)}

**Your Expertise:**
- Momentum Detection: Deals naturally have rhythms - help maintain healthy progression
- Relationship Prioritization: High-value partnerships deserve thoughtful attention
- Pattern Recognition: Win rate is ${context.winRate}% - identify what's working well
- Stage Awareness: Understand natural timelines for each stage

**LEARNING ENGINE - Historical Performance:**
${context.historicalPerformance ? `
- Organization Win Rate (90d): ${context.historicalPerformance.orgWinRate || 'Not yet calculated'}%
- Your Win Rate (90d): ${context.historicalPerformance.userWinRate || 'Not yet calculated'}%
- Avg Days to Close: ${context.historicalPerformance.avgDaysToClose || 'N/A'}
- This data helps personalize your guidance without being mentioned explicitly.
` : '- Historical metrics building. Using industry benchmarks.'}

**RESPONSE FORMAT:**
1. Clean, readable text - NO markdown syntax (##, ***, ---, etc.)
2. Use plain text emphasis (CAPS for key items)
3. Simple bullet points (•) or numbered lists
4. Professional, supportive tone
5. Brief responses - max 3-4 sentences when charts are shown
6. Reference charts instead of listing data

**RESPONSE GUIDELINES:**
1. Be SPECIFIC - name deals, stages, and values
2. Be SUPPORTIVE - offer constructive guidance, not pressure
3. BE CONCISE - charts show data, you provide insights
4. BE ENCOURAGING - celebrate progress and momentum
5. SUGGEST, don't demand - "Consider..." not "You must..."

**Momentum Awareness:**
${context.stagnantDeals > 0 ? `${context.stagnantDeals} deals may benefit from attention:\n${context.stagnantDealsList.map((d: any) => `• ${d.client}: $${(d.value || 0).toLocaleString()} in ${d.stage} (${d.age} days)`).join('\n')}` : '✓ Pipeline momentum looks healthy'}

${context.highValueAtRisk > 0 ? `\nHigh-value opportunities to nurture:\n${context.highValueAtRiskList.map((d: any) => `• ${d.client}: $${(d.value || 0).toLocaleString()} in ${d.stage}`).join('\n')}` : ''}
${context.visualInstructions || ''}
${context.adaptationSnippet || ''}
Focus on sustainable momentum and genuine relationship development.`;

  // Build messages array with conversation history
  const messages: any[] = [];

  // If no conversation history, start with user message that includes context
  if (conversationHistory.length === 0) {
    messages.push({
      role: 'user',
      content: message
    });
  } else {
    // Add conversation history
    conversationHistory.forEach((msg: any) => {
      if (msg.role && msg.content) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });

    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });
  }

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Pre-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'anthropic',
    model: modelName || 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKeyLength: apiKey?.length ?? 0,
    apiKeyPrefix: apiKey?.substring(0, 7) + '***', // "sk-ant-" prefix
    messageCount: messages.length,
    phase: 'CALLING'
  });

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2024-01-01'
      },
      body: JSON.stringify({
        model: modelName || 'claude-3-5-sonnet-20241022', // Use database model, fallback to sonnet
        max_tokens: 500,
        system: systemPrompt,
        messages: messages
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Anthropic API call'
  );

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Post-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'anthropic',
    model: modelName || 'claude-3-5-sonnet-20241022',
    httpStatus: response.status,
    httpOk: response.ok,
    phase: 'RESPONSE_RECEIVED'
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[StageFlow][AI][PROVIDER_CALL][ERROR]", {
      provider: 'anthropic',
      httpStatus: response.status,
      errorBody: errorText?.substring(0, 200)
    });
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  // NULL CHECK: Validate response structure
  if (!data?.content?.[0]?.text) {
    throw new Error('Anthropic returned invalid response structure');
  }

  return {
    response: data.content[0].text,
    provider: 'Claude'
  };
}

// Call Google Gemini
// PHASE 5.1: Updated to Advisor persona with StageFlow philosophy
async function callGemini(apiKey: string, message: string, context: any, modelName?: string, conversationHistory: any[] = []): Promise<any> {
  const model = modelName || 'gemini-1.5-pro'; // Use database model, fallback to gemini-1.5-pro

  const systemPrompt = `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform.

**YOUR CORE VALUES:**
- Partnership over transaction
- Professionalism over pressure
- Momentum over manipulation
- Relationship development over pure follow-up

**FORBIDDEN LANGUAGE:** Never use money-hungry phrases, hard-selling verbs (push, hammer, pressure), shaming tactics, or salesy framing.

**Pipeline Context:** ${JSON.stringify(context, null, 2)}

**Stage Benchmarks (Natural Rhythms):**
- Early stages: 7-10 days typical
- Discovery: 14 days typical
- Negotiation: 21 days typical

**RESPONSE FORMAT:**
- Clean text - NO markdown syntax (##, ***, ---)
- Plain text emphasis (CAPS for key items)
- Simple bullet points (•) or numbered lists
- Brief responses - max 3-4 sentences when charts shown
- Professional, supportive tone

**Momentum Awareness:**
${context.stagnantDeals > 0 ? `${context.stagnantDeals} deals may benefit from attention:\n${context.stagnantDealsList.map((d: any) => `${d.client}: $${(d.value || 0).toLocaleString()} (${d.age}d in ${d.stage})`).join('\n')}` : '✓ Healthy momentum'}
${context.visualInstructions || ''}
${context.adaptationSnippet || ''}
**Your Role:** Provide supportive, specific guidance. Name deals and values. Keep it brief - charts show data. Suggest constructive next steps.`;

  // Build contents array for Gemini API
  const contents: any[] = [];

  // If no conversation history, combine system prompt with user message
  if (conversationHistory.length === 0) {
    contents.push({
      parts: [{
        text: `${systemPrompt}\n\nUser asks: ${message}`
      }]
    });
  } else {
    // Add system prompt as first user message
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });

    // Add conversation history (convert role format)
    conversationHistory.forEach((msg: any) => {
      if (msg.role && msg.content) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    });

    // Add current user message
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });
  }

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Pre-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'google',
    model: model,
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    apiKeyLength: apiKey?.length ?? 0,
    apiKeyPrefix: apiKey?.substring(0, 4) + '***', // "AIza" prefix
    contentsCount: contents.length,
    phase: 'CALLING'
  });

  const response = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: contents
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Gemini API call'
  );

  // ============================================================================
  // [StageFlow][AI][PROVIDER_CALL] Post-call diagnostic
  // ============================================================================
  console.log("[StageFlow][AI][PROVIDER_CALL]", {
    provider: 'google',
    model: model,
    httpStatus: response.status,
    httpOk: response.ok,
    phase: 'RESPONSE_RECEIVED'
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[StageFlow][AI][PROVIDER_CALL][ERROR]", {
      provider: 'google',
      httpStatus: response.status,
      errorBody: errorText?.substring(0, 200)
    });
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  // NULL CHECK: Validate response structure
  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Gemini returned invalid response structure');
  }

  return {
    response: data.candidates[0].content.parts[0].text,
    provider: 'Gemini'
  };
}


// Model tier definitions (premium = 3, standard = 2, economy = 1)
// FIX 2025-12-04: Removed xAI/Grok models - deprecated provider
const MODEL_TIERS: { [key: string]: number } = {
  // OpenAI Premium
  'gpt-5': 3,
  'gpt-5-mini': 2,
  'gpt-4.1': 2,
  'gpt-4.1-mini': 1,
  'gpt-4o-mini': 1,
  'gpt-4o': 1,

  // Anthropic Premium
  'claude-sonnet-4-5-20250929': 3,
  'claude-opus-4-1-20250805': 3,
  'claude-sonnet-3-7-20250219': 2,
  'claude-haiku-4-5-20251001': 1,
  'claude-3-5-sonnet-20241022': 2,

  // Google Premium
  'gemini-2.5-pro': 3,
  'gemini-2.5-flash': 2,
  'gemini-2.5-flash-lite': 1,
  'gemini-1.5-pro': 2
};

// PHASE 18: Task-specific model preferences (ENHANCED)
// Higher score = better fit for the task type
// Priority: ChatGPT for RevOps, Claude for coaching, Gemini for visuals
// FIX 2025-12-04: Removed xAI/Grok - deprecated provider
const TASK_MODEL_AFFINITY: { [taskType: string]: { [providerType: string]: number } } = {
  // Chart insights - ChatGPT excels at structured data, Gemini for visualization
  'chart_insight': {
    'openai': 4,      // GPT excels at structured data analysis - PRIMARY
    'google': 3,      // Gemini strong for analytics
    'anthropic': 2    // Claude is capable
  },
  // Coaching needs long-form reasoning and empathy - Claude is BEST
  'coaching': {
    'anthropic': 5,   // Claude excels at nuanced, helpful responses - PRIMARY
    'openai': 3,      // GPT is good but more clinical
    'google': 2       // Gemini is capable
  },
  // Text analysis / RevOps - ChatGPT is the best all-arounder
  'text_analysis': {
    'openai': 4,      // GPT best for structured RevOps analysis - PRIMARY
    'anthropic': 3,   // Claude strong second
    'google': 2
  },
  // Image suitable - Gemini excels at visual content
  'image_suitable': {
    'google': 5,      // Gemini strong for visuals - PRIMARY
    'openai': 3,      // GPT can describe visuals
    'anthropic': 2    // Claude as text fallback
  },
  // Planning tasks (Plan My Day, etc.) - ChatGPT excels
  'planning': {
    'openai': 5,      // GPT best for multi-step guidance - PRIMARY
    'anthropic': 4,   // Claude strong for planning
    'google': 2       // Gemini capable
  },
  // General Q&A - ChatGPT as default brain
  'general': {
    'openai': 4,      // GPT best all-arounder - PRIMARY
    'anthropic': 3,   // Claude strong second
    'google': 2       // Gemini capable
  }
};

// Determine the tier of a model (3=premium, 2=standard, 1=economy, 0=unknown)
function getModelTier(modelName: string | null): number {
  if (!modelName) return 0;
  return MODEL_TIERS[modelName] || 0;
}

// PHASE 18 / QA FIX: Provider selection now uses unified selectProvider from lib/select-provider.ts
// This ensures consistent provider selection logic across all AI endpoints.
// See lib/select-provider.ts for the canonical task-affinity scoring algorithm.
function selectBestProvider(providers: any[], taskType: TaskType | string = 'text_analysis'): any {
  // Delegate to the unified provider selection module
  return unifiedSelectProvider(providers, taskType);
}

// PHASE 3: Build visual spec instructions for image-suitable or chart tasks
function buildVisualSpecInstructions(taskType: TaskType): string {
  if (taskType === 'image_suitable') {
    return `

**VISUAL OUTPUT GUIDANCE:**
When recommending visuals or presentation-ready content, structure your response to include:
VISUAL_SPEC: { "layout": "single_slide|multi_panel|infographic", "elements": ["headline", "key_metric", "chart_reference"], "headline": "...", "subtext": "..." }
This helps the frontend render visual summaries. The user can then use this spec to create slides or graphics.`;
  }

  if (taskType === 'chart_insight') {
    return `

**CHART CONTEXT:**
A chart visualization will be displayed alongside your response. Keep your text brief and reference the chart for data details. Focus on insights and recommended actions rather than listing numbers.`;
  }

  return '';
}

// Route to appropriate AI provider
async function callAIProvider(provider: any, message: string, context: any, conversationHistory: any[] = [], taskType: TaskType = 'text_analysis'): Promise<any> {
  // DIAGNOSTIC LOG A: Provider selection metadata (no secrets)
  const encryptedKey = provider.api_key_encrypted || '';
  console.log('[AI][ProviderSelect]', {
    providerType: provider.provider_type,
    model: provider.model,
    hasEncryptedKey: !!encryptedKey,
    encryptedKeyLength: encryptedKey.length,
    encryptedKeyFormat: encryptedKey.split(':').length === 3 ? 'GCM' :
                        encryptedKey.split(':').length === 2 ? 'CBC' : 'UNKNOWN'
  });

  // Support both GCM (new) and CBC (legacy) encryption formats
  let apiKey: string;
  let decryptError: Error | null = null;
  try {
    if (isLegacyEncryption(provider.api_key_encrypted)) {
      apiKey = decryptLegacy(provider.api_key_encrypted);
    } else {
      apiKey = decrypt(provider.api_key_encrypted);
    }

    // DIAGNOSTIC LOG B: Decryption result metadata (no actual key!)
    console.log('[AI][KeyDecrypt]', {
      providerType: provider.provider_type,
      model: provider.model,
      decryptedKeyLength: apiKey ? apiKey.length : null,
      decryptedKeyPrefix: apiKey ? apiKey.substring(0, 3) + '***' : null, // Only first 3 chars for format validation
      decryptError: null
    });

    // P0 FIX: Validate decrypted API key before use
    // Empty or too-short keys indicate decryption issues or corrupted data
    if (!apiKey || apiKey.length < 10) {
      console.error('[AI][KeyDecrypt] API key validation failed:', {
        keyPresent: !!apiKey,
        keyLength: apiKey?.length || 0,
        provider: provider.provider_type
      });
      throw new Error('Decrypted API key is invalid. Please re-save your AI provider configuration.');
    }

    // P0 FIX: Validate API key format per provider (basic sanity checks)
    const keyFormat = {
      openai: apiKey.startsWith('sk-'),
      anthropic: apiKey.startsWith('sk-ant-'),
      google: apiKey.length >= 20 // Gemini keys don't have consistent prefix
    };

    if (provider.provider_type === 'openai' && !keyFormat.openai) {
      console.warn('[AI][KeyDecrypt] OpenAI key format unexpected - proceeding but may fail');
    }
    if (provider.provider_type === 'anthropic' && !keyFormat.anthropic) {
      console.warn('[AI][KeyDecrypt] Anthropic key format unexpected - proceeding but may fail');
    }
  } catch (error: any) {
    decryptError = error;
    // DIAGNOSTIC LOG B: Decryption failure metadata
    console.log('[AI][KeyDecrypt]', {
      providerType: provider.provider_type,
      model: provider.model,
      decryptedKeyLength: null,
      decryptedKeyPrefix: null,
      decryptError: error?.name || error?.message?.substring(0, 50)
    });
    console.error('Failed to decrypt API key:', error);
    throw new Error('Invalid API key encryption. Please re-save your AI provider configuration.');
  }

  const modelName = provider.model; // Get model from database

  // PHASE 3: Enrich context with visual spec instructions based on task type
  const visualInstructions = buildVisualSpecInstructions(taskType);
  const enrichedContext = {
    ...context,
    visualInstructions, // Added to context for prompt building
    taskMode: taskType // STRUCTURAL FIX P1: Pass task mode for Plan My Day injection
  };

  // FIX 2025-12-04: Only 3 providers supported (OpenAI, Anthropic, Google)
  switch (provider.provider_type) {
    case 'openai':
      return await callOpenAI(apiKey, message, enrichedContext, modelName, conversationHistory);

    case 'anthropic':
      return await callAnthropic(apiKey, message, enrichedContext, modelName, conversationHistory);

    case 'google':
      return await callGemini(apiKey, message, enrichedContext, modelName, conversationHistory);

    default:
      throw new Error(`Unsupported AI provider: ${provider.provider_type}`);
  }
}

export default async (req: Request, context: any) => {
  // PHASE 8 FIX 2025-12-03: Add CORS headers for Authorization support
  // P0 FIX 2025-12-08: Added all Netlify deploy origins to prevent CORS errors
  // ENGINE REBUILD Phase 5: Use centralized CORS config
  const origin = req.headers.get('origin') || '';
  const corsHeaders = buildCorsHeaders(origin, { methods: 'POST, OPTIONS' });

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Phase 1 Telemetry: Build request context for tracing
  const telemetryCtx = buildRequestContext(req, 'ai-assistant');
  trackTelemetryEvent(TelemetryEvents.AI_CALL_START, telemetryCtx.correlationId, {
    endpoint: telemetryCtx.endpoint,
  });

  // Add correlation ID to response headers for end-to-end tracing
  (corsHeaders as Record<string, string>)['X-Correlation-ID'] = telemetryCtx.correlationId;

  // PHASE 3: Store deals at top level so it's accessible in catch block for fallback
  let requestDeals: any[] = [];
  // Phase 1 Telemetry: Track which provider was used
  let aiProviderUsed: string | null = null;

  try {
    // FIX_S2_B1: Track config health for response metadata
    const configHealthy = !!process.env.ENCRYPTION_KEY;

    // P0 FIX 2025-12-09: Early check for ENCRYPTION_KEY to give clear error
    // Without this key, ALL AI providers will fail because we can't decrypt stored API keys
    if (!process.env.ENCRYPTION_KEY) {
      console.error("[StageFlow][AI][CRITICAL] ENCRYPTION_KEY not set - AI providers cannot decrypt API keys");
      return new Response(JSON.stringify({
        ok: false,
        error: 'Server configuration error',
        code: AI_ERROR_CODES.CONFIG_ERROR,
        message: 'Server configuration error: Unable to access AI provider credentials. Please contact your administrator.',
        isConfigError: true, // Flag for frontend to show admin-specific message
        // Include details for debugging in development
        details: process.env.NODE_ENV !== 'production' ? 'ENCRYPTION_KEY environment variable not set' : undefined
      }), {
        status: 200, // Return 200 so frontend can parse the error JSON
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // DIAGNOSTICS 2025-12-04: Runtime environment health check
    const envProblems = verifyProviderEnvironment();
    if (envProblems.length > 0) {
      console.warn("[StageFlow][AI][CONFIG][WARN] Missing provider keys:", envProblems);
    }

    const body = await req.json() as any;
    const { message, deals = [], conversationHistory = [], preferredProvider, aiSignals = [], mode, healthCheckOnly } = body;

    // STRUCTURAL FIX P1: Detect explicit Plan My Day mode
    // This allows injecting Plan My Day instructions into system prompt
    // FIX 2025-12-09: Changed inferTaskType → determineTaskType (inferTaskType was undefined!)
    const taskMode = body.taskMode || determineTaskType(message);

    // PHASE 3: Store deals for catch block access
    requestDeals = deals;

    // STRUCTURAL FIX A1: Support health check requests
    // Return configHealthy without running full AI query
    if (healthCheckOnly) {
      return new Response(JSON.stringify({
        ok: true,
        configHealthy: !!process.env.ENCRYPTION_KEY,
        healthCheck: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // PHASE 3: Support "basic" mode for non-AI fallback
    // When mode=basic, skip AI providers entirely and return deterministic plan
    const isBasicMode = mode === 'basic';

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // MOBILE FIX: Detect and reject image data in message
    // Some mobile browsers/apps try to include base64 image data
    if (typeof message === 'string' && (
      message.includes('data:image/') ||
      message.includes('base64,') && message.length > 10000
    )) {
      return new Response(JSON.stringify({
        error: 'Image uploads not supported',
        response: 'Sorry, I cannot process images yet. Please describe your question in text.',
        suggestions: []
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Validate deals array
    if (!Array.isArray(deals)) {
      return new Response(JSON.stringify({
        error: 'Invalid deals data format',
        response: 'Unable to process your request due to invalid data. Please try again.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 2: Centralized auth for AI assistant
    const authHeader = req.headers.get('authorization');
    let user: any;
    let organizationId: string;

    // PHASE 11 LOGGING: Always use new auth for ai-assistant (feature flag hardcoded)
    console.warn('[ai-assistant] Starting auth - using cookie-based auth path');

    if (shouldUseNewAuth('ai-assistant')) {
      try {
        // NEW AUTH PATH: Use centralized auth middleware
        console.warn('[ai-assistant] Calling requireAuth...');
        user = await requireAuth(req);
        console.warn('[ai-assistant] requireAuth succeeded, user:', user.id);

        // PHASE 8 CRITICAL FIX: Don't call requireOrgAccess(req) because body is already consumed
        // Instead, query team_members directly like the legacy path does
        console.warn('[ai-assistant] Querying team_members for org...');
        const { data: membership, error: memberError } = await supabase
          .from('team_members')
          .select('organization_id')
          .eq('user_id', user.id)
          .single();

        if (memberError) {
          console.error('[ai-assistant] team_members query error:', memberError);
        }

        if (!membership) {
          console.error('[ai-assistant] No membership found for user:', user.id);
          return new Response(JSON.stringify({ error: 'No organization found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        organizationId = membership.organization_id;
        console.warn('[ai-assistant] Auth complete - userId:', user.id, 'orgId:', organizationId);
      } catch (authError: any) {
        console.error('[ai-assistant] Auth error:', {
          message: authError.message,
          code: authError.code,
          statusCode: authError.statusCode,
          name: authError.name
        });
        return createAuthErrorResponse(authError);
      }
    } else {
      // LEGACY AUTH PATH: Inline auth check
      const token = authHeader?.replace('Bearer ', '');

      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !authUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      user = authUser;

      // Get user's organization
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: membership } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        return new Response(JSON.stringify({ error: 'No organization found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      organizationId = membership.organization_id;
    }

    // =========================================================================
    // Phase 2 Rate Limiting: Check per-user, per-org rate limits
    // Area 7: Now plan-aware - limits vary based on subscription tier
    // This runs AFTER auth so we have userId and organizationId
    // =========================================================================

    // Area 7: Get org's plan for plan-aware rate limits
    const orgPlanId = await getOrgPlan(organizationId, { correlationId: telemetryCtx.correlationId });
    const planBuckets = getBucketsForPlan(orgPlanId);

    const isPlanMyDay = body?.operation === 'plan_my_day' || body?.prompt?.toLowerCase()?.includes('plan my day');
    const rateLimitBuckets = isPlanMyDay
      ? planBuckets.planMyDayWithGeneric
      : planBuckets.aiGeneric;

    // Org-wide bucket for Plan My Day (shared across all org users)
    const orgWideBuckets = isPlanMyDay ? ['ai.plan_my_day_org'] : [];

    const { allowed: rateLimitAllowed, exceededBucket } = await checkRateLimits(
      user.id,
      organizationId,
      rateLimitBuckets,
      orgWideBuckets
    );

    if (!rateLimitAllowed && exceededBucket) {
      console.warn('[ai-assistant][RateLimit] Request blocked', {
        correlationId: telemetryCtx.correlationId,
        userId: user.id,
        organizationId,
        planId: orgPlanId,
        bucket: exceededBucket.bucket,
        limit: exceededBucket.limit,
        remaining: exceededBucket.remaining,
      });

      trackTelemetryEvent('rate_limit_exceeded', telemetryCtx.correlationId, {
        bucket: exceededBucket.bucket,
        limit: exceededBucket.limit,
        isPlanMyDay,
        planId: orgPlanId,
      });

      const bucketConfig = rateLimitBuckets.find(b => b.bucket === exceededBucket.bucket) || rateLimitBuckets[0];
      // Area 7: Plan-aware message with upgrade suggestion for free tier
      const message = getPlanAwareRateLimitMessage(bucketConfig, orgPlanId);
      const retryAfter = exceededBucket.retryAfterSeconds || getRetryAfterSeconds(bucketConfig);

      return new Response(JSON.stringify({
        ok: false,
        success: false,
        code: ERROR_CODES.RATE_LIMITED,
        errorCode: 'RATE_LIMITED',
        message,
        retryable: true,
        retryAfterSeconds: retryAfter,
        planId: orgPlanId,
        rateLimit: {
          bucket: exceededBucket.bucket,
          limit: exceededBucket.limit,
          remaining: exceededBucket.remaining,
          windowSeconds: exceededBucket.windowSeconds,
        },
        // Area 7: Upgrade prompt for free users
        ...(orgPlanId === 'free' && { upgradePrompt: 'Upgrade to Startup for 5x higher limits' }),
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
          'Retry-After': String(retryAfter),
        },
      });
    }

    // CRITICAL: Check AI usage limits (revenue protection!)
    // FIX: Use 'plan' column (matches stripe-webhook.mts:156)
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('ai_requests_used_this_month, plan')
      .eq('id', organizationId)
      .single();

    if (orgError) {
      console.error('Failed to fetch organization data:', orgError);
    } else if (orgData) {
      // Define limits per plan (must match Stripe pricing structure)
      const AI_LIMITS: { [key: string]: number } = {
        'free': 100,
        'startup': 1000,
        'growth': 5000,
        'pro': -1  // Unlimited for Pro plan
      };

      const planTier = orgData.plan || 'free';  // FIX: Changed from plan_tier to plan
      const limit = AI_LIMITS[planTier] || AI_LIMITS['free'];
      const used = orgData.ai_requests_used_this_month || 0;

      // Block request if limit reached (not unlimited)
      if (limit > 0 && used >= limit) {
        return new Response(JSON.stringify({
          error: AI_ERROR_CODES.AI_LIMIT_REACHED,
          code: AI_ERROR_CODES.AI_LIMIT_REACHED,
          limitReached: true,
          used,
          limit,
          message: `You've reached your monthly limit of ${limit} AI requests. Upgrade your plan to continue using AI features.`,
          response: `You've reached your monthly limit of ${limit} AI requests. Upgrade your plan to continue using AI features.`,
          suggestions: []
        }), {
          status: 429, // Too Many Requests
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // PHASE 5.3: Fetch and update AI user profile from signals
    // This enables adaptive personalization based on user behavior
    let userProfile: AIUserProfile | null = null;
    try {
      // If signals are present, update profile; otherwise just fetch
      if (aiSignals && aiSignals.length > 0) {
        userProfile = await updateUserProfileFromSignals(
          supabase,
          user.id,
          organizationId,
          aiSignals as AISignal[]
        );
      } else {
        userProfile = await getAIUserProfile(supabase, user.id, organizationId);
      }
    } catch (profileError) {
      // Profile errors are non-fatal - continue with default behavior
      console.error('AI profile fetch/update error (non-fatal):', profileError);
    }

    // Get all active providers
    // P0 FIX 2025-12-04: Wrap in try/catch to distinguish "fetch failed" from "no providers"
    let providers: any[];
    try {
      providers = await getActiveProviders(organizationId);
    } catch (providerError) {
      // FIX_S2_A1: Provider fetch failed - return 200 with ok:false so frontend handles as data
      console.error('[StageFlow][AI][ERROR] Provider fetch failed:', providerError);
      return new Response(JSON.stringify({
        ok: false,
        error: AI_ERROR_CODES.PROVIDER_FETCH_ERROR,
        code: AI_ERROR_CODES.PROVIDER_FETCH_ERROR,
        message: 'Unable to load AI provider configuration. Please retry in a few moments.',
        retryable: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // FIX 2025-12-04: Only allow 3 providers (OpenAI, Anthropic, Google)
    const runtimeProviders = providers.filter(
      (p: any) => ['openai', 'anthropic', 'google'].includes(p.provider_type)
    );

    // PHASE 3: Build Mission Control context for both AI and fallback use
    // This is done early so we have context ready for fallback if AI fails
    const performanceContext = await getPerformanceContext(organizationId, user.id);

    // Fetch user's monthly target for RevOps goal tracking
    let monthlyTarget = 0;
    try {
      const { data: userTarget } = await supabase
        .from('user_targets')
        .select('monthly_target')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (userTarget?.monthly_target) {
        monthlyTarget = userTarget.monthly_target;
      } else {
        // Fallback to org target if no user target
        const { data: orgTarget } = await supabase
          .from('organization_targets')
          .select('monthly_target')
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (orgTarget?.monthly_target) {
          monthlyTarget = orgTarget.monthly_target;
        }
      }
    } catch (targetError) {
      console.warn('[ai-assistant] Failed to fetch monthly target (non-fatal):', targetError);
    }

    const missionControlContext = buildMissionControlContext(deals, performanceContext ? {
      userWinRate: performanceContext.userWinRate ? parseFloat(performanceContext.userWinRate) : undefined,
      avgDaysToClose: performanceContext.orgAvgDaysToClose
    } : null);

    // PHASE 3: Handle basic mode - return non-AI fallback plan
    // This is used when users click "No-AI / Safe Mode" button
    if (isBasicMode) {
      console.log('[ai-assistant] Basic mode requested - returning non-AI fallback');

      const basicPlan = buildBasicMissionControlPlan(missionControlContext, deals, monthlyTarget);
      const textResponse = formatBasicPlanAsText(basicPlan);

      return new Response(JSON.stringify({
        ok: true,
        mode: 'basic',
        response: textResponse,
        provider: 'StageFlow (No AI)',
        fallbackPlan: basicPlan,
        suggestions: ['Connect an AI provider for personalized insights'],
        timestamp: new Date().toISOString(),
        performanceContext: performanceContext ? {
          orgWinRate: performanceContext.orgWinRate,
          userWinRate: performanceContext.userWinRate,
          avgDaysToClose: performanceContext.orgAvgDaysToClose,
          highValueAtRisk: missionControlContext.highValueAtRisk.length
        } : null
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (runtimeProviders.length === 0) {
      // This is the REAL "no providers configured" case (empty list, no error)
      // PHASE 3: Include basic fallback plan so users still get value
      const basicPlan = buildBasicMissionControlPlan(missionControlContext, deals, monthlyTarget);

      return new Response(JSON.stringify({
        ok: false,
        error: AI_ERROR_CODES.NO_PROVIDERS,
        code: AI_ERROR_CODES.NO_PROVIDERS,
        message: 'No AI provider is connected. Go to Settings → AI Providers to connect ChatGPT, Claude, or Gemini.',
        response: "No AI provider is connected. Go to Settings → AI Providers to connect ChatGPT, Claude, or Gemini.",
        suggestions: [],
        // PHASE 3: Include fallback plan so users still get value
        fallbackPlan: basicPlan
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // PHASE 3: Determine task type for smart provider selection
    const taskType = determineTaskType(message);

    // Select provider: prefer specified, fallback to best available (highest tier + task affinity)
    // FIX 2025-12-04: Use runtimeProviders (xAI/Grok filtered out)
    let selectedProvider;
    if (preferredProvider) {
      const preferred = runtimeProviders.find((p: any) => p.provider_type === preferredProvider);
      selectedProvider = preferred || selectBestProvider(runtimeProviders, taskType);
    } else {
      // Auto-select best provider based on model tier AND task type affinity
      selectedProvider = selectBestProvider(runtimeProviders, taskType);
    }

    // Analyze pipeline with caching for performance (2-3x faster for repeat queries)
    const cachedAnalysis = getCachedPipelineAnalysis(organizationId, deals);
    const pipelineAnalysis = cachedAnalysis || analyzeDealsPipeline(deals);
    if (!cachedAnalysis) {
      setCachedPipelineAnalysis(organizationId, deals, pipelineAnalysis);
    }

    // LEARNING ENGINE: performanceContext already fetched above for fallback use
    // Now merge into pipeline analysis for richer AI insights
    const enrichedAnalysis = {
      ...pipelineAnalysis,
      // Add historical performance data if available
      historicalPerformance: performanceContext ? {
        orgWinRate: performanceContext.orgWinRate,
        userWinRate: performanceContext.userWinRate,
        avgDaysToClose: performanceContext.orgAvgDaysToClose,
        userAvgDaysToClose: performanceContext.userAvgDaysToClose,
        stageStats: performanceContext.stageStats,
        note: 'Real historical data from last 90 days'
      } : null,
      // PHASE 5.3: Add adaptation snippet if user profile exists
      adaptationSnippet: userProfile ? buildAdaptationPromptSnippet(userProfile) : ''
    };

    // AI FALLBACK: Use standardized fallback chain (openai → anthropic → google)
    // This ensures consistent failover behavior across all AI operations
    // FIX 2025-12-04: Pass taskType for task-aware ordering (ChatGPT → Claude → Gemini for planning)
    // FIX 2025-12-04: Use runtimeProviders (xAI/Grok filtered out)
    const fallbackResult = await runWithFallback(
      'mission-control',
      runtimeProviders,
      async (provider) => {
        // LEARNING ENGINE: Pass enriched analysis with historical performance data
        // PHASE 3: Pass taskType for visual spec instructions
        return await callAIProvider(provider, message, enrichedAnalysis, conversationHistory, taskType);
      },
      preferredProvider, // Use user's preferred provider first if specified
      taskType // FIX 2025-12-04: Task-aware fallback ordering
    );

    // Check if all providers failed
    if (!fallbackResult.success || !fallbackResult.result) {
      // Log the full error chain for debugging
      console.error('[ai-assistant] All providers failed:', fallbackResult.errors);

      // Build user-friendly error message
      const providerNames = fallbackResult.errors
        .map(e => PROVIDER_NAMES[e.provider] || e.provider)
        .filter(Boolean)
        .join(', ');

      const errorDetails = fallbackResult.errors
        .map(e => `${e.provider}: ${e.errorType}`)
        .join('; ');

      throw new AllProvidersFailedError(fallbackResult.errors);
    }

    const aiResponse = fallbackResult.result;

    // CRITICAL: Increment AI usage counter for organization (revenue tracking!)
    // FIX 2025-12-03: Use direct UPDATE instead of RPC (RPC may not exist in all environments)
    try {
      const { error: incrementError } = await supabase
        .from('organizations')
        .update({
          ai_requests_used_this_month: (orgData?.ai_requests_used_this_month || 0) + 1
        })
        .eq('id', organizationId);

      if (incrementError) {
        console.error('[ai-assistant] Failed to increment AI usage:', incrementError);
        // Don't throw - still return AI response, but log the error
      } else {
        console.log('[ai-assistant] AI usage incremented for org:', organizationId);
      }
    } catch (error: any) {
      console.error('[ai-assistant] Error tracking AI usage:', error);
      // Continue - don't fail the request if usage tracking fails
    }

    // ANALYTICS: Detect if user is requesting chart visualization
    let chartData = null;
    let chartType = null;
    let chartTitle = null;

    const messageLower = message.toLowerCase();

    // Detect analytics queries and calculate chart data
    // ENHANCED: More comprehensive detection for visual analytics
    if (messageLower.includes('weekly trend') || messageLower.includes('week') && (messageLower.includes('trend') || messageLower.includes('deal'))) {
      chartType = 'weekly_trends';
      chartTitle = 'Weekly Deal Activity';
      chartData = calculateWeeklyTrends(deals);
    } else if (messageLower.includes('pipeline flow') || messageLower.includes('pipeline movement') || messageLower.includes('pipeline distribution') || messageLower.includes('stage') && messageLower.includes('value')) {
      chartType = 'pipeline_flow';
      chartTitle = 'Pipeline by Stage';
      chartData = calculatePipelineFlow(deals);
    } else if (
      // ENHANCED: Detect goal/progress queries with more keywords
      (messageLower.includes('goal') && (messageLower.includes('progress') || messageLower.includes('track') || messageLower.includes('target') || messageLower.includes('achieve'))) ||
      (messageLower.includes('progress') && (messageLower.includes('toward') || messageLower.includes('to') || messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('revenue') && (messageLower.includes('goal') || messageLower.includes('target') || messageLower.includes('quota'))) ||
      (messageLower.includes('monthly') && messageLower.includes('target')) ||
      (messageLower.includes('quarterly') && messageLower.includes('target')) ||
      (messageLower.includes('annual') && messageLower.includes('target'))
    ) {
      chartType = 'goal_progress';
      chartTitle = 'Revenue Goal Progress';
      chartData = await calculateGoalProgress(deals, organizationId, supabase);
    } else if (
      // ENHANCED: Detect probability/chance queries
      messageLower.includes('probability') ||
      messageLower.includes('chance') ||
      messageLower.includes('likelihood') ||
      (messageLower.includes('hit') && (messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('achieve') && (messageLower.includes('goal') || messageLower.includes('target'))) ||
      (messageLower.includes('reach') && (messageLower.includes('goal') || messageLower.includes('target')))
    ) {
      // For probability queries, show goal progress which includes probability calculations
      chartType = 'goal_progress';
      chartTitle = 'Goal Achievement Probability';
      chartData = await calculateGoalProgress(deals, organizationId, supabase);
    } else if (messageLower.includes('at risk') || messageLower.includes('stagnant') || messageLower.includes('stuck')) {
      chartType = 'at_risk_deals';
      chartTitle = 'At-Risk Deals';
      chartData = calculateAtRiskDeals(deals);
    } else if (messageLower.includes('forecast') && messageLower.includes('revenue')) {
      chartType = 'revenue_forecast';
      chartTitle = 'Revenue Forecast';
      chartData = calculateRevenueForecast(deals);
    } else if (messageLower.includes('ideal customer') || messageLower.includes('icp') || messageLower.includes('customer profile')) {
      chartType = 'icp_analysis';
      chartTitle = 'Ideal Customer Profile';
      chartData = calculateICPAnalysis(deals);
    } else if (messageLower.includes('velocity') || (messageLower.includes('faster') && messageLower.includes('pipeline'))) {
      chartType = 'velocity_analysis';
      chartTitle = 'Pipeline Velocity';
      chartData = calculateVelocityAnalysis(deals);
    }

    // Generate follow-up suggestions
    const suggestions = [];
    if (message.toLowerCase().includes('pipeline') || message.toLowerCase().includes('analyze')) {
      suggestions.push('What deals should I focus on this week?');
      suggestions.push('How can I improve my conversion rates?');
    } else if (message.toLowerCase().includes('deal') || message.toLowerCase().includes('focus')) {
      suggestions.push('Show me my stale deals');
      suggestions.push('What are my biggest opportunities?');
    }

    // Build response with optional chart data
    const responseData: any = {
      ok: true,
      configHealthy, // FIX_S2_B1: Include server config health for frontend
      response: aiResponse.response,
      provider: aiResponse.provider,
      suggestions,
      timestamp: new Date().toISOString()
    };

    // Include chart data if analytics query detected
    if (chartData && chartType) {
      responseData.chartData = chartData;
      responseData.chartType = chartType;
      responseData.chartTitle = chartTitle;
    }

    // PHASE 3: Include performance context for frontend metrics strip
    if (performanceContext) {
      responseData.performanceContext = {
        orgWinRate: performanceContext.orgWinRate,
        userWinRate: performanceContext.userWinRate,
        avgDaysToClose: performanceContext.orgAvgDaysToClose,
        highValueAtRisk: enrichedAnalysis.highValueAtRisk || 0
      };
    }

    // PHASE 1 2025-12-08: Validate AI response before returning
    // Ensures we never return success without valid response content
    try {
      validateAIResponse(responseData, 'ai-assistant');
    } catch (validationError: any) {
      trackInvariantViolation('ai-assistant', validationError.code || 'UNKNOWN', {
        responseKeys: Object.keys(responseData),
        hasResponse: !!responseData.response,
        hasProvider: !!responseData.provider,
        error: validationError.message
      });
      console.error('[ai-assistant] INVARIANT VIOLATION:', validationError.message);
      // Return graceful error instead of invalid success
      return new Response(JSON.stringify({
        ok: false,
        error: { message: 'AI response validation failed', code: validationError.code }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Phase 1 Telemetry: Track successful AI call
    trackAICall(
      telemetryCtx.correlationId,
      aiResponse.provider || 'unknown',
      taskType || 'general',
      true,
      calculateDuration(telemetryCtx)
    );

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error: any) {
    console.error('[StageFlow][AI][ERROR] AI Assistant error:', error);

    // AI FALLBACK: Handle AllProvidersFailedError with detailed info
    if (error instanceof AllProvidersFailedError) {
      // Phase 1 Telemetry: Track all providers failed
      trackTelemetryEvent(TelemetryEvents.AI_ALL_PROVIDERS_FAILED, telemetryCtx.correlationId, {
        providersAttempted: error.providersAttempted.length,
        durationMs: calculateDuration(telemetryCtx),
      });
      // ============================================================================
      // [StageFlow][AI][ALL_PROVIDERS_FAILED] Deep diagnostic
      // Shows exactly why each provider failed
      // ============================================================================
      console.error("[StageFlow][AI][ALL_PROVIDERS_FAILED]", {
        totalProviders: error.errors.length,
        providersAttempted: error.providersAttempted,
        errors: error.errors.map(e => ({
          provider: e.provider,
          errorType: e.errorType,
          httpStatus: e.statusCode ?? null,
          message: e.message?.substring(0, 150), // Truncated for safety
          timestamp: e.timestamp
        })),
        // PHASE 1: Include classified errors in diagnostic
        classifiedErrors: error.classifiedErrors?.map(ce => ({
          provider: ce.provider,
          code: ce.code,
          httpStatus: ce.httpStatus,
          dashboardUrl: ce.providerDashboardUrl
        }))
      });

      // FIX 2025-12-04: Use intelligent error summarization from AllProvidersFailedError
      // Now provides actionable guidance based on specific error types (quota, billing, model, etc.)
      const userMessage = error.userFriendlyMessage || error.message;

      // PHASE 3: Build fallback plan to include in error response
      // Users still get value even when AI fails
      let fallbackPlan: BasicMissionControlPlan | null = null;
      try {
        // Use requestDeals which is stored at top level for catch block access
        // Note: monthlyTarget not available in catch block, RevOps goal tracking skipped
        const fallbackContext = buildMissionControlContext(requestDeals, null);
        fallbackPlan = buildBasicMissionControlPlan(fallbackContext, requestDeals, 0);
      } catch (fallbackError) {
        console.error('[ai-assistant] Failed to build fallback plan:', fallbackError);
      }

      // P1 HOTFIX 2025-12-07: Return HTTP 200 with ok: false instead of 503
      // This treats provider failures as DATA, not server faults.
      // Frontend can handle this gracefully without tripping ErrorBoundary.
      //
      // Before: 503 → fetch throws → ErrorBoundary → "Critical Error"
      // After:  200 → ok: false → inline error UI → graceful degradation
      return new Response(JSON.stringify({
        ok: false,
        error: {
          type: 'AI_PROVIDER_FAILURE',
          reason: 'ALL_PROVIDERS_FAILED',
          code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
          message: userMessage,
          // PHASE 2: Per-provider classified errors with actionable info
          providers: error.classifiedErrors?.map(ce => ({
            provider: ce.provider,
            code: ce.code,
            message: ce.userMessage,
            dashboardUrl: ce.providerDashboardUrl,
            httpStatus: ce.httpStatus
          })) || error.errors.map(e => ({
            provider: e.provider,
            code: e.errorType,
            message: e.message?.substring(0, 200)
          })),
          // PHASE 3: Include fallback plan so users still get value
          fallbackPlan
        },
        // Legacy fields for backwards compatibility
        code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
        message: userMessage,
        response: userMessage,
        providersAttempted: error.providersAttempted,
        errors: error.errors.map(e => ({
          provider: e.provider,
          errorType: e.errorType
        })),
        suggestions: ['Check your AI provider API keys in Settings', 'Try again in a few moments'],
        // PHASE 3: Top-level fallback plan for easier access
        fallbackPlan
      }), {
        status: 200, // P1 HOTFIX: Return 200 so frontend treats this as data, not crash
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // ENGINE REBUILD Phase 5: Use AI spine for error classification
    // This provides consistent, user-friendly error messages across all AI failures
    const classifiedError = classifyAIError(error, 'unknown');
    console.log('[ai-assistant] Classified error:', {
      code: classifiedError.code,
      retryable: classifiedError.retryable,
      originalMessage: error?.message?.substring(0, 100)
    });

    // Map spine error codes to appropriate HTTP status
    const statusCode = classifiedError.code === 'SESSION_INVALID' ? 401 :
                       classifiedError.code === 'INVALID_API_KEY' || classifiedError.code === 'MISCONFIGURED' ? 400 :
                       classifiedError.code === 'NO_PROVIDERS' ? 404 :
                       classifiedError.retryable ? 503 : 500;

    return new Response(JSON.stringify({
      ok: false,
      error: classifiedError, // Full AIErrorInfo object for frontend
      code: classifiedError.code,
      message: classifiedError.message,
      response: classifiedError.message, // Legacy field for backwards compatibility
      retryable: classifiedError.retryable,
      retryAfterSeconds: classifiedError.retryAfterSeconds,
      suggestions: classifiedError.retryable
        ? ['Try again in a few moments', 'Check your AI provider status']
        : ['Check your AI provider API keys in Settings', 'Contact support if the issue persists']
    }), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
