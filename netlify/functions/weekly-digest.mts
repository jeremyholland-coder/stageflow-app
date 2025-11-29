import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { shouldUseNewAuth } from "./lib/feature-flags";
import { requireAuth, createAuthErrorResponse } from "./lib/auth-middleware";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';

/**
 * Weekly Digest Function with User Preference Support
 *
 * This function should be triggered hourly to check if any users
 * need their weekly digest sent based on their individual preferences.
 *
 * User preferences (from notification_preferences table):
 * - digest_day: Day of week (e.g., "monday", "friday")
 * - digest_time: Time in 24h format (e.g., "09:00", "19:00")
 * - timezone: Timezone string (e.g., "America/Los_Angeles", "America/New_York")
 */
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth("weekly-digest")) {
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

    const currentTime = new Date();
    console.log('[weekly-digest] Running at:', currentTime.toISOString());

    // Get all organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgsError) {
      console.error('[weekly-digest] Error fetching organizations:', orgsError);
      throw orgsError;
    }

    if (!orgs || orgs.length === 0) {
      console.log('[weekly-digest] No organizations found');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No organizations to process' })
      };
    }

    let digestsSent = 0;

    for (const org of orgs) {
      console.log(`[weekly-digest] Processing organization: ${org.name} (${org.id})`);

      // Get organization members who want weekly digest
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: members, error: membersError } = await supabase
        .from('team_members')
        .select('user_id, users:user_id(email)')
        .eq('organization_id', org.id);

      if (membersError || !members) {
        console.error(`[weekly-digest] Error fetching members for ${org.name}:`, membersError);
        continue;
      }

      for (const member of members as any[]) {
        // Check if user wants weekly digest AND get their preferences
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('weekly_digest, digest_day, digest_time, timezone')
          .eq('user_id', member.user_id)
          .eq('organization_id', org.id)
          .maybeSingle();

        if (!prefs?.weekly_digest) {
          console.log(`[weekly-digest] User ${member.users?.email} has weekly_digest disabled`);
          continue;
        }

        // Check if it's the right time for this user
        const userTimezone = prefs.timezone || 'America/Los_Angeles';
        const userPreferredDay = (prefs.digest_day || 'monday').toLowerCase();
        const userPreferredTime = prefs.digest_time || '09:00';
        const userPreferredHour = parseInt(userPreferredTime.split(':')[0]);

        // Get current day and hour in user's timezone
        const userLocalDay = currentTime.toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: userTimezone
        }).toLowerCase();

        const userLocalHourStr = currentTime.toLocaleString('en-US', {
          hour: '2-digit',
          hour12: false,
          timeZone: userTimezone
        });
        const userLocalHour = parseInt(userLocalHourStr.split(',')[1]?.trim().split(':')[0] || '0');

        console.log(`[weekly-digest] User ${member.users?.email}: wants ${userPreferredDay} at ${userPreferredTime} (${userTimezone}), current: ${userLocalDay} ${userLocalHour}:00`);

        // Check if day matches AND hour matches (within 1-hour window)
        const isDayMatch = userLocalDay === userPreferredDay;
        const isTimeMatch = userLocalHour >= userPreferredHour && userLocalHour < (userPreferredHour + 1);

        if (!isDayMatch || !isTimeMatch) {
          console.log(`[weekly-digest] Skipping ${member.users?.email}: day=${isDayMatch}, time=${isTimeMatch}`);
          continue;
        }

        console.log(`[weekly-digest] MATCH! Sending digest to ${member.users?.email}`);

        // Calculate analytics for the week
        const analytics = await calculateWeeklyAnalytics(supabase, org.id);

        // Send digest email
        const emailContent = generateDigestEmail(org.name, analytics);

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: member.users.email,
            subject: emailContent.subject,
            html: emailContent.html
          })
        });

        if (response.ok) {
          digestsSent++;
          console.log(`[weekly-digest] ✓ Successfully sent digest to ${member.users.email}`);
        } else {
          const errorData = await response.json();
          console.error(`[weekly-digest] ✗ Failed to send to ${member.users.email}:`, errorData);
        }
      }
    }

    const result = {
      message: 'Weekly digest processing complete',
      digestsSent,
      timestamp: currentTime.toISOString()
    };

    console.log('[weekly-digest] Result:', result);

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };

  } catch (error: any) {
    console.error('[weekly-digest] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process weekly digest',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function calculateWeeklyAnalytics(supabase: any, organizationId: string) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Get all deals for organization
  const { data: allDeals } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', organizationId);

  const deals = allDeals || [];

  // Calculate metrics for this week
  const activeDeals = deals.filter((d: any) => d.status === 'active');
  const totalPipeline = activeDeals.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  const avgProbability = 0.70; // 70% average probability
  const expectedRevenue = Math.round(totalPipeline * avgProbability);

  const dealsThisWeek = deals.filter((d: any) =>
    new Date(d.created) >= oneWeekAgo
  );

  const wonThisWeek = deals.filter((d: any) =>
    d.status === 'won' &&
    new Date(d.last_activity) >= oneWeekAgo
  );

  const lostThisWeek = deals.filter((d: any) =>
    d.status === 'lost' &&
    new Date(d.last_activity) >= oneWeekAgo
  );

  // Calculate previous week metrics for trends
  const dealsPreviousWeek = deals.filter((d: any) => {
    const created = new Date(d.created);
    return created >= twoWeeksAgo && created < oneWeekAgo;
  });

  const wonPreviousWeek = deals.filter((d: any) => {
    const updated = new Date(d.last_activity);
    return d.status === 'won' && updated >= twoWeeksAgo && updated < oneWeekAgo;
  });

  // Calculate trends
  const newDealsTrend = dealsThisWeek.length >= dealsPreviousWeek.length ? 'up' : 'down';
  const wonTrend = wonThisWeek.length >= wonPreviousWeek.length ? 'up' : 'down';

  const newDealsValue = dealsThisWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
  const expectedNewDealsRevenue = Math.round(newDealsValue * avgProbability);

  // Calculate run rate and projections
  const wonThisWeekValue = wonThisWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
  const monthlyProjection = wonThisWeekValue * 4; // 4 weeks per month
  const quarterlyProjection = wonThisWeekValue * 13; // 13 weeks per quarter

  // Find stagnant deals (>7 days in current stage)
  const stagnantDeals = deals.filter((d: any) => {
    if (d.status !== 'active') return false;
    const daysSince = Math.floor(
      (Date.now() - new Date(d.last_activity).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSince > 7;
  });

  // Top opportunities (active, high value)
  const topOpportunities = deals
    .filter((d: any) => d.status === 'active')
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 3);

  return {
    totalPipeline,
    expectedRevenue,
    avgProbability,
    dealsAddedCount: dealsThisWeek.length,
    dealsAddedValue: newDealsValue,
    expectedNewDealsRevenue,
    newDealsTrend,
    dealsWonCount: wonThisWeek.length,
    dealsWonValue: wonThisWeekValue,
    wonTrend,
    dealsLostCount: lostThisWeek.length,
    lostDeals: lostThisWeek.map((d: any) => ({
      client: d.client,
      value: d.value,
      reason: d.lost_reason || 'No reason provided'
    })),
    monthlyProjection,
    quarterlyProjection,
    stagnantDealsCount: stagnantDeals.length,
    stagnantDeals: stagnantDeals.slice(0, 5).map((d: any) => ({
      client: d.client,
      stage: d.stage,
      value: d.value,
      days: Math.floor((Date.now() - new Date(d.last_activity).getTime()) / (1000 * 60 * 60 * 24))
    })),
    topOpportunities: topOpportunities.map((d: any) => ({
      client: d.client,
      value: d.value,
      stage: d.stage,
      probability: d.probability || 70
    }))
  };
}

function generateDigestEmail(orgName: string, analytics: any) {
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);

  const getTrendArrow = (trend: string) => trend === 'up' ? '▲' : '▼';
  const getTrendColor = (trend: string) => trend === 'up' ? '#16A34A' : '#DC2626';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>StageFlow Weekly Report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #2C3E50 0%, #34495E 50%, #1ABC9C 100%); padding: 48px 40px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 36px; font-weight: 700; letter-spacing: -0.5px; }
        .header h2 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 500; }
        .badge { display: inline-block; padding: 4px 12px; background: rgba(255,255,255,0.2); color: white; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }
        .content { padding: 40px; }
        .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 24px 0; }
        .metric-box { text-align: center; padding: 20px; border-radius: 12px; border: 1px solid; }
        .metric-value { font-size: 32px; font-weight: bold; }
        .metric-label { color: #6B7280; font-size: 14px; margin-top: 4px; }
        .metric-sublabel { font-size: 12px; color: #6B7280; margin-top: 4px; }
        .trend { font-size: 12px; margin-top: 4px; }
        .section { margin: 32px 0; }
        .section h3 { font-size: 18px; margin: 0 0 16px 0; }
        .deal-card { background: #f9fafb; border-radius: 12px; padding: 16px; margin: 12px 0; border-left: 4px solid #1ABC9C; }
        .deal-name { font-weight: 600; color: #1a1a1a; }
        .deal-value { color: #1ABC9C; font-weight: 600; }
        .button { display: inline-block; background: linear-gradient(135deg, #2C3E50 0%, #34495E 50%, #1ABC9C 100%); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; margin: 16px 0; box-shadow: 0 2px 8px rgba(44, 62, 80, 0.25); }
        .footer { background: #f9fafb; padding: 32px 24px; text-align: center; color: #6b7280; font-size: 13px; border-top: 1px solid #E5E7EB; }
        .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="https://stageflow.startupstage.com/stageflow-logo.png" alt="StageFlow Logo" width="80" height="80" style="margin-bottom: 16px; display: block; margin-left: auto; margin-right: auto; image-rendering: -webkit-optimize-contrast; -webkit-font-smoothing: antialiased;">
          <h1 style="margin: 0 0 8px 0;">StageFlow</h1>
          <h2 style="margin: 0;">Weekly Revenue Pipeline Snapshot</h2>
          <div class="badge">WEEKLY REPORT</div>
          <p style="color: rgba(255,255,255,0.85); margin: 12px 0 0 0; font-size: 15px;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div class="content">
          <!-- DEALS CLOSED - Priority #1 -->
          <div class="section">
            <h3>Deals Closed This Week</h3>
            <div style="display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); padding: 20px; border-radius: 12px; border: 1px solid #BBF7D0; margin-bottom: 8px;">
              <div>
                <div style="font-size: 28px; font-weight: bold; color: #16A34A;">${analytics.dealsWonCount} Won</div>
                <div style="font-size: 20px; color: #16A34A; margin-top: 4px;">${formatCurrency(analytics.dealsWonValue)}</div>
              </div>
              <div class="trend" style="color: ${getTrendColor(analytics.wonTrend)}; font-size: 24px;">
                ${getTrendArrow(analytics.wonTrend)}
              </div>
            </div>
            ${analytics.dealsLostCount > 0 ? `
            <div style="background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%); padding: 16px; border-radius: 12px; border: 1px solid #FECACA;">
              <div style="font-size: 18px; font-weight: 600; color: #DC2626;">${analytics.dealsLostCount} Lost</div>
              ${analytics.lostDeals.map((d: any) => `
                <div style="margin-top: 8px; font-size: 13px; color: #991B1B;">
                  <strong>${d.client}</strong> - ${formatCurrency(d.value)}<br>
                  <em style="color: #B91C1C;">Reason: ${d.reason}</em>
                </div>
              `).join('')}
            </div>
            ` : ''}
          </div>

          <!-- CURRENT PIPELINE + PROBABILITY -->
          <div class="metric-grid">
            <div class="metric-box" style="background: linear-gradient(135deg, #EBF8FF 0%, #E0F2FE 100%); border-color: #BAE6FD;">
              <div class="metric-value" style="color: #0284C7;">${formatCurrency(analytics.totalPipeline)}</div>
              <div class="metric-label">Current Pipeline</div>
              <div class="metric-sublabel">→ ${formatCurrency(analytics.expectedRevenue)} (${Math.round(analytics.avgProbability * 100)}% avg probability)</div>
            </div>

            <!-- NEW DEALS + PROBABILITY -->
            <div class="metric-box" style="background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border-color: #BBF7D0;">
              <div class="metric-value" style="color: #16A34A;">${analytics.dealsAddedCount}</div>
              <div class="metric-label">New Deals Added</div>
              <div class="metric-sublabel">${formatCurrency(analytics.dealsAddedValue)} → ${formatCurrency(analytics.expectedNewDealsRevenue)}</div>
              <div class="trend" style="color: ${getTrendColor(analytics.newDealsTrend)};">
                ${getTrendArrow(analytics.newDealsTrend)} vs last week
              </div>
            </div>
          </div>

          <!-- PROJECTED PERFORMANCE -->
          <div class="section">
            <h3>Projected Performance (Run Rate)</h3>
            <div style="background: linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%); padding: 20px; border-radius: 12px; border: 1px solid #E9D5FF;">
              <div style="display: flex; justify-content: space-around; text-align: center;">
                <div>
                  <div style="font-size: 24px; font-weight: bold; color: #9333EA;">${formatCurrency(analytics.monthlyProjection)}</div>
                  <div style="font-size: 13px; color: #6B7280; margin-top: 4px;">Monthly Projection</div>
                  <div style="font-size: 11px; color: #9CA3AF;">(at current run rate)</div>
                </div>
                <div>
                  <div style="font-size: 24px; font-weight: bold; color: #7C3AED;">${formatCurrency(analytics.quarterlyProjection)}</div>
                  <div style="font-size: 13px; color: #6B7280; margin-top: 4px;">Quarterly Projection</div>
                  <div style="font-size: 11px; color: #9CA3AF;">(at current run rate)</div>
                </div>
              </div>
            </div>
          </div>

          ${analytics.stagnantDealsCount > 0 ? `
          <!-- STAGNANT DEALS -->
          <div class="alert">
            <h3 style="margin: 0 0 12px 0; color: #92400E; font-size: 16px;">⚠️ ${analytics.stagnantDealsCount} Deals Need Attention</h3>
            ${analytics.stagnantDeals.map((d: any) => `
              <div class="deal-card" style="background: white; margin: 8px 0;">
                <div style="display: flex; justify-content: space-between;">
                  <span class="deal-name">${d.client}</span>
                  <span class="deal-value">${formatCurrency(d.value)}</span>
                </div>
                <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">
                  ${d.stage} • Stagnant for ${d.days} days
                </div>
              </div>
            `).join('')}
          </div>
          ` : ''}

          ${analytics.topOpportunities.length > 0 ? `
          <!-- TOP OPPORTUNITIES -->
          <div class="section">
            <h3>Top Opportunities</h3>
            ${analytics.topOpportunities.map((d: any) => `
              <div class="deal-card">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div class="deal-name">${d.client}</div>
                    <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">${d.stage} • ${d.probability}% probability</div>
                  </div>
                  <div class="deal-value" style="font-size: 20px;">${formatCurrency(d.value)}</div>
                </div>
              </div>
            `).join('')}
          </div>
          ` : ''}

          <a href="https://stageflow.startupstage.com" class="button">View Full Dashboard</a>
        </div>
        <div class="footer">
          <p>StageFlow CRM - Manage your pipeline with ease</p>
          <p><a href="https://stageflow.startupstage.com?view=settings" style="color: #1ABC9C;">Manage notification preferences</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    subject: `Weekly Revenue Pipeline Snapshot - ${orgName}`,
    html
  };
}

// Export handler and config for hourly schedule
export { handler };

export const config = {
  schedule: "0 * * * *" // Run every hour at :00
};
