/**
 * Cookie-Based Authentication Logout Endpoint
 *
 * PURPOSE:
 * Clears secure session cookies and invalidates server-side session.
 *
 * USAGE:
 * POST /.netlify/functions/auth-logout
 * Response: Clears HttpOnly cookies
 *
 * SECURITY UPDATES (2025-11-19):
 * - Invalidates token cache immediately (fixes 30s post-logout access window)
 * - Improved error handling and logging
 * - Always clears cookies even if server logout fails
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { clearSessionCookies, parseCookies, COOKIE_NAMES } from './lib/cookie-auth';
import { createErrorResponse } from './lib/error-sanitizer';
import { invalidateTokenCache } from './lib/auth-middleware';
import { logSecurityEvent, createSecurityEvent } from './lib/security-events';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Extract access token early for cache invalidation
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const authHeader = event.headers.authorization || event.headers.Authorization;

  let accessToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  } else if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN] || null;
  }

  let serverLogoutSuccess = false;

  try {
    // SECURITY FIX 1: Invalidate token cache BEFORE Supabase logout
    // This ensures immediate token invalidity (fixes 30s window vulnerability)
    if (accessToken) {
      invalidateTokenCache(accessToken);
      console.log('[Security] Token cache invalidated for logout');
    }

    // Get Supabase configuration
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    // SECURITY FIX 2: Attempt Supabase logout (best effort)
    if (supabaseUrl && supabaseAnonKey && accessToken) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        await supabase.auth.admin.signOut(accessToken);
        serverLogoutSuccess = true;

        console.log('[Security] Logout successful:', {
          ip: event.headers['x-forwarded-for'] || 'unknown',
          userAgent: event.headers['user-agent'] || 'unknown',
          timestamp: new Date().toISOString()
        });

        // Log logout event for audit trail
        logSecurityEvent(
          createSecurityEvent('LOGOUT', event, {
            metadata: {
              serverLogoutSuccess: true,
              timestamp: new Date().toISOString()
            }
          })
        );
      } catch (logoutError: any) {
        console.error('[Security] Supabase logout failed but continuing:', logoutError.message);
        // Continue to clear cookies even if Supabase logout fails
      }
    }

    // SECURITY FIX 3: Always clear session cookies
    const cookies = clearSessionCookies();

    // Return appropriate success response
    // FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        message: serverLogoutSuccess
          ? 'Logged out successfully'
          : 'Logged out from this device',
        ...((!serverLogoutSuccess && {
          warning: 'Session cleanup on server may have failed. Tokens are still invalidated.'
        }))
      })
    };

  } catch (error: any) {
    console.error('💥 Logout exception:', error);

    // SECURITY FIX 4: Even on complete failure, clear cookies and cache
    if (accessToken) {
      try {
        invalidateTokenCache(accessToken);
      } catch (cacheError) {
        console.error('[Security] Cache invalidation failed:', cacheError);
      }
    }

    const cookies = clearSessionCookies();

    // FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    return {
      statusCode: 200, // Return 200 to prevent UI errors
      headers: {
        'Content-Type': 'application/json'
      },
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        message: 'Logged out from this device',
        warning: 'Server-side cleanup may have failed'
      })
    };
  }
};
