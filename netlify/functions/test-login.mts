/**
 * Test-Only Login Endpoint for E2E Testing
 *
 * PURPOSE:
 * Enables Playwright E2E tests to authenticate without real Gmail or email verification.
 * Creates test users with confirmed emails and sets up their organizations automatically.
 *
 * SECURITY:
 * - Only works when NODE_ENV === "development" or TEST_MODE env var is set
 * - Returns 403 Forbidden in production
 * - Should NEVER be deployed to production
 *
 * USAGE:
 * POST /.netlify/functions/test-login
 * Body: { email: "test-onboarding-e2e+1@example.com" }
 * Response: Sets HttpOnly cookies + returns user data
 *
 * E2E Test Helper Example:
 * ```typescript
 * async function loginAsTestUser(page, email) {
 *   const response = await page.context().request.post(
 *     '/.netlify/functions/test-login',
 *     { data: { email } }
 *   );
 *   const data = await response.json();
 *   return data.user;
 * }
 * ```
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { setSessionCookies } from './lib/cookie-auth';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // SECURITY CHECK: Only allow in development/test mode
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.TEST_MODE === 'true';

  if (!isDevelopment) {
    console.error('❌ [TEST-LOGIN] Blocked: test-login is only available in development mode');
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'This endpoint is only available in development mode',
        code: 'FORBIDDEN'
      })
    };
  }

  // Only allow POST requests
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
    const { email } = body;

    // Validate required fields
    if (!email) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing required field: email',
          code: 'MISSING_EMAIL'
        })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid email format',
          code: 'INVALID_EMAIL'
        })
      };
    }

    // Get Supabase configuration
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ [TEST-LOGIN] Missing Supabase configuration');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Server configuration error',
          code: 'CONFIG_ERROR'
        })
      };
    }

    // Create Supabase admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('[TEST-LOGIN] Creating/updating test user:', email);

    // Check if user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('❌ [TEST-LOGIN] Failed to list users:', listError);
    }

    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let user;
    let session;

    if (existingUser) {
      console.log('[TEST-LOGIN] User exists, updating email_confirmed_at:', existingUser.id);

      // Update existing user to ensure email is confirmed
      const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
        existingUser.id,
        {
          email_confirm: true,
          user_metadata: {
            ...existingUser.user_metadata,
            test_user: true
          }
        }
      );

      if (updateError) {
        console.error('❌ [TEST-LOGIN] Failed to update user:', updateError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Failed to update test user',
            code: 'UPDATE_ERROR',
            details: updateError.message
          })
        };
      }

      user = updateData.user;

      // Create session for existing user
      console.log('[TEST-LOGIN] Creating session for existing user');
      const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
        user_id: existingUser.id
      });

      if (sessionError) {
        console.error('❌ [TEST-LOGIN] Failed to create session:', sessionError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Failed to create session',
            code: 'SESSION_ERROR',
            details: sessionError.message
          })
        };
      }

      session = sessionData.session;

    } else {
      console.log('[TEST-LOGIN] Creating new test user with confirmed email');

      // Create new user with confirmed email
      const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: 'TestPassword123!', // Default test password
        email_confirm: true, // Email is already confirmed
        user_metadata: {
          test_user: true
        }
      });

      if (createError) {
        console.error('❌ [TEST-LOGIN] Failed to create user:', createError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Failed to create test user',
            code: 'CREATE_ERROR',
            details: createError.message
          })
        };
      }

      user = createData.user;

      // Create session for new user
      console.log('[TEST-LOGIN] Creating session for new user');
      const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession({
        user_id: user.id
      });

      if (sessionError) {
        console.error('❌ [TEST-LOGIN] Failed to create session:', sessionError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Failed to create session',
            code: 'SESSION_ERROR',
            details: sessionError.message
          })
        };
      }

      session = sessionData.session;

      // Set up organization for new user
      console.log('[TEST-LOGIN] Setting up organization for test user');
      const { error: orgError } = await supabase.rpc('setup_organization_atomic', {
        p_user_id: user.id,
        p_email: email
      });

      if (orgError) {
        console.error('❌ [TEST-LOGIN] Failed to setup organization:', orgError);
        // Don't fail the login if org setup fails - tests can still proceed
        console.warn('[TEST-LOGIN] Continuing without organization setup');
      } else {
        console.log('[TEST-LOGIN] Organization setup completed');
      }
    }

    if (!session) {
      console.error('❌ [TEST-LOGIN] No session created');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Failed to create session',
          code: 'NO_SESSION'
        })
      };
    }

    // Create secure session cookies (same as real login)
    const cookies = setSessionCookies(
      session.access_token,
      session.refresh_token
    );

    console.log('[TEST-LOGIN] Test login successful:', {
      userId: user.id,
      email: user.email,
      sessionExpiresAt: session.expires_at
    });

    // Return success response with cookies
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookies.join(', ')
      },
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata,
          created_at: user.created_at
        },
        session: {
          expires_at: session.expires_at,
          expires_in: session.expires_in
        },
        message: 'Test login successful. Session stored in secure cookies.',
        warning: 'This is a test-only endpoint. Do not use in production.'
      })
    };

  } catch (error: any) {
    console.error('💥 [TEST-LOGIN] Exception:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        code: 'EXCEPTION',
        details: error.message
      })
    };
  }
};
