import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Sparkles, Loader2, MessageSquare, Settings, ExternalLink, RotateCcw, AlertCircle, TrendingUp, Target, BarChart3, AlertTriangle, Users, DollarSign, CheckCircle, Percent, Clock, Award, WifiOff, History, Zap, LineChart, Info } from 'lucide-react';
import { useApp } from './AppShell';
import { supabase, ensureValidSession } from '../lib/supabase';
import { DealAnalyticsChartLazy as DealAnalyticsChart } from './DealAnalyticsChartLazy';
import { renderMarkdown } from '../lib/format-ai-response.jsx';
import { useAIProviderStatus } from '../hooks/useAIProviderStatus'; // NEXT-LEVEL: Shared hook
// AI FALLBACK: Import fallback utilities for provider resilience
// QA FIX #5: Now includes retry-enabled version
import {
  runAIQueryWithFallback,
  runAIQueryWithRetry,
  fetchConnectedProviders,
  generateFallbackNotice,
  generateAllFailedMessage
} from '../lib/ai-fallback';
import { getProviderDisplayName, isProviderErrorResponse } from '../ai/stageflowConfig';
// OFFLINE PHASE 4B: Cache AI insights and build offline snapshots
import { saveAIInsight, loadLastAIInsight, extractSummary } from '../lib/aiOfflineCache';
import { buildOfflineSnapshot } from '../lib/offlineSnapshot';
// PHASE 5.1: New AI UX components
import { PlanMyDayButton } from './PlanMyDayButton';
// InsightChip removed - using minimal text buttons for secondary actions
// PHASE 5.2: Execution micro-buttons
import { ActionMicroButtonGroup } from './ActionMicroButton';
// PHASE 17: Plan My Day Checklist with persistence
import { PlanMyDayChecklist } from './PlanMyDayChecklist';
// PHASE 19B: Compact summary strip for Plan My Day
import { PlanMyDaySummary } from './PlanMyDaySummary';
// APMDOS: Adaptive Plan My Day Onboarding System
import { useActivationState, markFeatureSeen } from '../hooks/useActivationState';
// QA FIX #4: AI Usage Limit Visibility
import { AIUsageIndicator } from './AIUsageIndicator';
// TASK 3 WIRE-UP: Unified inline error UI for AI failures
import { AIInlineError } from './AIInlineError';

// ISSUE 4 FIX: Plan My Day daily limit helpers
const PLAN_MY_DAY_STORAGE_KEY = 'sf_plan_my_day_last_run';

/**
 * QA FIX #2: Map error codes to actionable user guidance
 *
 * Returns structured error info with:
 * - message: User-friendly error text
 * - action: { label, path?, onClick? } - Navigation or retry action
 * - severity: 'error' | 'warning' | 'info'
 * - retryable: Whether this error can be retried
 */
const getErrorGuidance = (error, { onRetry, onNavigate } = {}) => {
  // FIX 2025-12-02: Improved error code extraction to catch all sources
  const errorCode = error?.code || error?.data?.code || error?.data?.error || error?.message || '';
  const errorMessage = error?.message || error?.data?.message || '';
  const status = error?.status || error?.statusCode || error?.data?.status || 0;

  // DEBUG_AI logging (when enabled)
  if (typeof window !== 'undefined' && window.DEBUG_AI) {
    console.log('[getErrorGuidance] Classifying error:', { errorCode, errorMessage, status, error });
  }

  // Invalid API key (401/403 from provider)
  if (
    errorCode.includes('INVALID_API_KEY') ||
    errorMessage.includes('Invalid API key') ||
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('unauthorized') ||
    (status === 401 && errorMessage.includes('key'))
  ) {
    return {
      message: 'Your AI provider key appears to be invalid or expired.',
      action: onNavigate ? {
        label: 'Update in Settings',
        onClick: () => onNavigate('SETTINGS')
      } : null,
      severity: 'error',
      retryable: false
    };
  }

  // Rate limited (429)
  if (
    errorCode.includes('RATE_LIMITED') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    status === 429
  ) {
    return {
      message: 'AI provider is temporarily busy. Please wait a moment.',
      action: onRetry ? {
        label: 'Try Again',
        onClick: onRetry
      } : null,
      severity: 'warning',
      retryable: true
    };
  }

  // No providers configured
  if (
    errorCode.includes('NO_PROVIDERS') ||
    errorMessage.includes('No AI provider configured') ||
    errorMessage.includes('No valid providers')
  ) {
    return {
      message: 'No AI provider connected yet.',
      action: onNavigate ? {
        label: 'Add Provider',
        onClick: () => onNavigate('SETTINGS')
      } : null,
      severity: 'warning',
      retryable: false
    };
  }

  // AI limit reached
  if (
    errorCode.includes('AI_LIMIT_REACHED') ||
    error?.data?.limitReached
  ) {
    const used = error?.data?.used || '?';
    const limit = error?.data?.limit || '?';
    return {
      message: `Monthly AI limit reached (${used}/${limit} requests).`,
      action: onNavigate ? {
        label: 'Upgrade Plan',
        onClick: () => onNavigate('SETTINGS')
      } : null,
      severity: 'error',
      retryable: false
    };
  }

  // HOTFIX 2025-12-02: Session/auth expired - check BEFORE ALL_PROVIDERS_FAILED
  // to ensure auth issues show correct message, not "AI providers unavailable"
  if (
    errorCode.includes('SESSION_ERROR') ||
    errorCode.includes('AUTH_REQUIRED') ||
    errorCode.includes('SESSION_INVALID') ||
    errorCode.includes('NO_SESSION') ||
    errorMessage.includes('session') ||
    errorMessage.includes('Authentication required') ||
    status === 401 ||
    status === 403
  ) {
    return {
      message: 'Your session has expired. Please sign in again.',
      action: null, // User needs to sign out/in
      severity: 'error',
      retryable: false
    };
  }

  // All providers failed (only after ruling out auth issues)
  if (
    errorCode.includes('ALL_PROVIDERS_FAILED') ||
    error?.isAllProvidersFailed
  ) {
    return {
      message: 'All AI providers are temporarily unavailable.',
      action: onRetry ? {
        label: 'Retry',
        onClick: onRetry
      } : null,
      severity: 'warning',
      retryable: true
    };
  }

  // Network/timeout errors
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    error?.name === 'AbortError'
  ) {
    return {
      message: 'Request timed out. Please check your connection.',
      action: onRetry ? {
        label: 'Retry',
        onClick: onRetry
      } : null,
      severity: 'warning',
      retryable: true
    };
  }

  // Default fallback
  return {
    message: errorMessage || 'Something went wrong. Please try again.',
    action: onRetry ? {
      label: 'Try Again',
      onClick: onRetry
    } : null,
    severity: 'error',
    retryable: true
  };
};

/**
 * Check if Plan My Day was already run today
 * @returns {boolean} True if already run today
 */
const wasPlanMyDayRunToday = () => {
  try {
    const lastRun = localStorage.getItem(PLAN_MY_DAY_STORAGE_KEY);
    if (!lastRun) return false;

    const lastRunDate = new Date(lastRun);
    const today = new Date();

    // Compare date only (ignore time)
    return lastRunDate.toDateString() === today.toDateString();
  } catch {
    return false;
  }
};

/**
 * Mark Plan My Day as run today
 */
const markPlanMyDayRun = () => {
  try {
    localStorage.setItem(PLAN_MY_DAY_STORAGE_KEY, new Date().toISOString());
  } catch {
    // localStorage unavailable - fail silently
  }
};

// Metrics Summary Strip Component - Shows key performance stats
const MetricsSummaryStrip = ({ metrics }) => {
  if (!metrics) return null;

  // Build array of available metrics (skip nulls)
  const statPills = [];

  if (metrics.orgWinRate !== null && metrics.orgWinRate !== undefined) {
    statPills.push({
      label: 'Org Win Rate',
      value: `${metrics.orgWinRate}%`,
      icon: Award,
      color: 'from-emerald-500/20 to-emerald-600/10',
      borderColor: 'border-emerald-500/30'
    });
  }

  if (metrics.userWinRate !== null && metrics.userWinRate !== undefined) {
    statPills.push({
      label: 'Your Win Rate',
      value: `${metrics.userWinRate}%`,
      icon: Percent,
      color: 'from-[#1ABC9C]/20 to-[#16A085]/10',
      borderColor: 'border-[#1ABC9C]/30'
    });
  }

  if (metrics.avgDaysToClose !== null && metrics.avgDaysToClose !== undefined) {
    statPills.push({
      label: 'Avg Days to Close',
      value: metrics.avgDaysToClose,
      icon: Clock,
      color: 'from-blue-500/20 to-blue-600/10',
      borderColor: 'border-blue-500/30'
    });
  }

  if (metrics.highValueAtRisk !== null && metrics.highValueAtRisk !== undefined && metrics.highValueAtRisk > 0) {
    statPills.push({
      label: 'High-Value At Risk',
      value: metrics.highValueAtRisk,
      icon: AlertTriangle,
      color: 'from-amber-500/20 to-amber-600/10',
      borderColor: 'border-amber-500/30'
    });
  }

  // Don't render if no stats available
  if (statPills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-5 pb-4 border-b border-white/[0.07]">
      {statPills.slice(0, 4).map((stat, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-gradient-to-br ${stat.color} border ${stat.borderColor} backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-[0_6px_24px_rgba(0,0,0,0.12)]`}
        >
          <stat.icon className="w-4 h-4 text-white/70" />
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-white/60 font-medium">{stat.label}:</span>
            <span className="text-sm font-semibold text-white tracking-tight">{stat.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export const CustomQueryView = ({
  deals = [],
  isOnline: isOnlineProp,
  // APMDOS: New props for adaptive onboarding
  hasAIProviderProp,
  user: userProp,
  organization: organizationProp
}) => {
  const appContext = useApp();
  // APMDOS: Use props if provided, otherwise fall back to context
  const user = userProp || appContext.user;
  const organization = organizationProp || appContext.organization;
  const { addNotification, setActiveView, VIEWS } = appContext;
  const [query, setQuery] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] = useState(null);
  const conversationEndRef = useRef(null);
  // TASK 3 WIRE-UP: Inline error state for AI failures (replaces toast notifications)
  const [inlineError, setInlineError] = useState(null);

  // ISSUE 4 FIX: Track if Plan My Day was already run today
  const [planMyDayRunToday, setPlanMyDayRunToday] = useState(() => wasPlanMyDayRunToday());

  // OFFLINE: Track network status for AI availability
  // Use prop if provided (from parent), otherwise track locally
  const [localIsOnline, setLocalIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  // OFFLINE-02 FIX: Debounced online state to prevent flash on reconnect
  const [debouncedIsOnline, setDebouncedIsOnline] = useState(localIsOnline);
  const isOnline = isOnlineProp !== undefined ? isOnlineProp : debouncedIsOnline;

  // OFFLINE: Listen for online/offline events if not using prop
  useEffect(() => {
    if (isOnlineProp !== undefined) return; // Skip if parent controls this

    const handleOnline = () => setLocalIsOnline(true);
    const handleOffline = () => setLocalIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnlineProp]);

  // OFFLINE-02 FIX: Debounce online state changes to prevent UI flicker
  useEffect(() => {
    if (isOnlineProp !== undefined) return;

    // Immediate update when going offline, debounced when coming online
    if (!localIsOnline) {
      setDebouncedIsOnline(false);
    } else {
      const timer = setTimeout(() => setDebouncedIsOnline(true), 300);
      return () => clearTimeout(timer);
    }
  }, [localIsOnline, isOnlineProp]);

  // NEXT-LEVEL: Use shared hook instead of duplicate logic
  // FIX 2025-12-03: Also destructure authError to distinguish auth failures from "no provider"
  const { hasProvider: hasProviders, authError: aiAuthError } = useAIProviderStatus(user, organization);
  // APMDOS: Determine hasAIProvider - use prop if provided, otherwise use hook result
  const hasAIProvider = hasAIProviderProp !== undefined ? hasAIProviderProp : hasProviders;

  // APMDOS: Get activation state for adaptive onboarding
  const activationState = useActivationState({
    user,
    organization,
    deals,
    hasAIProvider
  });

  // AI FALLBACK: Track connected providers for fallback chain
  const [connectedProviders, setConnectedProviders] = useState([]);
  const [primaryProvider, setPrimaryProvider] = useState(null);

  // AI FALLBACK: Fetch connected providers when organization changes
  useEffect(() => {
    if (!organization?.id || !isOnline) {
      setConnectedProviders([]);
      return;
    }

    const loadProviders = async () => {
      try {
        const providers = await fetchConnectedProviders(organization.id);
        setConnectedProviders(providers);
        // Set primary provider to the first one (most recently added)
        if (providers.length > 0 && !primaryProvider) {
          setPrimaryProvider(providers[0].provider_type);
        }
      } catch (error) {
        console.error('[CustomQueryView] Failed to load providers:', error);
      }
    };

    loadProviders();
  }, [organization?.id, isOnline]);

  // OFFLINE PHASE 4B: State for offline snapshot and cached insight
  const [offlineSnapshot, setOfflineSnapshot] = useState(null);
  const [cachedInsight, setCachedInsight] = useState(null);
  const lastQuickActionRef = useRef(null); // Track last quick action for caching

  // PHASE 5.2: Execution micro-button state
  const [executionLoading, setExecutionLoading] = useState(null); // 'draft' | 'research' | 'prepare' | 'followup' | null
  const [executionContext, setExecutionContext] = useState(null); // { dealId, dealName, contactName, companyName }

  // PHASE 5.3: AI signals for adaptive personalization
  // Signals are collected locally and sent with the next AI request
  const pendingSignalsRef = useRef([]);

  // CONCURRENCY FIX: Synchronous lock to prevent double-clicks/rapid submissions
  // React state updates are async, so we need a ref for immediate lock checking
  const submissionLockRef = useRef(false);

  // PHASE 5.3: Helper to add a signal
  const addAISignal = (type, sectionId = null, actionId = null) => {
    // Don't collect signals when offline
    if (!isOnline) return;

    const signal = {
      type,
      timestamp: new Date().toISOString(),
    };
    if (sectionId) signal.sectionId = sectionId;
    if (actionId) signal.actionId = actionId;

    pendingSignalsRef.current.push(signal);

    // Limit to last 20 signals to prevent unbounded growth
    if (pendingSignalsRef.current.length > 20) {
      pendingSignalsRef.current = pendingSignalsRef.current.slice(-20);
    }
  };

  // PHASE 5.3: Get and clear pending signals
  const consumePendingSignals = () => {
    const signals = [...pendingSignalsRef.current];
    pendingSignalsRef.current = [];
    return signals;
  };

  // OFFLINE PHASE 4B: Build offline snapshot when offline
  useEffect(() => {
    if (!isOnline && deals && deals.length > 0 && organization?.id) {
      const snapshot = buildOfflineSnapshot(deals, { userId: user?.id });
      setOfflineSnapshot(snapshot);

      // Also set metrics from snapshot if no performanceMetrics
      if (!performanceMetrics && snapshot.metrics) {
        setPerformanceMetrics(snapshot.metrics);
      }
    }
  }, [isOnline, deals, organization?.id, user?.id, performanceMetrics]);

  // OFFLINE PHASE 4B: Load cached AI insight when offline
  useEffect(() => {
    if (!isOnline && organization?.id) {
      const insight = loadLastAIInsight(organization.id);
      setCachedInsight(insight);
    } else {
      setCachedInsight(null);
    }
  }, [isOnline, organization?.id]);

  // DYNAMIC RESIZE: Track if conversation has charts for auto-expansion
  const hasCharts = useMemo(() => {
    return conversationHistory.some(msg => msg.chartData && msg.chartType);
  }, [conversationHistory]);

  // Removed example queries - cleaner welcome state with just AI logo
  // NEXT-LEVEL: AI provider check now handled by shared hook (eliminated 48 lines of duplicate code)

  // Auto-scroll to bottom when conversation updates - but stay within container
  useEffect(() => {
    // Use 'nearest' block to prevent page scrolling, only scroll within the chat container
    conversationEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    });
  }, [conversationHistory, loading]);

  // PERFORMANCE: Streaming AI responses for instant feedback
  const handleQueryStreaming = async (queryText = null) => {
    // Accept optional queryText parameter for one-click execution
    const currentQuery = queryText || query.trim();

    // CONCURRENCY FIX: Check synchronous lock first (prevents double-click race condition)
    if (!currentQuery || isSubmitting || submissionLockRef.current) return;

    // Acquire lock immediately (synchronous - before any state updates)
    submissionLockRef.current = true;

    // AIDASH-EDGE-01 FIX: Reset lastQuickActionRef only for manual queries
    // This ensures Plan My Day micro-buttons stay visible after quick action completes
    // Quick actions set this ref themselves via handleQuickAction
    if (!queryText) {
      lastQuickActionRef.current = null;
    }

    // MOBILE FIX: Validate deals array before sending to prevent "Invalid deals data format" error
    // PHASE C FIX (B-RACE-05): Release lock on early return to prevent deadlock
    if (!Array.isArray(deals)) {
      console.error('[CustomQueryView] Deals is not an array:', typeof deals, deals);
      addNotification('Unable to load pipeline data. Please refresh the page.', 'error');
      submissionLockRef.current = false; // Release lock
      return;
    }

    setQuery('');
    setIsSubmitting(true);
    setLoading(true);
    // TASK 3 WIRE-UP: Clear any previous inline error when starting new request
    setInlineError(null);

    // Add user message immediately
    const userMessage = { role: 'user', content: currentQuery };
    setConversationHistory(prev => [...prev, userMessage]);

    // Add placeholder for AI response with unique ID
    const aiMessageId = Date.now();
    const placeholderAiMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      streaming: true,
      provider: 'AI'
    };
    setConversationHistory(prev => [...prev, placeholderAiMessage]);

    try {
      // PHASE 5.3: Collect and send AI signals with request
      const aiSignals = consumePendingSignals();

      // H3 FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: streamSession } } = await supabase.auth.getSession();

      const streamHeaders = { 'Content-Type': 'application/json' };
      if (streamSession?.access_token) {
        streamHeaders['Authorization'] = `Bearer ${streamSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/ai-assistant-stream', {
        method: 'POST',
        headers: streamHeaders,
        credentials: 'include', // Keep cookies as fallback
        body: JSON.stringify({
          message: currentQuery,
          // PERF FIX P16-1: Project deals to minimal fields (80% smaller payload)
          deals: (deals || []).map(d => ({
            stage: d.stage,
            status: d.status,
            value: d.value || 0
          })),
          // PERF FIX P16-2: Truncate history to last 6 exchanges (12 messages)
          conversationHistory: conversationHistory
            .filter(msg => !msg.chartData) // Strip chart data from history
            .slice(-12),
          aiSignals: aiSignals  // PHASE 5.3: Send behavioral signals
        })
      });

      if (!response.ok) {
        // Handle 401 Unauthorized - session expired
        // FIX 2025-12-02: Also handle 403 Forbidden
        if (response.status === 401 || response.status === 403) {
          addNotification('Your session has expired. Please sign out and sign back in.', 'error');
          // Remove placeholder message
          setConversationHistory(prev => prev.filter(msg => msg.id !== aiMessageId));
          // Create error with proper code for getErrorGuidance
          const sessionError = new Error('Session expired');
          sessionError.status = response.status;
          sessionError.code = 'SESSION_ERROR';
          throw sessionError;
        }

        const errorData = await response.json().catch(() => ({}));

        // Handle AI limit reached
        if (errorData.error === 'AI_LIMIT_REACHED' || errorData.limitReached) {
          addNotification(`AI limit reached: ${errorData.used}/${errorData.limit} requests used this month. Upgrade to continue.`, 'error');
          // Remove placeholder and add limit message
          setConversationHistory(prev => prev.filter(msg => msg.id !== aiMessageId));
          const limitMessage = {
            role: 'system',
            content: `⚠️ AI Limit Reached\n\nYou've used ${errorData.used} of ${errorData.limit} monthly AI requests. To continue using AI features, please upgrade your plan.\n\nClick Settings → Billing to upgrade now.`,
            isLimit: true
          };
          setConversationHistory(prev => [...prev, limitMessage]);
          return;
        }

        // FIX 2025-12-02: Handle NO_PROVIDERS (422) with proper error classification
        if (errorData.error === 'NO_PROVIDERS' || errorData.code === 'NO_PROVIDERS') {
          // Remove placeholder message
          setConversationHistory(prev => prev.filter(msg => msg.id !== aiMessageId));
          const noProviderError = new Error(errorData.message || 'No AI provider configured');
          noProviderError.code = 'NO_PROVIDERS';
          noProviderError.status = response.status;
          throw noProviderError;
        }

        // Create error with response data for proper classification
        const error = new Error(errorData.error || errorData.message || 'Stream failed');
        error.status = response.status;
        error.code = errorData.code || errorData.error;
        error.data = errorData;
        throw error;
      }

      // Read SSE stream with timeout protection
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let providerName = 'AI';

      // CRITICAL-01 FIX: Proper timeout protection for streaming
      const STREAM_TIMEOUT = 60000; // 60 seconds max for entire stream
      let streamTimedOut = false;
      const streamTimeout = setTimeout(() => {
        streamTimedOut = true;
        reader.cancel();
      }, STREAM_TIMEOUT);

      // CHART PARITY: Track chart data received from streaming endpoint
      let chartData = null;
      let chartType = null;
      let chartTitle = null;
      // PHASE 17: Track structured response for Plan My Day checklist
      let structuredResponse = null;

      // PHASE 18/20 PERF: Throttled UI updates (batches multiple chunks into single render)
      // Instead of updating state on every chunk, we batch updates every 35ms
      // PHASE 20: Lowered from 50ms to 35ms for smoother perceived output
      let pendingUpdate = false;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 35; // ms between UI updates (PHASE 20: reduced for lower latency)

      const scheduleUIUpdate = () => {
        const now = Date.now();
        if (!pendingUpdate && (now - lastUpdateTime) >= UPDATE_INTERVAL) {
          pendingUpdate = true;
          requestAnimationFrame(() => {
            setConversationHistory(prev => prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, content: accumulatedContent, provider: providerName }
                : msg
            ));
            pendingUpdate = false;
            lastUpdateTime = Date.now();
          });
        }
      };

      try {
        while (true) {
          // CRITICAL-01 FIX: Check timeout flag before read
          if (streamTimedOut) {
            throw new Error('AI response timed out. Please try again.');
          }
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n').filter(line => line.trim());

          // HIGH-02 FIX: Proper SSE parsing with sequential event/data handling
          let pendingEventType = null;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // CHART PARITY: Handle chart event (sent after text stream completes)
            if (line.startsWith('event: chart')) {
              pendingEventType = 'chart';
              continue;
            }

            // PHASE 17: Handle structured response event
            if (line.startsWith('event: structured')) {
              pendingEventType = 'structured';
              continue;
            }

            // If previous line was event: chart, this data line is chart data
            if (pendingEventType === 'chart' && line.startsWith('data: ')) {
              try {
                const chartPayload = JSON.parse(line.slice(6));
                chartData = chartPayload.chartData;
                chartType = chartPayload.chartType;
                chartTitle = chartPayload.chartTitle;
              } catch (e) {
                console.error('Chart parse error:', e);
              }
              pendingEventType = null;
              continue;
            }

            // PHASE 17: If previous line was event: structured, parse structured response
            if (pendingEventType === 'structured' && line.startsWith('data: ')) {
              try {
                structuredResponse = JSON.parse(line.slice(6));
              } catch (e) {
                console.error('Structured response parse error:', e);
              }
              pendingEventType = null;
              continue;
            }

            // Reset pending event if we hit a different line type
            if (!line.startsWith('data: ')) {
              pendingEventType = null;
              continue;
            }

            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                // CHART PARITY: Check if this is a chart event data
                if (data.chartType && data.chartData) {
                  chartData = data.chartData;
                  chartType = data.chartType;
                  chartTitle = data.chartTitle;
                  continue;
                }

                if (data.error) {
                  throw new Error(data.error);
                }

                if (data.content) {
                  accumulatedContent += data.content;
                  if (data.provider) {
                    providerName = data.provider;
                  }

                  // PHASE 18 PERF: Use throttled update instead of updating on every chunk
                  // This reduces React re-renders by ~90% during streaming
                  scheduleUIUpdate();
                }
              } catch (parseError) {
                console.error('Parse error:', parseError);
              }
            }
          }
        }

        // AI FALLBACK: Check if streamed response is a provider error
        // This happens when Grok returns 403 - the backend returns an error message as content
        const hasProviderError = isProviderErrorResponse(accumulatedContent);

        // Mark streaming complete and add chart data if present
        setConversationHistory(prev => prev.map(msg =>
          msg.id === aiMessageId
            ? {
                ...msg,
                streaming: false,
                // AI FALLBACK: Mark if this was a provider error (shows retry hint)
                isProviderError: hasProviderError,
                // CHART PARITY: Include chart data from streaming endpoint
                ...(chartData && { chartData }),
                ...(chartType && { chartType }),
                ...(chartTitle && { chartTitle }),
                // PHASE 17: Include structured response for Plan My Day checklist
                ...(structuredResponse && { structuredResponse })
              }
            : msg
        ));

        // AI FALLBACK: If provider error detected, show notification suggesting retry
        if (hasProviderError && connectedProviders.length > 1) {
          addNotification('This AI provider is temporarily unavailable. Try again to use another provider.', 'info');
        }

        // ISSUE 4 FIX: Mark Plan My Day as run today after successful completion
        if (lastQuickActionRef.current === 'plan_my_day' && !hasProviderError) {
          markPlanMyDayRun();
          setPlanMyDayRunToday(true);
        }
      } finally {
        // CRITICAL FIX: Always clear timeout to prevent memory leak
        clearTimeout(streamTimeout);
      }

    } catch (error) {
      console.error('Streaming error:', error);

      // CRITICAL-03 FIX: Single atomic state update to prevent race conditions
      // Remove both the AI placeholder (by id) and the user message (last before placeholder)
      setConversationHistory(prev => {
        // Filter out the AI placeholder by id
        const withoutPlaceholder = prev.filter(msg => msg.id !== aiMessageId);
        // Remove the user message that triggered this failed request (now the last message)
        if (withoutPlaceholder.length > 0 && withoutPlaceholder[withoutPlaceholder.length - 1]?.role === 'user') {
          return withoutPlaceholder.slice(0, -1);
        }
        return withoutPlaceholder;
      });

      // TASK 3 WIRE-UP: Use inline error instead of toast for AI failures
      const guidance = getErrorGuidance(error, {
        onRetry: () => {
          setInlineError(null); // Clear error before retry
          handleQueryStreaming(currentQuery);
        },
        onNavigate: (view) => setActiveView && setActiveView(VIEWS?.[view])
      });
      setInlineError(guidance);
    } finally {
      setLoading(false);
      setIsSubmitting(false);
      // CONCURRENCY FIX: Release synchronous lock
      submissionLockRef.current = false;
    }
  };

  // Fallback non-streaming handler (for providers that don't support streaming)
  const handleQuery = async () => {
    // CONCURRENCY FIX: Check synchronous lock first
    if (!query.trim() || isSubmitting || submissionLockRef.current) return;

    // Acquire lock immediately
    submissionLockRef.current = true;

    // MOBILE FIX: Validate deals array before sending
    if (!Array.isArray(deals)) {
      console.error('[CustomQueryView] Deals is not an array:', typeof deals, deals);
      addNotification('Unable to load pipeline data. Please refresh the page.', 'error');
      submissionLockRef.current = false; // Release lock on early return
      return;
    }

    const currentQuery = query.trim();
    setQuery('');
    setIsSubmitting(true);
    setLoading(true);

    // Add user message to conversation immediately
    const userMessage = { role: 'user', content: currentQuery };
    setConversationHistory(prev => [...prev, userMessage]);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // SURGICAL FIX: Removed redundant auth check - user already verified by AppShell
      if (!user) {
        console.warn('[CustomQueryView] No user - skipping AI query');
        addNotification('Please sign in to use AI features', 'error');
        return;
      }

      // PHASE 5.3: Collect and send AI signals with request
      const aiSignals = consumePendingSignals();

      // H3 FIX 2025-12-03: Inject Authorization header for reliable auth
      await ensureValidSession();
      const { data: { session: nonStreamSession } } = await supabase.auth.getSession();

      const nonStreamHeaders = { 'Content-Type': 'application/json' };
      if (nonStreamSession?.access_token) {
        nonStreamHeaders['Authorization'] = `Bearer ${nonStreamSession.access_token}`;
      }

      const response = await fetch('/.netlify/functions/ai-assistant', {
        method: 'POST',
        signal: controller.signal,
        headers: nonStreamHeaders,
        credentials: 'include', // Keep cookies as fallback
        body: JSON.stringify({
          message: currentQuery,
          // PERF FIX P16-1: Project deals to minimal fields (80% smaller payload)
          deals: (deals || []).map(d => ({
            stage: d.stage,
            status: d.status,
            value: d.value || 0
          })),
          // PERF FIX P16-2: Truncate history to last 6 exchanges (12 messages)
          conversationHistory: conversationHistory
            .filter(msg => !msg.chartData) // Strip chart data from history
            .slice(-12),
          aiSignals: aiSignals  // PHASE 5.3: Send behavioral signals
        })
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized - session expired (check before parsing JSON)
      if (response.status === 401) {
        addNotification('Your session has expired. Please log in again to use AI insights.', 'error');
        setConversationHistory(prev => prev.slice(0, -1));
        return;
      }

      // Parse JSON with error handling for empty responses
      let data;
      try {
        const text = await response.text();
        if (!text || text.trim() === '') {
          throw new Error('Empty response from AI assistant');
        }
        data = JSON.parse(text);
      } catch (jsonError) {
        console.error('JSON parse error:', jsonError);
        throw new Error(`Failed to parse AI response: ${jsonError.message}`);
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get AI response');
      }

      if (data.error) {
        if (data.error.includes('No AI provider configured')) {
          addNotification('Please connect an AI provider first', 'error');
          setConversationHistory(prev => prev.slice(0, -1));
          return;
        }
        // Handle AI limit reached
        if (data.error === 'AI_LIMIT_REACHED' || data.limitReached) {
          addNotification(`AI limit reached: ${data.used}/${data.limit} requests used this month. Upgrade to continue.`, 'error');
          setConversationHistory(prev => prev.slice(0, -1));
          // Add system message about limit
          const limitMessage = {
            role: 'system',
            content: `⚠️ AI Limit Reached\n\nYou've used ${data.used} of ${data.limit} monthly AI requests. To continue using AI features, please upgrade your plan.\n\nClick Settings → Billing to upgrade now.`,
            isLimit: true
          };
          setConversationHistory(prev => [...prev, limitMessage]);
          return;
        }
        throw new Error(data.error);
      }

      // Add AI response to conversation (with optional chart data)
      const aiMessage = {
        role: 'assistant',
        content: data.response,
        provider: data.provider || 'AI',
        ...(data.chartData && { chartData: data.chartData }),
        ...(data.chartType && { chartType: data.chartType }),
        ...(data.chartTitle && { chartTitle: data.chartTitle })
      };
      setConversationHistory(prev => [...prev, aiMessage]);

      // PHASE 3: Extract performance metrics from response for summary strip
      if (data.performanceContext) {
        setPerformanceMetrics(data.performanceContext);
      }

    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Error querying AI:', error);

      setConversationHistory(prev => prev.slice(0, -1));

      if (error.name === 'AbortError') {
        addNotification('Request timed out. The AI is taking longer than expected. Please try again.', 'error');
      } else {
        addNotification(error.message || 'Failed to get AI response. Try again.', 'error');
      }
    } finally {
      setLoading(false);
      setIsSubmitting(false);
      // CONCURRENCY FIX: Release synchronous lock
      submissionLockRef.current = false;
    }
  };

  const handleNewConversation = () => {
    setPerformanceMetrics(null); // Clear metrics on new conversation
    setConversationHistory([]);
    setQuery('');
    setExecutionLoading(null);
    setExecutionContext(null);
  };

  // PHASE 5.2: Execution Action Handlers
  // These handlers execute contextual AI actions from micro-buttons in Plan My Day responses
  const handleExecutionAction = async (actionType, context) => {
    // CONCURRENCY FIX: Check synchronous lock first
    if (isSubmitting || loading || !hasProviders || !isOnline || executionLoading || submissionLockRef.current) return;

    // PHASE 5.3: Track micro-action usage for adaptive personalization
    // Map execution action types to signal action IDs
    const actionToSignalId = {
      'draft': 'draft_message',
      'research': 'research_company',
      'prepare': 'prepare_conversation',
      'followup': 'followup_sequence'
    };
    const signalActionId = actionToSignalId[actionType];
    if (signalActionId) {
      addAISignal('micro_action_used', null, signalActionId);
    }

    setExecutionLoading(actionType);
    setExecutionContext(context);

    const { dealId, dealName, contactName, companyName } = context;

    // Build contextual prompts for each action type
    const executionPrompts = {
      draft: `Draft a professional outreach message for ${contactName || 'the contact'} at ${companyName || dealName}.

Context: This is for the deal "${dealName}".

Guidelines:
- Keep it warm, professional, and momentum-focused
- Reference our previous interactions if relevant context exists
- Focus on value and partnership, not pressure
- Keep it concise (3-4 paragraphs max)
- End with a clear, low-pressure next step

Please draft the message now. I can copy and customize it before sending.`,

      research: `Research ${companyName || dealName} to help me prepare for this opportunity.

Please provide:
1. **Company Overview**: What they do, industry, size if known
2. **Recent News or Updates**: Any public announcements, funding, leadership changes
3. **Potential Pain Points**: Based on their industry and size, what challenges might they face?
4. **Conversation Angles**: Topics that could build rapport and demonstrate understanding
5. **Partnership Fit**: How our solution might align with their needs

Keep insights actionable and relevant to building a genuine business relationship.`,

      prepare: `Help me prepare for my next conversation with ${contactName || 'the contact'} about the "${dealName}" opportunity.

Please provide:
1. **Key Discussion Points**: What should I cover in our next interaction?
2. **Questions to Ask**: Thoughtful questions that show genuine interest in their needs
3. **Potential Objections**: What concerns might arise and how to address them constructively
4. **Value Propositions**: Which benefits are most relevant to their situation?
5. **Next Steps to Propose**: Appropriate actions that maintain momentum without pressure

Focus on creating a productive, partnership-oriented conversation.`,

      followup: `Create a thoughtful follow-up sequence plan for the "${dealName}" opportunity with ${contactName || 'the contact'} at ${companyName || 'their company'}.

Please outline:
1. **Immediate Follow-Up** (within 24-48 hours): What to send and why
2. **Check-In #1** (3-5 days): Touchpoint focus and approach
3. **Value-Add #1** (1 week): Something useful to share (insight, resource, connection)
4. **Check-In #2** (2 weeks): Re-engagement approach if no response
5. **Long-Term Nurture**: If this deal stalls, how to maintain the relationship

Guidelines:
- Each touchpoint should provide value, not just "checking in"
- Maintain professional persistence without pressure
- Include specific message ideas or talking points
- Focus on relationship building over transaction pushing`
    };

    const queryText = executionPrompts[actionType];
    if (!queryText) {
      setExecutionLoading(null);
      return;
    }

    // Execute the query using streaming
    await handleQueryStreaming(queryText);

    setExecutionLoading(null);
  };

  // Individual action handlers that pass context to the main handler
  const handleDraftMessage = (context) => handleExecutionAction('draft', context);
  const handleResearchCompany = (context) => handleExecutionAction('research', context);
  const handlePrepareConversation = (context) => handleExecutionAction('prepare', context);
  const handleFollowUpPlan = (context) => handleExecutionAction('followup', context);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQueryStreaming(); // Use streaming for instant feedback
    }
  };

  // Quick action handler - ONE-CLICK execution (no second click required)
  const handleQuickAction = async (actionType) => {
    // CONCURRENCY FIX: Check synchronous lock first (prevents double-click race condition)
    if (isSubmitting || loading || !hasProviders || submissionLockRef.current) return;

    // Acquire lock immediately (synchronous - before any state updates)
    submissionLockRef.current = true;

    // OFFLINE PHASE 4B: Track the quick action type for caching
    lastQuickActionRef.current = actionType;

    // MOBILE FIX: Validate deals array before sending
    // PHASE C FIX (B-RACE-05): Release lock on early return to prevent deadlock
    if (!Array.isArray(deals)) {
      console.error('[CustomQueryView] Deals is not an array:', typeof deals, deals);
      addNotification('Unable to load pipeline data. Please refresh the page.', 'error');
      submissionLockRef.current = false; // Release lock
      return;
    }

    const quickQueries = {
      // PHASE 5.1: PLAN MY DAY - Hero Action (Structured Daily Plan)
      'plan_my_day': `Create my personalized daily action plan with these 4 sections:

**SECTION 1: Closest to Close (20-30 min focus)**
Review deals that are nearest to decision points. Look for deals in late stages (negotiation, contract_sent, verbal_commit) or deals with high confidence scores. Focus on momentum - what's the next concrete step to advance each? End with: "Want help drafting the next message or preparing the next step?"

**SECTION 2: Momentum Builders (45-60 min focus)**
Identify newly added leads, deals needing movement, and opportunities for research or discovery prep. Focus on deals that have activity potential but need attention. End with: "Want me to help you research or outline outreach?"

**SECTION 3: Relationship Development Touchpoints (10-20 min focus)**
Surface existing customers due for check-in, long-tail relationships worth nurturing, and partnership opportunities. Use gentle, human-centered suggestions. End with: "Would you like help composing these?"

**SECTION 4: Personal Workflow Insights (Conditional)**
Based on my historical performance patterns, share ONE brief insight about my work style - like best time of day for certain activities, patterns in my successful deals, or areas where I'm excelling. Keep this supportive and actionable.

TONE: Professional advisor, supportive, momentum-focused. Focus on partnership over transactions. Never mention how you're adapting the advice.`,

      // CORE METRICS (3) - Visual snapshots of performance (Phase 5.1 streamlined)
      'weekly_trends': 'Show me my weekly deal activity trends with a chart. Focus on momentum patterns and actionable insights.',
      'momentum_insights': 'Analyze my pipeline momentum. Which deals are losing momentum and need attention? Focus on deals that are slowing down relative to their stage benchmarks. Provide supportive guidance on re-engaging these opportunities without pressure tactics.',
      'flow_forecast': 'Show me my pipeline flow by stage AND forecast this month\'s revenue. Help me understand where deals are concentrated and what realistic revenue I can expect. Focus on clarity and confidence-building insights.',

      // LEGACY SUPPORT: Keep old action IDs working (backward compatibility)
      'goal_progress': 'Show me my progress toward my revenue goals. Pull my actual targets from the user_targets table and calculate: 1) Monthly progress: current month revenue vs monthly_target with probability of hitting it, 2) Quarterly progress: current quarter revenue vs quarterly_target with probability, 3) Annual progress: year-to-date revenue vs annual_target with probability. For each goal, show current amount, target amount, percentage complete, and estimated probability of achievement based on current run rate and time remaining.',
      'pipeline_flow': 'Show me my pipeline distribution by stage',
      'at_risk': 'Which deals are at risk of stagnation?',
      'revenue_forecast': 'Forecast this month\'s revenue based on current pipeline',

      // STRATEGIC AI COACHING (Advisor Insights) - Partnership-focused guidance
      'icp_analyzer': 'Based on my won deals, what patterns define my ideal customer profile? Help me identify traits that signal strong partnership potential - company characteristics, buying behavior, and engagement patterns that correlate with successful, long-term relationships.',
      'deal_doctor': 'I have deals that need strategic attention. Help me think through the situation by asking thoughtful questions about a specific deal. Focus on understanding the relationship dynamics and identifying constructive next steps.',
      'qualifier_coach': 'Help me develop better qualification conversations. What questions help identify genuine mutual fit? Focus on understanding prospect needs deeply rather than just checking boxes.',
      'velocity_booster': 'Analyze my deal progression patterns. Where do deals tend to slow down in my pipeline? Help me understand the natural rhythm and identify opportunities to maintain healthy momentum.',
      'relationship_development': 'Help me understand customer relationship development and lifetime value. What practices build genuine long-term partnerships? Focus on creating mutual value and trust over time.'
    };

    const queryText = quickQueries[actionType];
    if (!queryText) return;

    // PHASE 5.3: Track section usage signals based on action type
    // Map quick action IDs to section IDs for profile learning
    const actionToSection = {
      'plan_my_day': null, // Plan My Day triggers section tracking when user interacts with results
      'weekly_trends': 'momentum_builders',
      'momentum_insights': 'momentum_builders',
      'flow_forecast': 'closest_to_close',
      'goal_progress': 'closest_to_close',
      'pipeline_flow': 'momentum_builders',
      'at_risk': 'closest_to_close',
      'revenue_forecast': 'closest_to_close',
      'icp_analyzer': 'relationships',
      'deal_doctor': 'closest_to_close',
      'qualifier_coach': 'relationships',
      'velocity_booster': 'momentum_builders',
      'relationship_development': 'relationships'
    };

    const sectionId = actionToSection[actionType];
    if (sectionId) {
      addAISignal('section_used', sectionId, null);
    }

    // Execute query immediately WITHOUT populating input field
    setIsSubmitting(true);
    setLoading(true);
    // TASK 3 WIRE-UP: Clear any previous inline error when starting new request
    setInlineError(null);

    // Add user message to conversation immediately
    const userMessage = { role: 'user', content: queryText };
    setConversationHistory(prev => [...prev, userMessage]);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // SURGICAL FIX: Removed redundant auth check - user already verified by AppShell
      // PHASE C FIX (B-RACE-05): Release lock on early return
      if (!user) {
        console.warn('[CustomQueryView] No user - skipping AI query');
        addNotification('Please sign in to use AI features', 'error');
        setLoading(false);
        setIsSubmitting(false);
        submissionLockRef.current = false;
        return;
      }

      // PHASE 5.3: Collect and send AI signals with request
      const aiSignals = consumePendingSignals();

      // QA FIX #5: Use retry-enabled query with automatic backoff
      // AI FALLBACK: Tries multiple providers with automatic retry on transient failures
      const data = await runAIQueryWithRetry({
        message: queryText,
        deals: deals || [],
        conversationHistory: conversationHistory,
        primaryProvider: primaryProvider,
        organizationId: organization?.id,
        connectedProviders: connectedProviders,
        aiSignals: aiSignals
      }, {
        onRetryStart: (attempt) => {
          // Update placeholder message to show retry status
          setConversationHistory(prev => prev.map(msg =>
            msg.role === 'assistant' && msg.content === ''
              ? { ...msg, content: `Retrying (attempt ${attempt + 1})...` }
              : msg
          ));
        }
      });

      clearTimeout(timeoutId);

      // Handle AI limit reached (propagated from fallback helper)
      if (data.error === 'AI_LIMIT_REACHED' || data.limitReached) {
        addNotification(`AI limit reached: ${data.used}/${data.limit} requests used this month. Upgrade to continue.`, 'error');
        setConversationHistory(prev => prev.slice(0, -1));
        const limitMessage = {
          role: 'system',
          content: `AI Limit Reached\n\nYou've used ${data.used} of ${data.limit} monthly AI requests. To continue using AI features, please upgrade your plan.\n\nClick Settings -> Billing to upgrade now.`,
          isLimit: true
        };
        setConversationHistory(prev => [...prev, limitMessage]);
        return;
      }

      // Add AI response to conversation with fallback metadata
      const aiMessage = {
        role: 'assistant',
        content: data.response,
        provider: data.provider || 'AI',
        // AI FALLBACK: Include fallback metadata for UI display
        fallbackOccurred: data.fallbackOccurred || false,
        originalProvider: data.originalProvider,
        providerTypeUsed: data.providerTypeUsed,
        // FIX 2025-12-03: Mark soft failures for UI warning
        isSoftFailure: data.isSoftFailure || false,
        ...(data.chartData && { chartData: data.chartData }),
        ...(data.chartType && { chartType: data.chartType }),
        ...(data.chartTitle && { chartTitle: data.chartTitle })
      };
      setConversationHistory(prev => [...prev, aiMessage]);

      // FIX 2025-12-03: Show warning notification for soft failures (provider returned error message)
      // This replaces the ALL_PROVIDERS_FAILED banner with a more specific, helpful message
      if (data.isSoftFailure && data.softFailureMessage) {
        addNotification(data.softFailureMessage, 'warning');
      }

      // PHASE 3: Extract performance metrics from response for summary strip
      if (data.performanceContext) {
        setPerformanceMetrics(data.performanceContext);
      }

      // OFFLINE PHASE 4B: Cache AI insight for offline access (quick actions)
      if (organization?.id && lastQuickActionRef.current) {
        const summaryText = extractSummary(data.response);
        saveAIInsight(organization.id, lastQuickActionRef.current, {
          summaryText,
          chartType: data.chartType || null,
          chartData: data.chartData || null,
          metrics: data.performanceContext || null,
        });
      }

    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Error querying AI:', error);

      setConversationHistory(prev => prev.slice(0, -1));

      // TASK 3 WIRE-UP: Use inline error instead of toast for AI failures
      const guidance = getErrorGuidance(error, {
        onRetry: () => {
          setInlineError(null); // Clear error before retry
          handleQuickAction(actionType);
        },
        onNavigate: (view) => setActiveView && setActiveView(VIEWS?.[view])
      });
      setInlineError(guidance);
    } finally {
      setLoading(false);
      setIsSubmitting(false);
      // CONCURRENCY FIX: Release synchronous lock
      submissionLockRef.current = false;
    }
  };

  return (
    <div className="space-y-4">
      {/* NEXT-LEVEL: Error handling now gracefully handled by shared hook (no error UI needed) */}

      {/* OFFLINE: Offline Mode Warning */}
      {!isOnline && (
        <div className="space-y-4">
          {/* Offline Banner */}
          <div className="p-4 bg-slate-800/50 border border-slate-600/50 rounded-lg">
            <div className="flex items-start gap-3">
              <WifiOff className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-200 mb-1">
                  Offline Mode
                </p>
                <p className="text-sm text-slate-400">
                  AI insights require an internet connection, but your pipeline snapshot and last insights are still available.
                </p>
              </div>
            </div>
          </div>

          {/* OFFLINE PHASE 4B: Show offline metrics from cached deals */}
          {offlineSnapshot?.metrics && (
            <MetricsSummaryStrip metrics={offlineSnapshot.metrics} />
          )}

          {/* OFFLINE PHASE 4B: Show offline chart from cached deals */}
          {offlineSnapshot?.chartData && offlineSnapshot.chartData.length > 0 && (
            <div className="p-4 bg-[#0D1419] border border-[#1ABC9C]/20 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-[#1ABC9C]" />
                <p className="text-sm font-medium text-white/90">Pipeline Snapshot</p>
                <span className="text-xs text-white/40 ml-auto">
                  {offlineSnapshot.dealCount} deals
                </span>
              </div>
              <DealAnalyticsChart
                data={offlineSnapshot.chartData}
                type={offlineSnapshot.chartType}
                title="Pipeline Distribution"
              />
            </div>
          )}

          {/* OFFLINE PHASE 4B: Last Synced AI Insight Card */}
          {cachedInsight && cachedInsight.summaryText && (
            <div className="p-4 bg-[#0D1419] border border-[#1ABC9C]/20 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-[#1ABC9C]/20 rounded-lg flex-shrink-0">
                  <History className="w-3.5 h-3.5 text-[#1ABC9C]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-bold text-[#1ABC9C]">Last Synced AI Insight</p>
                    {cachedInsight.quickActionId && (
                      <span className="px-2 py-0.5 bg-[#1ABC9C]/10 text-[#1ABC9C] text-[10px] font-medium rounded-full border border-[#1ABC9C]/20 capitalize">
                        {cachedInsight.quickActionId.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/80 leading-relaxed">
                    {cachedInsight.summaryText}
                  </p>
                  {cachedInsight.timestamp && (
                    <p className="text-xs text-white/40 mt-2">
                      Updated while online on {new Date(cachedInsight.timestamp).toLocaleDateString()} at {new Date(cachedInsight.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FIX 2025-12-03: Auth Error Warning - show session expired message, NOT "no provider" */}
      {aiAuthError && isOnline && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-rose-800 dark:text-rose-300 mb-1">
                Session Expired
              </p>
              <p className="text-sm text-rose-700 dark:text-rose-400 mb-3">
                Your session has expired. Please sign out and sign back in to use AI features.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* No Providers Warning - only show if NO auth error (auth errors handled above) */}
      {!hasProviders && !aiAuthError && isOnline && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <Settings className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">
                AI Provider Required
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
                Connect an AI provider (ChatGPT, Claude, Gemini, or Grok) to use natural language queries.
              </p>
              <button
                onClick={() => setActiveView && setActiveView(VIEWS?.INTEGRATIONS)}
                className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition"
              >
                <span>Configure AI Providers</span>
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SIMPLIFIED: Flat layout - no nested cards, maximum viewport for AI content */}
      {/* ISSUE 6 FIX: Removed fixed heights to allow natural content sizing and prevent double-scroll */}
      <div className="relative flex flex-col min-h-[280px]">
        {/* New Conversation button - subtle, top-right when conversation exists */}
        {conversationHistory.length > 0 && (
          <div className="flex-shrink-0 flex justify-end pb-3">
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-2 text-xs px-3 py-1.5 text-white/50 hover:text-[#0CE3B1] transition-colors duration-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              New Conversation
            </button>
          </div>
        )}

        {/* Scrollable Conversation Area - Maximum space for AI content */}
        <div className="flex-1 overflow-y-auto space-y-6 scroll-smooth" style={{ scrollbarWidth: 'thin', scrollbarColor: '#0CE3B1 rgba(255,255,255,0.05)' }}>

          {/* APMDOS: Goal Summary Bar - Show when user has goals (STATE_D+) */}
          {activationState.hasGoals && activationState.goalProgress && conversationHistory.length === 0 && !loading && (
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-4 mb-2">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[#0CE3B1]" />
                <span className="text-xs font-semibold text-white/80">Goal Progress</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {activationState.goalProgress.monthly && (
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      activationState.goalProgress.monthly.status === 'on_track' ? 'text-emerald-400' :
                      activationState.goalProgress.monthly.status === 'at_risk' ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {activationState.goalProgress.monthly.percent}%
                    </div>
                    <div className="text-[10px] text-white/40">Monthly</div>
                  </div>
                )}
                {activationState.goalProgress.quarterly && (
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      activationState.goalProgress.quarterly.status === 'on_track' ? 'text-emerald-400' :
                      activationState.goalProgress.quarterly.status === 'at_risk' ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {activationState.goalProgress.quarterly.percent}%
                    </div>
                    <div className="text-[10px] text-white/40">Quarterly</div>
                  </div>
                )}
                {activationState.goalProgress.annual && (
                  <div className="text-center">
                    <div className={`text-lg font-bold ${
                      activationState.goalProgress.annual.status === 'on_track' ? 'text-emerald-400' :
                      activationState.goalProgress.annual.status === 'at_risk' ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {activationState.goalProgress.annual.percent}%
                    </div>
                    <div className="text-[10px] text-white/40">Annual</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* APMDOS: Adaptive Welcome State */}
          {conversationHistory.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">

              {/* STATE_A: No AI Connected - Setup Prompt */}
              {/* PLAN_MY_DAY_UX: Full-width layout */}
              {activationState.state === 'A' && (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/20 flex items-center justify-center">
                    <Settings className="w-7 h-7 text-amber-400" strokeWidth={1.5} />
                  </div>
                  <div className="text-center w-full max-w-lg space-y-4">
                    <p className="text-base text-white/80 font-medium">
                      Connect your AI to unlock coaching
                    </p>
                    <p className="text-sm text-white/50">
                      Add your OpenAI, Anthropic, or Google AI key to get personalized daily plans and deal insights.
                    </p>
                    <button
                      onClick={() => setActiveView && setActiveView(VIEWS?.SETTINGS)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 text-white font-semibold rounded-xl hover:scale-[1.02] transition-all shadow-lg shadow-[#0CE3B1]/20"
                    >
                      <Settings className="w-4 h-4" />
                      Connect AI Provider
                    </button>
                  </div>
                </>
              )}

              {/* STATE_B: No Deals - Onboarding Wizard */}
              {/* PLAN_MY_DAY_UX: Full-width layout */}
              {activationState.state === 'B' && (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/15 to-[#0CE3B1]/5 border border-[#0CE3B1]/15 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-[#0CE3B1]" strokeWidth={1.5} />
                  </div>
                  <div className="text-center w-full max-w-lg space-y-4">
                    <p className="text-base text-white/80 font-medium">
                      Welcome! Let's set you up in 30 seconds.
                    </p>
                    <div className="space-y-3 text-left bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#0CE3B1]/20 flex items-center justify-center text-xs font-bold text-[#0CE3B1]">1</div>
                        <span className="text-sm text-white/70">Create your first deal or import from CSV</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50">2</div>
                        <span className="text-sm text-white/50">Set your annual revenue goal</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50">3</div>
                        <span className="text-sm text-white/50">Get daily AI coaching</span>
                      </div>
                    </div>
                    <p className="text-xs text-white/40">
                      Go to the Pipeline tab to add your first deal.
                    </p>
                  </div>
                </>
              )}

              {/* STATE_C: Few Deals (<5) - Activation Tasks */}
              {/* PLAN_MY_DAY_UX: Full-width layout */}
              {activationState.state === 'C' && (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/15 to-[#0CE3B1]/5 border border-[#0CE3B1]/15 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-[#0CE3B1]" strokeWidth={1.5} />
                  </div>
                  <div className="text-center w-full max-w-lg space-y-4">
                    <p className="text-base text-white/80 font-medium">
                      Great start! Here's how to get more value:
                    </p>
                    <div className="space-y-2 text-left bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
                      <div className="flex items-center gap-2 text-sm text-white/60">
                        <CheckCircle className="w-4 h-4 text-[#0CE3B1]" />
                        <span>Add confidence scores to your deals</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-white/60">
                        <CheckCircle className="w-4 h-4 text-[#0CE3B1]" />
                        <span>Set expected close dates</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-white/60">
                        <CheckCircle className="w-4 h-4 text-[#0CE3B1]" />
                        <span>Import more contacts from your CRM</span>
                      </div>
                    </div>
                    {/* ISSUE 4 FIX: Still show Plan My Day for users with some deals, but respect daily limit */}
                    {hasProviders && isOnline && !planMyDayRunToday && (
                      <PlanMyDayButton
                        onClick={() => handleQuickAction('plan_my_day')}
                        disabled={loading || isSubmitting}
                        loading={loading && lastQuickActionRef.current === 'plan_my_day'}
                      />
                    )}
                    {planMyDayRunToday && (
                      <p className="text-xs text-[#0CE3B1]/70">
                        ✓ Today's plan is ready — check Tasks tab
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* STATE_D & E: Has Goals or Fully Activated - Standard Plan My Day */}
              {/* PLAN_MY_DAY_UX: Full-width layout, no interior window */}
              {(activationState.state === 'D' || activationState.state === 'E') && (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0CE3B1]/15 to-[#0CE3B1]/5 border border-[#0CE3B1]/15 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-[#0CE3B1]" strokeWidth={1.5} />
                  </div>
                  <div className="text-center w-full max-w-lg space-y-4">
                    {/* ISSUE 4 FIX: Show different message if Plan My Day was already run today */}
                    {planMyDayRunToday ? (
                      <>
                        <p className="text-base text-white/80 font-medium">
                          Today's plan is ready above ↑
                        </p>
                        <p className="text-xs text-white/40 pt-2">
                          Check your Tasks tab or scroll up to see your daily plan.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-base text-white/80 font-medium">
                          Start your day with a quick plan.
                        </p>
                        {hasProviders && isOnline && (
                          <PlanMyDayButton
                            onClick={() => handleQuickAction('plan_my_day')}
                            disabled={loading || isSubmitting}
                            loading={loading && lastQuickActionRef.current === 'plan_my_day'}
                          />
                        )}
                      </>
                    )}
                    <p className="text-xs text-white/40 pt-2">
                      Or ask anything about your deals in the chat box below.
                    </p>
                  </div>
                </>
              )}

              {/* PLAN_MY_DAY_UX: Smart Onboarding Helper Tips */}
              {/* iPhone-style mini tips stacked vertically, dismissed individually */}
              {activationState.tips.length > 0 && (
                <div className="w-full max-w-lg mt-4 space-y-2">
                  {activationState.tips.map(tip => (
                    <div
                      key={tip.id}
                      className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/[0.05] transition-all duration-200 hover:bg-white/[0.03]"
                    >
                      <Info className="w-4 h-4 text-[#0CE3B1] flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-white/60 leading-relaxed">{tip.text}</p>
                        <button
                          onClick={() => tip.dismiss()}
                          className="text-[10px] text-[#0CE3B1]/60 hover:text-[#0CE3B1] mt-1.5 font-medium transition-colors"
                        >
                          Got it
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Conversation Messages */}
          {conversationHistory.map((message, idx) => (
            <div key={idx} className="animate-[fadeIn_0.3s_ease-out]">
              {message.role === 'user' ? (
                /* User Message */
                <div className="flex justify-end">
                  <div className="max-w-[85%] sm:max-w-[75%] p-4 bg-gradient-to-br from-[#0CE3B1]/15 to-[#0CE3B1]/5 border border-[#0CE3B1]/20 rounded-2xl rounded-tr-md shadow-[0_4px_20px_rgba(12,227,177,0.08)] transition-all duration-300">
                    <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                </div>
              ) : message.role === 'system' && message.isLimit ? (
                /* System Limit Warning */
                <div className="flex justify-center">
                  <div className="max-w-[90%] p-4 bg-rose-900/30 border-2 border-rose-500/50 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 bg-rose-500/20 rounded-lg flex-shrink-0">
                        <AlertCircle className="w-4 h-4 text-rose-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                          {message.content}
                        </p>
                        <button
                          onClick={() => setActiveView && setActiveView(VIEWS?.SETTINGS)}
                          className="mt-3 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg transition"
                        >
                          Upgrade Plan
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* AI Message */
                <div className="flex justify-start">
                  <div className="max-w-[85%] sm:max-w-[75%] p-5 bg-white/[0.03] backdrop-blur-md border border-white/[0.07] rounded-2xl rounded-tl-md shadow-[0_4px_24px_rgba(0,0,0,0.12)] transition-all duration-300">
                    <div className="flex items-start gap-3.5">
                      <div className="p-2 bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 rounded-xl flex-shrink-0 shadow-[0_2px_8px_rgba(12,227,177,0.1)]">
                        <Sparkles className="w-4 h-4 text-[#0CE3B1]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-3 pb-2 border-b border-white/[0.05]">
                          <p className="text-xs font-bold text-[#0CE3B1] tracking-wide">AI</p>
                          {message.provider && (
                            <span className="px-2.5 py-0.5 bg-gradient-to-r from-[#0CE3B1]/15 to-[#0CE3B1]/5 text-[#0CE3B1] text-[10px] font-bold rounded-full border border-[#0CE3B1]/20">
                              {message.provider}
                            </span>
                          )}
                        </div>
                        {/* AI FALLBACK: Show notice when a fallback provider was used */}
                        {message.fallbackOccurred && message.originalProvider && message.providerTypeUsed && (
                          <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-300/90">
                              {generateFallbackNotice(message.originalProvider, message.providerTypeUsed)}
                            </p>
                          </div>
                        )}
                        <div className="text-sm text-white/90 leading-relaxed">
                          {/* PHASE 19B: Show summary strip for Plan My Day responses */}
                          {!message.streaming && message.structuredResponse?.response_type === 'plan_my_day' && (
                            <PlanMyDaySummary
                              structuredResponse={message.structuredResponse}
                              content={message.content}
                            />
                          )}
                          {renderMarkdown(message.content)}
                          {message.streaming && (
                            <span className="inline-block w-1.5 h-4 ml-1 bg-[#1ABC9C] animate-pulse" />
                          )}
                        </div>

                        {/* MEDIUM-02 FIX: Render chart with error boundary to prevent conversation crash */}
                        {message.chartData && message.chartType && (
                          <div className="mt-4">
                            {(() => {
                              try {
                                return (
                                  <DealAnalyticsChart
                                    data={message.chartData}
                                    type={message.chartType}
                                    title={message.chartTitle}
                                  />
                                );
                              } catch (chartError) {
                                console.error('Chart render error:', chartError);
                                return (
                                  <div className="p-4 bg-amber-900/20 border border-amber-500/30 rounded-xl text-sm text-amber-200">
                                    Chart unavailable. The data could not be rendered.
                                  </div>
                                );
                              }
                            })()}
                          </div>
                        )}

                        {/* PHASE 17: Plan My Day Checklist with localStorage persistence */}
                        {!message.streaming && message.structuredResponse &&
                         message.structuredResponse.response_type === 'plan_my_day' && (
                          <PlanMyDayChecklist
                            structuredResponse={message.structuredResponse}
                            organizationId={organization?.id}
                          />
                        )}

                        {/* PHASE 5.2: Execution Micro-Buttons after Plan My Day responses */}
                        {/* HIGH-01 FIX: Use lastQuickActionRef instead of searching message content */}
                        {/* Show when: response is complete, this is the last assistant message, and it was from plan_my_day */}
                        {!message.streaming && idx === conversationHistory.length - 1 &&
                         message.role === 'assistant' && lastQuickActionRef.current === 'plan_my_day' && (
                          <div className="mt-4 pt-4 border-t border-[#1ABC9C]/10">
                            <p className="text-xs text-white/50 mb-2 font-medium">Take action on a specific deal:</p>
                            <ActionMicroButtonGroup
                              dealId={null}
                              dealName="selected deal"
                              contactName={null}
                              companyName={null}
                              onDraftMessage={(ctx) => handleDraftMessage({ ...ctx, dealName: 'the deal you specify' })}
                              onResearchCompany={(ctx) => handleResearchCompany({ ...ctx, dealName: 'the company you specify' })}
                              onPrepareConversation={(ctx) => handlePrepareConversation({ ...ctx, dealName: 'the conversation you specify' })}
                              onFollowUpPlan={(ctx) => handleFollowUpPlan({ ...ctx, dealName: 'the deal you specify' })}
                              isOffline={!isOnline}
                              loadingAction={executionLoading}
                            />
                            <p className="text-[10px] text-white/30 mt-2">
                              Click an action, then specify the deal in your follow-up message
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading State - Elegant Wave Animation */}
          {loading && (
            <div className="flex justify-start animate-[fadeIn_0.3s_ease-out]">
              <div className="max-w-[85%] sm:max-w-[75%] p-5 bg-white/[0.03] backdrop-blur-md border border-white/[0.07] rounded-2xl rounded-tl-md shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
                <div className="flex items-center gap-3.5">
                  <div className="p-2 bg-gradient-to-br from-[#0CE3B1]/20 to-[#0CE3B1]/5 rounded-xl shadow-[0_2px_8px_rgba(12,227,177,0.1)]">
                    <Sparkles className="w-4 h-4 text-[#0CE3B1] animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white/70 font-medium">AI is thinking</p>
                    <div className="flex gap-1.5 ml-1">
                      <span className="w-1.5 h-1.5 bg-[#0CE3B1] rounded-full animate-bounce shadow-[0_0_8px_rgba(12,227,177,0.5)]" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[#0CE3B1] rounded-full animate-bounce shadow-[0_0_8px_rgba(12,227,177,0.5)]" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[#0CE3B1] rounded-full animate-bounce shadow-[0_0_8px_rgba(12,227,177,0.5)]" style={{ animationDelay: '300ms' }}></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Invisible scroll anchor */}
          <div ref={conversationEndRef} />
        </div>

        {/* Fixed Input Area at Bottom - Simplified, no heavy borders */}
        <div className="flex-shrink-0 pt-4 sticky bottom-0 z-10">
          {/* PHASE 5.1: New AI UX Surface - Hero Button + Insight Chips */}
          {/* OFFLINE: Hide quick actions when offline */}
          {/* LAUNCH: Only show when conversation exists (Plan My Day is in welcome state when empty) */}
          {hasProviders && isOnline && conversationHistory.length > 0 && (
            <div className="mb-4 space-y-4">
              {/* HERO BUTTON: Plan My Day - Primary CTA */}
              {/* ISSUE 4 FIX: Hide if already run today */}
              {!planMyDayRunToday && (
                <PlanMyDayButton
                  onClick={() => handleQuickAction('plan_my_day')}
                  disabled={loading || isSubmitting}
                  loading={loading && lastQuickActionRef.current === 'plan_my_day'}
                />
              )}

              {/* SECONDARY ACTIONS - Extremely subtle text-only buttons */}
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={() => handleQuickAction('weekly_trends')}
                  disabled={loading || isSubmitting}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="View weekly deal activity trends"
                >
                  {loading && lastQuickActionRef.current === 'weekly_trends' ? 'Loading...' : 'Weekly Trends'}
                </button>

                <span className="text-white/20">•</span>

                <button
                  onClick={() => handleQuickAction('momentum_insights')}
                  disabled={loading || isSubmitting}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Identify deals that need momentum attention"
                >
                  {loading && lastQuickActionRef.current === 'momentum_insights' ? 'Loading...' : 'Momentum Insights'}
                </button>

                <span className="text-white/20">•</span>

                <button
                  onClick={() => handleQuickAction('flow_forecast')}
                  disabled={loading || isSubmitting}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Pipeline distribution and revenue forecast"
                >
                  {loading && lastQuickActionRef.current === 'flow_forecast' ? 'Loading...' : 'Forecast'}
                </button>
              </div>
            </div>
          )}

          {/* TASK 3 WIRE-UP: Inline error display for AI failures */}
          {inlineError && (
            <AIInlineError
              message={inlineError.message}
              action={inlineError.action}
              severity={inlineError.severity}
              onDismiss={() => setInlineError(null)}
              className="mb-3"
            />
          )}

          <div className="relative">
            <textarea
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Clear inline error when user starts typing
                if (inlineError) setInlineError(null);
              }}
              onKeyDown={handleKeyPress}
              placeholder={
                !isOnline
                  ? "AI is unavailable offline. Your deals sync when you reconnect."
                  : hasProviders
                    ? "Ask anything about your pipeline..."
                    : "Configure an AI provider to use this feature..."
              }
              className="w-full p-4 pr-14 bg-white/[0.03] border border-white/[0.1] rounded-2xl focus:ring-2 focus:ring-[#0CE3B1]/50 focus:border-[#0CE3B1]/40 text-white placeholder-white/40 resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]"
              rows="2"
              disabled={loading || !hasProviders || !isOnline}
            />
            <button
              onClick={handleQueryStreaming}
              disabled={loading || isSubmitting || !query.trim() || !hasProviders || !isOnline}
              className={`absolute bottom-3 right-3 p-2.5 rounded-xl transition-all duration-300 ${
                loading || isSubmitting || !query.trim() || !hasProviders || !isOnline
                  ? 'bg-white/[0.05] cursor-not-allowed opacity-40'
                  : 'bg-gradient-to-br from-[#0CE3B1] to-[#0CE3B1]/80 hover:from-[#0CE3B1] hover:to-[#16A085] hover:scale-105 shadow-[0_4px_16px_rgba(12,227,177,0.3)] hover:shadow-[0_6px_20px_rgba(12,227,177,0.4)]'
              }`}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Send className="w-5 h-5 text-white" />
              )}
            </button>
          </div>

          {/* QA FIX #4: AI Usage Limit Indicator */}
          {organization?.id && (
            <div className="flex justify-end mt-2">
              <AIUsageIndicator
                organizationId={organization.id}
                onNavigate={(view) => setActiveView && setActiveView(VIEWS?.[view])}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
