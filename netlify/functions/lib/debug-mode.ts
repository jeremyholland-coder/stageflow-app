/**
 * Debug Mode Control Library
 *
 * PURPOSE:
 * Centralized control for debug/demo endpoints in production.
 * Prevents accidental exposure of admin/debug functionality.
 *
 * USAGE:
 * ```typescript
 * import { requireDebugMode } from './lib/debug-mode';
 *
 * // At the top of debug endpoints
 * requireDebugMode(); // Throws if debug mode disabled
 * ```
 *
 * CONFIGURATION:
 * Set ENABLE_DEBUG_ENDPOINTS=true in environment variables to enable.
 * Default: false (disabled in production)
 */

export class DebugModeDisabledError extends Error {
  constructor() {
    super('Debug endpoints are disabled in production');
    this.name = 'DebugModeDisabledError';
  }
}

/**
 * Check if debug mode is enabled
 * Returns true only if explicitly enabled via environment variable
 */
export function isDebugModeEnabled(): boolean {
  const enabled = process.env.ENABLE_DEBUG_ENDPOINTS;
  return enabled === 'true';
}

/**
 * Require debug mode to be enabled
 * Throws DebugModeDisabledError if disabled
 *
 * Use this at the top of debug/demo endpoints:
 * ```typescript
 * export const handler: Handler = async (event, context) => {
 *   requireDebugMode(); // Blocks execution if debug mode disabled
 *   // ... rest of endpoint logic
 * };
 * ```
 */
export function requireDebugMode(): void {
  if (!isDebugModeEnabled()) {
    console.warn('⚠️  [Debug Mode] Attempted to access debug endpoint while disabled');
    throw new DebugModeDisabledError();
  }
}

/**
 * Create standard error response for disabled debug endpoints
 */
export function createDebugDisabledResponse() {
  return {
    statusCode: 404, // Return 404 to hide endpoint existence
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Not found'
    })
  };
}

/**
 * Middleware wrapper for debug endpoints
 * Automatically handles debug mode checking and error responses
 *
 * Example:
 * ```typescript
 * export const handler = withDebugMode(async (event, context) => {
 *   // Debug logic here - only runs if debug mode enabled
 *   return { statusCode: 200, body: 'Debug info' };
 * });
 * ```
 */
export function withDebugMode(handler: Function) {
  return async (event: any, context: any) => {
    try {
      requireDebugMode();
      return await handler(event, context);
    } catch (error) {
      if (error instanceof DebugModeDisabledError) {
        return createDebugDisabledResponse();
      }
      throw error;
    }
  };
}

/**
 * Log debug mode status on server startup
 * Call this in a health check or startup script
 */
export function logDebugModeStatus(): void {
  if (isDebugModeEnabled()) {
    console.warn('⚠️  [Debug Mode] DEBUG ENDPOINTS ENABLED - Disable in production!');
    console.warn('    Set ENABLE_DEBUG_ENDPOINTS=false to disable');
  } else {
    console.log('✅ [Debug Mode] Debug endpoints disabled (production mode)');
  }
}
