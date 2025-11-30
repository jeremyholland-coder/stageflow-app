import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { shouldUseNewAuth } from "./lib/feature-flags";
import { requireAuth, createAuthErrorResponse } from "./lib/auth-middleware";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow Support <jeremy@startupstage.com>';
const TEST_EMAIL = 'jeremy.holland@icloud.com';
const TEST_USER_ID = 'e56cf47e-5600-4bb5-a702-5f8b92075570';
const TEST_ORG_ID = 'ac39e9c2-19d0-411f-a75d-4475e5b75391';
const STALE_DAYS_THRESHOLD = 14;

/**
 * Test function to send weekly digest immediately
 * This bypasses day/time checks and sends to jeremy.holland@icloud.com
 *
 * Query params:
 * - template: 'admin' | 'user' (default: 'admin')
 * - firstName: custom first name for testing (default: 'Jeremy')
 */
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // SECURITY: Feature-flagged authentication migration
  if (shouldUseNewAuth("send-test-weekly-digest")) {
    try {
      const authHeader = (event as any).headers?.authorization || (event as any).headers?.Authorization;
      if (authHeader) {
        const request = new Request("https://dummy.com", {
          method: "POST",
          headers: { "Authorization": authHeader }
        });
        await requireAuth(request);
      }
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Parse query params
    const params = event.queryStringParameters || {};
    const templateType = params.template || 'admin';
    const firstName = params.firstName || 'Jeremy';

    console.log('[test-digest] Sending test email to:', TEST_EMAIL);
    console.log('[test-digest] Template type:', templateType);

    // Get organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', TEST_ORG_ID)
      .single();

    if (orgError || !org) {
      throw new Error('Organization not found');
    }

    let emailContent;
    let analyticsData;

    if (templateType === 'user') {
      // Generate user template with user-specific data
      analyticsData = await calculateUserAnalytics(supabase, org.id, TEST_USER_ID);
      emailContent = generateUserDigestEmail(firstName, analyticsData);
      console.log('[test-digest] Generated USER template');
    } else {
      // Generate admin template with org-wide data
      analyticsData = await calculateAdminAnalytics(supabase, org.id);
      emailContent = generateAdminDigestEmail(firstName, analyticsData);
      console.log('[test-digest] Generated ADMIN template');
    }

    console.log('[test-digest] Sending to Resend...');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: TEST_EMAIL,
        subject: `[TEST] ${emailContent.subject}`,
        html: emailContent.html
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[test-digest] ✓ Email sent successfully, ID:', result.id);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: `Test ${templateType.toUpperCase()} digest sent successfully`,
          emailId: result.id,
          to: TEST_EMAIL,
          template: templateType,
          analytics: {
            totalActiveDeals: analyticsData.total_active_deals,
            pipelineValue: analyticsData.pipeline_value,
            dealsWon: analyticsData.deals_won_this_week,
            dealsLost: analyticsData.deals_lost_this_week,
            ...(templateType === 'admin' ? { teamWinRate: (analyticsData as any).team_win_rate } : {})
          }
        })
      };
    } else {
      console.error('[test-digest] ✗ Failed to send:', result);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Failed to send email',
          details: result
        })
      };
    }

  } catch (error: any) {
    console.error('[test-digest] Error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Failed to send test digest',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

// ==========================================
// ANALYTICS FUNCTIONS
// ==========================================

interface DigestAnalytics {
  total_active_deals: number;
  pipeline_value: number;
  deals_won_this_week: number;
  deals_won_value: number;
  deals_lost_this_week: number;
  active_deals_vs_last_week: string;
  pipeline_vs_last_week: string;
  deals_won_vs_last_week: string;
  month_goal_percent: number;
  quarter_goal_percent: number;
  year_goal_percent: number;
  top_loss_reason: string;
  top_driver: string;
  deals_near_close: number;
  stale_deals_count: number;
  stale_days_threshold: number;
  new_leads_target: number;
  manage_notifications_url: string;
}

interface AdminAnalytics extends DigestAnalytics {
  team_win_rate: number;
  at_risk_pipeline_value: number;
  at_risk_summary: string;
  leaderboard_rows: string;
}

async function calculateAdminAnalytics(supabase: any, organizationId: string): Promise<AdminAnalytics> {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Get all deals for organization
  const { data: allDeals } = await supabase
    .from('deals')
    .select('*, users:user_id(raw_user_meta_data)')
    .eq('organization_id', organizationId);

  const deals = allDeals || [];

  // Current week metrics
  const activeDeals = deals.filter((d: any) => d.status === 'active');
  const totalPipeline = activeDeals.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  const wonThisWeek = deals.filter((d: any) =>
    d.status === 'won' && new Date(d.last_activity) >= oneWeekAgo
  );
  const lostThisWeek = deals.filter((d: any) =>
    d.status === 'lost' && new Date(d.last_activity) >= oneWeekAgo
  );

  // Previous week for comparison
  const activePreviousWeek = deals.filter((d: any) => {
    const created = new Date(d.created);
    return d.status === 'active' && created < oneWeekAgo;
  });
  const previousPipeline = activePreviousWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  const wonPreviousWeek = deals.filter((d: any) => {
    const updated = new Date(d.last_activity);
    return d.status === 'won' && updated >= twoWeeksAgo && updated < oneWeekAgo;
  });

  // Calculate trends
  const activeDiff = activeDeals.length - activePreviousWeek.length;
  const pipelineDiff = totalPipeline - previousPipeline;
  const wonDiff = wonThisWeek.length - wonPreviousWeek.length;

  // Win rate calculation
  const closedThisWeek = wonThisWeek.length + lostThisWeek.length;
  const teamWinRate = closedThisWeek > 0 ? Math.round((wonThisWeek.length / closedThisWeek) * 100) : 0;

  // Stale deals (older than threshold)
  const staleDeals = activeDeals.filter((d: any) => {
    const daysSince = Math.floor((Date.now() - new Date(d.last_activity).getTime()) / (1000 * 60 * 60 * 24));
    return daysSince > STALE_DAYS_THRESHOLD;
  });
  const atRiskValue = staleDeals.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  // Deals near close (in later stages)
  const closingStages = ['negotiation', 'proposal', 'contract', 'closing'];
  const dealsNearClose = activeDeals.filter((d: any) =>
    closingStages.some(stage => d.stage?.toLowerCase().includes(stage))
  );

  // Top loss reason
  const lossReasons = lostThisWeek.map((d: any) => d.lost_reason).filter(Boolean);
  const topLossReason = getMostCommon(lossReasons) || 'Not enough budget';

  // Leaderboard (top 3 by deals won value)
  const ownerStats = new Map<string, { name: string; wonCount: number; wonValue: number }>();
  wonThisWeek.forEach((d: any) => {
    const ownerId = d.user_id;
    const ownerName = d.users?.raw_user_meta_data?.first_name ||
                     d.users?.raw_user_meta_data?.name?.split(' ')[0] ||
                     'Unknown';
    if (!ownerStats.has(ownerId)) {
      ownerStats.set(ownerId, { name: ownerName, wonCount: 0, wonValue: 0 });
    }
    const stats = ownerStats.get(ownerId)!;
    stats.wonCount++;
    stats.wonValue += d.value || 0;
  });

  const leaderboard = Array.from(ownerStats.values())
    .sort((a, b) => b.wonValue - a.wonValue)
    .slice(0, 3);

  const leaderboardRows = leaderboard.map(owner => `
    <tr>
      <td style="padding:2px 0;">${escapeHtml(owner.name)}</td>
      <td align="right" style="padding:2px 0;">${owner.wonCount}</td>
      <td align="right" style="padding:2px 0;">${formatCurrency(owner.wonValue)}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="padding:2px 0; color:#9ca3af;">No wins this week</td></tr>';

  // Get organization targets
  const { data: orgTargets } = await supabase
    .from('organization_targets')
    .select('monthly_target, quarterly_target, yearly_target')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const wonThisWeekValue = wonThisWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
  const monthGoalPercent = orgTargets?.monthly_target
    ? Math.round((wonThisWeekValue * 4 / orgTargets.monthly_target) * 100)
    : 0;
  const quarterGoalPercent = orgTargets?.quarterly_target
    ? Math.round((wonThisWeekValue * 13 / orgTargets.quarterly_target) * 100)
    : 0;
  const yearGoalPercent = orgTargets?.yearly_target
    ? Math.round((wonThisWeekValue * 52 / orgTargets.yearly_target) * 100)
    : 0;

  const newLeadsTarget = Math.max(3, Math.ceil(activeDeals.length * 0.2));

  return {
    total_active_deals: activeDeals.length,
    pipeline_value: totalPipeline,
    deals_won_this_week: wonThisWeek.length,
    deals_won_value: wonThisWeekValue,
    deals_lost_this_week: lostThisWeek.length,
    active_deals_vs_last_week: formatTrend(activeDiff),
    pipeline_vs_last_week: formatCurrencyTrend(pipelineDiff),
    deals_won_vs_last_week: formatTrend(wonDiff),
    month_goal_percent: monthGoalPercent,
    quarter_goal_percent: quarterGoalPercent,
    year_goal_percent: yearGoalPercent,
    top_loss_reason: topLossReason,
    top_driver: wonThisWeek.length > wonPreviousWeek.length ? 'Strong closing momentum' : 'New inbound opportunities',
    deals_near_close: dealsNearClose.length,
    stale_deals_count: staleDeals.length,
    stale_days_threshold: STALE_DAYS_THRESHOLD,
    new_leads_target: newLeadsTarget,
    manage_notifications_url: 'https://stageflow.startupstage.com?view=settings',
    team_win_rate: teamWinRate,
    at_risk_pipeline_value: atRiskValue,
    at_risk_summary: staleDeals.length > 0
      ? `${staleDeals.length} deals (${formatCurrency(atRiskValue)}) need attention`
      : 'Pipeline looks healthy',
    leaderboard_rows: leaderboardRows
  };
}

async function calculateUserAnalytics(supabase: any, organizationId: string, userId: string): Promise<DigestAnalytics> {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Get user's deals only
  const { data: allDeals } = await supabase
    .from('deals')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  const deals = allDeals || [];

  // Current metrics
  const activeDeals = deals.filter((d: any) => d.status === 'active');
  const totalPipeline = activeDeals.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  const wonThisWeek = deals.filter((d: any) =>
    d.status === 'won' && new Date(d.last_activity) >= oneWeekAgo
  );
  const lostThisWeek = deals.filter((d: any) =>
    d.status === 'lost' && new Date(d.last_activity) >= oneWeekAgo
  );

  // Previous week for comparison
  const activePreviousWeek = deals.filter((d: any) => {
    const created = new Date(d.created);
    return d.status === 'active' && created < oneWeekAgo;
  });
  const previousPipeline = activePreviousWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);

  const wonPreviousWeek = deals.filter((d: any) => {
    const updated = new Date(d.last_activity);
    return d.status === 'won' && updated >= twoWeeksAgo && updated < oneWeekAgo;
  });

  // Calculate trends
  const activeDiff = activeDeals.length - activePreviousWeek.length;
  const pipelineDiff = totalPipeline - previousPipeline;
  const wonDiff = wonThisWeek.length - wonPreviousWeek.length;

  // Stale deals
  const staleDeals = activeDeals.filter((d: any) => {
    const daysSince = Math.floor((Date.now() - new Date(d.last_activity).getTime()) / (1000 * 60 * 60 * 24));
    return daysSince > STALE_DAYS_THRESHOLD;
  });

  // Deals near close
  const closingStages = ['negotiation', 'proposal', 'contract', 'closing'];
  const dealsNearClose = activeDeals.filter((d: any) =>
    closingStages.some(stage => d.stage?.toLowerCase().includes(stage))
  );

  // Top loss reason
  const lossReasons = lostThisWeek.map((d: any) => d.lost_reason).filter(Boolean);
  const topLossReason = getMostCommon(lossReasons) || 'Not enough budget';

  // Get user targets
  const { data: userTargets } = await supabase
    .from('user_targets')
    .select('monthly_target, quarterly_target, yearly_target')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  const wonThisWeekValue = wonThisWeek.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
  const monthGoalPercent = userTargets?.monthly_target
    ? Math.round((wonThisWeekValue * 4 / userTargets.monthly_target) * 100)
    : 0;
  const quarterGoalPercent = userTargets?.quarterly_target
    ? Math.round((wonThisWeekValue * 13 / userTargets.quarterly_target) * 100)
    : 0;
  const yearGoalPercent = userTargets?.yearly_target
    ? Math.round((wonThisWeekValue * 52 / userTargets.yearly_target) * 100)
    : 0;

  const newLeadsTarget = Math.max(2, Math.ceil(activeDeals.length * 0.15));

  return {
    total_active_deals: activeDeals.length,
    pipeline_value: totalPipeline,
    deals_won_this_week: wonThisWeek.length,
    deals_won_value: wonThisWeekValue,
    deals_lost_this_week: lostThisWeek.length,
    active_deals_vs_last_week: formatTrend(activeDiff),
    pipeline_vs_last_week: formatCurrencyTrend(pipelineDiff),
    deals_won_vs_last_week: formatTrend(wonDiff),
    month_goal_percent: monthGoalPercent,
    quarter_goal_percent: quarterGoalPercent,
    year_goal_percent: yearGoalPercent,
    top_loss_reason: topLossReason,
    top_driver: wonThisWeek.length > 0 ? 'New opportunities created' : 'Pipeline building',
    deals_near_close: dealsNearClose.length,
    stale_deals_count: staleDeals.length,
    stale_days_threshold: STALE_DAYS_THRESHOLD,
    new_leads_target: newLeadsTarget,
    manage_notifications_url: 'https://stageflow.startupstage.com?view=settings'
  };
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// CORS headers for all responses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(val);
}

function formatTrend(diff: number): string {
  if (diff > 0) return `+${diff} vs last week`;
  if (diff < 0) return `${diff} vs last week`;
  return 'Same as last week';
}

function formatCurrencyTrend(diff: number): string {
  if (diff > 0) return `+${formatCurrency(diff)} vs last week`;
  if (diff < 0) return `${formatCurrency(diff)} vs last week`;
  return 'Same as last week';
}

function getMostCommon(arr: string[]): string | null {
  if (arr.length === 0) return null;
  const counts = arr.reduce((acc: Record<string, number>, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// ==========================================
// EMAIL TEMPLATES
// ==========================================

function generateAdminDigestEmail(firstName: string, analytics: AdminAnalytics) {
  // Escape user-provided content to prevent XSS
  const safeFirstName = escapeHtml(firstName);
  const safeTopLossReason = escapeHtml(analytics.top_loss_reason);
  const safeTopDriver = escapeHtml(analytics.top_driver);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>StageFlow – Weekly Team Pipeline Summary</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body, table, td, p { margin:0; padding:0; }
    img { border:0; outline:none; text-decoration:none; display:block; }
    table { border-collapse:collapse; }
    @media screen and (max-width: 600px) {
      .container { width:100% !important; }
      .inner-padding { padding:20px !important; }
      .h1 { font-size:22px !important; line-height:1.3 !important; }
      .stat-value { font-size:18px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#05080c; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;">
  <table role="presentation" width="100%" bgcolor="#05080c" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!-- TEST BANNER -->
        <table role="presentation" width="600" class="container" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; margin-bottom:10px;">
          <tr>
            <td align="center" style="padding:12px; background:#EF4444; border-radius:10px;">
              <span style="color:white; font-weight:600; font-size:14px;">🧪 TEST EMAIL - Admin/Team Leader Template</span>
            </td>
          </tr>
        </table>

        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; background-color:#0a1017; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.6);">
          <!-- HEADER -->
          <tr>
            <td align="left" style="background:linear-gradient(120deg,#39e1c6,#79f2df); padding:18px 24px;">
              <table role="presentation" width="100%">
                <tr>
                  <td align="left">
                    <span style="font-size:16px; font-weight:700; color:#020306;">StageFlow RevOps Platform</span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#04332a;">
                      Weekly Team Summary
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- INTRO -->
          <tr>
            <td class="inner-padding" style="padding:26px 28px 8px;">
              <p style="font-size:13px; color:#9aa5b3; margin:0 0 8px;">
                Hi ${safeFirstName},
              </p>
              <p class="h1" style="font-size:24px; line-height:1.4; color:#f5f7fa; font-weight:650; margin:0 0 6px;">
                Here's how your team's pipeline looks this week.
              </p>
              <p style="font-size:13px; color:#8994a3; margin:0 0 18px;">
                A quick snapshot of total pipeline, wins, and the areas that need attention before next week's conversations.
              </p>
            </td>
          </tr>

          <!-- FIRST ROW: ACTIVE + PIPELINE -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 6px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding:10px 10px 10px 0;">
                    <table role="presentation" width="100%" style="background-color:#0f1722; border-radius:14px; border:1px solid rgba(121,242,223,0.25);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Active deals (team)
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${analytics.total_active_deals}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            ${analytics.active_deals_vs_last_week}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <td width="50%" valign="top" style="padding:10px 0 10px 10px;">
                    <table role="presentation" width="100%" style="background-color:#0f1722; border-radius:14px; border:1px solid rgba(121,242,223,0.25);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Pipeline value
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${formatCurrency(analytics.pipeline_value)}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            ${analytics.pipeline_vs_last_week}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SECOND ROW: WINS + LOSSES -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 10px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding:10px 10px 10px 0;">
                    <table role="presentation" width="100%" style="background-color:#0b1520; border-radius:14px; border:1px solid rgba(63,211,160,0.6);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Deals won this week
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${analytics.deals_won_this_week}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            Win rate: ${analytics.team_win_rate}%
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <td width="50%" valign="top" style="padding:10px 0 10px 10px;">
                    <table role="presentation" width="100%" style="background-color:#190d15; border-radius:14px; border:1px solid rgba(248,113,113,0.4);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#fda4af; font-weight:600; margin-bottom:4px;">
                            Deals lost this week
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#fee2e2; margin-bottom:4px;">
                            ${analytics.deals_lost_this_week}
                          </div>
                          <div style="font-size:11px; color:#fca5a5;">
                            Top reason: ${safeTopLossReason}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PROGRESS TOWARD GOALS -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 18px;">
              <table role="presentation" width="100%" style="background-color:#0b131e; border-radius:16px; border:1px solid rgba(148,163,184,0.35);">
                <tr>
                  <td style="padding:14px 16px 10px;">
                    <p style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af; margin:0 0 8px;">
                      Progress toward team goals
                    </p>
                    <table role="presentation" width="100%">
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Month:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.month_goal_percent}% of target
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Quarter:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.quarter_goal_percent}% of target
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Year:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.year_goal_percent}% of target
                        </td>
                      </tr>
                    </table>
                    <p style="font-size:11px; color:#9ca3af; margin:8px 0 0;">
                      This week's biggest driver: <span style="color:#e5e7eb; font-weight:500;">${safeTopDriver}</span>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TEAM LEADERBOARD -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 18px;">
              <table role="presentation" width="100%" style="background-color:#050b12; border-radius:16px; border:1px solid rgba(63,211,160,0.45);">
                <tr>
                  <td style="padding:14px 16px 10px;">
                    <p style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#7cebd7; margin:0 0 8px;">
                      Team leaderboard
                    </p>
                    <table role="presentation" width="100%" style="font-size:12px; color:#e5e7eb;">
                      <tr>
                        <th align="left" style="padding:4px 0 6px; font-weight:500; color:#9ca3af;">Owner</th>
                        <th align="right" style="padding:4px 0 6px; font-weight:500; color:#9ca3af;">Deals won</th>
                        <th align="right" style="padding:4px 0 6px; font-weight:500; color:#9ca3af;">Won value</th>
                      </tr>
                      ${analytics.leaderboard_rows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SUGGESTED FOCUS -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 20px;">
              <table role="presentation" width="100%" style="background-color:#050b12; border-radius:16px; border:1px solid rgba(63,211,160,0.45);">
                <tr>
                  <td style="padding:14px 16px 12px;">
                    <p style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#7cebd7; margin:0 0 6px;">
                      Suggested focus for next week
                    </p>
                    <ul style="margin:0; padding-left:18px; font-size:12px; color:#cbd5f5;">
                      <li style="margin-bottom:4px;">
                        Review <strong>${analytics.deals_near_close}</strong> deals in final stages with owners before end of week.
                      </li>
                      <li style="margin-bottom:4px;">
                        Unblock <strong>${analytics.stale_deals_count}</strong> stalled opportunities older than ${analytics.stale_days_threshold} days.
                      </li>
                      <li>
                        Ensure at least <strong>${analytics.new_leads_target}</strong> new qualified leads are added to keep pipeline healthy.
                      </li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 28px 26px;">
              <a href="https://stageflow.startupstage.com"
                 style="display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(120deg,#39e1c6,#79f2df); color:#020306; font-size:14px; font-weight:600; text-decoration:none; box-shadow:0 14px 40px rgba(6,201,168,0.55);">
                Open StageFlow
              </a>
              <p style="font-size:11px; color:#6b7280; margin:10px 0 0;">
                Log in to drill into each deal, stage, and owner for the full picture.
              </p>
            </td>
          </tr>
        </table>

        <!-- FOOTER -->
        <table role="presentation" width="600" class="container" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; margin-top:10px;">
          <tr>
            <td align="center" style="padding:8px 10px 0;">
              <p style="font-size:10px; color:#6b7280; margin:0 0 4px;">
                You're receiving this because Weekly Team Pipeline Summary is enabled in your StageFlow notification settings.
              </p>
              <p style="font-size:10px; color:#6b7280; margin:0;">
                <a href="${analytics.manage_notifications_url}" style="color:#9ca3af; text-decoration:underline;">Manage notification preferences</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `Weekly Team Pipeline Summary`,
    html
  };
}

function generateUserDigestEmail(firstName: string, analytics: DigestAnalytics) {
  // Escape user-provided content to prevent XSS
  const safeFirstName = escapeHtml(firstName);
  const safeTopLossReason = escapeHtml(analytics.top_loss_reason);
  const safeTopDriver = escapeHtml(analytics.top_driver);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>StageFlow – Your Weekly Pipeline Summary</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body, table, td, p { margin:0; padding:0; }
    img { border:0; outline:none; text-decoration:none; display:block; }
    table { border-collapse:collapse; }
    @media screen and (max-width: 600px) {
      .container { width:100% !important; }
      .inner-padding { padding:20px !important; }
      .h1 { font-size:22px !important; line-height:1.3 !important; }
      .stat-value { font-size:18px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#05080c; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;">
  <table role="presentation" width="100%" bgcolor="#05080c" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!-- TEST BANNER -->
        <table role="presentation" width="600" class="container" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; margin-bottom:10px;">
          <tr>
            <td align="center" style="padding:12px; background:#3B82F6; border-radius:10px;">
              <span style="color:white; font-weight:600; font-size:14px;">🧪 TEST EMAIL - Regular User Template</span>
            </td>
          </tr>
        </table>

        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; background-color:#0a1017; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.6);">
          <!-- HEADER -->
          <tr>
            <td align="left" style="background:linear-gradient(120deg,#39e1c6,#79f2df); padding:18px 24px;">
              <table role="presentation" width="100%">
                <tr>
                  <td align="left">
                    <span style="font-size:16px; font-weight:700; color:#020306;">StageFlow RevOps Platform</span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:#04332a;">
                      Weekly Pipeline Summary
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- INTRO -->
          <tr>
            <td class="inner-padding" style="padding:26px 28px 8px;">
              <p style="font-size:13px; color:#9aa5b3; margin:0 0 8px;">
                Hi ${safeFirstName},
              </p>
              <p class="h1" style="font-size:24px; line-height:1.4; color:#f5f7fa; font-weight:650; margin:0 0 6px;">
                Here's how your pipeline looks this week.
              </p>
              <p style="font-size:13px; color:#8994a3; margin:0 0 18px;">
                A quick snapshot of what's moving, what's stalling, and how you're tracking toward your own goals.
              </p>
            </td>
          </tr>

          <!-- ACTIVE + PIPELINE -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 6px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding:10px 10px 10px 0;">
                    <table role="presentation" width="100%" style="background-color:#0f1722; border-radius:14px; border:1px solid rgba(121,242,223,0.25);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Active deals
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${analytics.total_active_deals}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            ${analytics.active_deals_vs_last_week}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <td width="50%" valign="top" style="padding:10px 0 10px 10px;">
                    <table role="presentation" width="100%" style="background-color:#0f1722; border-radius:14px; border:1px solid rgba(121,242,223,0.25);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Pipeline value
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${formatCurrency(analytics.pipeline_value)}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            ${analytics.pipeline_vs_last_week}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- WINS + LOSSES -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 10px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top" style="padding:10px 10px 10px 0;">
                    <table role="presentation" width="100%" style="background-color:#0b1520; border-radius:14px; border:1px solid rgba(63,211,160,0.6);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#7cebd7; font-weight:600; margin-bottom:4px;">
                            Deals won this week
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#f9fafb; margin-bottom:4px;">
                            ${analytics.deals_won_this_week}
                          </div>
                          <div style="font-size:11px; color:#8c97a6;">
                            ${analytics.deals_won_vs_last_week}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <td width="50%" valign="top" style="padding:10px 0 10px 10px;">
                    <table role="presentation" width="100%" style="background-color:#190d15; border-radius:14px; border:1px solid rgba(248,113,113,0.4);">
                      <tr>
                        <td style="padding:12px 14px 10px;">
                          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#fda4af; font-weight:600; margin-bottom:4px;">
                            Deals lost this week
                          </div>
                          <div class="stat-value" style="font-size:20px; font-weight:650; color:#fee2e2; margin-bottom:4px;">
                            ${analytics.deals_lost_this_week}
                          </div>
                          <div style="font-size:11px; color:#fca5a5;">
                            Top reason: ${safeTopLossReason}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- GOALS -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 18px;">
              <table role="presentation" width="100%" style="background-color:#0b131e; border-radius:16px; border:1px solid rgba(148,163,184,0.35);">
                <tr>
                  <td style="padding:14px 16px 10px;">
                    <p style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af; margin:0 0 8px;">
                      Progress toward your goals
                    </p>
                    <table role="presentation" width="100%">
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Month:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.month_goal_percent}% of target
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Quarter:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.quarter_goal_percent}% of target
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:12px; color:#e5e7eb; padding:2px 0;">Year:</td>
                        <td align="right" style="font-size:12px; color:#7cebd7; padding:2px 0;">
                          ${analytics.year_goal_percent}% of target
                        </td>
                      </tr>
                    </table>
                    <p style="font-size:11px; color:#9ca3af; margin:8px 0 0;">
                      Biggest driver this week: <span style="color:#e5e7eb; font-weight:500;">${safeTopDriver}</span>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SUGGESTED FOCUS -->
          <tr>
            <td class="inner-padding" style="padding:0 28px 20px;">
              <table role="presentation" width="100%" style="background-color:#050b12; border-radius:16px; border:1px solid rgba(63,211,160,0.45);">
                <tr>
                  <td style="padding:14px 16px 12px;">
                    <p style="font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#7cebd7; margin:0 0 6px;">
                      Suggested focus for next week
                    </p>
                    <ul style="margin:0; padding-left:18px; font-size:12px; color:#cbd5f5;">
                      <li style="margin-bottom:4px;">
                        Follow up on <strong>${analytics.deals_near_close}</strong> deals in closing stages.
                      </li>
                      <li style="margin-bottom:4px;">
                        Re-engage <strong>${analytics.stale_deals_count}</strong> stalled opportunities older than ${analytics.stale_days_threshold} days.
                      </li>
                      <li>
                        Add at least <strong>${analytics.new_leads_target}</strong> new leads to keep your pipeline healthy.
                      </li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 28px 26px;">
              <a href="https://stageflow.startupstage.com"
                 style="display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(120deg,#39e1c6,#79f2df); color:#020306; font-size:14px; font-weight:600; text-decoration:none; box-shadow:0 14px 40px rgba(6,201,168,0.55);">
                Open StageFlow
              </a>
              <p style="font-size:11px; color:#6b7280; margin:10px 0 0;">
                Log in to see every deal, stage, and note in one place.
              </p>
            </td>
          </tr>
        </table>

        <!-- FOOTER -->
        <table role="presentation" width="600" class="container" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%; margin-top:10px;">
          <tr>
            <td align="center" style="padding:8px 10px 0;">
              <p style="font-size:10px; color:#6b7280; margin:0 0 4px;">
                You're receiving this because Weekly Pipeline Summary is enabled in your StageFlow notification settings.
              </p>
              <p style="font-size:10px; color:#6b7280; margin:0;">
                <a href="${analytics.manage_notifications_url}" style="color:#9ca3af; text-decoration:underline;">Manage notification preferences</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `Your Weekly Pipeline Summary`,
    html
  };
}

export { handler };
