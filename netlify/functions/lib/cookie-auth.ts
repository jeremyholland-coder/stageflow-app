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
 * Default cookie options for production
 */
const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true, // HTTPS only
  sameSite: 'Strict', // Prevent CSRF
  maxAge: 3600, // 1 hour
  path: '/'
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
 * @param cookieHeader - Cookie header string (e.g., "name1=value1; name2=value2")
 * @returns Object with cookie name-value pairs
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach(cookie => {
    const [name, ...valueParts] = cookie.split('=');
    if (name && valueParts.length > 0) {
      const trimmedName = name.trim();
      const value = valueParts.join('=').trim();
      cookies[trimmedName] = decodeURIComponent(value);
    }
  });

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
 * @param name - Cookie name
 * @returns Set-Cookie header string that deletes the cookie
 */
export function deleteCookie(name: string): string {
  return serializeCookie(name, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 0,
    path: '/'
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
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

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
 * @param accessToken - Access token
 * @param refreshToken - Refresh token
 * @param options - Cookie options override
 * @returns Array of Set-Cookie header values
 */
export function setSessionCookies(
  accessToken: string,
  refreshToken: string,
  options: Partial<CookieOptions> = {}
): string[] {
  const cookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...options };

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
 * @returns Array of Set-Cookie header values that delete cookies
 */
export function clearSessionCookies(): string[] {
  return [
    deleteCookie(COOKIE_NAMES.ACCESS_TOKEN),
    deleteCookie(COOKIE_NAMES.REFRESH_TOKEN),
    deleteCookie(COOKIE_NAMES.SESSION_ID)
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
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

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
 */
const ALLOWED_ORIGINS = [
  'https://stageflow.startupstage.com',           // Production
  'https://stageflow-rev-ops.netlify.app',        // Netlify primary domain
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
    'Content-Type': 'application/json'
  };
}
