/**
 * Standard API Response Helpers for Netlify Functions
 * Ensures consistent error handling, validation, and responses across all endpoints
 */

import { sanitizeError, createErrorResponse } from './error-sanitizer';

/**
 * Standard success response
 */
export function successResponse<T>(data: T, statusCode: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Validates required environment variables
 * Throws error if any are missing
 */
export function validateEnvVars(requiredVars: string[]): void {
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Validates request method
 */
export function validateMethod(
  request: Request,
  allowedMethods: string[]
): Response | null {
  if (!allowedMethods.includes(request.method)) {
    return new Response(
      JSON.stringify({ 
        error: `Method ${request.method} not allowed. Allowed: ${allowedMethods.join(', ')}` 
      }),
      {
        status: 405,
        headers: { 
          'Content-Type': 'application/json',
          'Allow': allowedMethods.join(', ')
        }
      }
    );
  }
  return null;
}

/**
 * Validates authentication header
 */
export function validateAuth(request: Request): Response | null {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return createErrorResponse(
      new Error('Missing or invalid authorization header'),
      401,
      'validateAuth',
      'UNAUTHORIZED'
    );
  }
  
  return null;
}

/**
 * Parses and validates JSON body
 */
export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    return body as T;
  } catch (error: any) {
    throw new Error('Invalid JSON in request body');
  }
}

/**
 * Validates required fields in request body
 */
export function validateRequiredFields<T extends Record<string, any>>(
  body: T,
  requiredFields: (keyof T)[]
): void {
  const missing = requiredFields.filter(field => !body[field]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Standard function wrapper with error handling
 * Use this to wrap all Netlify function handlers
 */
export function withErrorHandling(
  handler: (request: Request) => Promise<Response>,
  functionName: string
) {
  return async (request: Request): Promise<Response> => {
    try {
      // Log incoming request (in production, be careful with sensitive data)
      
      return await handler(request);
    } catch (error: any) {
      // Log error with context
      console.error(`[${functionName}] Error:`, error);
      
      // Determine status code based on error type
      let statusCode = 500;
      const errorMessage = (error as any)?.message || '';
      if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
        statusCode = 401;
      } else if (errorMessage.includes('forbidden') || errorMessage.includes('permission')) {
        statusCode = 403;
      } else if (errorMessage.includes('not found')) {
        statusCode = 404;
      } else if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorMessage.includes('required')) {
        statusCode = 400;
      }

      return createErrorResponse(error as Error, statusCode, functionName);
    }
  };
}

/**
 * Allowed origins for CORS (whitelist)
 * Security: Only allow requests from these domains
 */
const ALLOWED_ORIGINS = [
  'https://stageflow.startupstage.com',           // Production
  'https://stageflow-rev-ops.netlify.app',        // Netlify primary domain
  'http://localhost:5173',                        // Vite dev server
  'http://localhost:8888',                        // Netlify dev server
];

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  // Allow exact matches
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  // Allow Netlify deploy previews (e.g., deploy-preview-123--stageflow.netlify.app)
  if (origin.includes('.netlify.app') && origin.includes('stageflow')) {
    return true;
  }

  return false;
}

/**
 * Standard handler for OPTIONS requests (CORS)
 */
export function handleCorsOptions(request: Request): Response {
  const origin = request.headers.get('Origin');
  const allowedOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

/**
 * Adds CORS headers to response (with origin validation)
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  const allowedOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];

  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Re-export error utilities
export { sanitizeError, createErrorResponse };
