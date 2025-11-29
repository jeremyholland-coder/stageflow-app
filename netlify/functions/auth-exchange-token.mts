/**
 * Exchange URL Tokens for HttpOnly Cookies
 *
 * PURPOSE:
 * When users click magic links / password reset links, Supabase returns tokens in the URL hash.
 * This endpoint validates those tokens and converts them into secure HttpOnly cookies.
 *
 * SECURITY:
 * - Validates tokens with Supabase before setting cookies
 * - Sets HttpOnly, Secure, SameSite cookies
 * - Logs authentication events for audit trail
 *
 * USAGE:
 * POST /.netlify/functions/auth-exchange-token
 * Body: { access_token, refresh_token }
 * Response: Sets cookies + returns user data
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { setSessionCookies } from './lib/cookie-auth';
import { logSecurityEvent, createSecurityEvent } from './lib/security-events';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { access_token, refresh_token } = body;

    if (!access_token || !refresh_token) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing required tokens',
          code: 'MISSING_TOKENS'
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Server configuration error',
          code: 'CONFIG_ERROR'
        })
      };
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // SECURITY: Validate tokens with Supabase before setting cookies
    // This ensures the tokens are genuine and not tampered with
    const { data: { user }, error } = await supabase.auth.getUser(access_token);

    if (error || !user) {
      console.error('❌ Token validation failed:', error?.message);

      logSecurityEvent(
        createSecurityEvent('TOKEN_VALIDATION_FAILED', event, {
          metadata: {
            error: error?.message,
            timestamp: new Date().toISOString()
          }
        })
      );

      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid or expired tokens',
          code: 'INVALID_TOKENS'
        })
      };
    }

    // Tokens are valid - set HttpOnly cookies
    const cookies = setSessionCookies(access_token, refresh_token);

    // Log successful token exchange
    console.log('[Auth] Token exchange successful:', {
      userId: user.id,
      email: user.email,
      ip: event.headers['x-forwarded-for'] || 'unknown',
      timestamp: new Date().toISOString()
    });

    logSecurityEvent(
      createSecurityEvent('TOKEN_EXCHANGE_SUCCESS', event, {
        userId: user.id,
        email: user.email,
        metadata: {
          authMethod: 'magic_link_or_password_reset',
          timestamp: new Date().toISOString()
        }
      })
    );

    // Return success with user data AND session (needed for password reset)
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
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
          user_metadata: user.user_metadata,
          created_at: user.created_at,
          updated_at: user.updated_at
        },
        session: {
          access_token: access_token,
          refresh_token: refresh_token,
          user: user
        },
        message: 'Authentication successful. Session stored in secure cookies.'
      })
    };

  } catch (error: any) {
    console.error('💥 Token exchange exception:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Token exchange failed',
        code: 'EXCHANGE_ERROR'
      })
    };
  }
};
