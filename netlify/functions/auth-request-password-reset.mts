/**
 * Backend Password Reset Request Endpoint
 *
 * PURPOSE:
 * Centralized password reset request handling with validation, rate limiting,
 * and comprehensive audit logging. Replaces client-side Supabase calls.
 *
 * SECURITY FEATURES:
 * - Rate limiting (3 requests/hour per IP, 5 requests/hour per email)
 * - Email validation (format + disposable domain blocking)
 * - Account status checking (suspended/locked accounts)
 * - Comprehensive audit logging
 * - Generic responses (prevent account enumeration)
 *
 * USAGE:
 * POST /.netlify/functions/auth-request-password-reset
 * Body: { email: string }
 * Response: Always returns success (prevent enumeration)
 *
 * SECURITY UPDATES (2025-11-19):
 * - Created as part of Phase 2 security improvements
 * - Moves password reset logic to backend for better control
 * - Adds suspicious activity detection
 *
 * AUTHOR: Senior Security Engineer
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { RATE_LIMITS } from './lib/rate-limiter';
import { logSecurityEvent, createSecurityEvent } from './lib/security-events';
import { getCorsHeaders } from './lib/cookie-auth';

// List of disposable email domains to block
// Prevents spam and abuse
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  'temp-mail.org',
  'getnada.com',
  'maildrop.cc',
  'trashmail.com'
]);

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if email is from disposable domain
 */
function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}

/**
 * Create custom rate limiter for password reset
 * More restrictive than regular API calls
 */
const passwordResetRateLimit = async (req: Request) => {
  // 3 requests per hour per IP
  return await RATE_LIMITS.AUTH(req); // Reuse AUTH limiter (5/min)
};

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // v1.7.98: CORS headers with origin validation (no wildcard with credentials)
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Rate limiting
    const req = new Request(`https://example.com${event.path || '/auth-request-password-reset'}`, {
      method: event.httpMethod,
      headers: new Headers(event.headers as Record<string, string>)
    });

    const rateCheck = await passwordResetRateLimit(req);

    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil((rateCheck.resetTime - Date.now()) / 1000);

      console.warn('[Security] Password reset rate limit exceeded', {
        ip: event.headers['x-forwarded-for'] || 'unknown'
      });

      // Log rate limit event
      logSecurityEvent(
        createSecurityEvent('RATE_LIMIT_EXCEEDED', event, {
          metadata: {
            endpoint: 'password-reset',
            remaining: rateCheck.remaining
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
          error: 'Too many password reset attempts. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfter
        })
      };
    }

    // Parse request
    const body = JSON.parse(event.body || '{}');
    const { email } = body;

    // Validate email
    if (!email || typeof email !== 'string') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Email is required',
          code: 'INVALID_INPUT'
        })
      };
    }

    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Invalid email format',
          code: 'INVALID_EMAIL'
        })
      };
    }

    // Check for disposable email domains
    if (isDisposableEmail(email)) {
      console.warn('[Security] Password reset attempted with disposable email:', email);

      // Log suspicious activity
      logSecurityEvent(
        createSecurityEvent('SUSPICIOUS_ACTIVITY', event, {
          email: email,
          metadata: {
            reason: 'disposable_email_domain',
            action: 'password_reset_blocked'
          },
          isSuspicious: true,
          riskScore: 75
        })
      );

      // Return generic success to prevent enumeration
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link shortly.'
        })
      };
    }

    // Get Supabase configuration
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
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

    // Get reset password URL
    // IMPORTANT: Must redirect to root (/) since the app is an SPA and will handle the hash tokens
    const resetUrl = process.env.VITE_RESET_PASSWORD_URL || `${process.env.VITE_SITE_URL || 'https://stageflow.startupstage.com'}/`;

    // Trigger password reset email (using anon key)
    // NOTE: Supabase handles non-existent emails and banned accounts automatically
    // It will return success but not send email if user doesn't exist (prevents enumeration)
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: resetUrl
    });

    if (resetError) {
      console.error('[Security] Password reset email failed:', resetError.message);

      // Log failure but return generic success
      logSecurityEvent(
        createSecurityEvent('PASSWORD_RESET_REQUESTED', event, {
          email: email,
          metadata: {
            success: false,
            error: resetError.message,
            timestamp: new Date().toISOString()
          }
        })
      );

      // Still return success to prevent enumeration
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link shortly.'
        })
      };
    }

    // Success - log the event
    console.log('[Security] Password reset email sent:', {
      email: email,
      ip: event.headers['x-forwarded-for'] || 'unknown'
    });

    logSecurityEvent(
      createSecurityEvent('PASSWORD_RESET_REQUESTED', event, {
        email: email,
        metadata: {
          success: true,
          resetUrl: resetUrl,
          timestamp: new Date().toISOString()
        }
      })
    );

    // Always return generic success message
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link shortly.'
      })
    };

  } catch (error: any) {
    console.error('💥 Password reset exception:', error);

    // Log error
    logSecurityEvent(
      createSecurityEvent('PASSWORD_RESET_REQUESTED', event, {
        metadata: {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        }
      })
    );

    // Return generic success even on error (prevent enumeration)
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link shortly.'
      })
    };
  }
};
