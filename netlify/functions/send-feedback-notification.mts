import type { Handler } from "@netlify/functions";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// CRITICAL FIX v1.7.63: Email should go to support@ not personal email
const ADMIN_EMAIL = 'support@startupstage.com';
const FROM_EMAIL = 'StageFlow Feedback <support@startupstage.com>';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Email service not configured' })
    };
  }

  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 8: Add authentication to feedback notification function
  if (shouldUseNewAuth('send-feedback-notification')) {
    try {
      // NEW AUTH PATH: Require authentication to prevent spam/abuse
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
  // LEGACY AUTH PATH: No authentication (allows spam/abuse of feedback system)

  try {
    // CRITICAL FIX: Wrap JSON parsing in try-catch with proper validation
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { userEmail, rating, category, message, pageUrl } = body;

    // CRITICAL FIX: Validate required fields
    if (!userEmail && !rating && !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'At least one of userEmail, rating, or message is required' })
      };
    }

    // Build email content
    const ratingStars = rating ? '⭐'.repeat(rating) : 'No rating';
    const categoryEmoji = {
      'bug': '🐛 Bug Report',
      'feature': '💡 Feature Request',
      'love': '❤️ Love it!',
      'confused': '🤔 Confused',
      'other': '💬 Other'
    }[category] || '💬 Feedback';

    const html = `
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
              <h1 style="margin: 0;">🔔 New Feedback Received!</h1>
              <p style="margin: 10px 0 0; opacity: 0.9;">StageFlow User Feedback System</p>
            </div>
            <div class="content">
              <div class="rating">
                <strong>Rating:</strong> ${ratingStars}
              </div>

              <div class="category">${categoryEmoji}</div>

              ${message ? `
                <div class="message">
                  <strong>Message:</strong><br>
                  ${String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\n/g, '<br>')}
                </div>
              ` : ''}

              <div class="meta">
                <strong>User:</strong> ${userEmail}<br>
                <strong>Page:</strong> ${pageUrl}<br>
                <strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    // CRITICAL FIX: Send email via Resend with timeout protection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal, // CRITICAL FIX: Add abort signal
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `Feedback Widget Response: ${categoryEmoji} from ${userEmail}`,
        html
      })
    });

    clearTimeout(timeoutId); // CRITICAL FIX: Clear timeout on success

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }


    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, emailId: result.id })
    };

  } catch (error) {
    console.error('Error sending feedback notification:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to send notification',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

export { handler };
