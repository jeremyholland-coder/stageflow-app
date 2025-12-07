/**
 * Backend Telemetry Utilities
 * Phase 1 - Observability
 *
 * Provides:
 * - Correlation ID extraction from request headers
 * - High-level metrics tracking (counters, no PII)
 * - Request context helpers
 *
 * NO PII is logged - only:
 * - correlationId
 * - endpoint + method
 * - status code / error code
 * - high-level event names (ai_call_failed, deal_update_success, etc.)
 */

import { captureBackendError, addBackendBreadcrumb, setBackendCorrelationId } from './sentry-backend';

// ============================================================================
// CORRELATION ID HANDLING
// ============================================================================

/**
 * Extract correlation ID from request headers
 * Falls back to generating a new ID if not present (for direct API calls)
 *
 * Header: X-Correlation-ID
 * Format: sf-{timestamp_base36}-{random_suffix}
 */
export const extractCorrelationId = (req: Request): string => {
  const fromHeader = req.headers.get('X-Correlation-ID');

  if (fromHeader && fromHeader.startsWith('sf-')) {
    return fromHeader;
  }

  // Generate new correlation ID for direct API calls (not from frontend)
  return generateCorrelationId();
};

/**
 * Generate a new correlation ID
 * Format: sf-{timestamp_base36}-{random_suffix}
 */
export const generateCorrelationId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  return `sf-${timestamp}-${randomSuffix}`;
};

/**
 * Extract request start time from headers (set by frontend)
 * Used to calculate total request duration including network latency
 */
export const extractRequestStartTime = (req: Request): number | null => {
  const startTimeHeader = req.headers.get('X-Request-Start');
  if (startTimeHeader) {
    const parsed = parseInt(startTimeHeader, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

// ============================================================================
// TELEMETRY EVENT TRACKING
// ============================================================================

/**
 * Standard telemetry event names (snake_case)
 * These are high-level events for aggregation, not detailed logs
 */
export const TelemetryEvents = {
  // AI Events
  AI_CALL_START: 'ai_call_start',
  AI_CALL_SUCCESS: 'ai_call_success',
  AI_CALL_FAILED: 'ai_call_failed',
  AI_PROVIDER_FALLBACK: 'ai_provider_fallback',
  AI_ALL_PROVIDERS_FAILED: 'ai_all_providers_failed',

  // Deal Events
  DEAL_UPDATE_START: 'deal_update_start',
  DEAL_UPDATE_SUCCESS: 'deal_update_success',
  DEAL_UPDATE_FAILED: 'deal_update_failed',
  DEAL_STAGE_CHANGE: 'deal_stage_change',

  // Auth Events
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILED: 'auth_failed',

  // Pipeline Events
  PIPELINE_LOAD: 'pipeline_load',
} as const;

export type TelemetryEventName = typeof TelemetryEvents[keyof typeof TelemetryEvents];

/**
 * Track a telemetry event
 * Only logs: correlationId, eventName, metadata (no PII)
 *
 * @param eventName - High-level event name (use TelemetryEvents constants)
 * @param correlationId - Request correlation ID
 * @param metadata - Additional safe metadata (no PII)
 */
export const trackTelemetryEvent = (
  eventName: TelemetryEventName | string,
  correlationId: string,
  metadata: Record<string, string | number | boolean | undefined> = {}
): void => {
  // Add breadcrumb to Sentry
  addBackendBreadcrumb(eventName, {
    correlationId,
    ...Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, v !== undefined ? String(v) : undefined])
    ),
  });

  // Log to console (Netlify captures these)
  // Production-safe: only event name + correlationId + safe metadata
  console.log(`[Telemetry] ${eventName}`, {
    correlationId,
    ...metadata,
    timestamp: Date.now(),
  });
};

// ============================================================================
// REQUEST CONTEXT
// ============================================================================

export interface RequestContext {
  correlationId: string;
  endpoint: string;
  method: string;
  startTime: number;
  frontendStartTime: number | null;
}

/**
 * Build request context from incoming request
 * Use this at the start of each function handler
 */
export const buildRequestContext = (req: Request, endpoint: string): RequestContext => {
  const correlationId = extractCorrelationId(req);
  const frontendStartTime = extractRequestStartTime(req);

  // Set correlation ID in Sentry scope
  setBackendCorrelationId(correlationId);

  return {
    correlationId,
    endpoint,
    method: req.method,
    startTime: Date.now(),
    frontendStartTime,
  };
};

/**
 * Calculate request duration
 */
export const calculateDuration = (ctx: RequestContext): number => {
  return Date.now() - ctx.startTime;
};

/**
 * Calculate total duration including frontend-to-backend network time
 */
export const calculateTotalDuration = (ctx: RequestContext): number | null => {
  if (ctx.frontendStartTime) {
    return Date.now() - ctx.frontendStartTime;
  }
  return null;
};

// ============================================================================
// METRIC HELPERS (for specific use cases)
// ============================================================================

/**
 * Track AI call metrics
 * Only logs: correlationId, provider, taskType, success, durationMs
 */
export const trackAICall = (
  correlationId: string,
  provider: string,
  taskType: string,
  success: boolean,
  durationMs: number,
  errorCode?: string
): void => {
  const eventName = success ? TelemetryEvents.AI_CALL_SUCCESS : TelemetryEvents.AI_CALL_FAILED;

  trackTelemetryEvent(eventName, correlationId, {
    provider,
    taskType,
    success,
    durationMs,
    errorCode,
  });
};

/**
 * Track AI provider fallback
 * Only logs: correlationId, fromProvider, toProvider, reason
 */
export const trackAIFallback = (
  correlationId: string,
  fromProvider: string,
  toProvider: string,
  reason: string
): void => {
  trackTelemetryEvent(TelemetryEvents.AI_PROVIDER_FALLBACK, correlationId, {
    fromProvider,
    toProvider,
    reason,
  });
};

/**
 * Track deal update metrics
 * Only logs: correlationId, success, hasStageChange, durationMs
 */
export const trackDealUpdate = (
  correlationId: string,
  success: boolean,
  hasStageChange: boolean,
  durationMs: number,
  errorCode?: string
): void => {
  const eventName = success ? TelemetryEvents.DEAL_UPDATE_SUCCESS : TelemetryEvents.DEAL_UPDATE_FAILED;

  trackTelemetryEvent(eventName, correlationId, {
    success,
    hasStageChange,
    durationMs,
    errorCode,
  });

  // Track stage change as separate event
  if (success && hasStageChange) {
    trackTelemetryEvent(TelemetryEvents.DEAL_STAGE_CHANGE, correlationId, {});
  }
};

/**
 * Track request error
 * Captures to Sentry with safe context
 */
export const trackError = (
  error: Error,
  ctx: RequestContext,
  errorCode?: string
): void => {
  captureBackendError(error, {
    correlationId: ctx.correlationId,
    endpoint: ctx.endpoint,
    method: ctx.method,
    errorCode,
  });
};

// ============================================================================
// LIGHTWEIGHT METRIC ROLLUPS (Phase 1 - Area 1 Completion)
// ============================================================================

/**
 * In-memory metric counters for aggregate tracking
 * These reset on cold start but provide useful rollup data within function invocations
 * Logged to console for Netlify log aggregation (searchable via [Metrics])
 */
const metricCounters: Record<string, number> = {
  ai_calls_total: 0,
  ai_calls_success: 0,
  ai_calls_failed: 0,
  ai_fallbacks: 0,
  deal_updates_total: 0,
  deal_updates_success: 0,
  deal_updates_failed: 0,
  stage_changes: 0,
};

const providerCounters: Record<string, { success: number; failed: number }> = {};

// Log rollup summary every N events
const ROLLUP_INTERVAL = 50;
let eventsSinceLastRollup = 0;

/**
 * Increment a metric counter
 */
const incrementMetric = (metric: string, count: number = 1): void => {
  metricCounters[metric] = (metricCounters[metric] || 0) + count;
  eventsSinceLastRollup++;

  // Log rollup summary periodically
  if (eventsSinceLastRollup >= ROLLUP_INTERVAL) {
    logMetricRollup();
    eventsSinceLastRollup = 0;
  }
};

/**
 * Track provider-specific metrics
 */
const incrementProviderMetric = (provider: string, success: boolean): void => {
  if (!providerCounters[provider]) {
    providerCounters[provider] = { success: 0, failed: 0 };
  }
  if (success) {
    providerCounters[provider].success++;
  } else {
    providerCounters[provider].failed++;
  }
};

/**
 * Log metric rollup summary
 * Format: [Metrics] { ... } - searchable in Netlify logs
 */
const logMetricRollup = (): void => {
  const aiSuccessRate = metricCounters.ai_calls_total > 0
    ? ((metricCounters.ai_calls_success / metricCounters.ai_calls_total) * 100).toFixed(1)
    : 'N/A';

  const dealSuccessRate = metricCounters.deal_updates_total > 0
    ? ((metricCounters.deal_updates_success / metricCounters.deal_updates_total) * 100).toFixed(1)
    : 'N/A';

  console.log('[Metrics] Rollup Summary', {
    timestamp: Date.now(),
    ai: {
      total: metricCounters.ai_calls_total,
      success: metricCounters.ai_calls_success,
      failed: metricCounters.ai_calls_failed,
      successRate: aiSuccessRate + '%',
      fallbacks: metricCounters.ai_fallbacks,
    },
    deals: {
      total: metricCounters.deal_updates_total,
      success: metricCounters.deal_updates_success,
      failed: metricCounters.deal_updates_failed,
      successRate: dealSuccessRate + '%',
      stageChanges: metricCounters.stage_changes,
    },
    providers: providerCounters,
  });
};

/**
 * Get current metric snapshot (for debugging/diagnostics)
 */
export const getMetricSnapshot = (): Record<string, any> => ({
  counters: { ...metricCounters },
  providers: { ...providerCounters },
  timestamp: Date.now(),
});

/**
 * Enhanced AI call tracking with metric rollups
 */
export const trackAICallWithMetrics = (
  correlationId: string,
  provider: string,
  taskType: string,
  success: boolean,
  durationMs: number,
  errorCode?: string
): void => {
  // Original tracking
  trackAICall(correlationId, provider, taskType, success, durationMs, errorCode);

  // Metric rollups
  incrementMetric('ai_calls_total');
  incrementMetric(success ? 'ai_calls_success' : 'ai_calls_failed');
  incrementProviderMetric(provider, success);
};

/**
 * Enhanced deal update tracking with metric rollups
 */
export const trackDealUpdateWithMetrics = (
  correlationId: string,
  success: boolean,
  hasStageChange: boolean,
  durationMs: number,
  errorCode?: string
): void => {
  // Original tracking
  trackDealUpdate(correlationId, success, hasStageChange, durationMs, errorCode);

  // Metric rollups
  incrementMetric('deal_updates_total');
  incrementMetric(success ? 'deal_updates_success' : 'deal_updates_failed');
  if (success && hasStageChange) {
    incrementMetric('stage_changes');
  }
};

/**
 * Enhanced fallback tracking with metric rollups
 */
export const trackAIFallbackWithMetrics = (
  correlationId: string,
  fromProvider: string,
  toProvider: string,
  reason: string
): void => {
  // Original tracking
  trackAIFallback(correlationId, fromProvider, toProvider, reason);

  // Metric rollups
  incrementMetric('ai_fallbacks');
};

export default {
  extractCorrelationId,
  generateCorrelationId,
  buildRequestContext,
  trackTelemetryEvent,
  trackAICall,
  trackAIFallback,
  trackDealUpdate,
  trackError,
  TelemetryEvents,
  // Phase 1 Area 1: Metric rollups
  getMetricSnapshot,
  trackAICallWithMetrics,
  trackDealUpdateWithMetrics,
  trackAIFallbackWithMetrics,
};
