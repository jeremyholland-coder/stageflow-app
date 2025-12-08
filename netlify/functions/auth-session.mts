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
 * Returns: { user, session, organization, role } or { error }
 *
 * FIX 2025-12-02: Handle token rotation race condition
 * - Added CORS headers (was missing - caused preflight failures)
 * - Made setSession failure non-fatal (race condition after token rotation)
 * - Added inline refresh when setSession fails but refresh_token exists
 * - Added organization/role to response for AI provider validation
 * - Added debug logging behind DEBUG_AUTH env flag
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import {
  parseCookies,
  COOKIE_NAMES,
  getCorsHeaders,
  setSessionCookies
} from './lib/cookie-auth';
import {
  extractCorrelationId,
  trackSessionValidation,
  trackSessionRefresh,
  trackSessionRotation,
} from './lib/telemetry';

const DEBUG = process.env.DEBUG_AUTH === 'true';

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[auth-session]', ...args);
  }
}

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // CRITICAL FIX: Add CORS headers with Cache-Control (prevents post-rotation failures)
  const corsHeaders = getCorsHeaders(event.headers as Record<string, string | undefined>);

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // PHASE 5: Extract correlation ID and track start time
  const correlationId = extractCorrelationId(new Request('http://localhost', {
    headers: event.headers as Record<string, string>
  }));
  const startTime = Date.now();

  try {
    // Get Supabase configuration
    // CRITICAL FIX 2025-12-03: Backend MUST prefer SUPABASE_* vars over VITE_* vars
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[AUTH_SESSION] CRITICAL: Missing Supabase configuration');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session validation unavailable', code: 'SUPABASE_CONFIG_ERROR' })
      };
    }

    // Read session tokens from HttpOnly cookies OR Authorization header
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    let accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];
    let refreshToken = cookies[COOKIE_NAMES.REFRESH_TOKEN];

    // FIX 2025-12-03: ALWAYS log token sources for production debugging
    // This helps diagnose 401s without needing DEBUG_AUTH=true
    const origin = event.headers.origin || event.headers.Origin || 'no-origin';
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const hasCookieToken = !!accessToken;
    const hasAuthHeader = authHeader.startsWith('Bearer ');

    console.log('[AUTH_SESSION] Token check:', {
      origin,
      hasCookieToken,
      hasAuthHeader,
      cookieNames: Object.keys(cookies),
      cookieHeaderLength: cookieHeader.length
    });

    // FALLBACK: Check Authorization header if no cookies
    if (!accessToken) {
      if (hasAuthHeader) {
        accessToken = authHeader.replace('Bearer ', '').trim();
        console.log('[AUTH_SESSION] Using Authorization header (no cookie token)');
      }
    }

    if (!accessToken) {
      // P0 FIX 2025-12-08: Add explicit P0 logging tag for Netlify log search
      console.error('[StageFlow][P0][AUTH_SESSION_FAILED]', {
        reason: 'NO_TOKEN',
        hasCookieToken,
        hasAuthHeader,
        cookieHeaderLength: cookieHeader.length,
        origin,
        timestamp: new Date().toISOString()
      });
      // PHASE 5: Track failed validation (no token)
      trackSessionValidation(correlationId, false, 'NO_SESSION', Date.now() - startTime, {
        hasCookie: String(hasCookieToken),
        hasAuthHeader: String(hasAuthHeader),
      });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Your session has expired or is invalid. Please sign in again.',
          code: 'SESSION_INVALID',
          message: 'Your session has expired or is invalid.'
        })
      };
    }

    debugLog('Found access token, refresh token:', !!refreshToken);

    // Create Supabase client
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

    // Track final session data for response
    let finalSession: any = null;
    let finalUser: any = null;
    let newCookies: string[] | null = null;

    // STRATEGY: Try multiple approaches to validate the session
    // This handles the token rotation race condition gracefully

    // APPROACH 1: Try setSession if we have both tokens
    if (refreshToken) {
      debugLog('Attempting setSession with both tokens');
      const { data: sessionResult, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (!sessionError && sessionResult?.session) {
        debugLog('setSession succeeded');
        finalSession = sessionResult.session;
        finalUser = sessionResult.user;
      } else {
        // CRITICAL FIX: setSession failed - this happens during token rotation race
        // Don't return 401 immediately - try getUser() and inline refresh
        debugLog('setSession failed:', sessionError?.message, '- trying fallback approaches');
      }
    }

    // APPROACH 2: If setSession failed or no refresh token, try getUser() directly
    // CRITICAL FIX: Pass token EXPLICITLY - global headers may have stale token after rotation
    if (!finalUser) {
      debugLog('Trying getUser() with explicit token');
      const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

      if (!userError && userData?.user) {
        debugLog('getUser() succeeded');
        finalUser = userData.user;
        // Build minimal session from access token
        finalSession = {
          access_token: accessToken,
          refresh_token: refreshToken || null,
          expires_at: null,
          expires_in: null
        };
      } else {
        debugLog('getUser() failed:', userError?.message);

        // APPROACH 3: Last resort - try refreshSession if we have refresh token
        if (refreshToken) {
          debugLog('Attempting inline refreshSession');
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
            refresh_token: refreshToken
          });

          if (!refreshError && refreshData?.session && refreshData?.user) {
            debugLog('Inline refresh succeeded');
            finalSession = refreshData.session;
            finalUser = refreshData.user;
            // Set new cookies so frontend gets fresh tokens
            // P0 FIX 2025-12-08: Pass origin for domain-aware cookie setting
            newCookies = setSessionCookies(
              refreshData.session.access_token,
              refreshData.session.refresh_token,
              { origin }
            );
          } else {
            debugLog('Inline refresh failed:', refreshError?.message);
          }
        }
      }
    }

    // All approaches failed - session is truly invalid
    if (!finalUser) {
      // P0 FIX 2025-12-08: Add explicit P0 logging tag for Netlify log search
      const hadRefreshToken = !!refreshToken;
      const errorCode = hadRefreshToken ? 'SESSION_ROTATED' : 'SESSION_INVALID';

      console.error('[StageFlow][P0][AUTH_SESSION_FAILED]', {
        reason: 'ALL_VALIDATION_FAILED',
        errorCode,
        hadRefreshToken,
        origin,
        timestamp: new Date().toISOString()
      });

      // PHASE 5: Track failed validation
      trackSessionValidation(correlationId, false, errorCode, Date.now() - startTime, {
        hadRefreshToken: String(hadRefreshToken),
      });

      // Track session rotation specifically
      if (hadRefreshToken) {
        trackSessionRotation(correlationId, { reason: 'refresh_token_invalid' });
      }

      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Your session has expired or is invalid. Please sign in again.',
          code: 'SESSION_INVALID',
          message: 'Your session has expired or is invalid.',
          // Signal frontend: if SESSION_ROTATED, try calling auth-refresh first then retry
          retryable: hadRefreshToken,
          retryHint: hadRefreshToken ? 'CALL_AUTH_REFRESH_FIRST' : null
        })
      };
    }

    // SUCCESS: We have a valid user
    // Now fetch organization and role for AI provider validation
    let organization: any = null;
    let role: string | null = null;
    let orgStatus: 'found' | 'not_found' | 'query_error' = 'not_found';

    try {
      const { data: membership, error: membershipError } = await supabase
        .from('team_members')
        .select('organization_id, role, organizations(id, name, plan)')
        .eq('user_id', finalUser.id)
        .single();

      if (!membershipError && membership) {
        organization = membership.organizations;
        role = membership.role;
        orgStatus = 'found';
        debugLog('Fetched organization:', organization?.id, 'role:', role);
      } else if (membershipError?.code === 'PGRST116') {
        // PGRST116 = "no rows returned" - user has no org membership (new signup)
        orgStatus = 'not_found';
        debugLog('No organization membership found (ORG_NOT_FOUND)');
      } else {
        // Actual query error
        orgStatus = 'query_error';
        debugLog('Organization query error:', membershipError?.message);
      }
    } catch (orgError) {
      // Exception during query - non-fatal but logged
      orgStatus = 'query_error';
      debugLog('Organization fetch exception (non-fatal):', orgError);
    }

    // Build response session
    const responseSession = finalSession
      ? {
          access_token: finalSession.access_token,
          refresh_token: finalSession.refresh_token || null,
          expires_at: finalSession.expires_at || null,
          expires_in: finalSession.expires_in || null
        }
      : null;

    // Build response
    // P0 FIX 2025-12-08: Added valid:true and organization_id for frontend compatibility
    // Frontend expects { valid: true, user, session, organization_id }
    const responseBody = {
      valid: true, // P0 FIX: Explicit success flag for frontend
      user: finalUser,
      session: responseSession,
      organization: organization,
      organization_id: organization?.id || null, // P0 FIX: Top-level org ID for easier access
      role: role,
      orgStatus: orgStatus // 'found' | 'not_found' | 'query_error'
    };

    // PHASE 5: Track successful validation
    trackSessionValidation(correlationId, true, 'SUCCESS', Date.now() - startTime, {
      hadInlineRefresh: String(!!newCookies),
      orgStatus,
    });

    // Return with optional new cookies (if we did inline refresh)
    if (newCookies) {
      // PHASE 5: Track inline refresh success
      trackSessionRefresh(correlationId, true, 'INLINE_REFRESH', Date.now() - startTime);
      return {
        statusCode: 200,
        headers: corsHeaders,
        multiValueHeaders: { 'Set-Cookie': newCookies },
        body: JSON.stringify(responseBody)
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody)
    };

  } catch (error: any) {
    console.error('[auth-session] Unexpected error:', error);
    // PHASE 5: Track unexpected error
    trackSessionValidation(correlationId, false, 'INTERNAL_ERROR', Date.now() - startTime);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR'
      })
    };
  }
};
