/**
 * Find Demo User - Diagnostic function to identify the demo account
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  try {
    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 5: Add authentication to admin diagnostic function
    if (shouldUseNewAuth('find-demo-user')) {
      try {
        // NEW AUTH PATH: Require authentication for admin operations
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader) {
          return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authentication required' })
          };
        }

        const request = new Request('https://dummy.com', {
          method: 'GET',
          headers: { 'Authorization': authHeader }
        });

        await requireAuth(request);

        // Admin operation authenticated
      } catch (authError) {
        const errorResponse = createAuthErrorResponse(authError);
        return {
          statusCode: errorResponse.status,
          body: await errorResponse.text()
        };
      }
    }
    // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find all users with email containing 'stageflow' or 'startupstage'
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      throw authError;
    }

    const filteredUsers = authUsers.users.filter(user =>
      user.email?.toLowerCase().includes('stageflow') ||
      user.email?.toLowerCase().includes('startupstage')
    );

    const users = filteredUsers.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at
    }));

    // Get organization info for each user
    const usersWithOrgs = await Promise.all(
      (users || []).map(async (user) => {
        // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
        const { data: workspace } = await supabase
          .from('team_members')
          .select('organization_id')
          .eq('user_id', user.id)
          .single();

        if (workspace) {
          const { data: deals } = await supabase
            .from('deals')
            .select('id, stage, status')
            .eq('organization_id', workspace.organization_id);

          const orphaned = deals?.filter(d =>
            !['lead_identified', 'lead_qualified', 'discovery', 'scope_defined',
              'proposal_sent', 'contract_sent', 'negotiation', 'closed_won',
              'deal_lost', 'invoice_sent', 'payment_received', 'retention',
              'lead_generation', 'lead_qualification', 'deal_won',
              'client_onboarding', 'renewal_upsell'].includes(d.stage)
          ).length || 0;

          return {
            ...user,
            organizationId: workspace.organization_id,
            totalDeals: deals?.length || 0,
            orphanedDeals: orphaned,
            dealsByStatus: {
              active: deals?.filter(d => d.status === 'active').length || 0,
              won: deals?.filter(d => d.status === 'won').length || 0,
              lost: deals?.filter(d => d.status === 'lost').length || 0
            }
          };
        }

        return { ...user, organizationId: null, totalDeals: 0, orphanedDeals: 0 };
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: usersWithOrgs.length,
        users: usersWithOrgs
      }, null, 2)
    };

  } catch (error: any) {
    console.error('Error finding demo user:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to find demo user',
        details: error.message
      })
    };
  }
};
