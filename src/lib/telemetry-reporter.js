/**
 * TELEMETRY REPORTER MODULE
 *
 * Phase 5: Telemetry Intelligence & Safety Nets
 *
 * Provides throttled, deduplicated telemetry reporting to prevent:
 * - Flooding Sentry with duplicate errors
 * - Overwhelming the user with repeated error toasts
 * - Masking systemic issues with noise
 *
 * Features:
 * - Per-category throttling (e.g., max 5 invariant violations per minute)
 * - Deduplication by error signature (same error = same signature)
 * - Breach rate metrics (track violation frequency)
 * - Automatic escalation when breach rate exceeds threshold
 *
 * Usage:
 * ```javascript
 * import { telemetryReporter } from './telemetry-reporter';
 *
 * // Report an invariant violation (throttled)
 * telemetryReporter.reportInvariantViolation('MISSING_DEAL', {
 *   context: 'update-deal',
 *   responseKeys: ['success', 'error']
 * });
 *
 * // Report a UX regression (throttled)
 * telemetryReporter.reportUXRegression('blank_state', {
 *   component: 'KanbanBoard',
 *   expectedData: 'deals'
 * });
 *
 * // Get breach rate metrics
 * const metrics = telemetryReporter.getBreachMetrics();
 * ```
 */

import { captureMessage, captureError, trackEvent } from './sentry';

// ============================================================================
// THROTTLE CONFIGURATION
// ============================================================================

/**
 * Throttle configuration per category
 * Prevents flooding Sentry with duplicate events
 */
const THROTTLE_CONFIG = {
  // Invariant violations: max 5 per minute per error code
  invariant: {
    maxPerWindow: 5,
    windowMs: 60000, // 1 minute
    escalationThreshold: 10, // If 10+ unique violations in window, escalate
  },
  // UX regressions: max 3 per minute per component
  ux_regression: {
    maxPerWindow: 3,
    windowMs: 60000,
    escalationThreshold: 5,
  },
  // Auth anomalies: max 3 per minute per user
  auth_anomaly: {
    maxPerWindow: 3,
    windowMs: 60000,
    escalationThreshold: 5,
  },
  // Session errors: max 2 per minute (prevent spam on session issues)
  session_error: {
    maxPerWindow: 2,
    windowMs: 60000,
    escalationThreshold: 5,
  },
  // Blank state detection: max 3 per minute per component
  blank_state: {
    maxPerWindow: 3,
    windowMs: 60000,
    escalationThreshold: 5,
  },
};

// ============================================================================
// THROTTLE STATE
// ============================================================================

/**
 * Track events per category for throttling
 * Structure: { category: { signature: { count, firstSeen, lastSeen, suppressed } } }
 */
const throttleState = new Map();

/**
 * Track breach rates for metrics
 * Structure: { category: { total, unique, suppressed, escalated } }
 */
const breachMetrics = {
  invariant: { total: 0, unique: 0, suppressed: 0, escalated: false },
  ux_regression: { total: 0, unique: 0, suppressed: 0, escalated: false },
  auth_anomaly: { total: 0, unique: 0, suppressed: 0, escalated: false },
  session_error: { total: 0, unique: 0, suppressed: 0, escalated: false },
  blank_state: { total: 0, unique: 0, suppressed: 0, escalated: false },
};

// ============================================================================
// THROTTLE LOGIC
// ============================================================================

/**
 * Generate a unique signature for an event (for deduplication)
 */
const generateSignature = (category, code, details = {}) => {
  // Include only stable fields in signature (not timestamps, not random IDs)
  const stableDetails = {};
  for (const [key, value] of Object.entries(details)) {
    // Exclude volatile fields
    if (!['timestamp', 'correlationId', 'requestId'].includes(key)) {
      stableDetails[key] = value;
    }
  }
  return `${category}:${code}:${JSON.stringify(stableDetails)}`;
};

/**
 * Check if an event should be reported (not throttled)
 * Returns: { shouldReport: boolean, isEscalation: boolean }
 */
const shouldReportEvent = (category, signature) => {
  const config = THROTTLE_CONFIG[category] || THROTTLE_CONFIG.invariant;
  const now = Date.now();

  // Initialize category state
  if (!throttleState.has(category)) {
    throttleState.set(category, new Map());
  }
  const categoryState = throttleState.get(category);

  // Clean expired entries
  for (const [sig, data] of categoryState.entries()) {
    if (now - data.firstSeen > config.windowMs) {
      categoryState.delete(sig);
    }
  }

  // Check this signature
  const signatureData = categoryState.get(signature);

  if (!signatureData) {
    // First occurrence - always report
    categoryState.set(signature, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
      suppressed: 0,
    });
    breachMetrics[category].unique++;
    breachMetrics[category].total++;
    return { shouldReport: true, isEscalation: false };
  }

  // Update count
  signatureData.count++;
  signatureData.lastSeen = now;
  breachMetrics[category].total++;

  // Check if within throttle limit
  if (signatureData.count <= config.maxPerWindow) {
    return { shouldReport: true, isEscalation: false };
  }

  // Throttled - increment suppressed count
  signatureData.suppressed++;
  breachMetrics[category].suppressed++;

  // Check for escalation (many unique violations = systemic issue)
  const uniqueInWindow = categoryState.size;
  if (uniqueInWindow >= config.escalationThreshold && !breachMetrics[category].escalated) {
    breachMetrics[category].escalated = true;
    return { shouldReport: true, isEscalation: true };
  }

  return { shouldReport: false, isEscalation: false };
};

// ============================================================================
// REPORTER FUNCTIONS
// ============================================================================

/**
 * Report an invariant violation (throttled)
 *
 * @param {string} code - Invariant error code (e.g., 'MISSING_DEAL')
 * @param {object} details - Additional context (no PII)
 */
const reportInvariantViolation = (code, details = {}) => {
  const signature = generateSignature('invariant', code, details);
  const { shouldReport, isEscalation } = shouldReportEvent('invariant', signature);

  if (!shouldReport) {
    // Log locally but don't send to Sentry
    console.warn('[Telemetry] Invariant violation throttled:', code);
    return;
  }

  const eventData = {
    code,
    context: details.context || 'unknown',
    timestamp: new Date().toISOString(),
    ...details,
  };

  if (isEscalation) {
    // Escalation: many unique violations = likely systemic issue
    captureMessage(`[ESCALATION] Multiple invariant violations detected`, 'error', {
      uniqueViolations: throttleState.get('invariant')?.size || 0,
      totalViolations: breachMetrics.invariant.total,
      recentCode: code,
      ...eventData,
    });

    console.error('[Telemetry] ESCALATION: Multiple invariant violations detected', {
      uniqueViolations: throttleState.get('invariant')?.size || 0,
    });
  } else {
    // Normal violation
    captureMessage(`Invariant violation: ${code}`, 'warning', eventData);
  }

  // Track as event for metrics
  trackEvent('invariant_violation', {
    code,
    context: details.context,
    isEscalation,
  });

  console.error('[Telemetry] Invariant violation reported:', code, eventData);
};

/**
 * Report a UX regression (blank state, missing data, etc.)
 *
 * @param {string} type - Regression type (e.g., 'blank_state', 'missing_data')
 * @param {object} details - Component, expected data, etc.
 */
const reportUXRegression = (type, details = {}) => {
  const signature = generateSignature('ux_regression', type, details);
  const { shouldReport, isEscalation } = shouldReportEvent('ux_regression', signature);

  if (!shouldReport) {
    console.warn('[Telemetry] UX regression throttled:', type);
    return;
  }

  const eventData = {
    type,
    component: details.component || 'unknown',
    timestamp: new Date().toISOString(),
    ...details,
  };

  if (isEscalation) {
    captureMessage(`[ESCALATION] Multiple UX regressions detected`, 'error', {
      uniqueRegressions: throttleState.get('ux_regression')?.size || 0,
      totalRegressions: breachMetrics.ux_regression.total,
      recentType: type,
      ...eventData,
    });
  } else {
    captureMessage(`UX regression: ${type}`, 'warning', eventData);
  }

  trackEvent('ux_regression', {
    type,
    component: details.component,
    isEscalation,
  });

  console.warn('[Telemetry] UX regression reported:', type, eventData);
};

/**
 * Report an auth anomaly (multiple failures, suspicious activity)
 *
 * @param {string} type - Anomaly type (e.g., 'multiple_failures', 'session_mismatch')
 * @param {object} details - Context (no PII like passwords)
 */
const reportAuthAnomaly = (type, details = {}) => {
  const signature = generateSignature('auth_anomaly', type, details);
  const { shouldReport, isEscalation } = shouldReportEvent('auth_anomaly', signature);

  if (!shouldReport) {
    console.warn('[Telemetry] Auth anomaly throttled:', type);
    return;
  }

  const eventData = {
    type,
    timestamp: new Date().toISOString(),
    ...details,
  };

  if (isEscalation) {
    captureMessage(`[ESCALATION] Multiple auth anomalies detected`, 'error', {
      uniqueAnomalies: throttleState.get('auth_anomaly')?.size || 0,
      totalAnomalies: breachMetrics.auth_anomaly.total,
      recentType: type,
      ...eventData,
    });
  } else {
    captureMessage(`Auth anomaly: ${type}`, 'warning', eventData);
  }

  trackEvent('auth_anomaly', {
    type,
    isEscalation,
  });

  console.warn('[Telemetry] Auth anomaly reported:', type, eventData);
};

/**
 * Report a session error (throttled to prevent spam on session issues)
 *
 * @param {string} code - Error code (e.g., 'SESSION_EXPIRED', 'REFRESH_FAILED')
 * @param {object} details - Context
 */
const reportSessionError = (code, details = {}) => {
  const signature = generateSignature('session_error', code, details);
  const { shouldReport, isEscalation } = shouldReportEvent('session_error', signature);

  if (!shouldReport) {
    // Session errors are noisy - don't even log when throttled
    return;
  }

  const eventData = {
    code,
    timestamp: new Date().toISOString(),
    ...details,
  };

  if (isEscalation) {
    captureMessage(`[ESCALATION] Multiple session errors detected`, 'error', {
      uniqueErrors: throttleState.get('session_error')?.size || 0,
      totalErrors: breachMetrics.session_error.total,
      recentCode: code,
      ...eventData,
    });
  } else {
    // Don't send individual session errors to Sentry - too noisy
    // Just track as event
    trackEvent('session_error', { code });
  }

  console.warn('[Telemetry] Session error:', code);
};

/**
 * Report a blank state detection (component rendered with no data)
 *
 * @param {string} component - Component name
 * @param {object} details - What data was expected
 */
const reportBlankState = (component, details = {}) => {
  const signature = generateSignature('blank_state', component, details);
  const { shouldReport, isEscalation } = shouldReportEvent('blank_state', signature);

  if (!shouldReport) {
    console.warn('[Telemetry] Blank state throttled:', component);
    return;
  }

  const eventData = {
    component,
    expectedData: details.expectedData || 'unknown',
    timestamp: new Date().toISOString(),
    ...details,
  };

  if (isEscalation) {
    captureMessage(`[ESCALATION] Multiple blank states detected`, 'error', {
      uniqueComponents: throttleState.get('blank_state')?.size || 0,
      totalBlankStates: breachMetrics.blank_state.total,
      recentComponent: component,
      ...eventData,
    });
  } else {
    captureMessage(`Blank state: ${component}`, 'warning', eventData);
  }

  trackEvent('blank_state', {
    component,
    isEscalation,
  });

  console.warn('[Telemetry] Blank state reported:', component, eventData);
};

// ============================================================================
// METRICS & DIAGNOSTICS
// ============================================================================

/**
 * Get current breach metrics (for monitoring dashboards)
 */
const getBreachMetrics = () => {
  return {
    ...breachMetrics,
    timestamp: new Date().toISOString(),
    activeThrottles: {
      invariant: throttleState.get('invariant')?.size || 0,
      ux_regression: throttleState.get('ux_regression')?.size || 0,
      auth_anomaly: throttleState.get('auth_anomaly')?.size || 0,
      session_error: throttleState.get('session_error')?.size || 0,
      blank_state: throttleState.get('blank_state')?.size || 0,
    },
  };
};

/**
 * Reset metrics (for testing or after escalation resolution)
 */
const resetMetrics = () => {
  for (const category of Object.keys(breachMetrics)) {
    breachMetrics[category] = { total: 0, unique: 0, suppressed: 0, escalated: false };
  }
  throttleState.clear();
};

/**
 * Log current metrics to console (for debugging)
 */
const logMetrics = () => {
  console.log('[Telemetry] Breach Metrics:', getBreachMetrics());
};

// ============================================================================
// EXPORTS
// ============================================================================

export const telemetryReporter = {
  // Core reporters
  reportInvariantViolation,
  reportUXRegression,
  reportAuthAnomaly,
  reportSessionError,
  reportBlankState,

  // Metrics
  getBreachMetrics,
  resetMetrics,
  logMetrics,
};

export default telemetryReporter;
