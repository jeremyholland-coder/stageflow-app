/**
 * Fix Demo Account - Comprehensive Pipeline Setup
 *
 * This function:
 * 1. Recovers orphaned deals (invalid stages)
 * 2. Redistributes deals across pipeline stages realistically
 * 3. Adds variety and historical data for demo purposes
 *
 * Usage: POST to /.netlify/functions/fix-demo-account
 * Body: { "email": "stageflow@startupstage.com" }
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email required' })
      };
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 5: Add authentication to admin demo fix function
    if (shouldUseNewAuth('fix-demo-account')) {
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
          method: 'POST',
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

    console.log('[DemoFix] Starting demo account fix for:', email);

    // 1. Find user and organization
    const { data: authUsers, error: userError } = await supabase.auth.admin.listUsers();

    if (userError) {
      throw new Error(`Failed to fetch users: ${userError.message}`);
    }

    const user = authUsers.users.find(u => u.email === email);

    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
    const { data: workspace, error: workspaceError } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (workspaceError || !workspace) {
      throw new Error('Organization not found for user');
    }

    const orgId = workspace.organization_id;
    console.log('[DemoFix] Found organization:', orgId);

    // 2. Get current pipeline template
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('pipeline_template')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      throw new Error('Failed to fetch organization details');
    }

    const pipelineTemplate = org.pipeline_template || 'professional_services';
    console.log('[DemoFix] Pipeline template:', pipelineTemplate);

    // 3. Define stage mapping for each template
    const stageMapping: Record<string, Record<string, string>> = {
      professional_services: {
        'lead': 'lead_identified',
        'qualified': 'lead_qualified',
        'proposal': 'proposal_sent',
        'negotiation': 'negotiation',
        'won': 'closed_won',
        'lost': 'deal_lost',
        'discovery': 'discovery',
        'scope': 'scope_defined',
        'contract': 'contract_sent'
      },
      healthcare: {
        'lead': 'lead_generation',
        'qualified': 'lead_qualification',
        'proposal': 'proposal_sent',
        'negotiation': 'negotiation',
        'won': 'deal_won',
        'lost': 'deal_lost',
        'discovery': 'discovery',
        'scope': 'scope_defined',
        'contract': 'contract_sent'
      },
      vc_pe: {
        'lead': 'deal_sourced',
        'qualified': 'initial_screening',
        'proposal': 'term_sheet_presented',
        'negotiation': 'negotiation',
        'won': 'investment_closed',
        'lost': 'deal_lost',
        'discovery': 'due_diligence',
        'scope': 'due_diligence',
        'contract': 'term_sheet_presented'
      },
      real_estate: {
        'lead': 'lead_captured',
        'qualified': 'qualification',
        'proposal': 'property_showing',
        'negotiation': 'negotiation',
        'won': 'contract_signed',
        'lost': 'deal_lost',
        'discovery': 'qualification',
        'scope': 'property_showing',
        'contract': 'contract_signed'
      }
    };

    const mapping = stageMapping[pipelineTemplate] || stageMapping.professional_services;

    // 4. Get all deals for this organization
    const { data: allDeals, error: dealsError } = await supabase
      .from('deals')
      .select('*')
      .eq('organization_id', orgId);

    if (dealsError) {
      throw new Error('Failed to fetch deals');
    }

    console.log('[DemoFix] Found', allDeals?.length || 0, 'total deals');

    if (!allDeals || allDeals.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No deals found to fix',
          stats: { total: 0, fixed: 0, redistributed: 0 }
        })
      };
    }

    // 5. Define valid stages for the current template
    const validStages: Record<string, string[]> = {
      professional_services: [
        'lead_identified', 'lead_qualified', 'discovery', 'scope_defined',
        'proposal_sent', 'contract_sent', 'negotiation', 'closed_won',
        'deal_lost', 'invoice_sent', 'payment_received', 'retention'
      ],
      healthcare: [
        'lead_generation', 'lead_qualification', 'discovery', 'scope_defined',
        'proposal_sent', 'contract_sent', 'negotiation', 'deal_won',
        'deal_lost', 'invoice_sent', 'payment_received', 'client_onboarding',
        'renewal_upsell'
      ],
      vc_pe: [
        'deal_sourced', 'initial_screening', 'due_diligence',
        'term_sheet_presented', 'negotiation', 'investment_closed',
        'capital_call_sent', 'capital_received', 'portfolio_mgmt'
      ],
      real_estate: [
        'lead_captured', 'qualification', 'property_showing', 'negotiation',
        'contract_signed', 'deal_lost', 'closing_statement_sent',
        'escrow_completed', 'client_followup'
      ]
    };

    const stages = validStages[pipelineTemplate] || validStages.professional_services;

    // 6. Recover orphaned deals
    const orphanedDeals = allDeals.filter(deal => !stages.includes(deal.stage));
    console.log('[DemoFix] Found', orphanedDeals.length, 'orphaned deals');

    let fixedCount = 0;
    for (const deal of orphanedDeals) {
      // Try to map to valid stage
      let newStage = mapping[deal.stage] || mapping['qualified'] || stages[1];

      // Make sure status matches stage
      let newStatus = 'active';
      if (newStage.includes('won') || newStage.includes('closed_won') ||
          newStage.includes('investment_closed') || newStage.includes('contract_signed') ||
          newStage.includes('payment_received') || newStage.includes('capital_received')) {
        newStatus = 'won';
      } else if (newStage.includes('lost')) {
        newStatus = 'lost';
      }

      await supabase
        .from('deals')
        .update({
          stage: newStage,
          status: newStatus,
          last_activity: new Date().toISOString()
        })
        .eq('id', deal.id);

      fixedCount++;
    }

    console.log('[DemoFix] Fixed', fixedCount, 'orphaned deals');

    // 7. Fetch updated deals
    const { data: updatedDeals, error: fetchError } = await supabase
      .from('deals')
      .select('*')
      .eq('organization_id', orgId);

    if (fetchError || !updatedDeals) {
      throw new Error('Failed to fetch updated deals');
    }

    // 8. Realistic distribution percentages for active pipeline
    // Based on typical B2B SaaS funnel conversion rates
    const stageDistribution: Record<string, number> = {
      // Early stage (40% of active deals)
      0: 0.15,  // Lead identified/generated
      1: 0.12,  // Qualified
      2: 0.08,  // Discovery/screening
      3: 0.05,  // Scope defined

      // Mid stage (35% of active deals)
      4: 0.12,  // Proposal sent
      5: 0.10,  // Contract sent
      6: 0.13,  // Negotiation (largest active stage)

      // End stage (25% of deals)
      7: 0.15,  // Won (15%)
      8: 0.10,  // Lost (10%)
    };

    // 9. Redistribute deals across stages
    const activeDeals = updatedDeals.filter(d => d.status === 'active');
    const wonDeals = updatedDeals.filter(d => d.status === 'won');
    const lostDeals = updatedDeals.filter(d => d.status === 'lost');

    // Shuffle deals for random distribution
    const shuffled = [...activeDeals].sort(() => Math.random() - 0.5);

    let redistributedCount = 0;
    let currentIndex = 0;

    // Distribute active deals across active stages
    for (let i = 0; i < stages.length - 2; i++) {  // -2 to exclude won/lost stages
      const stage = stages[i];
      const percentage = stageDistribution[i] || 0.05;
      const count = Math.floor(shuffled.length * percentage);

      for (let j = 0; j < count && currentIndex < shuffled.length; j++) {
        const deal = shuffled[currentIndex];

        // Add time variety (last 12 months)
        const daysAgo = Math.floor(Math.random() * 365);
        const createdDate = new Date();
        createdDate.setDate(createdDate.getDate() - daysAgo);

        const lastActivityDate = new Date(createdDate);
        lastActivityDate.setDate(lastActivityDate.getDate() + Math.floor(Math.random() * daysAgo));

        await supabase
          .from('deals')
          .update({
            stage,
            status: 'active',
            created: createdDate.toISOString(),
            last_activity: lastActivityDate.toISOString()
          })
          .eq('id', deal.id);

        redistributedCount++;
        currentIndex++;
      }
    }

    // 10. Distribute won/lost deals with historical dates
    const wonStage = stages.find(s =>
      s.includes('won') || s.includes('closed_won') ||
      s.includes('investment_closed') || s.includes('contract_signed')
    ) || stages[stages.length - 2];

    const lostStage = stages.find(s => s.includes('lost')) || stages[stages.length - 1];

    // Distribute remaining active deals to won/lost
    const remaining = shuffled.slice(currentIndex);
    const wonCount = Math.floor(remaining.length * 0.6); // 60% won, 40% lost

    for (let i = 0; i < remaining.length; i++) {
      const deal = remaining[i];
      const isWon = i < wonCount;
      const stage = isWon ? wonStage : lostStage;
      const status = isWon ? 'won' : 'lost';

      // Historical dates (3-12 months ago)
      const monthsAgo = 3 + Math.floor(Math.random() * 9);
      const closedDate = new Date();
      closedDate.setMonth(closedDate.getMonth() - monthsAgo);

      const createdDate = new Date(closedDate);
      createdDate.setMonth(createdDate.getMonth() - 2); // 2 months sales cycle

      await supabase
        .from('deals')
        .update({
          stage,
          status,
          created: createdDate.toISOString(),
          last_activity: closedDate.toISOString(),
          close_date: closedDate.toISOString()
        })
        .eq('id', deal.id);

      redistributedCount++;
    }

    // Also update existing won/lost deals with proper dates
    for (const deal of [...wonDeals, ...lostDeals]) {
      const monthsAgo = 1 + Math.floor(Math.random() * 11);
      const closedDate = new Date();
      closedDate.setMonth(closedDate.getMonth() - monthsAgo);

      const createdDate = new Date(closedDate);
      createdDate.setMonth(createdDate.getMonth() - 2);

      // Make sure stage matches status
      const correctStage = deal.status === 'won' ? wonStage : lostStage;

      await supabase
        .from('deals')
        .update({
          stage: correctStage,
          created: createdDate.toISOString(),
          last_activity: closedDate.toISOString(),
          close_date: closedDate.toISOString()
        })
        .eq('id', deal.id);

      redistributedCount++;
    }

    console.log('[DemoFix] Redistributed', redistributedCount, 'deals');

    // 11. Get final stats
    const { data: finalDeals } = await supabase
      .from('deals')
      .select('stage, status')
      .eq('organization_id', orgId);

    const stageCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = { active: 0, won: 0, lost: 0 };

    finalDeals?.forEach(deal => {
      stageCounts[deal.stage] = (stageCounts[deal.stage] || 0) + 1;
      statusCounts[deal.status] = (statusCounts[deal.status] || 0) + 1;
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Demo account fixed successfully for ${email}`,
        stats: {
          totalDeals: finalDeals?.length || 0,
          orphanedFixed: fixedCount,
          redistributed: redistributedCount,
          byStatus: statusCounts,
          byStage: stageCounts
        },
        pipelineTemplate
      })
    };

  } catch (error: any) {
    console.error('[DemoFix] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to fix demo account',
        details: error.message
      })
    };
  }
};
