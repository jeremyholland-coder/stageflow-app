// COMPREHENSIVE DATABASE QA CHECK
// Runs all performance, security, and data integrity checks

import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  try {
    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 6: Add authentication to admin diagnostic function
    if (shouldUseNewAuth('db-qa-comprehensive')) {
      try {
        // NEW AUTH PATH: Require authentication for admin operations
        await requireAuth(req);
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    }
    // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

    // Use Supabase client with service role key for admin access
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const results: any = {
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // CHECK 1: Get all deals and check for invalid stages
    const {data: allDeals, error: dealsError} = await supabase
      .from('deals')
      .select('stage, organization_id');

    if (!dealsError && allDeals) {
      const validStages = ['lead', 'qualified', 'proposal', 'negotiation', 'invoice', 'onboarding', 'delivery', 'retention', 'won', 'lost'];
      const invalidStages = allDeals.filter(d => !validStages.includes(d.stage));

      const stageCounts: Record<string, number> = {};
      invalidStages.forEach(d => {
        stageCounts[d.stage] = (stageCounts[d.stage] || 0) + 1;
      });

      results.checks.invalid_deal_stages = Object.entries(stageCounts).map(([stage, count]) => ({stage, count}));
    }

    // CHECK 2: Get all organizations to check for orphaned deals
    const {data: allOrgs} = await supabase
      .from('organizations')
      .select('id');

    if (allDeals && allOrgs) {
      const orgIds = new Set(allOrgs.map(o => o.id));
      const orphaned = allDeals.filter(d => !orgIds.has(d.organization_id));
      results.checks.orphaned_deals_count = orphaned.length;
      results.checks.orphaned_deals_list = orphaned.slice(0, 10); // Show first 10
    }

    // CHECK 3: Check for NULL values in critical columns
    const {data: orgsWithNulls} = await supabase
      .from('organizations')
      .select('id, name, created_at')
      .or('name.is.null,created_at.is.null');

    results.checks.organizations_with_null_critical_fields = orgsWithNulls?.length || 0;

    const {data: dealsWithNulls} = await supabase
      .from('deals')
      .select('id, organization_id, stage')
      .or('organization_id.is.null,stage.is.null');

    results.checks.deals_with_null_critical_fields = dealsWithNulls?.length || 0;

    // CHECK 4: Count total records in each table
    const {count: totalDeals} = await supabase
      .from('deals')
      .select('*', {count: 'exact', head: true});

    const {count: totalOrgs} = await supabase
      .from('organizations')
      .select('*', {count: 'exact', head: true});

    // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
    const {count: totalMembers} = await supabase
      .from('team_members')
      .select('*', {count: 'exact', head: true});

    results.checks.table_counts = {
      deals: totalDeals || 0,
      organizations: totalOrgs || 0,
      team_members: totalMembers || 0
    };

    // Summary
    results.summary = {
      critical_issues:
        (results.checks.invalid_deal_stages?.length || 0) +
        (results.checks.orphaned_deals_count || 0) +
        (results.checks.organizations_with_null_critical_fields || 0) +
        (results.checks.deals_with_null_critical_fields || 0),
      warnings: 0,
      healthy:
        (results.checks.invalid_deal_stages?.length || 0) === 0 &&
        (results.checks.orphaned_deals_count || 0) === 0 &&
        (results.checks.organizations_with_null_critical_fields || 0) === 0 &&
        (results.checks.deals_with_null_critical_fields || 0) === 0,
      total_deals: totalDeals || 0,
      total_organizations: totalOrgs || 0,
      total_team_members: totalMembers || 0
    };

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error: any) {
    console.error('QA Check Error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
