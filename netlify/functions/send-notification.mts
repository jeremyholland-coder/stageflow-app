import type { Handler } from "@netlify/functions";
import { NotificationPayloadSchema, validate } from "./lib/validation";
import { requireAuth, validateUserIdMatch, createAuthErrorResponse } from './lib/auth-middleware';
import { createClient } from '@supabase/supabase-js';
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { getCorsOrigin } from './lib/cors';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';

const handler: Handler = async (event) => {
  // ENGINE REBUILD Phase 9: Use centralized CORS spine
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = getCorsOrigin(requestOrigin);

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Email service not configured' })
    };
  }

  // Initialize Supabase client early for auth check
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const body = JSON.parse(event.body || '{}');

    // VALIDATE INPUT
    const validation = validate(NotificationPayloadSchema, body);
    if (!validation.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Validation failed',
          details: validation.error
        })
      };
    }

    const payload = validation.data;

    console.warn('[send-notification] Request for user:', payload.user_id, 'org:', payload.organization_id?.substring(0, 8));

    // PHASE 12 FIX: Query team_members directly instead of requireOrgAccess
    try {
      // Create Request object from event for auth middleware (includes cookies)
      const request = new Request('https://dummy.com', {
        method: 'POST',
        headers: new Headers(event.headers as Record<string, string>)
      });

      console.warn('[send-notification] Authenticating user...');
      const user = await requireAuth(request);
      await validateUserIdMatch(user, payload.user_id);
      console.warn('[send-notification] Auth succeeded, user:', user.id);

      // Verify membership directly
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', payload.organization_id)
        .maybeSingle();

      if (memberError || !membership) {
        console.error('[send-notification] User not in organization:', { userId: user.id, organizationId: payload.organization_id });
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Not authorized for this organization' })
        };
      }

      console.warn('[send-notification] Membership verified');
    } catch (authError: any) {
      console.error('[send-notification] Auth error:', authError.message);
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        headers,
        body: await errorResponse.text()
      };
    }

    // Get notification preferences - supabase already initialized above
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', payload.user_id)
      .eq('organization_id', payload.organization_id)
      .maybeSingle();

    if (!prefs?.all_notifications) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Notifications disabled by user' })
      };
    }

    const notifMap = {
      'deal_created': prefs.notify_deal_created,
      'stage_changed': prefs.notify_stage_changed,
      'deal_won': prefs.notify_deal_won,
      'deal_lost': prefs.notify_deal_lost
    };

    if (!notifMap[payload.type]) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'This notification type disabled by user' })
      };
    }

    const emailContent = generateEmailContent(payload);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: payload.user_email,
        subject: emailContent.subject,
        html: emailContent.html
      })
    });

    const result = await response.json() as any;

    if (!response.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(result)}`);
    }

    console.warn('[send-notification] Email sent successfully:', result.id);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Notification sent',
        emailId: result.id
      })
    };

  } catch (error: any) {
    console.error('[send-notification] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to send notification',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

function generateEmailContent(payload: any) {
  const { type, deal } = payload;
  const formattedValue = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(deal.value);

  let subject = '';
  let title = '';
  let message = '';

  switch (type) {
    case 'deal_created':
      subject = `New Deal: ${deal.client}`;
      title = 'New Deal Created';
      message = `<strong>${deal.client}</strong> has been added to your pipeline at <strong>${formattedValue}</strong> in the <strong>${deal.stage}</strong> stage.`;
      break;
    case 'stage_changed':
      subject = `Deal Moved: ${deal.client}`;
      title = 'Deal Stage Changed';
      message = `<strong>${deal.client}</strong> has moved from <strong>${deal.from_stage}</strong> to <strong>${deal.stage}</strong>.`;
      break;
    case 'deal_won':
      subject = `Deal Won: ${deal.client} - ${formattedValue}`;
      title = 'Deal Won!';
      message = `Congratulations! You've won <strong>${deal.client}</strong> worth <strong>${formattedValue}</strong>!`;
      break;
    case 'deal_lost':
      subject = `Deal Lost: ${deal.client}`;
      title = 'Deal Lost';
      message = `<strong>${deal.client}</strong> has been marked as lost.`;
      break;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #F9FAFB;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; padding: 40px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 16px;">
              <tr>
                <td style="background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); padding: 40px; text-align: center;">
                  <h1 style="margin: 0; color: white; font-size: 28px;">StageFlow</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px;">
                  <h2 style="margin: 0 0 16px 0;">${title}</h2>
                  <p style="margin: 0 0 24px 0;">${message}</p>
                  <a href="https://stageflow.startupstage.com" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); color: white; text-decoration: none; border-radius: 8px;">
                    View in StageFlow
                  </a>
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
