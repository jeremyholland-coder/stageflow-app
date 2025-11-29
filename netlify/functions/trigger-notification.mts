import type { Config, Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { getEmailTemplate } from './email-templates.mts';
import { requireAuth, validateUserIdMatch, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  try {
    const { dealId, event, userId, organizationId } = await req.json() as any;

    if (!dealId || !event || !userId || !organizationId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // SECURITY: Require authentication via HttpOnly cookies (v1.7.98)
    // Phase 3 complete: Always require auth, no legacy path
    try {
      const user = await requireAuth(req);
      await validateUserIdMatch(user, userId);
      await requireOrgAccess(req, organizationId);

      // User is authenticated and authorized
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }

    // Get user's notification preferences
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (prefsError) {
      console.error('Error fetching preferences:', prefsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch preferences' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If no preferences or all notifications are off, don't send
    if (!prefs || !prefs.all_notifications) {
      return new Response(JSON.stringify({ message: 'Notifications disabled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if this specific notification type is enabled
    const notificationMap = {
      'deal_created': prefs.notify_deal_created,
      'stage_changed': prefs.notify_stage_changed,
      'deal_won': prefs.notify_deal_won,
      'deal_lost': prefs.notify_deal_lost
    };

    if (!(notificationMap as any)[event]) {
      return new Response(JSON.stringify({ message: 'This notification type is disabled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get deal details
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      console.error('Error fetching deal:', dealError);
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get user email
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError || !userData.user?.email) {
      console.error('Error fetching user:', userError);
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prepare email data
    const baseUrl = 'https://stageflow.startupstage.com';
    const emailData: any = {
      clientName: deal.client,
      email: deal.email,
      value: deal.value,
      stage: deal.stage,
      dealUrl: `${baseUrl}?deal=${dealId}`,
      settingsUrl: `${baseUrl}?view=settings`
    };

    // Add event-specific data
    if (event === 'stage_changed') {
      // Get stage history for this deal
      const { data: history } = await supabase
        .from('deal_stage_history')
        .select('*')
        .eq('deal_id', dealId)
        .order('changed_at', { ascending: false })
        .limit(2);

      if (history && history.length >= 2) {
        emailData.fromStage = history[1].to_stage;
        emailData.toStage = history[0].to_stage;
      } else {
        emailData.fromStage = 'Unknown';
        emailData.toStage = deal.stage;
      }
    }

    if (event === 'deal_won') {
      // Calculate days to close
      const created = new Date(deal.created);
      const now = new Date();
      const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      emailData.daysToClose = days;
    }

    if (event === 'deal_lost') {
      emailData.reason = deal.lost_reason || '';
    }

    // Generate email from template
    const { subject, html } = getEmailTemplate(event, emailData);

    // Send email
    const sendResponse = await fetch(`${baseUrl}/.netlify/functions/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: userData.user.email,
        subject,
        html,
        notificationType: event
      })
    });

    if (!sendResponse.ok) {
      throw new Error('Failed to send email');
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Notification sent',
      event 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Notification trigger error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to process notification',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config: Config = {
  path: '/api/trigger-notification'
};
