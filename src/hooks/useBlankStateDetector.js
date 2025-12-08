/**
 * BLANK STATE DETECTOR HOOK
 *
 * Phase 5: Telemetry Intelligence & Safety Nets
 *
 * Detects when critical UI components render with no data (unexpected blank states).
 * Reports these to telemetry for monitoring and alerting.
 *
 * Use Cases:
 * 1. KanbanBoard renders but deals array is empty when it shouldn't be
 * 2. DealDetailsModal opens but deal object is null
 * 3. TeamPerformance loads but team members is empty
 * 4. AI Assistant responds but response is empty
 *
 * Usage:
 * ```javascript
 * function KanbanBoard({ deals, loading, error }) {
 *   // Detect blank state: not loading, no error, but no data
 *   useBlankStateDetector({
 *     componentName: 'KanbanBoard',
 *     data: deals,
 *     isLoading: loading,
 *     hasError: !!error,
 *     expectedMinItems: 0, // 0 = any array is valid, >0 = require at least N items
 *     checkCondition: deals => Array.isArray(deals), // Custom validation
 *   });
 *
 *   // ... render logic
 * }
 * ```
 *
 * The detector will report to telemetry when:
 * - Not loading AND not error AND data is invalid/missing
 * - After a grace period (to avoid reporting during initial render)
 */

import { useEffect, useRef } from 'react';
import { telemetryReporter } from '../lib/telemetry-reporter';

/**
 * Default grace period before reporting blank state (ms)
 * Allows for initial render cycle and data fetching
 */
const DEFAULT_GRACE_PERIOD_MS = 2000;

/**
 * Hook to detect and report unexpected blank states
 *
 * @param {object} options - Detection options
 * @param {string} options.componentName - Name of the component (for telemetry)
 * @param {any} options.data - The data that should be present
 * @param {boolean} options.isLoading - Whether data is currently loading
 * @param {boolean} options.hasError - Whether there's an error state
 * @param {number} options.expectedMinItems - For arrays, minimum expected items (default: -1 = no check)
 * @param {Function} options.checkCondition - Custom validation function (data => boolean)
 * @param {number} options.gracePeriodMs - Grace period before reporting (default: 2000ms)
 * @param {boolean} options.disabled - Disable detection (useful for conditional features)
 */
export function useBlankStateDetector({
  componentName,
  data,
  isLoading = false,
  hasError = false,
  expectedMinItems = -1,
  checkCondition = null,
  gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
  disabled = false,
}) {
  const mountTimeRef = useRef(Date.now());
  const hasReportedRef = useRef(false);
  const lastDataRef = useRef(data);

  useEffect(() => {
    // Skip if disabled
    if (disabled) return;

    // Skip if loading or has error (these are expected states)
    if (isLoading || hasError) {
      hasReportedRef.current = false; // Reset so we can report again if blank after load
      return;
    }

    // Skip during grace period (initial load)
    const timeSinceMount = Date.now() - mountTimeRef.current;
    if (timeSinceMount < gracePeriodMs) {
      return;
    }

    // Skip if already reported this blank state (to avoid spam)
    if (hasReportedRef.current && lastDataRef.current === data) {
      return;
    }

    // Check for blank state
    const isBlankState = detectBlankState(data, expectedMinItems, checkCondition);

    if (isBlankState) {
      // Report to telemetry
      telemetryReporter.reportBlankState(componentName, {
        expectedData: getExpectedDataDescription(data, expectedMinItems),
        actualData: getActualDataDescription(data),
        timeSinceMount,
      });

      hasReportedRef.current = true;
      lastDataRef.current = data;
    } else {
      // Reset if data becomes valid
      hasReportedRef.current = false;
      lastDataRef.current = data;
    }
  }, [componentName, data, isLoading, hasError, expectedMinItems, checkCondition, gracePeriodMs, disabled]);

  // Reset mount time if component re-mounts
  useEffect(() => {
    mountTimeRef.current = Date.now();
    hasReportedRef.current = false;
  }, []);
}

/**
 * Detect if data represents a blank state
 */
function detectBlankState(data, expectedMinItems, checkCondition) {
  // Custom check takes precedence
  if (checkCondition) {
    return !checkCondition(data);
  }

  // Null/undefined is always blank
  if (data === null || data === undefined) {
    return true;
  }

  // Array with expectedMinItems check
  if (Array.isArray(data)) {
    if (expectedMinItems >= 0 && data.length < expectedMinItems) {
      return true;
    }
    return false; // Array exists and meets min items requirement
  }

  // Object - check if empty
  if (typeof data === 'object') {
    return Object.keys(data).length === 0;
  }

  // Empty string
  if (typeof data === 'string') {
    return data.trim() === '';
  }

  // Other falsy values
  return !data;
}

/**
 * Get description of expected data (for telemetry)
 */
function getExpectedDataDescription(data, expectedMinItems) {
  if (Array.isArray(data)) {
    if (expectedMinItems > 0) {
      return `array with at least ${expectedMinItems} items`;
    }
    return 'non-empty array';
  }

  if (data === null || data === undefined) {
    return 'non-null value';
  }

  return 'valid data';
}

/**
 * Get description of actual data (for telemetry)
 */
function getActualDataDescription(data) {
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  if (Array.isArray(data)) return `array with ${data.length} items`;
  if (typeof data === 'object') return `object with ${Object.keys(data).length} keys`;
  if (typeof data === 'string') return data.trim() === '' ? 'empty string' : 'string';
  return typeof data;
}

/**
 * Higher-order component for blank state detection
 * Wraps a component and adds blank state monitoring
 */
export function withBlankStateDetection(WrappedComponent, detectorOptions) {
  return function BlankStateDetectionWrapper(props) {
    // Extract data from props based on configuration
    const data = typeof detectorOptions.dataSelector === 'function'
      ? detectorOptions.dataSelector(props)
      : props[detectorOptions.dataKey || 'data'];

    const isLoading = typeof detectorOptions.loadingSelector === 'function'
      ? detectorOptions.loadingSelector(props)
      : props[detectorOptions.loadingKey || 'loading'];

    const hasError = typeof detectorOptions.errorSelector === 'function'
      ? detectorOptions.errorSelector(props)
      : props[detectorOptions.errorKey || 'error'];

    useBlankStateDetector({
      componentName: detectorOptions.componentName || WrappedComponent.displayName || WrappedComponent.name || 'Unknown',
      data,
      isLoading,
      hasError: !!hasError,
      expectedMinItems: detectorOptions.expectedMinItems,
      checkCondition: detectorOptions.checkCondition,
      gracePeriodMs: detectorOptions.gracePeriodMs,
    });

    return <WrappedComponent {...props} />;
  };
}

/**
 * Preset configurations for common components
 */
export const BLANK_STATE_PRESETS = {
  // For list components (deals, tasks, etc.)
  LIST: {
    expectedMinItems: 0, // Empty list is valid
    checkCondition: data => Array.isArray(data),
  },

  // For list components that should never be empty
  NON_EMPTY_LIST: {
    expectedMinItems: 1,
    checkCondition: data => Array.isArray(data) && data.length > 0,
  },

  // For single object components (deal details, user profile)
  OBJECT: {
    checkCondition: data => data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0,
  },

  // For text content (AI responses, descriptions)
  TEXT: {
    checkCondition: data => typeof data === 'string' && data.trim().length > 0,
  },

  // For optional data (may legitimately be null)
  OPTIONAL: {
    checkCondition: () => true, // Never report blank state for optional data
  },
};

export default useBlankStateDetector;
