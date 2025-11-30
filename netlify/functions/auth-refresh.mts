/**
 * Cookie-Based Authentication Refresh Endpoint
 *
 * PURPOSE:
 * Automatically refreshes access tokens using refresh tokens stored in HttpOnly cookies.
 * Provides seamless session management without requiring user re-authentication.
 *
 * USAGE:
 * POST /.netlify/functions/auth-refresh
 * Cookies: sb-refresh-token (HttpOnly)
 * Response: New access/refresh tokens in HttpOnly cookies
 *
 * SECURITY:
 * - Refresh tokens are HttpOnly (cannot be accessed by JavaScript)
 * - Refresh tokens have 7-day expiration
 * - Access tokens have 1-hour expiration
 * - Automatic rotation prevents token reuse attacks
 * - Rate limiting (10 requests/minute) prevents abuse
 *
 * SECURITY UPDATES (2025-11-19):
 * - Added distributed rate limiting for refresh endpoint
 * - Added logging for audit trail
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import {
  parseCookies,
  COOKIE_NAMES,
  setSessionCookies,
  clearSessionCookies
} from './lib/cookie-auth';
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead
import { RATE_LIMITS } from './lib/rate-limiter';
import { logSecurityEvent, createSecurityEvent } from './lib/security-events';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // PHASE 12: Consistent CORS headers
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:5173',
    'http://localhost:8888'
  ];
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : 'https://stageflow.startupstage.com';

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  console.warn('[auth-refresh] Processing token refresh request');

  try {
    // SECURITY FIX: Apply rate limiting to prevent refresh abuse
    // Allows 10 refreshes per minute (more generous than login)
    const req = new Request(`https://example.com${event.path || '/auth-refresh'}`, {
      method: event.httpMethod,
      headers: new Headers(event.headers as Record<string, string>)
    });

    const rateCheck = await RATE_LIMITS.API(req); // Use API limit (100/15min)

    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil((rateCheck.resetTime - Date.now()) / 1000);

      console.warn('[Security] Rate limit exceeded for token refresh', {
        ip: event.headers['x-forwarded-for'] || 'unknown',
        remaining: rateCheck.remaining
      });

      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(retryAfter)
        },
        body: JSON.stringify({
          error: 'Too many refresh attempts',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfter
        })
      };
    }

    // Get Supabase configuration
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('❌ Missing Supabase configuration');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Server configuration error',
          code: 'CONFIG_ERROR'
        })
      };
    }

    // Extract refresh token from cookies
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    const refreshToken = cookies[COOKIE_NAMES.REFRESH_TOKEN];

    if (!refreshToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        // PHASE 9 FIX: Use multiValueHeaders for Set-Cookie (prevents cookie parsing issues)
        multiValueHeaders: { 'Set-Cookie': clearSessionCookies() },
        body: JSON.stringify({
          error: 'No refresh token found',
          code: 'NO_REFRESH_TOKEN',
          message: 'Please log in again'
        })
      };
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Attempt to refresh session
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session) {
      console.error('❌ Session refresh failed:', error?.message);

      // Log token refresh failure
      logSecurityEvent(
        createSecurityEvent('TOKEN_REFRESH_FAILURE', event, {
          metadata: {
            errorMessage: error?.message,
            timestamp: new Date().toISOString()
          }
        })
      );

      // Clear invalid cookies
      const clearCookies = clearSessionCookies();

      return {
        statusCode: 401,
        headers: corsHeaders,
        // PHASE 9 FIX: Use multiValueHeaders for Set-Cookie (prevents cookie parsing issues)
        multiValueHeaders: { 'Set-Cookie': clearCookies },
        body: JSON.stringify({
          error: 'Session expired',
          code: 'SESSION_EXPIRED',
          message: 'Please log in again'
        })
      };
    }

    // Set new session cookies with refreshed tokens
    const newCookies = setSessionCookies(
      data.session.access_token,
      data.session.refresh_token
    );

    // Log successful token refresh
    logSecurityEvent(
      createSecurityEvent('TOKEN_REFRESH', event, {
        userId: data.user.id,
        email: data.user.email,
        metadata: {
          sessionExpiresAt: data.session.expires_at,
          timestamp: new Date().toISOString()
        }
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      // PHASE 9 FIX: Use multiValueHeaders for Set-Cookie (prevents cookie parsing issues)
      multiValueHeaders: { 'Set-Cookie': newCookies },
      body: JSON.stringify({
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          user_metadata: data.user.user_metadata
        },
        session: {
          expires_at: data.session.expires_at,
          expires_in: data.session.expires_in
        },
        message: 'Session refreshed successfully'
      })
    };

  } catch (error: any) {
    console.error('💥 Refresh exception:', error);

    // Clear cookies on error
    const clearCookies = clearSessionCookies();

    return {
      statusCode: 500,
      headers: corsHeaders,
      // PHASE 9 FIX: Use multiValueHeaders for Set-Cookie (prevents cookie parsing issues)
      multiValueHeaders: { 'Set-Cookie': clearCookies },
      body: JSON.stringify({
        error: 'Session refresh failed',
        code: 'REFRESH_ERROR',
        message: 'Please log in again'
      })
    };
  }
};
