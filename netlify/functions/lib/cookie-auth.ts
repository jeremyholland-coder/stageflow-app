/**
 * Cookie-Based Authentication Library
 *
 * PURPOSE:
 * Provides secure cookie-based session management to replace localStorage tokens.
 * Eliminates XSS vulnerability by using HttpOnly cookies that JavaScript cannot access.
 *
 * SECURITY FEATURES:
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: HTTPS-only transmission (MITM protection)
 * - SameSite: Prevents CSRF attacks
 * - Short-lived: 1-hour expiration with refresh mechanism
 *
 * MIGRATION STRATEGY:
 * Phase 1: Dual authentication (support both cookies and Bearer tokens)
 * Phase 2: Frontend migration (update to cookie-based auth)
 * Phase 3: Cleanup (remove Bearer token support)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cookie configuration
 */
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  maxAge?: number; // seconds
  path?: string;
  domain?: string;
}

/**
 * Get cookie domain based on environment and request origin
 *
 * P0 FIX 2025-12-08: Cookie domain MUST match the host making the request
 *
 * CRITICAL BUG FIXED:
 * - If user is on stageflow.startupstage.com, cookies need domain=.startupstage.com
 * - If user is on stageflow-rev-ops.netlify.app, cookies need domain=.netlify.app (or omit)
 * - Setting .startupstage.com domain when accessed via .netlify.app causes 401s
 *
 * SOLUTION: Don't set domain attribute - let browser use host-only cookie (most compatible)
 * Host-only cookies are sent to the exact domain that set them, which is what we need
 * for Netlify Functions (which run on the same domain as the site)
 *
 * NOTE: Domain is only set for startupstage.com subdomains. For all other hosts, omit domain.
 */
function getCookieDomain(requestOrigin?: string): string | undefined {
  // P0 FIX 2025-12-08: Check if request is from startupstage.com
  // Only set domain for startupstage.com origins (enables subdomain sharing)
  // For netlify.app or localhost, omit domain (host-only cookie is most compatible)
  if (requestOrigin?.includes('startupstage.com')) {
    return '.startupstage.com';
  }

  // For all other origins (netlify.app, localhost, etc.), don't set domain
  // This creates a "host-only" cookie that's sent to the exact domain
  return undefined;
}

/**
 * Default cookie options for production
 * P0 FIX 2025-12-08: Domain is now set dynamically based on request origin
 * Do NOT set domain here - it's added in setSessionCookies based on origin
 */
const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true, // HTTPS only
  sameSite: 'Lax', // FIX 2025-12-03: Changed from Strict to allow cross-site navigation cookies to Netlify Functions
  maxAge: 3600, // 1 hour
  path: '/'
  // P0 FIX 2025-12-08: domain intentionally omitted - set dynamically in setSessionCookies
};

/**
 * Cookie names
 */
export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'sb-access-token',
  REFRESH_TOKEN: 'sb-refresh-token',
  SESSION_ID: 'sb-session-id'
} as const;

/**
 * Parse cookies from Cookie header string
 *
 * CRITICAL FIX: Added defensive type checking to prevent "e.split is not a function" error
 * This error occurs when cookieHeader is not a string (e.g., undefined, null, array, number)
 *
 * @param cookieHeader - Cookie header string (e.g., "name1=value1; name2=value2")
 * @returns Object with cookie name-value pairs
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  // CRITICAL FIX: Defensive type checking
  // Ensure cookieHeader is actually a string before calling split
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  try {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...valueParts] = cookie.split('=');
      if (name && valueParts.length > 0) {
        const trimmedName = name.trim();
        const value = valueParts.join('=').trim();
        // Safely decode - some cookie values may not need decoding
        try {
          cookies[trimmedName] = decodeURIComponent(value);
        } catch (decodeErr) {
          // If decoding fails, use raw value
          cookies[trimmedName] = value;
        }
      }
    });
  } catch (error) {
    console.warn('[cookie-auth] Cookie parse error:', error);
    return cookies;
  }

  return cookies;
}

/**
 * Serialize cookie into Set-Cookie header format
 *
 * @param name - Cookie name
 * @param value - Cookie value
 * @param options - Cookie options
 * @returns Set-Cookie header string
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const opts = { ...DEFAULT_COOKIE_OPTIONS, ...options };
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];

  if (opts.httpOnly) {
    parts.push('HttpOnly');
  }

  if (opts.secure) {
    parts.push('Secure');
  }

  if (opts.sameSite) {
    parts.push(`SameSite=${opts.sameSite}`);
  }

  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${opts.maxAge}`);
    // Also set Expires for compatibility with older browsers
    const expires = new Date(Date.now() + opts.maxAge * 1000);
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  if (opts.path) {
    parts.push(`Path=${opts.path}`);
  }

  if (opts.domain) {
    parts.push(`Domain=${opts.domain}`);
  }

  return parts.join('; ');
}

/**
 * Create cookie for deletion (set expiration in past)
 *
 * P0 FIX 2025-12-08: Added origin parameter for domain-aware deletion
 * Cookies set WITH domain can only be deleted WITH the same domain
 *
 * @param name - Cookie name
 * @param origin - Request origin (used to determine correct domain)
 * @returns Set-Cookie header string that deletes the cookie
 */
export function deleteCookie(name: string, origin?: string): string {
  const domain = getCookieDomain(origin);
  return serializeCookie(name, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax', // P0 FIX: Match the SameSite used when setting (was Strict, should be Lax)
    maxAge: 0,
    path: '/',
    domain // P0 FIX: Include domain so cookies with domain get properly deleted
  });
}

/**
 * Extract session from cookies
 *
 * @param request - Request object
 * @returns Session tokens or null
 */
export function getSessionFromCookies(request: Request): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);

  return {
    accessToken: cookies[COOKIE_NAMES.ACCESS_TOKEN] || null,
    refreshToken: cookies[COOKIE_NAMES.REFRESH_TOKEN] || null
  };
}

/**
 * Create Supabase client with cookie-based session
 *
 * @param request - Request object
 * @returns Supabase client configured with cookie session
 */
export function createSupabaseCookieClient(request: Request): SupabaseClient {
  // CRITICAL: Backend MUST prefer SUPABASE_* vars over VITE_* vars
  // VITE_* vars are for frontend only and may not exist in Netlify Functions
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration');
  }

  // Extract session from cookies
  const { accessToken } = getSessionFromCookies(request);

  // Create client with global headers for session
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}
    }
  });

  return client;
}

/**
 * Set session cookies in response
 *
 * P0 FIX 2025-12-08: Added origin parameter for domain-aware cookie setting
 * Domain is set based on request origin to ensure cookies work correctly:
 * - startupstage.com → domain=.startupstage.com (enables subdomain sharing)
 * - netlify.app → no domain (host-only cookie, most compatible)
 * - localhost → no domain (host-only cookie)
 *
 * @param accessToken - Access token
 * @param refreshToken - Refresh token
 * @param options - Cookie options override (can include origin for domain detection)
 * @returns Array of Set-Cookie header values
 */
export function setSessionCookies(
  accessToken: string,
  refreshToken: string,
  options: Partial<CookieOptions> & { origin?: string } = {}
): string[] {
  // P0 FIX 2025-12-08: Extract origin and compute domain dynamically
  const { origin, ...restOptions } = options;
  const domain = getCookieDomain(origin);

  const cookieOptions = {
    ...DEFAULT_COOKIE_OPTIONS,
    ...restOptions,
    domain // P0 FIX: Set domain based on request origin
  };

  return [
    serializeCookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, cookieOptions),
    serializeCookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 3600 // Refresh token: 7 days
    })
  ];
}

/**
 * Clear session cookies
 *
 * P0 FIX 2025-12-08: Added origin parameter for domain-aware deletion
 *
 * @param origin - Request origin (used to determine correct domain for deletion)
 * @returns Array of Set-Cookie header values that delete cookies
 */
export function clearSessionCookies(origin?: string): string[] {
  return [
    deleteCookie(COOKIE_NAMES.ACCESS_TOKEN, origin),
    deleteCookie(COOKIE_NAMES.REFRESH_TOKEN, origin),
    deleteCookie(COOKIE_NAMES.SESSION_ID, origin)
  ];
}

/**
 * Validate and refresh session from cookies if needed
 *
 * @param request - Request object
 * @returns Valid session or null
 */
export async function validateCookieSession(request: Request): Promise<{
  user: any;
  session: any;
  needsRefresh: boolean;
} | null> {
  // CRITICAL: Backend MUST prefer SUPABASE_* vars over VITE_* vars
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration');
  }

  const { accessToken, refreshToken } = getSessionFromCookies(request);

  if (!accessToken) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // Validate access token
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      // Access token invalid, try refresh token
      if (refreshToken) {
        const { data, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken
        });

        if (refreshError || !data.session) {
          return null;
        }

        return {
          user: data.user,
          session: data.session,
          needsRefresh: true
        };
      }

      return null;
    }

    // Check if token is about to expire (less than 5 minutes remaining)
    const { data: { session } } = await supabase.auth.getSession();
    const needsRefresh = session?.expires_at
      ? (session.expires_at - Date.now() / 1000) < 300
      : false;

    return {
      user,
      session,
      needsRefresh
    };

  } catch (error) {
    console.error('Cookie session validation failed:', error);
    return null;
  }
}

/**
 * Create response with session cookies
 *
 * @param body - Response body
 * @param status - HTTP status code
 * @param accessToken - Access token
 * @param refreshToken - Refresh token
 * @param additionalHeaders - Additional headers
 * @returns Response with Set-Cookie headers
 */
export function createResponseWithCookies(
  body: string,
  status: number,
  accessToken: string,
  refreshToken: string,
  additionalHeaders: Record<string, string> = {}
): Response {
  const cookies = setSessionCookies(accessToken, refreshToken);

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders,
      'Set-Cookie': cookies.join(', ')
    }
  });
}

/**
 * Get cookie expiration timestamp
 *
 * @param maxAge - Max age in seconds
 * @returns ISO timestamp
 */
export function getCookieExpiration(maxAge: number): string {
  return new Date(Date.now() + maxAge * 1000).toISOString();
}

/**
 * v1.7.98: CORS Origin Validation
 *
 * SECURITY: Never use wildcard '*' with credentials - browsers reject this.
 * Instead, validate the request origin against a whitelist and echo it back.
 *
 * P0 FIX 2025-12-08: Standardized ALLOWED_ORIGINS across all auth functions
 * All Netlify app domains must be listed to ensure consistent CORS behavior.
 */
const ALLOWED_ORIGINS = [
  'https://stageflow.startupstage.com',           // Production (custom domain)
  'https://stageflow-rev-ops.netlify.app',        // Netlify primary domain
  'https://stageflow-app.netlify.app',            // P0 FIX: Alternate Netlify domain (used in auth-login)
  'http://localhost:5173',                        // Vite dev server
  'http://localhost:8888',                        // Netlify dev server
];

/**
 * Check if origin is allowed for CORS
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;

  // Exact match against whitelist
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // Allow Netlify deploy previews (e.g., deploy-preview-123--stageflow.netlify.app)
  if (origin.includes('.netlify.app') && origin.includes('stageflow')) return true;

  return false;
}

/**
 * Get validated CORS origin from request
 * Returns the origin if allowed, or the production URL as fallback
 *
 * @param origin - Origin header from request
 * @returns Safe origin for CORS header
 */
export function getCorsOrigin(origin: string | null | undefined): string {
  if (isAllowedOrigin(origin)) {
    return origin!;
  }
  // Fallback to production URL (never use wildcard with credentials)
  return ALLOWED_ORIGINS[0];
}

/**
 * Get CORS headers for Netlify Handler format (event.headers)
 *
 * @param eventHeaders - Headers from HandlerEvent
 * @returns CORS headers object
 */
export function getCorsHeaders(eventHeaders: Record<string, string | undefined>): Record<string, string> {
  const origin = eventHeaders.origin || eventHeaders.Origin;
  const allowedOrigin = getCorsOrigin(origin);

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
    // FIX 2025-12-02: Prevent browser caching of auth responses
    // Stale cached responses cause 401s after token rotation
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  };
}
