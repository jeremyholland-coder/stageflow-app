// ENGINEERED CSRF VALIDATION - Double-Submit Cookie Pattern
// Implements cryptographically secure CSRF protection
// Date: 2025-11-04

import { timingSafeEqual } from 'crypto';

/**
 * Validate CSRF token using double-submit cookie pattern
 * Compares header token with cookie token using timing-safe comparison
 *
 * @param req - Netlify Request object
 * @returns boolean - true if valid, false otherwise
 */
export function validateCsrfToken(req: Request): boolean {
  try {
    // Get token from header
    const headerToken = req.headers.get('X-CSRF-Token');
    if (!headerToken) {
      console.warn('CSRF: No token in header');
      return false;
    }

    // Get token from cookie
    const cookies = req.headers.get('cookie') || '';
    const cookieMatch = cookies.match(/_csrf=([^;]+)/);
    const cookieToken = cookieMatch ? cookieMatch[1] : null;

    if (!cookieToken) {
      console.warn('CSRF: No token in cookie');
      return false;
    }

    // Timing-safe comparison to prevent timing attacks
    const headerBuffer = Buffer.from(headerToken, 'utf8');
    const cookieBuffer = Buffer.from(cookieToken, 'utf8');

    // Must be same length
    if (headerBuffer.length !== cookieBuffer.length) {
      console.warn('CSRF: Token length mismatch');
      return false;
    }

    // Constant-time comparison
    const isValid = timingSafeEqual(headerBuffer, cookieBuffer);

    if (!isValid) {
      console.warn('CSRF: Token mismatch');
    }

    return isValid;
  } catch (error: any) {
    console.error('CSRF validation error:', error);
    return false;
  }
}

/**
 * Create standardized CSRF error response
 */
export function createCsrfErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'CSRF token validation failed',
      code: 'CSRF_INVALID'
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}
