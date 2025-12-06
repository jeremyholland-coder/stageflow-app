/**
 * Production-Grade Error Boundary Wrapper for Netlify Functions
 *
 * PART 2 of Production Readiness Audit:
 * Provides centralized error handling with standardized response shape.
 *
 * RESPONSE SHAPE (guaranteed):
 * {
 *   success: boolean,
 *   code: string,
 *   message: string,
 *   retryable: boolean,
 *   data?: T
 * }
 *
 * ERROR CLASSIFICATION:
 * - retryable: true for 502/503/504 + network timeouts
 * - retryable: false for 400/401/403/404/500
 *
 * SECURITY:
 * - Never exposes stack traces
 * - Never exposes raw error messages
 * - Logs full errors server-side for monitoring
 */

import type { Context } from "@netlify/functions";
import { sanitizeError } from "./error-sanitizer";

/**
 * Standard API response interface
 * All endpoints MUST return this shape
 */
export interface ApiResponse<T = any> {
  success: boolean;
  code: string;
  message: string;
  retryable: boolean;
  data?: T;
  requestId?: string;
}

/**
 * Error code constants for consistent error handling
 */
export const ERROR_CODES = {
  // Success
  SUCCESS: 'SUCCESS',

  // Client errors (4xx) - NOT retryable
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // Server errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',        // 500 - NOT retryable
  BAD_GATEWAY: 'BAD_GATEWAY',              // 502 - retryable
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', // 503 - retryable
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',      // 504 - retryable

  // Network errors - retryable
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_RESET: 'CONNECTION_RESET',

  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',

  // AI errors
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
} as const;

/**
 * Determine if an error is retryable based on status code
 * Only 502/503/504 and network timeouts are retryable
 */
export function isRetryableError(statusCode: number, errorCode?: string): boolean {
  // Transient server errors - retryable
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return true;
  }

  // Network/timeout errors - retryable
  if (errorCode === ERROR_CODES.NETWORK_ERROR ||
      errorCode === ERROR_CODES.TIMEOUT ||
      errorCode === ERROR_CODES.CONNECTION_RESET) {
    return true;
  }

  // Rate limiting - technically retryable after backoff
  if (statusCode === 429 || errorCode === ERROR_CODES.RATE_LIMITED) {
    return true;
  }

  // Everything else (400/401/403/404/500) - NOT retryable
  return false;
}

/**
 * Create standardized API response
 */
export function createApiResponse<T>(
  success: boolean,
  code: string,
  message: string,
  data?: T,
  statusCode: number = 200
): ApiResponse<T> {
  return {
    success,
    code,
    message,
    retryable: success ? false : isRetryableError(statusCode, code),
    ...(data !== undefined && { data }),
    requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`
  };
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, message: string = 'Success'): Response {
  const body = createApiResponse(true, ERROR_CODES.SUCCESS, message, data, 200);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create error response with standardized shape
 */
export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): Response {
  const body = createApiResponse(false, code, message, undefined, statusCode);

  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Map HTTP status code to error code
 */
function statusToCode(status: number): string {
  switch (status) {
    case 400: return ERROR_CODES.BAD_REQUEST;
    case 401: return ERROR_CODES.UNAUTHORIZED;
    case 403: return ERROR_CODES.FORBIDDEN;
    case 404: return ERROR_CODES.NOT_FOUND;
    case 429: return ERROR_CODES.RATE_LIMITED;
    case 500: return ERROR_CODES.INTERNAL_ERROR;
    case 502: return ERROR_CODES.BAD_GATEWAY;
    case 503: return ERROR_CODES.SERVICE_UNAVAILABLE;
    case 504: return ERROR_CODES.GATEWAY_TIMEOUT;
    default: return ERROR_CODES.INTERNAL_ERROR;
  }
}

/**
 * Classify error to determine status code and code
 */
function classifyError(error: any): { statusCode: number; code: string } {
  const message = error.message?.toLowerCase() || '';
  const errorCode = error.code || '';
  const errorName = error.name || '';

  // Auth errors
  if (error.statusCode === 401 ||
      message.includes('unauthorized') ||
      message.includes('authentication') ||
      message.includes('not authenticated') ||
      errorName === 'UnauthorizedError' ||
      errorName === 'TokenExpiredError') {
    return { statusCode: 401, code: ERROR_CODES.UNAUTHORIZED };
  }

  // Session errors
  if (errorCode === 'SESSION_EXPIRED' ||
      errorCode === 'SESSION_INVALID' ||
      errorCode === 'TOKEN_EXPIRED' ||
      message.includes('session') ||
      message.includes('token expired')) {
    return { statusCode: 401, code: ERROR_CODES.SESSION_EXPIRED };
  }

  // Forbidden
  if (error.statusCode === 403 ||
      message.includes('forbidden') ||
      message.includes('permission') ||
      errorName === 'ForbiddenError') {
    return { statusCode: 403, code: ERROR_CODES.FORBIDDEN };
  }

  // Not found
  if (error.statusCode === 404 ||
      message.includes('not found') ||
      message.includes('does not exist')) {
    return { statusCode: 404, code: ERROR_CODES.NOT_FOUND };
  }

  // Validation errors
  if (message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('required') ||
      message.includes('missing')) {
    return { statusCode: 400, code: ERROR_CODES.VALIDATION_ERROR };
  }

  // Rate limiting
  if (error.statusCode === 429 ||
      message.includes('rate limit') ||
      message.includes('too many requests')) {
    return { statusCode: 429, code: ERROR_CODES.RATE_LIMITED };
  }

  // Network/timeout errors
  if (message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('connection')) {
    return { statusCode: 504, code: ERROR_CODES.TIMEOUT };
  }

  // Database constraint violations
  if (errorCode?.startsWith('23') || message.includes('constraint')) {
    return { statusCode: 400, code: ERROR_CODES.CONSTRAINT_VIOLATION };
  }

  // Default to 500 Internal Server Error
  return { statusCode: 500, code: ERROR_CODES.INTERNAL_ERROR };
}

/**
 * Get CORS headers with origin validation
 */
function getCorsHeaders(request: Request): Record<string, string> {
  const ALLOWED_ORIGINS = [
    'https://stageflow.startupstage.com',
    'https://stageflow-rev-ops.netlify.app',
    'http://localhost:5173',
    'http://localhost:8888',
  ];

  const origin = request.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

/**
 * Handler function type
 */
type HandlerFunction = (
  request: Request,
  context: Context
) => Promise<Response>;

/**
 * Configuration options for the error boundary wrapper
 */
interface ErrorBoundaryOptions {
  /** Function name for logging */
  functionName: string;
  /** Allowed HTTP methods (default: ['POST', 'OPTIONS']) */
  allowedMethods?: string[];
  /** Whether to include CORS headers (default: true) */
  cors?: boolean;
  /** Custom error handler */
  onError?: (error: any, request: Request) => void;
}

/**
 * Production-grade error boundary wrapper for Netlify Functions
 *
 * Usage:
 * ```typescript
 * export default withErrorBoundary(
 *   async (request, context) => {
 *     // Your handler logic here
 *     return successResponse({ result: 'data' });
 *   },
 *   { functionName: 'my-function' }
 * );
 * ```
 */
export function withErrorBoundary(
  handler: HandlerFunction,
  options: ErrorBoundaryOptions
): HandlerFunction {
  const {
    functionName,
    allowedMethods = ['POST', 'OPTIONS'],
    cors = true,
    onError,
  } = options;

  return async (request: Request, context: Context): Promise<Response> => {
    const startTime = Date.now();
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;

    // Get CORS headers
    const corsHeaders = cors ? getCorsHeaders(request) : { 'Content-Type': 'application/json' };

    try {
      // Handle preflight OPTIONS request
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Validate HTTP method
      if (!allowedMethods.includes(request.method)) {
        console.warn(`[${functionName}] Method ${request.method} not allowed`);
        return new Response(
          JSON.stringify(createApiResponse(
            false,
            ERROR_CODES.BAD_REQUEST,
            `Method ${request.method} not allowed. Allowed: ${allowedMethods.join(', ')}`
          )),
          {
            status: 405,
            headers: {
              ...corsHeaders,
              'Allow': allowedMethods.join(', ')
            }
          }
        );
      }

      // Execute handler
      const response = await handler(request, context);

      // Log success
      const duration = Date.now() - startTime;
      console.log(`[${functionName}] ${request.method} completed in ${duration}ms`, {
        status: response.status,
        requestId
      });

      // Ensure CORS headers are present on success responses
      if (cors) {
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          if (!headers.has(key)) {
            headers.set(key, value);
          }
        });
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      return response;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Log full error server-side (never exposed to client)
      console.error(`[${functionName}] Error after ${duration}ms:`, {
        requestId,
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      });

      // Call custom error handler if provided
      if (onError) {
        try {
          onError(error, request);
        } catch (handlerError) {
          console.error(`[${functionName}] Error in onError handler:`, handlerError);
        }
      }

      // Classify error
      const { statusCode, code } = classifyError(error);

      // Sanitize error message for client (never expose internal details)
      const sanitizedMessage = sanitizeError(error, functionName);

      // Create standardized error response
      const responseBody = createApiResponse(
        false,
        code,
        sanitizedMessage,
        undefined,
        statusCode
      );

      return new Response(JSON.stringify(responseBody), {
        status: statusCode,
        headers: corsHeaders
      });
    }
  };
}

export default withErrorBoundary;
