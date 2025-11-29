// path: netlify/functions/lib/csrf-middleware.ts
import type { HandlerEvent } from '@netlify/functions';
import crypto from 'crypto';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token'; // header name is case-insensitive

/**
 * Parse cookies from a Cookie header string into a key/value object
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(part => {
    const [rawName, ...rest] = part.split('=');
    if (!rawName) return;
    const name = rawName.trim();
    const value = rest.join('=').trim();
    if (!name) return;
    cookies[name] = decodeURIComponent(value || '');
  });

  return cookies;
}

/**
 * Create a standardized CSRF error response
 */
export function createCSRFErrorResponse() {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Invalid CSRF token',
      code: 'CSRF_INVALID'
    })
  };
}

/**
 * Validate CSRF token using the double-submit cookie pattern:
 * - Token stored in cookie "csrf_token"
 * - Same token sent in header "X-CSRF-Token"
 * - Both must exist and match (constant-time comparison)
 *
 * Safe for:
 * - POST/PUT/PATCH/DELETE
 * Skipped for:
 * - GET/HEAD/OPTIONS
 */
export function validateCSRFToken(event: HandlerEvent): boolean {
  const method = (event.httpMethod || 'GET').toUpperCase();

  // Read-only methods do not require CSRF validation
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = parseCookies(cookieHeader);

  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken =
    (event.headers[CSRF_HEADER_NAME] as string | undefined) ||
    (event.headers[CSRF_HEADER_NAME.toUpperCase()] as string | undefined);

  if (!cookieToken || !headerToken) {
    console.warn('[CSRF] Missing token - cookie or header not present');
    return false;
  }

  // Constant-time comparison
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));

  if (a.length !== b.length) {
    console.warn('[CSRF] Token length mismatch');
    return false;
  }

  try {
    const match = crypto.timingSafeEqual(a, b);
    if (!match) {
      console.warn('[CSRF] Token mismatch');
    }
    return match;
  } catch (err) {
    console.error('[CSRF] Error during token comparison:', err);
    return false;
  }
}
