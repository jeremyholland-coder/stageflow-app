/**
 * NOTIFICATION SERVICE
 *
 * Central service for sending notifications to users.
 * Respects user preferences and logs all notification attempts.
 *
 * Usage:
 * import { notifyUser } from './lib/notifications-service';
 *
 * await notifyUser({
 *   userId: 'user-uuid',
 *   categoryCode: 'DEAL_ASSIGNED',
 *   data: { dealId, dealName, amount, assignedBy }
 * });
 */

import { getSupabaseClient } from './supabase-pool';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'StageFlow <jeremy@startupstage.com>';

export interface NotifyPayload {
  userId: string;
  categoryCode: string;
  data: Record<string, any>;
}

interface NotificationCategory {
  code: string;
  name: string;
  description: string | null;
  is_critical: boolean;
  default_enabled: boolean;
}

interface UserPreference {
  enabled: boolean;
  channel_email: boolean;
  channel_in_app: boolean;
  channel_push: boolean;
}

interface NotifyResult {
  success: boolean;
  channels: {
    email?: { sent: boolean; error?: string };
    inApp?: { sent: boolean };
    push?: { sent: boolean };
  };
}

/**
 * Send a notification to a user based on their preferences.
 *
 * @param payload - The notification payload
 * @returns Result object with success status and channel details
 */
export async function notifyUser(payload: NotifyPayload): Promise<NotifyResult> {
  const { userId, categoryCode, data } = payload;
  const supabase = getSupabaseClient();

  console.warn('[notifications] Starting notifyUser:', { userId, categoryCode });

  const result: NotifyResult = {
    success: false,
    channels: {}
  };

  try {
    // 1. Fetch the notification category
    const { data: category, error: catError } = await supabase
      .from('notification_categories')
      .select('code, name, description, is_critical, default_enabled')
      .eq('code', categoryCode)
      .single();

    if (catError || !category) {
      console.error('[notifications] Invalid category code:', categoryCode, catError);
      return result;
    }

    console.warn('[notifications] Category found:', category.name);

    // 2. Fetch user's email from auth.users (via profiles or direct)
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.email) {
      console.error('[notifications] Could not find user email:', userId, profileError);
      return result;
    }

    const userEmail = profile.email;
    const userName = profile.full_name || 'User';

    console.warn('[notifications] User found:', { email: userEmail.substring(0, 3) + '***' });

    // 3. Load user preferences for this category
    const { data: userPref, error: prefError } = await supabase
      .from('user_notification_preferences')
      .select('enabled, channel_email, channel_in_app, channel_push')
      .eq('user_id', userId)
      .eq('category_code', categoryCode)
      .maybeSingle();

    // Default preferences if none set
    const prefs: UserPreference = userPref || {
      enabled: category.default_enabled,
      channel_email: true,
      channel_in_app: true,
      channel_push: false
    };

    console.warn('[notifications] Prefs resolved:', {
      enabled: prefs.enabled,
      email: prefs.channel_email,
      inApp: prefs.channel_in_app,
      push: prefs.channel_push
    });

    // 4. Check if notifications are enabled
    if (!prefs.enabled) {
      console.warn('[notifications] Notifications disabled for this category by user');
      result.success = true; // Not an error, just skipped
      return result;
    }

    // 5. Send via enabled channels
    // EMAIL CHANNEL
    if (prefs.channel_email && RESEND_API_KEY) {
      try {
        const emailResult = await sendEmailNotification({
          to: userEmail,
          userName,
          category,
          data
        });
        result.channels.email = emailResult;

        // Log to queue
        await logNotificationAttempt(supabase, {
          userId,
          categoryCode,
          channel: 'email',
          payload: data,
          status: emailResult.sent ? 'sent' : 'failed',
          errorMessage: emailResult.error
        });

        if (emailResult.sent) {
          console.warn('[notifications] Email sent successfully');
        } else {
          console.error('[notifications] Email failed:', emailResult.error);
        }
      } catch (emailError: any) {
        console.error('[notifications] Email error:', emailError.message);
        result.channels.email = { sent: false, error: emailError.message };

        await logNotificationAttempt(supabase, {
          userId,
          categoryCode,
          channel: 'email',
          payload: data,
          status: 'failed',
          errorMessage: emailError.message
        });
      }
    } else if (prefs.channel_email && !RESEND_API_KEY) {
      console.warn('[notifications] Email requested but RESEND_API_KEY not configured');
    }

    // IN-APP CHANNEL (placeholder for future notification center)
    if (prefs.channel_in_app) {
      // For now, just log that in-app was "sent"
      // In the future, this could store to a notifications inbox table
      result.channels.inApp = { sent: true };
      console.warn('[notifications] In-app notification logged (future: notification center)');

      await logNotificationAttempt(supabase, {
        userId,
        categoryCode,
        channel: 'in_app',
        payload: data,
        status: 'sent'
      });
    }

    // PUSH CHANNEL (not implemented yet)
    if (prefs.channel_push) {
      result.channels.push = { sent: false };
      console.warn('[notifications] Push notifications not implemented yet');
    }

    result.success = true;
    console.warn('[notifications] notifyUser complete:', { success: true });

    return result;

  } catch (error: any) {
    console.error('[notifications] notifyUser error:', error.message);
    return result;
  }
}

/**
 * Send email via Resend API
 */
async function sendEmailNotification(params: {
  to: string;
  userName: string;
  category: NotificationCategory;
  data: Record<string, any>;
}): Promise<{ sent: boolean; error?: string }> {
  const { to, userName, category, data } = params;

  // Generate email content based on category
  const emailContent = generateEmailContent(category.code, category.name, data, userName);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: emailContent.subject,
      html: emailContent.html
    })
  });

  const result = await response.json() as any;

  if (!response.ok) {
    return { sent: false, error: result.message || 'Resend API error' };
  }

  return { sent: true };
}

/**
 * Generate email content based on notification category
 */
function generateEmailContent(
  categoryCode: string,
  categoryName: string,
  data: Record<string, any>,
  userName: string
): { subject: string; html: string } {
  let subject = '';
  let title = '';
  let message = '';

  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(value || 0);

  switch (categoryCode) {
    case 'DEAL_ASSIGNED':
      subject = `Deal Assigned: ${data.dealName || 'New Deal'}`;
      title = 'New Deal Assigned to You';
      message = `
        <p>Hey ${userName},</p>
        <p>A deal has been assigned to you:</p>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Deal:</strong> ${data.dealName || 'Unknown'}</li>
          ${data.amount ? `<li><strong>Value:</strong> ${formatCurrency(data.amount)}</li>` : ''}
          ${data.assignedByName ? `<li><strong>Assigned by:</strong> ${data.assignedByName}</li>` : ''}
        </ul>
        <p>Log in to StageFlow to view the full details and take action.</p>
      `;
      break;

    case 'DEAL_WON':
      subject = `Congratulations! Deal Won: ${data.dealName || 'Deal'} - ${formatCurrency(data.amount)}`;
      title = 'Deal Won!';
      message = `
        <p>Congratulations ${userName}!</p>
        <p>You've won <strong>${data.dealName || 'a deal'}</strong> worth <strong>${formatCurrency(data.amount)}</strong>!</p>
        <p>Keep up the great work!</p>
      `;
      break;

    case 'DEAL_LOST':
      subject = `Deal Lost: ${data.dealName || 'Deal'}`;
      title = 'Deal Lost';
      message = `
        <p>Hey ${userName},</p>
        <p><strong>${data.dealName || 'A deal'}</strong> has been marked as lost.</p>
        ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        <p>On to the next one!</p>
      `;
      break;

    case 'TASK_DUE_TODAY':
      subject = `Task Due Today: ${data.taskName || 'Task'}`;
      title = 'Task Due Today';
      message = `
        <p>Hey ${userName},</p>
        <p>You have a task due today:</p>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Task:</strong> ${data.taskName || 'Unknown'}</li>
          ${data.dealName ? `<li><strong>Related deal:</strong> ${data.dealName}</li>` : ''}
        </ul>
        <p>Log in to StageFlow to complete this task.</p>
      `;
      break;

    case 'STAGE_CHANGED':
      subject = `Deal Moved: ${data.dealName || 'Deal'} → ${data.newStage || 'New Stage'}`;
      title = 'Deal Stage Changed';
      message = `
        <p>Hey ${userName},</p>
        <p><strong>${data.dealName || 'A deal'}</strong> has moved from <strong>${data.previousStage || 'Unknown'}</strong> to <strong>${data.newStage || 'Unknown'}</strong>.</p>
      `;
      break;

    case 'WEEKLY_PIPELINE_DIGEST':
      subject = 'Your Weekly Pipeline Summary';
      title = 'Weekly Pipeline Summary';
      message = `
        <p>Hey ${userName},</p>
        <p>Here's your weekly pipeline summary:</p>
        <ul>
          ${data.totalDeals ? `<li><strong>Total active deals:</strong> ${data.totalDeals}</li>` : ''}
          ${data.totalValue ? `<li><strong>Pipeline value:</strong> ${formatCurrency(data.totalValue)}</li>` : ''}
          ${data.dealsWon ? `<li><strong>Deals won this week:</strong> ${data.dealsWon}</li>` : ''}
          ${data.dealsLost ? `<li><strong>Deals lost this week:</strong> ${data.dealsLost}</li>` : ''}
        </ul>
        <p>Log in to StageFlow for the full picture.</p>
      `;
      break;

    case 'TEAM_MENTION':
      subject = `${data.mentionedByName || 'Someone'} mentioned you in StageFlow`;
      title = 'You Were Mentioned';
      message = `
        <p>Hey ${userName},</p>
        <p><strong>${data.mentionedByName || 'Someone'}</strong> mentioned you${data.context ? ` in ${data.context}` : ''}.</p>
        ${data.snippet ? `<blockquote style="border-left: 3px solid #1ABC9C; padding-left: 12px; margin: 16px 0; color: #666;">${data.snippet}</blockquote>` : ''}
        <p>Log in to StageFlow to see the full context.</p>
      `;
      break;

    default:
      subject = `StageFlow Notification: ${categoryName}`;
      title = categoryName;
      message = `
        <p>Hey ${userName},</p>
        <p>You have a new notification from StageFlow.</p>
        <p>Log in to see more details.</p>
      `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F9FAFB; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" style="max-width: 600px;" cellpadding="0" cellspacing="0">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); padding: 32px 40px; border-radius: 16px 16px 0 0;">
                  <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">StageFlow</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="background-color: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                  <h2 style="margin: 0 0 20px 0; color: #111827; font-size: 20px; font-weight: 600;">${title}</h2>
                  <div style="color: #374151; font-size: 16px; line-height: 1.6;">
                    ${message}
                  </div>
                  <div style="margin-top: 32px;">
                    <a href="https://stageflow.startupstage.com" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #1ABC9C 0%, #3A86FF 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                      Open StageFlow
                    </a>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding: 24px 40px; text-align: center;">
                  <p style="margin: 0; color: #9CA3AF; font-size: 12px;">
                    You're receiving this because you have notifications enabled for "${categoryName}".
                    <br>
                    <a href="https://stageflow.startupstage.com/settings" style="color: #6B7280; text-decoration: underline;">Manage notification preferences</a>
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

/**
 * Log notification attempt to the queue table
 */
async function logNotificationAttempt(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    userId: string;
    categoryCode: string;
    channel: string;
    payload: Record<string, any>;
    status: 'pending' | 'sent' | 'failed';
    errorMessage?: string;
  }
): Promise<void> {
  try {
    await supabase.from('notifications_queue').insert({
      user_id: params.userId,
      category_code: params.categoryCode,
      channel: params.channel,
      payload: params.payload,
      status: params.status,
      error_message: params.errorMessage || null,
      sent_at: params.status === 'sent' ? new Date().toISOString() : null
    });
  } catch (error: any) {
    // Non-fatal - just log
    console.warn('[notifications] Failed to log to queue:', error.message);
  }
}

export default notifyUser;
