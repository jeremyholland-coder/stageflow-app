/**
 * Timeout Wrapper Utility
 *
 * Wraps async operations with timeout protection to prevent functions from hanging
 * indefinitely when external services (Stripe, Supabase, AI providers) are slow.
 *
 * CRITICAL FOR PRODUCTION: Without this, users see infinite loading spinners
 * and functions hit Netlify's 10-second timeout with generic errors.
 */

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Wraps a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Human-readable description for error messages
 * @returns The promise result or throws TimeoutError
 *
 * @example
 * const result = await withTimeout(
 *   stripe.checkout.sessions.create({ ... }),
 *   10000,
 *   'Stripe checkout session creation'
 * );
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new TimeoutError(operation, timeoutMs)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Recommended timeout values for different operations
 */
export const TIMEOUTS = {
  // Database operations
  DATABASE_QUERY: 5000,        // 5s - most queries should be fast
  DATABASE_RPC: 15000,         // 15s - RPCs can be complex
  DATABASE_TRANSACTION: 10000, // 10s - transactions need more time

  // External APIs
  STRIPE_API: 10000,           // 10s - Stripe is usually fast
  STRIPE_WEBHOOK: 5000,        // 5s - webhook processing should be quick
  EMAIL_API: 10000,            // 10s - Resend/SendGrid
  AI_PROVIDER: 60000,          // P1 FIX 2025-12-09: Increased from 30s to 60s for complex queries (Plan My Day)

  // Auth operations
  AUTH_CHECK: 5000,            // 5s - auth should be fast
  AUTH_TOKEN_REFRESH: 8000,    // 8s - token refresh can be slower

  // Internal operations
  JSON_PARSE: 1000,            // 1s - parsing should be instant
  ENCRYPTION: 2000,            // 2s - crypto operations
  FILE_UPLOAD: 30000,          // 30s - file uploads can be slow
} as const;

/**
 * Safe JSON parsing with timeout
 *
 * @param jsonString - JSON string to parse
 * @param fallback - Optional fallback value if parsing fails
 * @returns Parsed object or fallback
 */
export function safeJsonParse<T = any>(
  jsonString: string,
  fallback?: T
): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch (e) {
    if (fallback !== undefined) {
      return fallback;
    }
    return null;
  }
}

/**
 * Wraps Request.json() with timeout and error handling
 *
 * @param req - Request object
 * @param timeoutMs - Timeout in milliseconds (default: 1000ms)
 * @returns Parsed JSON or throws descriptive error
 */
export async function safeRequestJson<T = any>(
  req: Request,
  timeoutMs: number = TIMEOUTS.JSON_PARSE
): Promise<T> {
  try {
    const json = await withTimeout(
      req.json(),
      timeoutMs,
      'Request JSON parsing'
    );
    return json as T;
  } catch (e) {
    if (e instanceof TimeoutError) {
      throw new Error('Request body parsing timed out - body may be too large');
    }
    throw new Error('Invalid JSON in request body');
  }
}

/**
 * Validates required environment variables at module load time
 *
 * @param vars - Array of environment variable names
 * @throws Error if any variables are missing
 *
 * @example
 * validateEnvVars(['STRIPE_SECRET_KEY', 'SUPABASE_URL']);
 */
export function validateEnvVars(vars: string[]): void {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}
