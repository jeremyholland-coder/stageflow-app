/**
 * Team Deal Assignment Function
 *
 * Endpoints:
 * - POST /assign-deal - Assign a single deal to a team member
 * - POST /assign-deals-bulk - Assign multiple deals at once
 * - POST /assign-auto - Auto-assign using round-robin
 * - GET /team-performance - Get team performance metrics
 * - GET /team-leaderboard - Get team rankings
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { notifyUser } from './lib/notifications-service';
// ENGINE REBUILD Phase 8: Use centralized CORS spine
import { getCorsOrigin } from './lib/cors';

export const handler = async (event: any) => {
  // ENGINE REBUILD Phase 8: Use centralized CORS config
  const requestOrigin = event.headers?.origin || '';
  const corsOrigin = getCorsOrigin(requestOrigin);

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-ID',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Correlation-ID',
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

    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action || 'assign-deal';
    const { organizationId } = body;

    // PHASE 11 CRITICAL FIX: Validate organizationId before auth check
    // requireOrgAccess would fail if org_id is missing and it tries to read body from dummy request
    if (!organizationId) {
      console.error('[assign-deals] Missing organizationId in request');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Organization ID is required' })
      };
    }

    // PHASE 9 CRITICAL FIX: ALWAYS require authentication
    // This was a CRITICAL VULNERABILITY - anyone could assign deals without auth!
    try {
      const request = new Request('https://dummy.com', {
        method: event.httpMethod,
        headers: event.headers
      });

      console.warn('[assign-deals] Authenticating user for org:', organizationId);
      const user = await requireAuth(request);
      console.warn('[assign-deals] Auth succeeded, user:', user.id);

      // PHASE 11 FIX: Verify membership directly instead of requireOrgAccess
      // The dummy Request has no body, so requireOrgAccess would fail trying to read org_id
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (memberError || !membership) {
        console.error('[assign-deals] User not in organization:', {
          userId: user.id,
          organizationId,
          error: memberError
        });
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Not authorized for this organization' })
        };
      }

      console.warn('[assign-deals] Membership verified, role:', membership.role);

      // PERMISSION POLICY: Any org member can assign deals to any other org member.
      // Cross-org assignment is prevented by:
      // 1. The membership check above (assigning user must be in org)
      // 2. The assignee check in each action (assignee must be in same org)
      // 3. The deal update query (deal must belong to same org)
    } catch (authError: any) {
      console.error('[assign-deals] Auth error:', {
        message: authError.message,
        code: authError.code
      });
      return createAuthErrorResponse(authError);
    }

    // =================================================================
    // ACTION: Assign Single Deal
    // =================================================================
    if (action === 'assign-deal') {
      const { dealId, assignedTo, assignedBy, organizationId, notes } = body;

      if (!dealId || !assignedTo || !organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required fields: dealId, assignedTo, organizationId'
          })
        };
      }

      // Verify team member exists in organization
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: workspace, error: workspaceError } = await supabase
        .from('team_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .eq('user_id', assignedTo)
        .single();

      if (workspaceError || !workspace) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'Team member not found in organization'
          })
        };
      }

      // Assign the deal
      const { data: deal, error: assignError } = await supabase
        .from('deals')
        .update({
          assigned_to: assignedTo,
          assigned_by: assignedBy || assignedTo,
          assigned_at: new Date().toISOString()
        })
        .eq('id', dealId)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (assignError) {
        throw assignError;
      }

      // Send notification to the assignee (non-blocking)
      // Only notify if assigning to someone else (not self-assignment)
      if (deal && assignedTo !== assignedBy) {
        try {
          // Get assigner's name for the notification
          const { data: assignerProfile } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('id', assignedBy || assignedTo)
            .single();

          const assignerName = assignerProfile?.full_name || 'A team member';

          console.warn('[assign-deals] Sending notification to assignee:', assignedTo);

          // Fire and forget - don't block the response
          notifyUser({
            userId: assignedTo,
            categoryCode: 'DEAL_ASSIGNED',
            data: {
              dealId: deal.id,
              dealName: deal.client || deal.company || 'Untitled Deal',
              amount: deal.value,
              assignedBy: assignedBy || assignedTo,
              assignedByName: assignerName
            }
          }).catch(err => {
            console.error('[assign-deals] Notification failed (non-fatal):', err.message);
          });
        } catch (notifyError: any) {
          // Non-fatal - log but don't fail the request
          console.warn('[assign-deals] Could not send notification:', notifyError.message);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Deal assigned successfully',
          deal
        })
      };
    }

    // =================================================================
    // ACTION: Bulk Assign Deals
    // =================================================================
    if (action === 'assign-deals-bulk') {
      const { dealIds, assignedTo, assignedBy, organizationId } = body;

      if (!dealIds || !Array.isArray(dealIds) || !assignedTo || !organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required fields: dealIds (array), assignedTo, organizationId'
          })
        };
      }

      // Verify team member
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: workspace, error: workspaceError } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('user_id', assignedTo)
        .single();

      if (workspaceError || !workspace) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'Team member not found in organization'
          })
        };
      }

      // Bulk assign
      const { data: deals, error: assignError } = await supabase
        .from('deals')
        .update({
          assigned_to: assignedTo,
          assigned_by: assignedBy || assignedTo,
          assigned_at: new Date().toISOString()
        })
        .in('id', dealIds)
        .eq('organization_id', organizationId)
        .select();

      if (assignError) {
        throw assignError;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `${deals?.length || 0} deals assigned successfully`,
          count: deals?.length || 0,
          deals
        })
      };
    }

    // =================================================================
    // ACTION: Auto-Assign (Round Robin)
    // =================================================================
    if (action === 'assign-auto') {
      const { dealId, organizationId } = body;

      if (!dealId || !organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required fields: dealId, organizationId'
          })
        };
      }

      // Use the round-robin function
      const { data, error } = await supabase.rpc('assign_deal_round_robin', {
        p_deal_id: dealId,
        p_organization_id: organizationId
      });

      if (error) {
        throw error;
      }

      // Get the updated deal
      const { data: deal } = await supabase
        .from('deals')
        .select('*')
        .eq('id', dealId)
        .single();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Deal auto-assigned successfully',
          assignedTo: data,
          deal
        })
      };
    }

    // =================================================================
    // ACTION: Get Team Performance
    // =================================================================
    if (action === 'team-performance') {
      const { organizationId } = body;

      if (!organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required field: organizationId'
          })
        };
      }

      const { data: performance, error: perfError } = await supabase
        .from('team_performance')
        .select('*')
        .eq('organization_id', organizationId)
        .order('won_value', { ascending: false });

      if (perfError) {
        throw perfError;
      }

      // Get user details from user_profiles (much faster than listUsers!)
      const teamMemberIds = performance?.map(p => p.team_member_id).filter(Boolean) || [];
      let userDetails = [];

      if (teamMemberIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, full_name, created_at')
          .in('id', teamMemberIds);

        userDetails = profiles || [];
      }

      // Merge performance with user details
      const enrichedPerformance = performance?.map(perf => {
        const user = userDetails.find(u => u.id === perf.team_member_id);
        return {
          ...perf,
          user: user || null
        };
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          performance: enrichedPerformance || []
        })
      };
    }

    // =================================================================
    // ACTION: Get Team Leaderboard
    // =================================================================
    if (action === 'team-leaderboard') {
      const { organizationId } = body;

      if (!organizationId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required field: organizationId'
          })
        };
      }

      const { data: leaderboard, error: leaderError } = await supabase
        .from('team_leaderboard')
        .select('*')
        .eq('organization_id', organizationId)
        .order('revenue_this_month', { ascending: false });

      if (leaderError) {
        throw leaderError;
      }

      // Get user details from user_profiles (much faster than listUsers!)
      const teamMemberIds = leaderboard?.map(l => l.team_member_id).filter(Boolean) || [];
      let userDetails = [];

      if (teamMemberIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, full_name, created_at')
          .in('id', teamMemberIds);

        userDetails = profiles || [];
      }

      // Merge leaderboard with user details
      const enrichedLeaderboard = leaderboard?.map(entry => {
        const user = userDetails.find(u => u.id === entry.team_member_id);
        return {
          ...entry,
          user: user || null
        };
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          leaderboard: enrichedLeaderboard || []
        })
      };
    }

    // =================================================================
    // ACTION: Get Assignment History
    // =================================================================
    if (action === 'assignment-history') {
      const { dealId } = body;

      if (!dealId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing required field: dealId'
          })
        };
      }

      const { data: history, error: historyError } = await supabase
        .from('deal_assignment_history')
        .select('*')
        .eq('deal_id', dealId)
        .order('assigned_at', { ascending: false });

      if (historyError) {
        throw historyError;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          history: history || []
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
          'assign-deal',
          'assign-deals-bulk',
          'assign-auto',
          'team-performance',
          'team-leaderboard',
          'assignment-history'
        ]
      })
    };

  } catch (error: any) {
    console.error('[AssignDeals] Error:', error);
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
