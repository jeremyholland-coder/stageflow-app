/**
 * Supabase Performance Metrics
 *
 * Tracks database operations for monitoring and alerting.
 * Integrates with Sentry for production monitoring.
 *
 * Metrics tracked:
 * - Query duration
 * - Success/error rates
 * - Connection pool utilization
 * - Rate limit hits
 * - Slow query detection
 */

interface MetricOptions {
  operation: string;
  table?: string;
  method?: string;
}

interface QueryMetrics {
  duration: number;
  success: boolean;
  operation: string;
  table?: string;
  error?: string;
}

// In-memory metrics aggregation
const metrics = {
  totalQueries: 0,
  successfulQueries: 0,
  failedQueries: 0,
  totalDuration: 0,
  slowQueries: 0,
  rateLimitHits: 0
};

/**
 * Track Supabase operation metrics
 *
 * @param operation - Async database operation
 * @param options - Metric metadata
 * @returns Operation result
 */
export async function withMetrics<T>(
  operation: () => Promise<T>,
  options: MetricOptions
): Promise<T> {
  const start = Date.now();
  let success = false;
  let error: any = null;

  try {
    const result = await operation();
    success = true;
    metrics.totalQueries++;
    metrics.successfulQueries++;

    return result;
  } catch (err) {
    error = err;
    metrics.totalQueries++;
    metrics.failedQueries++;
    throw err;
  } finally {
    const duration = Date.now() - start;
    metrics.totalDuration += duration;

    // Track slow queries (> 1 second)
    if (duration > 1000) {
      metrics.slowQueries++;
      console.warn('[Supabase Metrics] Slow query detected', {
        operation: options.operation,
        table: options.table,
        duration,
        threshold: 1000
      });
    }

    // Log metrics
    logMetric({
      duration,
      success,
      operation: options.operation,
      table: options.table,
      error: error?.message
    });

    // Send to Sentry if available
    if (typeof window !== 'undefined' && window.Sentry) {
      window.Sentry.metrics.gauge('supabase.query.duration', duration, {
        tags: {
          operation: options.operation,
          table: options.table || 'unknown',
          success: success.toString()
        }
      });
    }
  }
}

/**
 * Log metric to console (structured logging)
 */
function logMetric(metric: QueryMetrics): void {
  const level = metric.success ? 'info' : 'error';
  const emoji = metric.success ? '✅' : '❌';

  if (process.env.NODE_ENV === 'development') {
    console[level](`${emoji} [Supabase] ${metric.operation}`, {
      duration: `${metric.duration}ms`,
      table: metric.table,
      error: metric.error
    });
  }
}

/**
 * Get aggregated metrics (for monitoring dashboards)
 */
export function getMetrics() {
  const avgDuration = metrics.totalQueries > 0
    ? metrics.totalDuration / metrics.totalQueries
    : 0;

  const successRate = metrics.totalQueries > 0
    ? (metrics.successfulQueries / metrics.totalQueries) * 100
    : 100;

  return {
    ...metrics,
    avgDuration: Math.round(avgDuration),
    successRate: Math.round(successRate * 100) / 100
  };
}

/**
 * Reset metrics (useful for testing)
 */
export function resetMetrics(): void {
  metrics.totalQueries = 0;
  metrics.successfulQueries = 0;
  metrics.failedQueries = 0;
  metrics.totalDuration = 0;
  metrics.slowQueries = 0;
  metrics.rateLimitHits = 0;
}

/**
 * Track rate limit hit
 */
export function trackRateLimitHit(identifier: string): void {
  metrics.rateLimitHits++;

  console.warn('[Supabase Metrics] Rate limit hit', {
    identifier,
    totalHits: metrics.rateLimitHits
  });

  // Alert if rate limit hits are high
  if (metrics.rateLimitHits > 100) {
    console.error('[Supabase Metrics] HIGH RATE LIMIT ACTIVITY', {
      hits: metrics.rateLimitHits,
      recommendation: 'Consider increasing rate limits or optimizing client code'
    });
  }
}

/**
 * Helper wrapper for Supabase queries with automatic metrics
 *
 * Usage:
 *   const result = await withSupabaseMetrics(
 *     () => supabase.from('deals').select('*'),
 *     { operation: 'SELECT', table: 'deals' }
 *   );
 */
export async function withSupabaseMetrics<T>(
  query: () => Promise<{ data: T | null; error: any }>,
  options: MetricOptions
): Promise<{ data: T | null; error: any }> {
  return withMetrics(query, options);
}

/**
 * Create Sentry transaction for database operations
 * (for production performance monitoring)
 */
export function createSupabaseTransaction(operation: string) {
  if (typeof window !== 'undefined' && window.Sentry) {
    return window.Sentry.startTransaction({
      name: `supabase.${operation}`,
      op: 'db.query'
    });
  }
  return null;
}
