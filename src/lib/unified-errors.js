/**
 * UNIFIED ERROR SYSTEM
 *
 * Phase 2: Apple UX Error Handling & User Trust Layer
 *
 * Single source of truth for all error codes, messages, and recovery guidance.
 * Consolidates: ERROR_CODES, AI_ERROR_CODES, INVARIANT_ERROR_CODES, backend ERROR_CODES
 *
 * DESIGN PRINCIPLES (Apple Human Interface Guidelines):
 * 1. Messages are calm and human - never technical or alarming
 * 2. Every error has clear recovery guidance
 * 3. Errors are actionable - user knows what to do next
 * 4. Retryable errors auto-suggest retry
 * 5. Auth errors gracefully guide to sign-in
 *
 * @author StageFlow Engineering
 * @phase Phase 2 - Error Handling & User Trust Layer
 */

// ============================================================================
// UNIFIED ERROR CODE TAXONOMY
// ============================================================================

/**
 * Single source of truth for all error codes
 * Organized by domain for easy lookup
 */
export const UNIFIED_ERROR_CODES = {
  // ----- NETWORK & CONNECTION -----
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_RESET: 'CONNECTION_RESET',
  OFFLINE: 'OFFLINE',

  // ----- AUTHENTICATION & SESSION -----
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_ERROR: 'SESSION_ERROR',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // ----- AUTHORIZATION & PERMISSIONS -----
  FORBIDDEN: 'FORBIDDEN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  ORG_ACCESS_DENIED: 'ORG_ACCESS_DENIED',

  // ----- VALIDATION & DATA -----
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',

  // ----- RATE LIMITING & QUOTAS -----
  RATE_LIMITED: 'RATE_LIMITED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',

  // ----- SERVER & DATABASE -----
  SERVER_ERROR: 'SERVER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  BAD_GATEWAY: 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

  // ----- AI SPECIFIC -----
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  ALL_PROVIDERS_FAILED: 'ALL_PROVIDERS_FAILED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  NO_PROVIDERS: 'NO_PROVIDERS',
  STREAM_ERROR: 'STREAM_ERROR',

  // ----- INVARIANT VIOLATIONS (Internal) -----
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  MISSING_DATA: 'MISSING_DATA',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  AMBIGUOUS_RESPONSE: 'AMBIGUOUS_RESPONSE',

  // ----- GENERIC -----
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  SUCCESS: 'SUCCESS',
};

// ============================================================================
// ERROR SEVERITY LEVELS
// ============================================================================

/**
 * Visual severity for error display
 * Maps to colors and urgency in the UI
 */
export const ERROR_SEVERITY = {
  INFO: 'info',         // Blue - informational, will resolve
  WARNING: 'warning',   // Amber - needs attention, may retry
  ERROR: 'error',       // Red - requires action
  CRITICAL: 'critical', // Deep red - blocking, requires immediate action
};

// ============================================================================
// APPLE-GRADE ERROR MESSAGES
// ============================================================================

/**
 * Human-friendly error messages
 * Tone: Calm, helpful, never technical
 */
export const ERROR_MESSAGES = {
  // Network & Connection
  [UNIFIED_ERROR_CODES.NETWORK_ERROR]: {
    title: 'Connection Issue',
    message: "We couldn't reach our servers. Check your internet connection and try again.",
    recovery: 'Check your Wi-Fi or cellular connection.',
  },
  [UNIFIED_ERROR_CODES.TIMEOUT]: {
    title: 'Taking Too Long',
    message: "This is taking longer than expected. Let's try that again.",
    recovery: 'Try again in a moment.',
  },
  [UNIFIED_ERROR_CODES.CONNECTION_RESET]: {
    title: 'Connection Lost',
    message: 'Your connection was interrupted. Your changes are safe.',
    recovery: 'Try again when your connection is stable.',
  },
  [UNIFIED_ERROR_CODES.OFFLINE]: {
    title: 'You\'re Offline',
    message: 'No internet connection detected. Some features may be limited.',
    recovery: 'Connect to the internet to sync your changes.',
  },

  // Authentication & Session
  [UNIFIED_ERROR_CODES.AUTH_REQUIRED]: {
    title: 'Sign In Required',
    message: 'Please sign in to continue.',
    recovery: 'Sign in with your account.',
  },
  [UNIFIED_ERROR_CODES.SESSION_EXPIRED]: {
    title: 'Session Expired',
    message: 'Your session has ended. Please sign in again to continue.',
    recovery: 'Sign in to continue where you left off.',
  },
  [UNIFIED_ERROR_CODES.SESSION_ERROR]: {
    title: 'Session Issue',
    message: 'There was a problem with your session. Please sign in again.',
    recovery: 'Sign in to refresh your session.',
  },
  [UNIFIED_ERROR_CODES.INVALID_TOKEN]: {
    title: 'Authentication Issue',
    message: 'Your login credentials need to be refreshed.',
    recovery: 'Sign in again to continue.',
  },
  [UNIFIED_ERROR_CODES.TOKEN_EXPIRED]: {
    title: 'Session Timed Out',
    message: 'For security, your session has timed out.',
    recovery: 'Sign in to continue.',
  },
  [UNIFIED_ERROR_CODES.UNAUTHORIZED]: {
    title: 'Access Denied',
    message: 'You need to sign in to access this.',
    recovery: 'Sign in with an authorized account.',
  },

  // Authorization & Permissions
  [UNIFIED_ERROR_CODES.FORBIDDEN]: {
    title: 'Access Restricted',
    message: "You don't have permission to do this.",
    recovery: 'Contact your administrator for access.',
  },
  [UNIFIED_ERROR_CODES.PERMISSION_DENIED]: {
    title: 'Permission Required',
    message: "Your account doesn't have permission for this action.",
    recovery: 'Ask an admin to grant you the necessary permissions.',
  },
  [UNIFIED_ERROR_CODES.INSUFFICIENT_PRIVILEGES]: {
    title: 'Higher Access Required',
    message: 'This action requires additional privileges.',
    recovery: 'Contact your organization administrator.',
  },
  [UNIFIED_ERROR_CODES.INSUFFICIENT_ROLE]: {
    title: 'Role Restriction',
    message: 'Your current role cannot perform this action.',
    recovery: 'Request a role change from your administrator.',
  },
  [UNIFIED_ERROR_CODES.ORG_ACCESS_DENIED]: {
    title: 'Organization Access',
    message: "You're not a member of this organization.",
    recovery: 'Request an invitation to join this organization.',
  },

  // Validation & Data
  [UNIFIED_ERROR_CODES.VALIDATION_ERROR]: {
    title: 'Invalid Input',
    message: 'Please check your input and try again.',
    recovery: 'Review the form for any missing or incorrect fields.',
  },
  [UNIFIED_ERROR_CODES.BAD_REQUEST]: {
    title: 'Something\'s Not Right',
    message: 'We couldn\'t process your request. Please try again.',
    recovery: 'Check your input and try again.',
  },
  [UNIFIED_ERROR_CODES.NOT_FOUND]: {
    title: 'Not Found',
    message: "We couldn't find what you're looking for.",
    recovery: 'Check the link or search for it.',
  },
  [UNIFIED_ERROR_CODES.DUPLICATE_ENTRY]: {
    title: 'Already Exists',
    message: 'This item already exists.',
    recovery: 'Use a different name or update the existing item.',
  },
  [UNIFIED_ERROR_CODES.CONSTRAINT_VIOLATION]: {
    title: 'Conflict Detected',
    message: 'This change conflicts with existing data.',
    recovery: 'Review the conflict and try a different approach.',
  },

  // Rate Limiting & Quotas
  [UNIFIED_ERROR_CODES.RATE_LIMITED]: {
    title: 'Slow Down',
    message: "You're making requests too quickly. Take a breath and try again.",
    recovery: 'Wait a moment, then try again.',
  },
  [UNIFIED_ERROR_CODES.RATE_LIMIT_EXCEEDED]: {
    title: 'Request Limit',
    message: "You've hit the request limit. This resets shortly.",
    recovery: 'Wait a few minutes and try again.',
  },
  [UNIFIED_ERROR_CODES.QUOTA_EXCEEDED]: {
    title: 'Plan Limit Reached',
    message: "You've reached your plan's limit.",
    recovery: 'Upgrade your plan for more capacity.',
  },
  [UNIFIED_ERROR_CODES.AI_LIMIT_REACHED]: {
    title: 'AI Requests Exhausted',
    message: "You've used all your AI requests this month.",
    recovery: 'Upgrade your plan or wait for the next billing cycle.',
  },

  // Server & Database
  [UNIFIED_ERROR_CODES.SERVER_ERROR]: {
    title: 'Server Issue',
    message: "Something went wrong on our end. We're looking into it.",
    recovery: 'Try again in a few moments.',
  },
  [UNIFIED_ERROR_CODES.INTERNAL_ERROR]: {
    title: 'Internal Error',
    message: 'An unexpected error occurred. Your data is safe.',
    recovery: 'Refresh the page and try again.',
  },
  [UNIFIED_ERROR_CODES.DATABASE_ERROR]: {
    title: 'Data Issue',
    message: "We're having trouble saving your changes.",
    recovery: 'Try again in a moment.',
  },
  [UNIFIED_ERROR_CODES.BAD_GATEWAY]: {
    title: 'Service Temporarily Unavailable',
    message: "We're experiencing some issues. This usually resolves quickly.",
    recovery: 'Wait a moment and refresh.',
  },
  [UNIFIED_ERROR_CODES.SERVICE_UNAVAILABLE]: {
    title: 'Under Maintenance',
    message: "We're performing maintenance. We'll be back shortly.",
    recovery: 'Check back in a few minutes.',
  },
  [UNIFIED_ERROR_CODES.GATEWAY_TIMEOUT]: {
    title: 'Response Timeout',
    message: 'The server took too long to respond.',
    recovery: 'Try again - it often works the second time.',
  },

  // AI Specific
  [UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR]: {
    title: 'AI Unavailable',
    message: 'The AI service is temporarily unavailable.',
    recovery: 'Try again in a moment.',
  },
  [UNIFIED_ERROR_CODES.ALL_PROVIDERS_FAILED]: {
    title: 'AI Services Down',
    message: 'All AI providers are currently experiencing issues.',
    recovery: 'Try again later when services are restored.',
  },
  [UNIFIED_ERROR_CODES.INVALID_API_KEY]: {
    title: 'API Key Invalid',
    message: 'Your AI provider API key appears to be invalid.',
    recovery: 'Update your API key in Settings.',
  },
  [UNIFIED_ERROR_CODES.NO_PROVIDERS]: {
    title: 'No AI Provider',
    message: 'You haven\'t connected an AI provider yet.',
    recovery: 'Add an AI provider in Settings.',
  },
  [UNIFIED_ERROR_CODES.STREAM_ERROR]: {
    title: 'Stream Interrupted',
    message: 'The AI response was interrupted.',
    recovery: 'Try your request again.',
  },

  // Invariant Violations
  [UNIFIED_ERROR_CODES.INVARIANT_VIOLATION]: {
    title: 'Data Issue',
    message: 'Something unexpected happened with your data. Your work is safe.',
    recovery: 'Refresh and try again.',
  },
  [UNIFIED_ERROR_CODES.MISSING_DATA]: {
    title: 'Missing Information',
    message: "We couldn't find the data needed for this action.",
    recovery: 'Refresh the page to reload the data.',
  },
  [UNIFIED_ERROR_CODES.INVALID_RESPONSE]: {
    title: 'Unexpected Response',
    message: 'We received an unexpected response. Your data is safe.',
    recovery: 'Try the action again.',
  },
  [UNIFIED_ERROR_CODES.AMBIGUOUS_RESPONSE]: {
    title: 'Unclear Result',
    message: "We're not sure if that worked. Your data is safe.",
    recovery: 'Refresh to check the current state.',
  },

  // Generic
  [UNIFIED_ERROR_CODES.UNKNOWN_ERROR]: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Your data is safe.',
    recovery: 'Try again or contact support if this continues.',
  },
  [UNIFIED_ERROR_CODES.SUCCESS]: {
    title: 'Success',
    message: 'Action completed successfully.',
    recovery: '',
  },
};

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Determine if an error is retryable
 */
export function isRetryable(code) {
  const retryableCodes = new Set([
    UNIFIED_ERROR_CODES.NETWORK_ERROR,
    UNIFIED_ERROR_CODES.TIMEOUT,
    UNIFIED_ERROR_CODES.CONNECTION_RESET,
    UNIFIED_ERROR_CODES.BAD_GATEWAY,
    UNIFIED_ERROR_CODES.SERVICE_UNAVAILABLE,
    UNIFIED_ERROR_CODES.GATEWAY_TIMEOUT,
    UNIFIED_ERROR_CODES.SERVER_ERROR,
    UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
    UNIFIED_ERROR_CODES.ALL_PROVIDERS_FAILED,
    UNIFIED_ERROR_CODES.STREAM_ERROR,
    UNIFIED_ERROR_CODES.RATE_LIMITED,
    UNIFIED_ERROR_CODES.OFFLINE,
  ]);
  return retryableCodes.has(code);
}

/**
 * Determine if error requires authentication
 */
export function requiresAuth(code) {
  const authCodes = new Set([
    UNIFIED_ERROR_CODES.AUTH_REQUIRED,
    UNIFIED_ERROR_CODES.SESSION_EXPIRED,
    UNIFIED_ERROR_CODES.SESSION_ERROR,
    UNIFIED_ERROR_CODES.INVALID_TOKEN,
    UNIFIED_ERROR_CODES.TOKEN_EXPIRED,
    UNIFIED_ERROR_CODES.UNAUTHORIZED,
  ]);
  return authCodes.has(code);
}

/**
 * Determine error severity
 */
export function getSeverity(code) {
  // Critical - blocking errors
  if (requiresAuth(code)) {
    return ERROR_SEVERITY.ERROR;
  }

  // Info - will resolve on its own
  if (code === UNIFIED_ERROR_CODES.OFFLINE || code === UNIFIED_ERROR_CODES.SERVICE_UNAVAILABLE) {
    return ERROR_SEVERITY.INFO;
  }

  // Warning - retryable
  if (isRetryable(code)) {
    return ERROR_SEVERITY.WARNING;
  }

  // Permissions
  if ([
    UNIFIED_ERROR_CODES.FORBIDDEN,
    UNIFIED_ERROR_CODES.PERMISSION_DENIED,
    UNIFIED_ERROR_CODES.INSUFFICIENT_PRIVILEGES,
    UNIFIED_ERROR_CODES.INSUFFICIENT_ROLE,
    UNIFIED_ERROR_CODES.ORG_ACCESS_DENIED
  ].includes(code)) {
    return ERROR_SEVERITY.ERROR;
  }

  // Default to error for unknown
  return ERROR_SEVERITY.ERROR;
}

/**
 * Get suggested action for an error
 */
export function getAction(code, context = {}) {
  // Auth errors
  if (requiresAuth(code)) {
    return { label: 'Sign In', type: 'auth', path: '/login' };
  }

  // Retryable errors
  if (isRetryable(code) && code !== UNIFIED_ERROR_CODES.OFFLINE) {
    return { label: 'Try Again', type: 'retry' };
  }

  // Settings errors
  if ([UNIFIED_ERROR_CODES.INVALID_API_KEY, UNIFIED_ERROR_CODES.NO_PROVIDERS].includes(code)) {
    return { label: 'Open Settings', type: 'navigate', path: '/settings?tab=ai' };
  }

  // Quota/limit errors
  if ([
    UNIFIED_ERROR_CODES.QUOTA_EXCEEDED,
    UNIFIED_ERROR_CODES.AI_LIMIT_REACHED
  ].includes(code)) {
    return { label: 'Upgrade Plan', type: 'navigate', path: '/settings?tab=billing' };
  }

  // Rate limit - wait
  if (code === UNIFIED_ERROR_CODES.RATE_LIMITED) {
    return { label: 'Wait', type: 'wait', waitSeconds: context.retryAfterSeconds || 60 };
  }

  // Permission errors
  if ([
    UNIFIED_ERROR_CODES.FORBIDDEN,
    UNIFIED_ERROR_CODES.PERMISSION_DENIED,
    UNIFIED_ERROR_CODES.INSUFFICIENT_PRIVILEGES
  ].includes(code)) {
    return { label: 'Contact Admin', type: 'none' };
  }

  // Offline
  if (code === UNIFIED_ERROR_CODES.OFFLINE) {
    return { label: 'Waiting for connection...', type: 'wait' };
  }

  // Default - dismiss
  return { label: 'Dismiss', type: 'dismiss' };
}

// ============================================================================
// ERROR NORMALIZATION
// ============================================================================

/**
 * Normalize any error to unified format
 * Handles: API responses, fetch errors, Error objects, strings
 */
export function normalizeError(error, context = 'unknown') {
  // Handle null/undefined
  if (!error) {
    return {
      code: UNIFIED_ERROR_CODES.UNKNOWN_ERROR,
      ...ERROR_MESSAGES[UNIFIED_ERROR_CODES.UNKNOWN_ERROR],
      severity: ERROR_SEVERITY.ERROR,
      retryable: false,
      action: getAction(UNIFIED_ERROR_CODES.UNKNOWN_ERROR),
      context,
      raw: null,
    };
  }

  // Extract code from various formats
  let code = extractErrorCode(error);

  // Get message info
  const messageInfo = ERROR_MESSAGES[code] || ERROR_MESSAGES[UNIFIED_ERROR_CODES.UNKNOWN_ERROR];

  return {
    code,
    title: messageInfo.title,
    message: messageInfo.message,
    recovery: messageInfo.recovery,
    severity: getSeverity(code),
    retryable: isRetryable(code),
    action: getAction(code, error?.data || error),
    context,
    raw: error,
  };
}

/**
 * Extract error code from various error formats
 */
function extractErrorCode(error) {
  // String error
  if (typeof error === 'string') {
    return mapStringToCode(error);
  }

  // Already has a unified code
  if (error.code && UNIFIED_ERROR_CODES[error.code]) {
    return error.code;
  }

  // Check common code locations
  const possibleCode =
    error.code ||
    error.errorCode ||
    error.error?.code ||
    error.data?.code ||
    error.response?.code;

  if (possibleCode && UNIFIED_ERROR_CODES[possibleCode]) {
    return possibleCode;
  }

  // Map legacy codes
  const legacyMap = {
    // From error-handler.js ERROR_CODES
    'NETWORK_ERROR': UNIFIED_ERROR_CODES.NETWORK_ERROR,
    'AUTH_REQUIRED': UNIFIED_ERROR_CODES.AUTH_REQUIRED,
    'SESSION_EXPIRED': UNIFIED_ERROR_CODES.SESSION_EXPIRED,
    'SESSION_ERROR': UNIFIED_ERROR_CODES.SESSION_ERROR,
    'INVALID_TOKEN': UNIFIED_ERROR_CODES.INVALID_TOKEN,
    'PERMISSION_DENIED': UNIFIED_ERROR_CODES.PERMISSION_DENIED,
    'INSUFFICIENT_PRIVILEGES': UNIFIED_ERROR_CODES.INSUFFICIENT_PRIVILEGES,
    'VALIDATION_ERROR': UNIFIED_ERROR_CODES.VALIDATION_ERROR,
    'NOT_FOUND': UNIFIED_ERROR_CODES.NOT_FOUND,
    'DUPLICATE_ENTRY': UNIFIED_ERROR_CODES.DUPLICATE_ENTRY,
    'RATE_LIMIT_EXCEEDED': UNIFIED_ERROR_CODES.RATE_LIMITED,
    'QUOTA_EXCEEDED': UNIFIED_ERROR_CODES.QUOTA_EXCEEDED,
    'SERVER_ERROR': UNIFIED_ERROR_CODES.SERVER_ERROR,
    'DATABASE_ERROR': UNIFIED_ERROR_CODES.DATABASE_ERROR,
    'UNKNOWN_ERROR': UNIFIED_ERROR_CODES.UNKNOWN_ERROR,

    // From ai-error-codes.js AI_ERROR_CODES
    'INVALID_API_KEY': UNIFIED_ERROR_CODES.INVALID_API_KEY,
    'NO_PROVIDERS': UNIFIED_ERROR_CODES.NO_PROVIDERS,
    'AI_LIMIT_REACHED': UNIFIED_ERROR_CODES.AI_LIMIT_REACHED,
    'RATE_LIMITED': UNIFIED_ERROR_CODES.RATE_LIMITED,
    'ALL_PROVIDERS_FAILED': UNIFIED_ERROR_CODES.ALL_PROVIDERS_FAILED,
    'PROVIDER_ERROR': UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
    'TIMEOUT': UNIFIED_ERROR_CODES.TIMEOUT,
    'STREAM_ERROR': UNIFIED_ERROR_CODES.STREAM_ERROR,
    'OFFLINE': UNIFIED_ERROR_CODES.OFFLINE,
    'UNKNOWN': UNIFIED_ERROR_CODES.UNKNOWN_ERROR,

    // From backend ERROR_CODES
    'UNAUTHORIZED': UNIFIED_ERROR_CODES.UNAUTHORIZED,
    'FORBIDDEN': UNIFIED_ERROR_CODES.FORBIDDEN,
    'BAD_REQUEST': UNIFIED_ERROR_CODES.BAD_REQUEST,
    'INTERNAL_ERROR': UNIFIED_ERROR_CODES.INTERNAL_ERROR,
    'BAD_GATEWAY': UNIFIED_ERROR_CODES.BAD_GATEWAY,
    'SERVICE_UNAVAILABLE': UNIFIED_ERROR_CODES.SERVICE_UNAVAILABLE,
    'GATEWAY_TIMEOUT': UNIFIED_ERROR_CODES.GATEWAY_TIMEOUT,
    'CONNECTION_RESET': UNIFIED_ERROR_CODES.CONNECTION_RESET,
    'CONSTRAINT_VIOLATION': UNIFIED_ERROR_CODES.CONSTRAINT_VIOLATION,
    'AI_PROVIDER_ERROR': UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
    'AI_RATE_LIMITED': UNIFIED_ERROR_CODES.RATE_LIMITED,

    // From invariants.js INVARIANT_ERROR_CODES
    'INVARIANT_MISSING_DEAL': UNIFIED_ERROR_CODES.MISSING_DATA,
    'INVARIANT_INVALID_DEAL_SHAPE': UNIFIED_ERROR_CODES.INVALID_RESPONSE,
    'INVARIANT_MISSING_REQUIRED_FIELD': UNIFIED_ERROR_CODES.VALIDATION_ERROR,
    'INVARIANT_INVALID_STAGE': UNIFIED_ERROR_CODES.VALIDATION_ERROR,
    'INVARIANT_INVALID_STATUS': UNIFIED_ERROR_CODES.VALIDATION_ERROR,
    'INVARIANT_RESPONSE_MISMATCH': UNIFIED_ERROR_CODES.AMBIGUOUS_RESPONSE,
    'INVARIANT_MISSING_SESSION': UNIFIED_ERROR_CODES.SESSION_ERROR,
    'INVARIANT_MISSING_USER': UNIFIED_ERROR_CODES.AUTH_REQUIRED,
    'INVARIANT_MISSING_ORGANIZATION': UNIFIED_ERROR_CODES.NOT_FOUND,
    'INVARIANT_MISSING_AI_RESPONSE': UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
    'INVARIANT_AI_RESPONSE_EMPTY': UNIFIED_ERROR_CODES.AI_PROVIDER_ERROR,
    'INVARIANT_MISSING_RESPONSE': UNIFIED_ERROR_CODES.INVALID_RESPONSE,
    'INVARIANT_SUCCESS_WITHOUT_DATA': UNIFIED_ERROR_CODES.AMBIGUOUS_RESPONSE,
    'INVARIANT_AMBIGUOUS_RESPONSE': UNIFIED_ERROR_CODES.AMBIGUOUS_RESPONSE,
  };

  if (possibleCode && legacyMap[possibleCode]) {
    return legacyMap[possibleCode];
  }

  // Check HTTP status codes
  const status = error.status || error.statusCode || error.response?.status;
  if (status) {
    return mapStatusToCode(status);
  }

  // Check error message patterns
  const message = error.message || error.error || '';
  return mapStringToCode(message);
}

/**
 * Map HTTP status to error code
 */
function mapStatusToCode(status) {
  switch (status) {
    case 400: return UNIFIED_ERROR_CODES.BAD_REQUEST;
    case 401: return UNIFIED_ERROR_CODES.UNAUTHORIZED;
    case 403: return UNIFIED_ERROR_CODES.FORBIDDEN;
    case 404: return UNIFIED_ERROR_CODES.NOT_FOUND;
    case 408: return UNIFIED_ERROR_CODES.TIMEOUT;
    case 409: return UNIFIED_ERROR_CODES.DUPLICATE_ENTRY;
    case 422: return UNIFIED_ERROR_CODES.VALIDATION_ERROR;
    case 429: return UNIFIED_ERROR_CODES.RATE_LIMITED;
    case 500: return UNIFIED_ERROR_CODES.INTERNAL_ERROR;
    case 502: return UNIFIED_ERROR_CODES.BAD_GATEWAY;
    case 503: return UNIFIED_ERROR_CODES.SERVICE_UNAVAILABLE;
    case 504: return UNIFIED_ERROR_CODES.GATEWAY_TIMEOUT;
    default: return UNIFIED_ERROR_CODES.UNKNOWN_ERROR;
  }
}

/**
 * Map error message string to error code
 */
function mapStringToCode(message) {
  if (!message) return UNIFIED_ERROR_CODES.UNKNOWN_ERROR;

  const lower = message.toLowerCase();

  // Network
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused')) {
    return UNIFIED_ERROR_CODES.NETWORK_ERROR;
  }
  if (lower.includes('timeout') || lower.includes('etimedout')) {
    return UNIFIED_ERROR_CODES.TIMEOUT;
  }
  if (lower.includes('offline') || lower.includes('no internet')) {
    return UNIFIED_ERROR_CODES.OFFLINE;
  }

  // Auth
  if (lower.includes('session') && (lower.includes('expired') || lower.includes('invalid'))) {
    return UNIFIED_ERROR_CODES.SESSION_EXPIRED;
  }
  if (lower.includes('unauthorized') || lower.includes('not authenticated')) {
    return UNIFIED_ERROR_CODES.UNAUTHORIZED;
  }
  if (lower.includes('forbidden') || lower.includes('permission denied')) {
    return UNIFIED_ERROR_CODES.FORBIDDEN;
  }
  if (lower.includes('token') && (lower.includes('expired') || lower.includes('invalid'))) {
    return UNIFIED_ERROR_CODES.INVALID_TOKEN;
  }

  // Rate limiting
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return UNIFIED_ERROR_CODES.RATE_LIMITED;
  }
  if (lower.includes('quota') || lower.includes('limit reached')) {
    return UNIFIED_ERROR_CODES.QUOTA_EXCEEDED;
  }

  // AI
  if (lower.includes('api key')) {
    return UNIFIED_ERROR_CODES.INVALID_API_KEY;
  }
  if (lower.includes('no provider') || lower.includes('no ai')) {
    return UNIFIED_ERROR_CODES.NO_PROVIDERS;
  }
  if (lower.includes('ai limit')) {
    return UNIFIED_ERROR_CODES.AI_LIMIT_REACHED;
  }

  // Data
  if (lower.includes('not found') || lower.includes('does not exist')) {
    return UNIFIED_ERROR_CODES.NOT_FOUND;
  }
  if (lower.includes('duplicate') || lower.includes('already exists')) {
    return UNIFIED_ERROR_CODES.DUPLICATE_ENTRY;
  }
  if (lower.includes('validation') || lower.includes('invalid')) {
    return UNIFIED_ERROR_CODES.VALIDATION_ERROR;
  }

  return UNIFIED_ERROR_CODES.UNKNOWN_ERROR;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  UNIFIED_ERROR_CODES,
  ERROR_SEVERITY,
  ERROR_MESSAGES,
  normalizeError,
  isRetryable,
  requiresAuth,
  getSeverity,
  getAction,
};
