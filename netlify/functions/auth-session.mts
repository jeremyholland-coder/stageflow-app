/**
 * Get Current Session from HttpOnly Cookies
 *
 * PURPOSE:
 * Reads the HttpOnly cookie and returns the current user + session tokens.
 * This replaces client-side `supabase.auth.getSession()` calls.
 * Frontend uses the tokens to call `setSession()` so client-side RLS queries work.
 *
 * USAGE:
 * GET /.netlify/functions/auth-session
 * Returns: { user, session: { access_token, refresh_token, expires_at, expires_in } } or { error }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES } from './lib/cookie-auth';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get Supabase configuration
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // CRITICAL FIX: Read session tokens from HttpOnly cookies OR Authorization header
    // FIX 2025-12-01: Also accept Authorization header as fallback for scenarios where cookies aren't sent
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    let accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];
    let refreshToken = cookies[COOKIE_NAMES.REFRESH_TOKEN];

    // FALLBACK: Check Authorization header if no cookies
    // This handles cases where cookies aren't being sent (e.g., after password reset, cross-origin)
    if (!accessToken) {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.replace('Bearer ', '').trim();
        console.log('[auth-session] Using Authorization header token (no cookies found)');
      }
    }

    if (!accessToken) {
      console.log('[auth-session] No session found (checked cookies and Authorization header)');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // If we only have access token (from header), we can still validate the user
    // The refresh token is optional for validation - we'll use what we have
    if (!refreshToken) {
      console.log('[auth-session] No refresh token available - will validate access token only');
    }

    // Create Supabase client and set the session from cookies
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: fetch,
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      },
      auth: {
        persistSession: false,
        detectSessionInUrl: false
      }
    });

    // Set the session in the client so getUser() works
    // FIX 2025-12-01: Handle case where only access token is available (from Authorization header)
    let sessionData: any = null;
    let sessionError: any = null;

    if (refreshToken) {
      // We have both tokens - do full session restore
      const result = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      sessionData = result.data;
      sessionError = result.error;
    } else {
      // Only access token available - validate user directly without setSession
      // This allows Authorization header auth to work
      console.log('[auth-session] Validating access token without refresh token');
    }

    if (refreshToken && (sessionError || !sessionData?.session)) {
      console.error('[auth-session] Failed to restore session:', sessionError?.message);
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid or expired session' })
      };
    }

    // Get the user info (validates the access token is still valid)
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      console.error('[auth-session] Failed to get user:', userError?.message);
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: "Not authenticated" })
      };
    }

    // Return both user and session tokens for frontend to call setSession()
    // FIX 2025-12-01: Handle case where only access token was provided (no session refresh)
    const responseSession = sessionData?.session
      ? {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
          expires_at: sessionData.session.expires_at,
          expires_in: sessionData.session.expires_in
        }
      : {
          // Return the access token we validated (no refresh token available)
          access_token: accessToken,
          refresh_token: null,
          expires_at: null,
          expires_in: null
        };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: userData.user,
        session: responseSession
      })
    };

  } catch (error: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
