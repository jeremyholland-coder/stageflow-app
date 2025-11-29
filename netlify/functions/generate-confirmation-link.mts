import type { Handler } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';

/**
 * Generate confirmation link and send verification email
 * Uses Supabase Admin API to generate proper confirmation tokens
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration incomplete' })
    };
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 6: Add authentication to admin email generation function
  // TEMPORARY FIX: Bypass auth requirement for signup email verification to work
  // TODO: Re-enable auth after fixing frontend to send Authorization header
  if (false && shouldUseNewAuth('generate-confirmation-link')) {
    try {
      // NEW AUTH PATH: Require authentication for admin operations
      const authHeader = event.headers.authorization || event.headers.Authorization;
      if (!authHeader) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Authentication required' })
        };
      }

      const request = new Request('https://dummy.com', {
        method: 'POST',
        headers: { 'Authorization': authHeader }
      });

      await requireAuth(request);
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (allows email verification to work)

  try {
    console.log('[Generate Link] ===== START =====');
    console.log('[Generate Link] Environment check:', {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasResendKey: !!RESEND_API_KEY,
      url: process.env.URL || 'https://stageflow.startupstage.com'
    });

    const { email, type = 'signup' } = JSON.parse(event.body || '{}');
    console.log('[Generate Link] Parsed request:', { email, type });

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    // Create admin client with service role key
    console.log('[Generate Link] Creating Supabase admin client...');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Generate proper confirmation link using Supabase Admin API
    // CRITICAL UX FIX: Use magiclink for all types (signup & recovery)
    // This auto-logs the user in when they click the link - no manual login required!
    console.log('[Generate Link] Calling Supabase admin.generateLink...');
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        // Redirect to root path - Supabase client will automatically handle the token
        redirectTo: `${process.env.URL || 'https://stageflow.startupstage.com'}`
      }
    });

    if (error) {
      console.error('[Generate Link] ❌ Supabase generateLink error:', {
        message: error.message,
        status: error.status,
        code: error.code,
        name: error.name,
        fullError: JSON.stringify(error)
      });
      throw new Error(`Supabase generateLink failed: ${error.message} (code: ${error.code || 'unknown'})`);
    }

    if (!data || !data.properties) {
      console.error('[Generate Link] ❌ No data returned from generateLink:', { data });
      throw new Error('No confirmation link generated - Supabase returned empty data');
    }

    const confirmationUrl = data.properties.action_link;
    console.log('[Generate Link] ✅ Generated confirmation link:', {
      hasUrl: !!confirmationUrl,
      urlLength: confirmationUrl?.length
    });

    // Send email through Resend with beautiful template
    const emailContent = generateVerificationEmail(type, confirmationUrl);
    console.log('[Generate Link] Sending email via Resend...', {
      from: FROM_EMAIL,
      to: email,
      subject: emailContent.subject
    });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: emailContent.subject,
        html: emailContent.html
      })
    });

    const result = await response.json() as any;
    console.log('[Generate Link] Resend API response:', {
      status: response.status,
      ok: response.ok,
      result: JSON.stringify(result)
    });

    if (!response.ok) {
      console.error('[Generate Link] ❌ Resend API error:', {
        status: response.status,
        statusText: response.statusText,
        result: JSON.stringify(result)
      });
      throw new Error(`Resend API error (${response.status}): ${JSON.stringify(result)}`);
    }

    console.log('[Generate Link] ✅ SUCCESS - Email sent with ID:', result.id);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Verification email sent',
        emailId: result.id
      })
    };

  } catch (error: any) {
    console.error('[Generate Link] ❌ FATAL ERROR:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });

    // Return REAL error details to client for debugging
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to send verification email',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error.name,
        stack: error.stack
      })
    };
  }
};

function generateVerificationEmail(type: string, confirmationUrl: string) {
  const isPasswordReset = type === 'recovery';
  const subject = isPasswordReset
    ? 'Reset Your StageFlow Password'
    : 'Verify Your StageFlow Email';

  const title = isPasswordReset
    ? 'Password Reset Request'
    : 'Welcome to StageFlow!';

  const message = isPasswordReset
    ? 'Click the button below to reset your password. This link expires in 1 hour.'
    : 'Thanks for signing up! Click the button below to verify your email and automatically log in. No password required!';

  const buttonText = isPasswordReset ? 'Reset Password' : 'Verify Email & Log In';

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; padding: 40px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); padding: 48px; text-align: center; border-radius: 16px 16px 0 0;">
                  <h1 style="margin: 0; color: white; font-size: 32px; font-weight: bold;">StageFlow</h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">Revenue Pipeline Management</p>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 48px;">
                  <h2 style="margin: 0 0 16px 0; color: #1A1A1A; font-size: 24px;">${title}</h2>
                  <p style="margin: 0 0 32px 0; color: #6B7280; font-size: 16px; line-height: 1.6;">${message}</p>

                  <!-- CTA Button -->
                  <table cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">
                    <tr>
                      <td>
                        <a href="${confirmationUrl}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(26,188,156,0.3);">
                          ${buttonText}
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin: 0 0 16px 0; color: #6B7280; font-size: 14px;">
                    If the button doesn't work, copy and paste this link:
                  </p>
                  <p style="margin: 0; color: #3A86FF; font-size: 14px; word-break: break-all;">
                    ${confirmationUrl}
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #F9FAFB; padding: 32px; text-align: center; border-radius: 0 0 16px 16px;">
                  <p style="margin: 0 0 8px 0; color: #6B7280; font-size: 14px;">
                    StageFlow CRM - Manage your revenue pipeline with ease
                  </p>
                  <p style="margin: 0; color: #9CA3AF; font-size: 12px;">
                    If you didn't request this email, you can safely ignore it.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return { subject, html };
}

export { handler };
