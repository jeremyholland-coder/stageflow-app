import type { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { setSessionCookies } from "./lib/cookie-auth";
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { getCorsOrigin, ALLOWED_ORIGINS } from './lib/cors';

/**
 * Password Reset with Auto-Login
 *
 * CRITICAL FIX: Use ANON client (not service role) for user authentication operations
 *
 * Flow:
 * 1. Validate recovery token from password reset email
 * 2. Update user's password using authenticated session
 * 3. Get new session tokens after password update
 * 4. Set HttpOnly cookies for automatic login
 * 5. Return success with user data
 *
 * Security:
 * - Uses anon client with user's recovery token (not admin service role)
 * - Validates token before accepting password update
 * - Sets secure HttpOnly cookies (XSS protection)
 * - Logs all operations for audit trail
 *
 * CRITICAL FIX (2025-12-01): Added CORS headers to ensure Set-Cookie works with credentials: 'include'
 * Without these headers, browsers ignore Set-Cookie from fetch responses with credentials mode
 */

// ENGINE REBUILD Phase 9: Use centralized CORS spine
const getCorsHeaders = (event: HandlerEvent) => {
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = getCorsOrigin(requestOrigin);

  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
};

export const handler: Handler = async (event) => {
  // Get CORS headers for this request
  const corsHeaders = getCorsHeaders(event);

  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { accessToken, refreshToken, newPassword } = JSON.parse(event.body || "{}");

    // CRITICAL FIX v1.7.96: Require ALL three parameters
    // Without valid refreshToken, session cannot be established and password update fails silently
    if (!accessToken || !refreshToken || !newPassword) {
      console.error('[Password Reset] ❌ Missing required fields:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasNewPassword: !!newPassword,
        accessTokenLength: accessToken?.length || 0,
        refreshTokenLength: refreshToken?.length || 0
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: !refreshToken
            ? "Session expired. Please request a new password reset link."
            : "Missing required fields for password reset.",
        }),
      };
    }

    console.warn('[Password Reset] 🔑 Starting password reset:', {
      accessTokenLength: accessToken.length,
      refreshTokenLength: refreshToken.length,
      hasNewPassword: !!newPassword
    });

    // Get Supabase configuration
    // CRITICAL FIX 2025-12-03: Backend MUST prefer SUPABASE_* vars over VITE_* vars
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[AUTH_RESET_PASSWORD] CRITICAL: Missing Supabase configuration');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Password reset unavailable. Please try again later." }),
      };
    }

    // CRITICAL FIX: Use ANON client, not service role
    // Service role doesn't return sessions after updateUser()
    // Anon client with recovery token is the correct approach for user auth operations
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Validate the recovery token by getting the user
    // This ensures the token is valid before we attempt password update
    const { data: { user: validatedUser }, error: validationError } = await supabase.auth.getUser(accessToken);

    if (validationError || !validatedUser) {
      console.error('[Password Reset] Token validation failed:', {
        error: validationError?.message,
        hasUser: !!validatedUser
      });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Invalid or expired recovery token. Please request a new password reset link."
        }),
      };
    }

    console.warn('[Password Reset] Token validated for user:', validatedUser.id);

    // CRITICAL FIX v1.7.96: Create session using BOTH tokens
    // refreshToken is now REQUIRED (validated above) - no fallback to invalid token
    console.warn('[Password Reset] 📡 Establishing session with tokens...');
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken, // MUST be valid refresh token, not accessToken fallback
    });

    if (sessionError || !sessionData.session) {
      console.error('[Password Reset] ❌ Failed to create session:', {
        error: sessionError?.message,
        errorCode: sessionError?.status,
        hasSession: !!sessionData?.session,
        sessionData: sessionData
      });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Could not establish session. Your reset link may have expired. Please request a new one."
        }),
      };
    }

    console.warn('[Password Reset] ✅ Session established for user:', sessionData.user?.id);

    // Now update the password while authenticated with the recovery session
    // CRITICAL: After this, the recovery token is CONSUMED and cannot be used again
    console.warn('[Password Reset] 🔐 Updating password via updateUser()...');
    const { data: updateData, error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      console.error('[Password Reset] ❌ Password update FAILED:', {
        error: updateError.message,
        code: updateError.status,
        name: updateError.name,
        fullError: JSON.stringify(updateError)
      });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: updateError.message || "Failed to update password. Please try again."
        }),
      };
    }

    if (!updateData || !updateData.user) {
      console.error('[Password Reset] ❌ No user returned after password update - this should not happen');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Password update failed to return user data. Please try again."
        }),
      };
    }

    console.warn('[Password Reset] ✅ Password updated successfully:', {
      userId: updateData.user.id,
      email: updateData.user.email,
      updatedAt: updateData.user.updated_at
    });

    // CRITICAL FIX: Sign in with NEW password to get a fresh, valid session
    // The recovery token is now consumed and cannot be used for session management
    // We MUST sign in again with the new password to get proper access/refresh tokens
    const userEmail = validatedUser.email || updateData.user.email || '';
    console.warn('[Password Reset] 🔑 Signing in with new password to verify it was saved...');

    // CRITICAL FIX v1.7.97: Create a FRESH Supabase client for sign-in
    // The previous client's session state may be corrupted after updateUser()
    // Using a fresh client ensures clean authentication
    const freshSupabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: signInData, error: signInError } = await freshSupabase.auth.signInWithPassword({
      email: userEmail,
      password: newPassword,
    });

    if (signInError || !signInData.session) {
      console.error('[Password Reset] ⚠️ Sign-in with new password FAILED:', {
        error: signInError?.message,
        errorCode: signInError?.status,
        hasSession: !!signInData?.session,
        email: userEmail
      });

      // CRITICAL: If sign-in fails, the password may not have been saved correctly!
      // This is a serious bug - log it prominently
      console.error('[Password Reset] 🚨 PASSWORD MAY NOT HAVE BEEN SAVED CORRECTLY!');

      // Graceful degradation: tell user to try again
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          autoLogin: false,
          message: "Password reset completed. Please log in with your new password.",
          user: {
            id: updateData.user.id,
            email: updateData.user.email
          }
        }),
      };
    }

    console.warn('[Password Reset] ✅✅ Sign-in with new password SUCCEEDED - password is confirmed saved!');

    // Success! We have a fresh session with valid tokens
    // Set HttpOnly cookies for automatic login
    // P0 FIX 2025-12-08: Pass origin for domain-aware cookie setting
    const requestOrigin = event.headers?.origin || '';
    const cookies = setSessionCookies(
      signInData.session.access_token,
      signInData.session.refresh_token,
      { origin: requestOrigin }
    );

    console.warn('[Password Reset] ✅✅ Password reset complete - user signed in with fresh session:', {
      userId: signInData.user.id,
      email: signInData.user.email,
      hasAccessToken: !!signInData.session.access_token,
      hasRefreshToken: !!signInData.session.refresh_token,
      sessionExpiresAt: signInData.session.expires_at
    });

    // FIX v1.7.95: Use multiValueHeaders for multiple Set-Cookie
    // CRITICAL FIX (2025-12-01): Include CORS headers for Set-Cookie to work with credentials: 'include'
    return {
      statusCode: 200,
      headers: corsHeaders,
      multiValueHeaders: {
        'Set-Cookie': cookies
      },
      body: JSON.stringify({
        success: true,
        autoLogin: true,
        user: {
          id: signInData.user.id,
          email: signInData.user.email,
          email_confirmed_at: signInData.user.email_confirmed_at
        }
      }),
    };
  } catch (err: any) {
    console.error('[Password Reset] 💥 Unexpected exception:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: "An unexpected error occurred. Please try again or request a new password reset link.",
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      }),
    };
  }
};
