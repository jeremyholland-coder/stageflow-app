/**
 * Comprehensive Error Handling System for StageFlow
 * Provides standardized error handling, logging, and user notifications
 */

import React from 'react';

export const ERROR_CODES = {
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  
  // Authentication errors
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  
  // Permission errors
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  
  // Data errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  
  // Server errors
  SERVER_ERROR: 'SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * MEDIUM FIX: Helper function to sanitize error messages (defined before AppError class)
 * Removes sensitive information that could expose system internals
 */
function sanitizeMessage(message) {
  if (!message || typeof message !== 'string') {
    return 'An error occurred. Please try again.';
  }

  // Quick sanitization patterns for sensitive data
  const patterns = [
    { pattern: /relation "([^"]+)" does not exist/gi, replacement: 'Database table not found' },
    { pattern: /column "([^"]+)"/gi, replacement: 'database field' },
    { pattern: /\/[a-zA-Z0-9_\-\/\.]+\.(js|jsx|ts|tsx)/gi, replacement: '[file]' },
    { pattern: /at\s+[a-zA-Z0-9_]+\s+\([^\)]+\)/gi, replacement: '' },
    { pattern: /postgres:\/\/[^\s]+/gi, replacement: '[database]' },
    { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: '[server]' }
  ];

  let sanitized = message;
  for (const { pattern, replacement } of patterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (!sanitized || sanitized.length < 5) {
    return 'An error occurred. Please try again.';
  }

  return sanitized.length > 200 ? sanitized.substring(0, 200) + '...' : sanitized;
}

/**
 * Structured error class for consistent error handling
 */
export class AppError extends Error {
  constructor(message, code = ERROR_CODES.UNKNOWN_ERROR, severity = ERROR_SEVERITY.MEDIUM, originalError = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.severity = severity;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
    this.userMessage = this.getUserFriendlyMessage();
  }

  getUserFriendlyMessage() {
    const messages = {
      [ERROR_CODES.NETWORK_ERROR]: 'Connection issue. Please check your internet connection.',
      [ERROR_CODES.TIMEOUT]: 'Request timed out. Please try again.',
      [ERROR_CODES.AUTH_REQUIRED]: 'Please log in to continue.',
      [ERROR_CODES.SESSION_EXPIRED]: 'Your session has expired. Please log in again.',
      [ERROR_CODES.INVALID_TOKEN]: 'Authentication failed. Please log in again.',
      [ERROR_CODES.PERMISSION_DENIED]: 'You don\'t have permission to perform this action.',
      [ERROR_CODES.INSUFFICIENT_PRIVILEGES]: 'Insufficient privileges. Contact your administrator.',
      [ERROR_CODES.VALIDATION_ERROR]: sanitizeMessage(this.message), // MEDIUM FIX: Sanitize validation errors
      [ERROR_CODES.NOT_FOUND]: 'The requested item could not be found.',
      [ERROR_CODES.DUPLICATE_ENTRY]: 'This item already exists.',
      [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please wait a moment and try again.',
      [ERROR_CODES.QUOTA_EXCEEDED]: 'You\'ve reached your plan limit. Please upgrade.',
      [ERROR_CODES.SERVER_ERROR]: 'Server error. Please try again later.',
      [ERROR_CODES.DATABASE_ERROR]: 'Database error. Please try again.',
      [ERROR_CODES.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.'
    };

    // MEDIUM FIX: Sanitize fallback messages
    return messages[this.code] || sanitizeMessage(this.message) || messages[ERROR_CODES.UNKNOWN_ERROR];
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      userMessage: this.userMessage,
      code: this.code,
      severity: this.severity,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Parse Supabase errors into structured AppError instances
 */
export function parseSupabaseError(error) {
  if (!error) return new AppError('Unknown error', ERROR_CODES.UNKNOWN_ERROR, ERROR_SEVERITY.MEDIUM);

  // Network errors
  if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
    return new AppError(
      'Network connection failed',
      ERROR_CODES.NETWORK_ERROR,
      ERROR_SEVERITY.HIGH,
      error
    );
  }

  // Authentication errors
  // FIX: Recognize HTTP 401/403 status AND authentication-related messages
  // Previous version only checked for 'JWT'/'token' strings, missing backend 401 responses
  if (error.message?.includes('JWT') ||
      error.message?.includes('token') ||
      error.code === 'PGRST301' ||
      error.status === 401 ||
      error.status === 403 ||
      error.message?.toLowerCase().includes('authentication') ||
      error.message?.toLowerCase().includes('unauthorized') ||
      error.code === 'UNAUTHORIZED' ||
      error.code === 'AUTH_REQUIRED') {
    return new AppError(
      'Authentication failed',
      ERROR_CODES.SESSION_EXPIRED,
      ERROR_SEVERITY.HIGH,
      error
    );
  }

  // Permission errors
  if (error.code === '42501' || error.message?.includes('permission denied') || error.message?.includes('RLS')) {
    return new AppError(
      'Permission denied',
      ERROR_CODES.PERMISSION_DENIED,
      ERROR_SEVERITY.MEDIUM,
      error
    );
  }

  // Validation errors
  if (error.code === '23505') {
    return new AppError('This item already exists', ERROR_CODES.DUPLICATE_ENTRY, ERROR_SEVERITY.LOW, error);
  }

  if (error.code === '23503') {
    return new AppError('Referenced item does not exist', ERROR_CODES.VALIDATION_ERROR, ERROR_SEVERITY.MEDIUM, error);
  }

  if (error.code === '23502') {
    return new AppError('Required field is missing', ERROR_CODES.VALIDATION_ERROR, ERROR_SEVERITY.LOW, error);
  }

  // Not found
  if (error.code === 'PGRST116' || error.message?.includes('not found')) {
    return new AppError('Item not found', ERROR_CODES.NOT_FOUND, ERROR_SEVERITY.LOW, error);
  }

  // Server errors
  if (error.code?.startsWith('5') || error.code?.startsWith('P0')) {
    return new AppError('Server error occurred', ERROR_CODES.SERVER_ERROR, ERROR_SEVERITY.HIGH, error);
  }

  return new AppError(
    error.message || 'An error occurred',
    ERROR_CODES.UNKNOWN_ERROR,
    ERROR_SEVERITY.MEDIUM,
    error
  );
}

/**
 * MEDIUM FIX: Sanitize error messages to prevent information leakage
 * Removes sensitive information that could expose system internals
 * @param {string} message - Raw error message
 * @returns {string} Sanitized message safe for user display
 */
export function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') {
    return 'An error occurred. Please try again.';
  }

  // Patterns that expose sensitive information
  const sensitivePatterns = [
    // Database-specific errors with table/column names
    { pattern: /relation "([^"]+)" does not exist/gi, replacement: 'Database table not found' },
    { pattern: /column "([^"]+)" (does not exist|of relation)/gi, replacement: 'Database field error' },
    { pattern: /syntax error at or near "([^"]+)"/gi, replacement: 'Invalid request format' },

    // File paths (Unix and Windows)
    { pattern: /\/[a-zA-Z0-9_\-\/\.]+\.(js|jsx|ts|tsx|mjs|mts|py|rb)/gi, replacement: '[file]' },
    { pattern: /[A-Z]:\\[a-zA-Z0-9_\-\\\.]+/gi, replacement: '[file]' },

    // Stack traces
    { pattern: /at\s+[a-zA-Z0-9_]+\s+\([^\)]+\)/gi, replacement: '' },
    { pattern: /^\s*at\s+.+$/gm, replacement: '' },

    // Environment variables and config
    { pattern: /process\.env\.[A-Z_]+/gi, replacement: '[config]' },
    { pattern: /API[_\s]?KEY[:\s=]+[a-zA-Z0-9\-_]+/gi, replacement: '[API_KEY]' },

    // Connection strings
    { pattern: /postgres:\/\/[^\s]+/gi, replacement: '[database]' },
    { pattern: /mongodb:\/\/[^\s]+/gi, replacement: '[database]' },
    { pattern: /redis:\/\/[^\s]+/gi, replacement: '[cache]' },

    // IP addresses and ports
    { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, replacement: '[server]' },
    { pattern: /localhost:\d+/gi, replacement: '[server]' },

    // SQL query fragments
    { pattern: /SELECT\s+\*?\s+FROM\s+[a-zA-Z0-9_]+/gi, replacement: 'database query' },
    { pattern: /INSERT\s+INTO\s+[a-zA-Z0-9_]+/gi, replacement: 'database operation' },
    { pattern: /UPDATE\s+[a-zA-Z0-9_]+\s+SET/gi, replacement: 'database update' },
    { pattern: /DELETE\s+FROM\s+[a-zA-Z0-9_]+/gi, replacement: 'database operation' },

    // Function/module names that expose internal structure
    { pattern: /in\s+function\s+[a-zA-Z0-9_]+/gi, replacement: 'internal function' },
    { pattern: /module\s+[a-zA-Z0-9_\.\/]+/gi, replacement: 'internal module' }
  ];

  let sanitized = message;

  // Apply all sanitization patterns
  for (const { pattern, replacement } of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // Remove excessive whitespace created by replacements
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // If message was completely sanitized away, provide generic message
  if (!sanitized || sanitized.length < 5) {
    return 'An error occurred. Please try again.';
  }

  // Limit message length to prevent data leakage through verbose errors
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...';
  }

  return sanitized;
}

/**
 * Global error logger
 */
export class ErrorLogger {
  static logs = [];
  static maxLogs = 100;

  static log(error, context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: error instanceof AppError ? error.toJSON() : {
        message: error.message,
        stack: error.stack
      },
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    if (process.env.NODE_ENV === 'development') {
      console.group(`[Error] ${error.code || 'UNKNOWN'}`);
      console.error('Message:', error.message || error.userMessage);
      console.error('Context:', context);
      console.error('Full Error:', error);
      console.groupEnd();
    }

    if (logEntry.error.severity === ERROR_SEVERITY.CRITICAL) {
      console.error('[CRITICAL ERROR]', logEntry);
    }
  }

  static getLogs() {
    return this.logs;
  }

  static clearLogs() {
    this.logs = [];
  }
}

/**
 * Retry failed operations with exponential backoff
 */
export async function retryOperation(operation, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    shouldRetry = (error) => {
      return error.code === ERROR_CODES.NETWORK_ERROR || 
             error.code === ERROR_CODES.SERVER_ERROR ||
             error.code === ERROR_CODES.TIMEOUT;
    }
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const appError = error instanceof AppError ? error : parseSupabaseError(error);
      lastError = appError;

      if (attempt === maxRetries || !shouldRetry(appError)) {
        throw appError;
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(delay, maxDelay)));
      delay *= backoffFactor;
    }
  }

  throw lastError;
}

/**
 * Wrapper for async operations with standard error handling
 */
export async function withErrorHandling(
  operation,
  {
    onError = null,
    context = {},
    showNotification = true,
    notificationFn = null,
    retry = false,
    retryOptions = {}
  } = {}
) {
  try {
    const result = retry 
      ? await retryOperation(operation, retryOptions)
      : await operation();
    
    return { success: true, data: result, error: null };
  } catch (error) {
    const appError = error instanceof AppError ? error : parseSupabaseError(error);
    
    ErrorLogger.log(appError, context);
    
    if (showNotification && notificationFn) {
      notificationFn(appError.userMessage, 'error');
    }
    
    if (onError) {
      onError(appError);
    }
    
    return { success: false, data: null, error: appError };
  }
}

/**
 * Hook-friendly error handler for React components
 */
export function useErrorHandler(addNotification) {
  const handleError = (error, context = {}) => {
    const appError = error instanceof AppError ? error : parseSupabaseError(error);
    ErrorLogger.log(appError, context);
    
    if (addNotification) {
      addNotification(appError.userMessage, 'error');
    }
    
    return appError;
  };

  const handleAsyncOperation = async (operation, options = {}) => {
    return withErrorHandling(operation, {
      ...options,
      notificationFn: addNotification
    });
  };

  return { handleError, handleAsyncOperation };
}
