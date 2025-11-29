/**
 * Advanced Error Recovery System
 * Automatic retry with exponential backoff and circuit breaker
 *
 * Features:
 * - Exponential backoff retry
 * - Circuit breaker pattern
 * - Error categorization
 * - Automatic fallback strategies
 * - Error rate limiting
 *
 * Performance Impact:
 * - Higher success rates on flaky networks
 * - Prevents cascade failures
 * - Better user experience
 *
 * @author StageFlow Engineering
 * @date November 14, 2025
 */

import { logger } from './logger';

/**
 * Error categories
 */
export const ErrorCategory = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  AUTH: 'auth',
  VALIDATION: 'validation',
  SERVER: 'server',
  UNKNOWN: 'unknown',
};

/**
 * Categorize error
 */
export function categorizeError(error) {
  if (!error) return ErrorCategory.UNKNOWN;

  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    code === 'NETWORK_ERROR'
  ) {
    return ErrorCategory.NETWORK;
  }

  // Timeout errors
  if (message.includes('timeout') || code === 'TIMEOUT') {
    return ErrorCategory.TIMEOUT;
  }

  // Auth errors
  if (
    message.includes('auth') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    code === 'AUTH_ERROR' ||
    error.status === 401 ||
    error.status === 403
  ) {
    return ErrorCategory.AUTH;
  }

  // Validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    error.status === 400 ||
    error.status === 422
  ) {
    return ErrorCategory.VALIDATION;
  }

  // Server errors
  if (error.status >= 500) {
    return ErrorCategory.SERVER;
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Check if error is retryable
 */
export function isRetryable(error) {
  const category = categorizeError(error);

  // Retryable errors
  const retryableCategories = [
    ErrorCategory.NETWORK,
    ErrorCategory.TIMEOUT,
    ErrorCategory.SERVER,
  ];

  return retryableCategories.includes(category);
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000) {
  // Exponential: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

  // Add jitter (±20%) to prevent thundering herd
  const jitter = delay * 0.2 * (Math.random() - 0.5);

  return Math.round(delay + jitter);
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff(
  operation,
  options = {}
) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetry = null,
    shouldRetry = isRetryable,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      if (attempt > 0) {
        logger.log(`[ErrorRecovery] ✓ Success after ${attempt} retries`);
      }

      return result;
    } catch (error) {
      lastError = error;

      const category = categorizeError(error);
      const retryable = shouldRetry(error);

      console.error(`[ErrorRecovery] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, {
        category,
        retryable,
        message: error.message,
      });

      // Don't retry if not retryable or max retries reached
      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      // Calculate delay
      const delay = calculateBackoff(attempt, baseDelay, maxDelay);

      logger.log(`[ErrorRecovery] Retrying in ${delay}ms...`);

      // Callback before retry
      if (onRetry) {
        onRetry(attempt, delay, error);
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Circuit Breaker States
 */
const CircuitState = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Failing - reject immediately
  HALF_OPEN: 'half-open', // Testing - allow limited requests
};

/**
 * Circuit Breaker Pattern
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 60000; // 1 minute
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds

    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Execute operation through circuit breaker
   */
  async execute(operation) {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker [${this.name}] is OPEN - rejecting request`);
      }

      // Time to try again - switch to half-open
      logger.log(`[CircuitBreaker] ${this.name}: OPEN → HALF_OPEN (testing)`);
      this.state = CircuitState.HALF_OPEN;
      this.successes = 0;
    }

    try {
      // Execute operation with timeout
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Circuit breaker timeout')), this.timeout)
        ),
      ]);

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  onSuccess() {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;

      logger.log(
        `[CircuitBreaker] ${this.name}: Success ${this.successes}/${this.successThreshold}`
      );

      if (this.successes >= this.successThreshold) {
        logger.log(`[CircuitBreaker] ${this.name}: HALF_OPEN → CLOSED (recovered)`);
        this.state = CircuitState.CLOSED;
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed operation
   */
  onFailure(error) {
    this.failures++;
    this.lastFailureTime = Date.now();

    console.error(`[CircuitBreaker] ${this.name}: Failure ${this.failures}/${this.failureThreshold}`, error.message);

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed while testing - reopen circuit
      logger.log(`[CircuitBreaker] ${this.name}: HALF_OPEN → OPEN (test failed)`);
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      this.failures = 0;
      return;
    }

    if (this.failures >= this.failureThreshold) {
      console.warn(`[CircuitBreaker] ${this.name}: CLOSED → OPEN (threshold reached)`);
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      this.failures = 0;
    }
  }

  /**
   * Get circuit status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Reset circuit manually
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;

    logger.log(`[CircuitBreaker] ${this.name}: Manually reset`);
  }
}

/**
 * Global circuit breakers registry
 */
const circuitBreakers = new Map();

/**
 * Get or create circuit breaker
 */
export function getCircuitBreaker(name, options = {}) {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker({ ...options, name }));
  }

  return circuitBreakers.get(name);
}

/**
 * Error recovery manager
 */
class ErrorRecoveryManager {
  constructor() {
    this.errorLog = [];
    this.errorRates = new Map();
  }

  /**
   * Log error
   */
  logError(operation, error) {
    const category = categorizeError(error);

    this.errorLog.push({
      operation,
      error: {
        message: error.message,
        category,
        stack: error.stack,
      },
      timestamp: Date.now(),
    });

    // Keep only last 100 errors
    if (this.errorLog.length > 100) {
      this.errorLog.shift();
    }

    // Update error rate
    this.updateErrorRate(operation);
  }

  /**
   * Update error rate for operation
   */
  updateErrorRate(operation) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    const recentErrors = this.errorLog.filter(
      (e) => e.operation === operation && now - e.timestamp < windowMs
    );

    this.errorRates.set(operation, {
      count: recentErrors.length,
      rate: recentErrors.length / 60, // errors per second
      window: windowMs,
    });
  }

  /**
   * Get error rate for operation
   */
  getErrorRate(operation) {
    return this.errorRates.get(operation) || { count: 0, rate: 0 };
  }

  /**
   * Get error summary
   */
  getSummary() {
    const now = Date.now();
    const windowMs = 300000; // 5 minutes

    const recentErrors = this.errorLog.filter((e) => now - e.timestamp < windowMs);

    const byCategory = {};
    recentErrors.forEach((e) => {
      const cat = e.error.category;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    return {
      total: recentErrors.length,
      byCategory,
      errorRates: Object.fromEntries(this.errorRates),
    };
  }

  /**
   * Clear error log
   */
  clear() {
    this.errorLog = [];
    this.errorRates.clear();
  }
}

// Export singleton
export const errorRecoveryManager = new ErrorRecoveryManager();

/**
 * React hook for error recovery
 */
export function useErrorRecovery(operation, options = {}) {
  const executeWithRetry = async (fn) => {
    try {
      const circuit = getCircuitBreaker(operation);
      const result = await circuit.execute(() => retryWithBackoff(fn, options));
      return result;
    } catch (error) {
      errorRecoveryManager.logError(operation, error);
      throw error;
    }
  };

  return {
    execute: executeWithRetry,
    getErrorRate: () => errorRecoveryManager.getErrorRate(operation),
    getCircuitStatus: () => getCircuitBreaker(operation).getStatus(),
  };
}

export default {
  retryWithBackoff,
  CircuitBreaker,
  getCircuitBreaker,
  categorizeError,
  isRetryable,
  errorRecoveryManager,
};
