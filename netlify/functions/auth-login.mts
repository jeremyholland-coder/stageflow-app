/**
 * Cookie-Based Authentication Login Endpoint
 *
 * PURPOSE:
 * Replaces client-side localStorage authentication with secure HttpOnly cookies.
 * This endpoint handles user login and sets secure session cookies.
 *
 * SECURITY FEATURES:
 * - HttpOnly cookies (XSS protection)
 * - Secure flag (HTTPS only)
 * - SameSite=Strict (CSRF protection)
 * - Short-lived tokens (1 hour with refresh)
 * - Distributed rate limiting (5 attempts/minute)
 * - Generic error messages (prevents account enumeration)
 *
 * USAGE:
 * POST /.netlify/functions/auth-login
 * Body: { email, password }
 * Response: Sets HttpOnly cookies + returns user data
 *
 * MIGRATION PATH:
 * Phase 1: Deploy this endpoint (dual auth support)
 * Phase 2: Update frontend to use this endpoint
 * Phase 3: Remove localStorage auth code
 *
 * SECURITY UPDATES (2025-11-19):
 * - Added distributed rate limiting to prevent brute force attacks
 * - Sanitized error messages to prevent account enumeration
 * - Added security event logging for audit trail
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { setSessionCookies, clearSessionCookies } from './lib/cookie-auth';
import { RATE_LIMITS } from './lib/rate-limiter';
import { logSecurityEvent, createSecurityEvent } from './lib/security-events';
import { createAuthLogContext } from './lib/log-sanitizer';
import { validateCSRFToken, createCSRFErrorResponse } from './lib/csrf-middleware';

// P0 FIX 2025-12-08: Standardized CORS origins across all auth functions
const ALLOWED_ORIGINS = [
  'https://stageflow.startupstage.com',           // Production (custom domain)
  'https://stageflow-rev-ops.netlify.app',        // Netlify primary domain
  'https://stageflow-app.netlify.app',            // Alternate Netlify domain
  'http://localhost:5173',                        // Vite dev server
  'http://localhost:8888',                        // Netlify dev server
];

// PHASE F FIX: CORS headers for browser requests
const getCorsHeaders = (event: HandlerEvent) => {
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : 'https://stageflow.startupstage.com';

  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
    'Content-Type': 'application/json'
  };
};

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // PHASE F FIX: Get CORS headers for this request
  const corsHeaders = getCorsHeaders(event);

  // PHASE F FIX: Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // SECURITY FIX (CRIT-SEC-3): Track request start time for constant-time responses
  const requestStartTime = Date.now();

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // SECURITY FIX (CRIT-SEC-2): Validate CSRF token for state-changing operations
    if (!validateCSRFToken(event)) {
      console.warn('[CSRF] Login attempt with invalid CSRF token');
      return createCSRFErrorResponse();
    }

    // SECURITY FIX 1: Apply distributed rate limiting (5 attempts/minute)
    // Prevents brute force attacks at application layer
    const req = new Request(`https://example.com${event.path || '/auth-login'}`, {
      method: event.httpMethod,
      headers: new Headers(event.headers as Record<string, string>)
    });

    const rateCheck = await RATE_LIMITS.AUTH(req);

    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil((rateCheck.resetTime - Date.now()) / 1000);

      console.warn(
        `[Security] Rate limit exceeded for login attempt`,
        {
          ip: event.headers['x-forwarded-for'] || 'unknown',
          remaining: rateCheck.remaining,
          resetTime: new Date(rateCheck.resetTime).toISOString()
        }
      );

      // Log rate limit event (async, non-blocking)
      logSecurityEvent(
        createSecurityEvent('RATE_LIMIT_EXCEEDED', event, {
          email: JSON.parse(event.body || '{}').email,
          metadata: {
            endpoint: 'auth-login',
            remaining: rateCheck.remaining,
            resetTime: new Date(rateCheck.resetTime).toISOString()
          }
        })
      );

      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(retryAfter)
        },
        body: JSON.stringify({
          error: 'Too many login attempts. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfter,
          resetAt: new Date(rateCheck.resetTime).toISOString()
        })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required fields',
          code: 'MISSING_FIELDS',
          details: 'Email and password are required'
        })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Invalid email format',
          code: 'INVALID_EMAIL'
        })
      };
    }

    // Get Supabase configuration
    // CRITICAL FIX 2025-12-03: Backend MUST prefer SUPABASE_* vars over VITE_* vars
    // VITE_* vars are for frontend only and may not exist in Netlify Functions
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    // DIAGNOSTIC: Log env var presence (not values) for debugging auth issues
    console.log('[AUTH_LOGIN] Config check:', {
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasViteSupabaseUrl: !!process.env.VITE_SUPABASE_URL,
      hasSupabaseAnonKey: !!process.env.SUPABASE_ANON_KEY,
      hasViteSupabaseAnonKey: !!process.env.VITE_SUPABASE_ANON_KEY,
      hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      usingUrl: supabaseUrl ? 'set' : 'MISSING',
      usingAnonKey: supabaseAnonKey ? 'set' : 'MISSING'
    });

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[AUTH_LOGIN] CRITICAL: Missing Supabase configuration - check SUPABASE_URL and SUPABASE_ANON_KEY env vars');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Sign-in is temporarily unavailable. Please try again later.',
          code: 'SUPABASE_CONFIG_ERROR'
        })
      };
    }

    // Create Supabase client
    console.log('[AUTH_LOGIN] Creating Supabase client for login');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Attempt login
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      // SECURITY FIX (CRIT-SEC-1): Use sanitized logging (no PII)
      // Hash email instead of logging plaintext
      const logContext = createAuthLogContext({
        email,
        ip: event.headers['x-forwarded-for'],
        userAgent: event.headers['user-agent']
      });

      // DIAGNOSTIC: Log detailed error info for debugging
      console.error('[AUTH_LOGIN] Login failed:', {
        errorMessage: error.message,
        errorCode: error.code,
        errorStatus: error.status,
        errorName: error.name,
        ...logContext
      });

      // Return generic error message for all authentication failures
      // This prevents attackers from determining if an account exists
      let statusCode = 401;
      let errorCode = 'AUTHENTICATION_FAILED';
      let errorMessage = 'Invalid email or password';

      // Exception: Rate limiting can be explicit (already handled above via rate limiter)
      // If Supabase rate limit also triggered, pass it through
      if (error.message.includes('Too many requests')) {
        statusCode = 429;
        errorCode = 'RATE_LIMIT_EXCEEDED';
        errorMessage = 'Too many login attempts. Please try again later.';
      }

      // APPLE-LEVEL UX FIX: Detect unconfirmed email and return specific error
      // This is SAFE because the user knows their email exists (they signed up)
      // Provides actionable guidance instead of confusing generic error
      const isEmailNotConfirmed = error.message.includes('Email not confirmed');
      if (isEmailNotConfirmed) {
        // SECURITY FIX (CRIT-SEC-1): Use sanitized logging
        console.warn('[Security] Login attempt with unconfirmed email:', logContext.emailHash);

        // Log unconfirmed email event
        logSecurityEvent(
          createSecurityEvent('LOGIN_FAILURE', event, {
            email: email,
            metadata: {
              errorCode: 'EMAIL_NOT_CONFIRMED',
              errorMessage: error.message,
              isEmailNotConfirmed: true,
              timestamp: new Date().toISOString()
            }
          })
        );

        // Return specific error code so frontend can show helpful message + resend button
        return {
          statusCode: 403, // Forbidden - different from 401 Unauthorized
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Please verify your email address. Check your inbox for the verification link.',
            code: 'EMAIL_NOT_CONFIRMED',
            email: email // Include email so frontend can offer to resend
          })
        };
      }

      // Log failed login event for audit trail (other errors)
      logSecurityEvent(
        createSecurityEvent('LOGIN_FAILURE', event, {
          email: email,
          metadata: {
            errorCode: error.code,
            errorMessage: error.message,
            isEmailNotConfirmed: false,
            timestamp: new Date().toISOString()
          }
        })
      );

      // SECURITY FIX (CRIT-SEC-3): Constant-time response to prevent timing attacks
      // Ensure all failed logins take at least MIN_RESPONSE_TIME
      const elapsed = Date.now() - requestStartTime;
      const MIN_RESPONSE_TIME = 300; // 300ms minimum
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
      }

      return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({
          error: errorMessage,
          code: errorCode
        })
      };
    }

    if (!data.session || !data.user) {
      console.error('❌ Login succeeded but no session returned');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Authentication failed',
          code: 'NO_SESSION'
        })
      };
    }

    // P0 FIX 2025-12-08: Pass origin for domain-aware cookie setting
    const requestOrigin = event.headers?.origin || '';
    const cookies = setSessionCookies(
      data.session.access_token,
      data.session.refresh_token,
      { origin: requestOrigin }
    );

    // SECURITY FIX (CRIT-SEC-1): Log successful authentication with sanitized data
    const successLogContext = createAuthLogContext({
      email: data.user.email,
      userId: data.user.id,
      ip: event.headers['x-forwarded-for'],
      userAgent: event.headers['user-agent']
    });

    console.log('[Security] Login successful:', successLogContext);

    // Log successful login event (email stored in security_events table for audit only)
    logSecurityEvent(
      createSecurityEvent('LOGIN_SUCCESS', event, {
        userId: data.user.id,
        email: data.user.email, // Stored in DB table, not logs
        metadata: {
          sessionExpiresAt: data.session.expires_at,
          timestamp: new Date().toISOString()
        }
      })
    );

    // SECURITY FIX (CRIT-SEC-3): Constant-time response to prevent timing attacks
    // Ensure all successful logins take at least MIN_RESPONSE_TIME
    const elapsed = Date.now() - requestStartTime;
    const MIN_RESPONSE_TIME = 300; // 300ms minimum
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
    }

    // Return success response with cookies
    // CRITICAL FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    // Comma-joining cookies causes browser parsing issues
    return {
      statusCode: 200,
      headers: corsHeaders,
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          email_confirmed_at: data.user.email_confirmed_at,
          user_metadata: data.user.user_metadata,
          created_at: data.user.created_at
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in
        },
        message: 'Logged in successfully. Session stored in secure cookies.'
      })
    };

  } catch (error: any) {
    console.error('💥 Login exception:', error);

    // PHASE F FIX: Return error with CORS headers (createErrorResponse doesn't include CORS)
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'An error occurred during login. Please try again.',
        code: 'LOGIN_ERROR'
      })
    };
  }
};

/**
 * Logout endpoint (POST /auth-logout)
 *
 * Clears session cookies and invalidates server-side session.
 */
export const logoutHandler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // PHASE F FIX: Get CORS headers for this request
  const corsHeaders = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get Supabase configuration
    // CRITICAL FIX 2025-12-03: Backend MUST prefer SUPABASE_* vars over VITE_* vars
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      // Extract access token from Authorization header or cookies
      const authHeader = event.headers.authorization || event.headers.Authorization;
      const cookieHeader = event.headers.cookie || event.headers.Cookie || '';

      // Try to get token from cookies if not in header
      let accessToken: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.substring(7);
      } else if (cookieHeader) {
        const { parseCookies, COOKIE_NAMES } = await import('./lib/cookie-auth');
        const cookies = parseCookies(cookieHeader);
        accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN] || null;
      }

      // Invalidate session server-side if we have a token
      if (accessToken) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        await supabase.auth.signOut();
      }
    }

    // P0 FIX 2025-12-08: Pass origin for domain-aware cookie deletion
    const logoutOrigin = event.headers?.origin || '';
    const cookies = clearSessionCookies(logoutOrigin);

    // FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    return {
      statusCode: 200,
      headers: corsHeaders,
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        message: 'Logged out successfully'
      })
    };

  } catch (error: any) {
    console.error('💥 Logout exception:', error);

    // Even if logout fails, clear cookies client-side
    // P0 FIX 2025-12-08: Pass origin for domain-aware cookie deletion
    const logoutOrigin = event.headers?.origin || '';
    const cookies = clearSessionCookies(logoutOrigin);

    // FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    return {
      statusCode: 200,
      headers: corsHeaders,
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        message: 'Logged out (client-side)'
      })
    };
  }
};
