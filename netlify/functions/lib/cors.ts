/**
 * CORS CONFIG SPINE
 *
 * Single source of truth for CORS configuration across all Netlify functions.
 * All API endpoints must use this module for CORS headers.
 *
 * @module lib/cors
 * @since Engine Rebuild Phase 5
 */

// =============================================================================
// ALLOWED ORIGINS
// =============================================================================

/**
 * Whitelist of allowed origins for CORS.
 *
 * Add new deploy URLs here when setting up new environments.
 * Order doesn't matter - this is used for membership checks.
 */
export const ALLOWED_ORIGINS = [
  // Production
  'https://stageflow.startupstage.com',

  // Netlify deploy previews
  'https://stageflow-rev-ops.netlify.app',
  'https://stageflow-app.netlify.app',

  // Local development
  'http://localhost:8888',
  'http://localhost:5173',
  'http://localhost:3000',
] as const;

/**
 * Default origin to use when request origin is not in whitelist.
 * This is the production URL.
 */
export const DEFAULT_ORIGIN = 'https://stageflow.startupstage.com';

// =============================================================================
// CORS HELPERS
// =============================================================================

/**
 * Check if an origin is a Netlify deploy preview for StageFlow.
 *
 * Handles dynamic deploy preview URLs like:
 * - https://deploy-preview-123--stageflow-app.netlify.app
 * - https://feature-branch--stageflow-app.netlify.app
 * - https://main--stageflow-rev-ops.netlify.app
 *
 * ENGINE REBUILD Phase 9: Preserve Netlify preview handling from original CORS logic
 */
export function isNetlifyDeployPreview(origin: string | null | undefined): boolean {
  if (!origin) return false;

  // Must be a Netlify app URL AND contain stageflow identifier
  return origin.includes('.netlify.app') && origin.includes('stageflow');
}

/**
 * Check if an origin is allowed.
 *
 * An origin is allowed if:
 * 1. It's in the static whitelist, OR
 * 2. It's a Netlify deploy preview for StageFlow
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;

  // Check static whitelist
  if (ALLOWED_ORIGINS.includes(origin as typeof ALLOWED_ORIGINS[number])) {
    return true;
  }

  // Check dynamic Netlify deploy previews
  return isNetlifyDeployPreview(origin);
}

/**
 * Get the appropriate CORS origin header value.
 *
 * - If origin is in whitelist, returns that origin
 * - Otherwise returns the default production origin
 */
export function getCorsOrigin(origin: string | null | undefined): string {
  if (origin && isAllowedOrigin(origin)) {
    return origin;
  }
  return DEFAULT_ORIGIN;
}

/**
 * Build complete CORS headers for a response.
 *
 * @param origin - The request's Origin header
 * @param options - Optional configuration
 * @returns Headers object with all CORS headers
 */
export function buildCorsHeaders(
  origin: string | null | undefined,
  options: {
    methods?: string;
    allowHeaders?: string;
    exposeHeaders?: string;
    maxAge?: number;
  } = {}
): Record<string, string> {
  const {
    methods = 'GET, POST, PUT, DELETE, OPTIONS',
    allowHeaders = 'Content-Type, Authorization, X-Correlation-ID',
    exposeHeaders = 'X-Correlation-ID',
    maxAge = 86400, // 24 hours
  } = options;

  return {
    'Access-Control-Allow-Origin': getCorsOrigin(origin),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Expose-Headers': exposeHeaders,
    'Access-Control-Max-Age': String(maxAge),
    'Content-Type': 'application/json',
  };
}

/**
 * Create a preflight (OPTIONS) response with CORS headers.
 */
export function createPreflightResponse(origin: string | null | undefined): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

/**
 * Create an error response with CORS headers.
 */
export function createErrorResponse(
  origin: string | null | undefined,
  error: {
    message: string;
    code?: string;
    status?: number;
    details?: unknown;
  }
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: error.message,
      code: error.code || 'ERROR',
      details: error.details,
    }),
    {
      status: error.status || 500,
      headers: buildCorsHeaders(origin),
    }
  );
}

/**
 * Create a success response with CORS headers.
 */
export function createSuccessResponse<T>(
  origin: string | null | undefined,
  data: T,
  status = 200
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      ...data,
    }),
    {
      status,
      headers: buildCorsHeaders(origin),
    }
  );
}

/**
 * Extract origin from request headers.
 * Handles both Request object and plain headers object.
 */
export function getOriginFromRequest(req: Request | { headers: Record<string, string | undefined> }): string | null {
  if (req instanceof Request) {
    return req.headers.get('origin');
  }
  return req.headers.origin || req.headers.Origin || null;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  ALLOWED_ORIGINS,
  DEFAULT_ORIGIN,
  isNetlifyDeployPreview,
  isAllowedOrigin,
  getCorsOrigin,
  buildCorsHeaders,
  createPreflightResponse,
  createErrorResponse,
  createSuccessResponse,
  getOriginFromRequest,
};
