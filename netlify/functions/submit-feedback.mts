/**
 * Submit Feedback Endpoint
 *
 * PURPOSE:
 * Allow users to submit feedback with proper auth validation
 * Stores feedback in Supabase AND sends email notification
 *
 * AUTHENTICATION:
 * - Requires cookie-based authentication (HttpOnly session)
 *
 * USAGE:
 * POST /.netlify/functions/submit-feedback
 * {
 *   "rating": 5,
 *   "category": "love",
 *   "message": "Great app!",
 *   "pageUrl": "https://...",
 *   "userAgent": "..."
 * }
 *
 * RETURNS:
 * { success: true, emailSent: true/false }
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';

// Email configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL = 'support@startupstage.com';
const FROM_EMAIL = 'StageFlow Feedback <support@startupstage.com>';

// Category display mapping
const CATEGORY_LABELS: Record<string, string> = {
  'bug': 'Bug Report',
  'feature': 'Feature Request',
  'love': 'Love it!',
  'confused': 'Confused',
  'other': 'Other'
};

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
    // CRITICAL: Use HttpOnly cookie authentication (Phase 3)
    // Same pattern as create-checkout-session, api-keys-create, etc.
    const user = await requireAuth(new Request(
      `https://example.com${event.path}`,
      {
        method: event.httpMethod,
        headers: new Headers(event.headers as Record<string, string>)
      }
    ));

    console.log('[FEEDBACK] Authenticated user:', user.email);

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { rating, category, message, pageUrl, userAgent } = body;

    // Validate input
    if (!rating && !message?.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Must provide either rating or message',
          code: 'INVALID_INPUT'
        })
      };
    }

    // Initialize Supabase client with service role
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get user's organization (optional - feedback can be org-less)
    const { data: orgData } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // Insert feedback
    const { error: dbError } = await supabase
      .from('feedback')
      .insert({
        user_id: user.id,
        organization_id: orgData?.organization_id || null,
        user_email: user.email,
        rating: rating || null,
        category: category || 'other',
        message: message?.trim() || null,
        page_url: pageUrl || null,
        user_agent: userAgent || null,
      });

    if (dbError) {
      console.error('[FEEDBACK] Database error:', dbError);
      throw dbError;
    }

    console.log('[FEEDBACK] Feedback stored successfully for user:', user.email);

    // CRITICAL FIX: Send email notification in same function (atomic operation)
    // Previously this was a separate call from frontend that could fail silently
    let emailSent = false;

    if (RESEND_API_KEY) {
      try {
        const environment = process.env.NETLIFY_DEV ? 'development' : 'production';
        const ratingStars = rating ? '\u2B50'.repeat(rating) : 'No rating';
        const categoryLabel = CATEGORY_LABELS[category] || 'Feedback';

        const emailHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #2C3E50 0%, #1ABC9C 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .rating { font-size: 24px; margin: 20px 0; }
                .category { display: inline-block; background: #1ABC9C; color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; margin: 10px 0; }
                .message { background: white; padding: 20px; border-left: 4px solid #1ABC9C; border-radius: 4px; margin: 20px 0; }
                .meta { color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0;">New Feedback Received!</h1>
                  <p style="margin: 10px 0 0; opacity: 0.9;">StageFlow User Feedback System</p>
                </div>
                <div class="content">
                  <div class="rating">
                    <strong>Rating:</strong> ${ratingStars}
                  </div>

                  <div class="category">${categoryLabel}</div>

                  ${message ? `
                    <div class="message">
                      <strong>Message:</strong><br>
                      ${String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\n/g, '<br>')}
                    </div>
                  ` : '<p><em>No message provided</em></p>'}

                  <div class="meta">
                    <strong>User:</strong> ${user.email}<br>
                    <strong>User ID:</strong> ${user.id}<br>
                    <strong>Page:</strong> ${pageUrl || 'Not specified'}<br>
                    <strong>Environment:</strong> ${environment}<br>
                    <strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST
                  </div>
                </div>
              </div>
            </body>
          </html>
        `;

        const emailSubject = `[StageFlow Feedback] ${environment === 'development' ? '[DEV] ' : ''}${ratingStars} - ${categoryLabel}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: SUPPORT_EMAIL,
            subject: emailSubject,
            html: emailHtml
          })
        });

        clearTimeout(timeoutId);

        if (emailResponse.ok) {
          emailSent = true;
          console.log('[FEEDBACK] Email notification sent successfully to', SUPPORT_EMAIL);
        } else {
          const errorData = await emailResponse.json();
          console.error('[FEEDBACK] Email send failed:', errorData);
        }
      } catch (emailError) {
        // Email failure should NOT fail the entire feedback submission
        console.error('[FEEDBACK] Email notification error (non-blocking):', emailError);
      }
    } else {
      console.warn('[FEEDBACK] RESEND_API_KEY not configured - skipping email notification');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Feedback submitted successfully',
        emailSent
      })
    };

  } catch (error: any) {
    console.error('[FEEDBACK] Error submitting feedback:', error);

    // FIX v1.7.60: Return proper HTTP status codes for different error types
    // This allows frontend to distinguish auth failures from server errors
    if (error.name === 'UnauthorizedError' ||
        error.name === 'TokenExpiredError' ||
        error.name === 'InvalidTokenError') {
      return {
        statusCode: error.statusCode || 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message || 'Authentication required. Please log in again.',
          code: error.code || 'UNAUTHORIZED'
        })
      };
    }

    // Generic 500 error for actual server failures
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to submit feedback',
        details: error.message
      })
    };
  }
};
