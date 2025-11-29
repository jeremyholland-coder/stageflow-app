/**
 * Error sanitization utilities for serverless functions
 * Prevents information leakage in production environments
 */

/**
 * Sanitizes error messages to prevent information disclosure
 * @param error - The error object
 * @param context - Additional context for logging
 * @returns User-safe error message
 */
export function sanitizeError(error: any, context?: string): string {
  // In development, return full error details for debugging
  if (process.env.NODE_ENV === 'development' || process.env.NETLIFY_DEV === 'true') {
    return error.message || error.toString();
  }

  // Log full error server-side for monitoring
  console.error(`[ERROR]${context ? ` ${context}:` : ''}`, {
    message: error.message,
    code: error.code,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // Return generic message to client in production
  // This prevents leaking:
  // - Database schema details
  // - Internal paths
  // - Implementation details
  // - Stack traces
  
  // Map specific error patterns to user-friendly messages
  const errorString = error.message || error.toString();
  
  if (errorString.includes('JWT') || errorString.includes('token')) {
    return 'Authentication failed. Please try logging in again.';
  }
  
  if (errorString.includes('duplicate') || errorString.includes('unique')) {
    return 'This resource already exists.';
  }
  
  if (errorString.includes('not found') || errorString.includes('does not exist')) {
    return 'Resource not found.';
  }
  
  if (errorString.includes('permission') || errorString.includes('policy')) {
    return 'You do not have permission to perform this action.';
  }
  
  if (errorString.includes('timeout') || errorString.includes('ETIMEDOUT')) {
    return 'Request timed out. Please try again.';
  }

  // Default generic message
  return 'An error occurred. Please try again or contact support if the problem persists.';
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  requestId?: string;
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  error: any,
  statusCode: number,
  context?: string,
  errorCode?: string
): Response {
  const sanitizedMessage = sanitizeError(error, context);
  
  const responseBody: ErrorResponse = {
    error: sanitizedMessage,
    ...(errorCode && { code: errorCode })
  };

  return new Response(JSON.stringify(responseBody), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}
