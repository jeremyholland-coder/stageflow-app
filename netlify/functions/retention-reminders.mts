/**
 * Retention Reminders API
 *
 * Manages customer retention follow-ups based on closed_date
 * Automatically suggests touchpoints: 2 weeks, 1 month, 90 days, quarterly
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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

      // SECURITY: Feature-flagged authentication migration
      // Phase 4 Batch 4: Prevent user impersonation + validate org access
      if (shouldUseNewAuth('retention-reminders', organizationId)) {
        try {
          // NEW AUTH PATH: Validate session and organization membership
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
          await requireOrgAccess(request, organizationId);

          // User is authenticated and authorized
        } catch (authError) {
          const errorResponse = createAuthErrorResponse(authError);
          return {
            statusCode: errorResponse.status,
            body: await errorResponse.text()
          };
        }
      }
      // LEGACY AUTH PATH: No validation (CRITICAL VULNERABILITY - will be removed after migration)

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

      // SECURITY: Feature-flagged authentication (same as get-reminders)
      if (shouldUseNewAuth('retention-reminders', organizationId)) {
        try {
          const authHeader = event.headers.authorization || event.headers.Authorization;
          if (!authHeader) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };
          }

          const request = new Request('https://dummy.com', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
          });

          await requireAuth(request);
          await requireOrgAccess(request, organizationId);
        } catch (authError) {
          const errorResponse = createAuthErrorResponse(authError);
          return { statusCode: errorResponse.status, body: await errorResponse.text() };
        }
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

      // SECURITY: Feature-flagged authentication (same as get-reminders)
      if (shouldUseNewAuth('retention-reminders', organizationId)) {
        try {
          const authHeader = event.headers.authorization || event.headers.Authorization;
          if (!authHeader) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Authentication required' }) };
          }

          const request = new Request('https://dummy.com', {
            method: 'POST',
            headers: { 'Authorization': authHeader }
          });

          await requireAuth(request);
          await requireOrgAccess(request, organizationId);
        } catch (authError) {
          const errorResponse = createAuthErrorResponse(authError);
          return { statusCode: errorResponse.status, body: await errorResponse.text() };
        }
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
