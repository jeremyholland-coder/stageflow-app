import type { Config, Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { getEmailTemplate } from './email-templates.mts';
import { requireAuth, validateUserIdMatch, createAuthErrorResponse } from './lib/auth-middleware';
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { buildCorsHeaders } from './lib/cors';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async (req: Request, context: Context) => {
  // ENGINE REBUILD Phase 9: Use centralized CORS spine
  const origin = req.headers.get('origin') || '';
  const headers = buildCorsHeaders(origin, { methods: 'POST, OPTIONS' });

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  try {
    const { dealId, event, userId, organizationId } = await req.json() as any;

    console.warn('[trigger-notification] Request received:', { dealId, event, userId, organizationId: organizationId?.substring(0, 8) });

    if (!dealId || !event || !userId || !organizationId) {
      console.error('[trigger-notification] Missing required fields');
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers
      });
    }

    // PHASE 12 FIX: Query team_members directly instead of requireOrgAccess
    // requireOrgAccess would try to re-read body if org_id were falsy
    try {
      console.warn('[trigger-notification] Authenticating user...');
      const user = await requireAuth(req);
      await validateUserIdMatch(user, userId);
      console.warn('[trigger-notification] Auth succeeded, user:', user.id);

      // Verify membership directly
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (memberError || !membership) {
        console.error('[trigger-notification] User not in organization:', { userId: user.id, organizationId });
        return new Response(JSON.stringify({ error: 'Not authorized for this organization' }), {
          status: 403,
          headers
        });
      }

      console.warn('[trigger-notification] Membership verified, role:', membership.role);
    } catch (authError: any) {
      console.error('[trigger-notification] Auth error:', authError.message);
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
        headers
      });
    }

    // If no preferences or all notifications are off, don't send
    if (!prefs || !prefs.all_notifications) {
      return new Response(JSON.stringify({ message: 'Notifications disabled' }), {
        status: 200,
        headers
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
        headers
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
        headers
      });
    }

    // Get user email
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (userError || !userData.user?.email) {
      console.error('Error fetching user:', userError);
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers
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
      headers,
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
      headers
    });

  } catch (error: any) {
    console.error('Notification trigger error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to process notification',
      details: error.message 
    }), {
      status: 500,
      headers
    });
  }
};

export const config: Config = {
  path: '/api/trigger-notification'
};
