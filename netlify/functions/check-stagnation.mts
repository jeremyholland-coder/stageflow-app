import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { shouldUseNewAuth } from "./lib/feature-flags";
import { requireAuth, createAuthErrorResponse } from "./lib/auth-middleware";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';

// Default stagnation thresholds (in days) per stage
const STAGNATION_THRESHOLDS = {
  lead: 7,
  quote: 5,
  approval: 7,
  invoice: 3,
  onboarding: 14,
  delivery: 30,
  retention: 90
};

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth("check-stagnation")) {
    try {
      const authHeader = (event as any).headers?.authorization || (event as any).headers?.Authorization;
      if (authHeader) {
        const request = new Request("https://dummy.com", {
          method: "POST",
          headers: { "Authorization": authHeader }
        });
        await requireAuth(request);
      }
      // No auth header = scheduled execution (allowed)
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (allows both manual and scheduled execution)

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all active deals
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('*, users:user_id(email)')
      .eq('status', 'active');

    if (dealsError) throw dealsError;
    if (!deals || deals.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No active deals' })
      };
    }

    const stagnantDeals = [];
    const now = new Date();

    for (const deal of deals) {
      const lastActivity = new Date(deal.last_activity);
      const daysSinceActivity = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      const threshold = STAGNATION_THRESHOLDS[deal.stage as keyof typeof STAGNATION_THRESHOLDS] || 7;

      if (daysSinceActivity >= threshold) {
        stagnantDeals.push({
          ...deal,
          daysSinceActivity,
          threshold
        });
      }
    }


    // Group by user and send alerts
    const userDeals = stagnantDeals.reduce((acc: any, deal: any) => {
      const userId = deal.user_id;
      if (!acc[userId]) {
        acc[userId] = {
          email: deal.users?.email,
          deals: []
        };
      }
      acc[userId].deals.push(deal);
      return acc;
    }, {});

    // Send alerts
    let sentCount = 0;
    for (const [userId, userData] of Object.entries(userDeals as any)) {
      const typedUserData = userData as any;
      // Check if user wants stagnation notifications
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!prefs?.all_notifications || !prefs?.notify_stage_changed) {
        continue;
      }

      // Send email
      const emailContent = generateStagnationEmail(typedUserData.deals);

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: typedUserData.email,
          subject: emailContent.subject,
          html: emailContent.html
        })
      });

      if (response.ok) {
        sentCount++;
      } else {
        console.error(`Failed to send to ${typedUserData.email}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Stagnation check complete',
        stagnantDeals: stagnantDeals.length,
        alertsSent: sentCount
      })
    };

  } catch (error: any) {
    console.error('Error checking stagnation:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to check stagnation',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

function generateStagnationEmail(deals: any[]) {
  const baseStyles = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1A1A1A;
    line-height: 1.6;
  `;

  const dealsList = deals.map((deal: any) => `
    <tr style="border-bottom: 1px solid #E0E0E0;">
      <td style="padding: 16px;">
        <strong style="color: #1A1A1A;">${deal.client}</strong><br>
        <span style="color: #6B7280; font-size: 14px;">Stage: ${deal.stage}</span>
      </td>
      <td style="padding: 16px; text-align: right;">
        <span style="color: #F39C12; font-weight: 600;">${deal.daysSinceActivity} days</span><br>
        <span style="color: #6B7280; font-size: 14px;">(threshold: ${deal.threshold} days)</span>
      </td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #F9FAFB;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; padding: 40px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <tr>
                <td style="background: linear-gradient(135deg, #F39C12 0%, #E74C3C 100%); padding: 40px; text-align: center;">
                  <svg width="60" height="60" viewBox="0 0 200 200" style="margin-bottom: 12px;">
                    <defs>
                      <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#F39C12;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#E74C3C;stop-opacity:1" />
                      </linearGradient>
                    </defs>
                    <path d="M100,20 Q140,20 160,50 L180,100 Q180,140 150,160 L100,180 L50,160 Q20,140 20,100 L40,50 Q60,20 100,20 Z" 
                          fill="url(#logoGradient)" opacity="0.2"/>
                    <path d="M100,40 L140,80 L120,100 L140,120 L100,160 L60,120 L80,100 L60,80 Z" 
                          fill="white"/>
                  </svg>
                  <h1 style="margin: 0; color: white; font-size: 28px; ${baseStyles} font-weight: 600;">
                    Stagnant Deals Alert
                  </h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; ${baseStyles}">
                    StageFlow
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px;">
                  <h2 style="margin: 0 0 16px 0; font-size: 24px; ${baseStyles}">
                    ${deals.length} Deal${deals.length > 1 ? 's' : ''} Need Attention
                  </h2>
                  <p style="margin: 0 0 24px 0; font-size: 16px; ${baseStyles}">
                    These deals haven't been updated recently and may need your attention:
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #E0E0E0; border-radius: 8px; overflow: hidden;">
                    ${dealsList}
                  </table>
                  <div style="margin-top: 24px; padding: 16px; background-color: #FEF3C7; border-radius: 8px; border-left: 4px solid #F39C12;">
                    <p style="margin: 0; font-size: 14px; color: #92400E; ${baseStyles}">
                      <strong>Tip:</strong> Regular updates keep your pipeline healthy. Consider reaching out to these clients or moving deals forward.
                    </p>
                  </div>
                  <a href="https://stageflow.startupstage.com" style="
                    display: inline-block;
                    padding: 12px 24px;
                    background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                    margin-top: 24px;
                  ">
                    Review Deals
                  </a>
                </td>
              </tr>
              <tr>
                <td style="background-color: #F9FAFB; padding: 24px; text-align: center; border-top: 1px solid #E0E0E0;">
                  <p style="margin: 0; font-size: 14px; color: #6B7280; ${baseStyles}">
                    Stagnation alerts help keep your pipeline healthy
                  </p>
                  <p style="margin: 8px 0 0 0; font-size: 12px; color: #9CA3AF; ${baseStyles}">
                    Manage notification preferences in Settings
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

  return {
    subject: `${deals.length} Stagnant Deal${deals.length > 1 ? 's' : ''} Need Attention`,
    html
  };
}

export { handler };
