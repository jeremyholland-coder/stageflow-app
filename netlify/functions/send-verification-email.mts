import type { Handler } from "@netlify/functions";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Email service not configured' })
    };
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 8: Add authentication to email sending function
  if (shouldUseNewAuth('send-verification-email')) {
    try {
      // NEW AUTH PATH: Require authentication for email operations
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
  // LEGACY AUTH PATH: No authentication (allows email spam/abuse)

  try {
    const { email, confirmationUrl, type = 'signup' } = JSON.parse(event.body || '{}');

    if (!email || !confirmationUrl) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: email, confirmationUrl' })
      };
    }

    // SECURITY FIX: Validate confirmationUrl to prevent phishing attacks
    // Only allow URLs from our domain or Supabase auth domain
    const allowedDomains = [
      'stageflow.startupstage.com',
      'stageflow-crm.netlify.app',
      'localhost',
      process.env.SUPABASE_URL?.replace('https://', '')?.split('/')[0], // Extract Supabase domain
    ].filter(Boolean);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(confirmationUrl);
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid confirmationUrl format' })
      };
    }

    const hostname = parsedUrl.hostname;
    const isAllowed = allowedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      console.error(`Blocked suspicious confirmationUrl: ${hostname}`);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid confirmationUrl domain',
          details: 'Confirmation URL must be from an authorized domain'
        })
      };
    }

    const emailContent = generateVerificationEmail(type, confirmationUrl);

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

    if (!response.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Verification email sent',
        emailId: result.id 
      })
    };

  } catch (error: any) {
    console.error('Error sending verification email:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to send verification email',
        details: error instanceof Error ? error.message : 'Unknown error'
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
    : 'Thanks for signing up! Click the button below to verify your email and get started.';
  
  const buttonText = isPasswordReset ? 'Reset Password' : 'Verify Email';

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
