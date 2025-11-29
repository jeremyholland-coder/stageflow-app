/**
 * Retention Reminders API
 *
 * Manages customer retention follow-ups based on closed_date
 * Automatically suggests touchpoints: 2 weeks, 1 month, 90 days, quarterly
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  // PHASE 12: Consistent CORS headers (no wildcard)
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:5173',
    'http://localhost:8888'
  ];
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : 'https://stageflow.startupstage.com';

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || event.queryStringParameters?.action || 'get-reminders';

    // =================================================================
    // ACTION: Get All Retention Reminders
    // =================================================================
    if (action === 'get-reminders') {
      const { organizationId } = body;

      if (!organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing organizationId' })
        };
      }

      // PHASE 12 FIX: Always require authentication, query team_members directly
      try {
        console.warn('[retention-reminders] get-reminders auth check for org:', organizationId);

        // Create Request with full headers (includes cookies)
        const request = new Request('https://dummy.com', {
          method: event.httpMethod,
          headers: new Headers(event.headers as Record<string, string>)
        });

        const user = await requireAuth(request);
        console.warn('[retention-reminders] Auth succeeded, user:', user.id);

        // Verify membership directly
        const { data: membership, error: memberError } = await supabase
          .from('team_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (memberError || !membership) {
          console.error('[retention-reminders] User not in organization:', { userId: user.id, organizationId });
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Not authorized for this organization' })
          };
        }

        console.warn('[retention-reminders] Membership verified, role:', membership.role);
      } catch (authError: any) {
        console.error('[retention-reminders] Auth error:', authError.message);
        const errorResponse = createAuthErrorResponse(authError);
        return {
          statusCode: errorResponse.status,
          headers,
          body: await errorResponse.text()
        };
      }

      const { data: reminders, error } = await supabase
        .from('retention_reminders')
        .select('*')
        .eq('organization_id', organizationId)
        .neq('reminder_type', 'no_action_needed')
        .order('is_overdue', { ascending: false })
        .order('days_since_close', { ascending: false });

      if (error) throw error;

      // Get user details from user_profiles (much faster than listUsers!)
      const assignedUserIds = [...new Set(reminders?.map(r => r.assigned_to).filter(Boolean))];
      let userDetails = [];

      if (assignedUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, full_name')
          .in('id', assignedUserIds);

        userDetails = profiles || [];
      }

      // Enrich reminders with user data
      const enrichedReminders = reminders?.map(r => ({
        ...r,
        assigned_user: userDetails.find(u => u.id === r.assigned_to) || null
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          reminders: enrichedReminders || [],
          summary: {
            total: enrichedReminders?.length || 0,
            overdue: enrichedReminders?.filter(r => r.is_overdue).length || 0,
            urgent: enrichedReminders?.filter(r => r.priority === 'urgent').length || 0,
            high: enrichedReminders?.filter(r => r.priority === 'high').length || 0
          }
        })
      };
    }

    // =================================================================
    // ACTION: Get Overdue Items Only
    // =================================================================
    if (action === 'get-overdue') {
      const { organizationId } = body;

      if (!organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing organizationId' })
        };
      }

      // PHASE 12 FIX: Always require authentication, query team_members directly
      try {
        console.warn('[retention-reminders] get-overdue auth check for org:', organizationId);

        const request = new Request('https://dummy.com', {
          method: event.httpMethod,
          headers: new Headers(event.headers as Record<string, string>)
        });

        const user = await requireAuth(request);
        const { data: membership, error: memberError } = await supabase
          .from('team_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (memberError || !membership) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Not authorized for this organization' })
          };
        }
      } catch (authError: any) {
        console.error('[retention-reminders] get-overdue auth error:', authError.message);
        const errorResponse = createAuthErrorResponse(authError);
        return { statusCode: errorResponse.status, headers, body: await errorResponse.text() };
      }

      const { data: overdueItems, error } = await supabase
        .rpc('get_overdue_retention_items', {
          p_organization_id: organizationId
        });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          overdueItems: overdueItems || [],
          count: overdueItems?.length || 0
        })
      };
    }

    // =================================================================
    // ACTION: Get Reminders for Specific Rep
    // =================================================================
    if (action === 'get-by-rep') {
      const { organizationId, assignedTo } = body;

      if (!organizationId || !assignedTo) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing organizationId or assignedTo' })
        };
      }

      // PHASE 12 FIX: Always require authentication, query team_members directly
      try {
        console.warn('[retention-reminders] get-by-rep auth check for org:', organizationId);

        const request = new Request('https://dummy.com', {
          method: event.httpMethod,
          headers: new Headers(event.headers as Record<string, string>)
        });

        const user = await requireAuth(request);
        const { data: membership, error: memberError } = await supabase
          .from('team_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', organizationId)
          .maybeSingle();

        if (memberError || !membership) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Not authorized for this organization' })
          };
        }
      } catch (authError: any) {
        console.error('[retention-reminders] get-by-rep auth error:', authError.message);
        const errorResponse = createAuthErrorResponse(authError);
        return { statusCode: errorResponse.status, headers, body: await errorResponse.text() };
      }

      const { data: reminders, error } = await supabase
        .from('retention_reminders')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('assigned_to', assignedTo)
        .neq('reminder_type', 'no_action_needed')
        .order('priority')
        .order('days_since_close', { ascending: false });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          reminders: reminders || []
        })
      };
    }

    // =================================================================
    // ACTION: Mark as Contacted (Update last_activity)
    // =================================================================
    if (action === 'mark-contacted') {
      const { dealId, notes } = body;

      if (!dealId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing dealId' })
        };
      }

      // Update last_activity to indicate contact was made
      const { data: deal, error } = await supabase
        .from('deals')
        .update({
          last_activity: new Date().toISOString()
        })
        .eq('id', dealId)
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Contact logged successfully',
          deal
        })
      };
    }

    // Unknown action
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `Unknown action: ${action}`,
        validActions: [
          'get-reminders',
          'get-overdue',
          'get-by-rep',
          'mark-contacted'
        ]
      })
    };

  } catch (error: any) {
    console.error('[RetentionReminders] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
