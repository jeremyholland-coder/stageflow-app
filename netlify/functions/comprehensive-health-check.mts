/**
 * COMPREHENSIVE HEALTH CHECK
 *
 * Run this systematically to catch issues before users report them
 * Tests: Database, RLS, API endpoints, duplicates, performance
 *
 * Usage:
 * - Netlify: /.netlify/functions/comprehensive-health-check
 * - CLI: node scripts/run-health-check.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface HealthCheckResult {
  test: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
  fix?: string;
}

export const handler = async (event: any) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 6: Add authentication to admin diagnostic function
  if (shouldUseNewAuth('comprehensive-health-check')) {
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
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

  const results: HealthCheckResult[] = [];

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log('🏥 Starting Comprehensive Health Check...');

  // TEST 1: Database Connectivity
  try {
    const { error } = await supabase.from('organizations').select('count').limit(1);
    if (error) throw error;
    results.push({
      test: 'Database Connectivity',
      status: 'pass',
      message: 'Database is reachable'
    });
  } catch (error: any) {
    results.push({
      test: 'Database Connectivity',
      status: 'fail',
      message: 'Cannot connect to database',
      details: error.message,
      fix: 'Check Supabase status and credentials'
    });
  }

  // TEST 2: All Users Have Organizations
  try {
    const { data: users } = await supabase.auth.admin.listUsers();
    const orphanedUsers = [];

    for (const user of users.users) {
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: workspace } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single();

      if (!workspace) {
        orphanedUsers.push(user.email);
      }
    }

    if (orphanedUsers.length === 0) {
      results.push({
        test: 'User-Organization Binding',
        status: 'pass',
        message: `All ${users.users.length} users have organizations`
      });
    } else {
      results.push({
        test: 'User-Organization Binding',
        status: 'fail',
        message: `${orphanedUsers.length} users have no organization`,
        details: orphanedUsers,
        fix: 'Run: node scripts/fix-orphaned-users.mjs'
      });
    }
  } catch (error: any) {
    results.push({
      test: 'User-Organization Binding',
      status: 'fail',
      message: 'Failed to check user-org binding',
      details: error.message
    });
  }

  // TEST 3: Check for Orphaned Deals
  try {
    const { data: orphanedDeals } = await supabase
      .from('deals')
      .select('id')
      .is('organization_id', null);

    if (!orphanedDeals || orphanedDeals.length === 0) {
      results.push({
        test: 'Orphaned Deals',
        status: 'pass',
        message: 'No deals without organization_id'
      });
    } else {
      results.push({
        test: 'Orphaned Deals',
        status: 'fail',
        message: `${orphanedDeals.length} deals have no organization`,
        details: { count: orphanedDeals.length },
        fix: 'Run: node scripts/fix-orphaned-deals.mjs'
      });
    }
  } catch (error: any) {
    results.push({
      test: 'Orphaned Deals',
      status: 'fail',
      message: 'Failed to check orphaned deals',
      details: error.message
    });
  }

  // TEST 4: RLS Policies on Critical Tables
  // Uses custom check_rls_status() function to query system catalogs
  try {
    const { data: rlsStatus, error } = await supabase.rpc('check_rls_status');

    if (error) {
      // Function doesn't exist yet - provide guidance
      results.push({
        test: 'RLS Check Function',
        status: 'warn',
        message: 'RLS check function not installed',
        details: error.message,
        fix: 'Run migration: supabase/migrations/20250113_create_rls_check_function.sql'
      });
    } else if (rlsStatus && rlsStatus.length > 0) {
      // Process each table's RLS status
      for (const table of rlsStatus) {
        if (table.rls_enabled && table.policy_count > 0) {
          results.push({
            test: `RLS: ${table.tablename}`,
            status: 'pass',
            message: `RLS enabled on ${table.tablename} (${table.policy_count} policies)`
          });
        } else if (table.rls_enabled && table.policy_count === 0) {
          results.push({
            test: `RLS: ${table.tablename}`,
            status: 'fail',
            message: `RLS enabled but no policies on ${table.tablename}`,
            fix: 'Create RLS policies for this table'
          });
        } else {
          results.push({
            test: `RLS: ${table.tablename}`,
            status: 'fail',
            message: `RLS disabled on ${table.tablename}`,
            fix: `Run: ALTER TABLE ${table.tablename} ENABLE ROW LEVEL SECURITY;`
          });
        }
      }
    } else {
      results.push({
        test: 'RLS Status',
        status: 'warn',
        message: 'No RLS status data returned',
        fix: 'Check if check_rls_status() function is working'
      });
    }
  } catch (error: any) {
    results.push({
      test: 'RLS Status',
      status: 'warn',
      message: 'Failed to check RLS status',
      details: error.message
    });
  }

  // TEST 5: Check for Duplicate Deals
  try {
    const { data: deals } = await supabase
      .from('deals')
      .select('client, email, organization_id');

    if (deals) {
      const seen = new Map();
      const duplicates = [];

      for (const deal of deals) {
        const key = `${deal.client}_${deal.email}_${deal.organization_id}`;
        if (seen.has(key)) {
          duplicates.push(deal);
        } else {
          seen.set(key, deal);
        }
      }

      if (duplicates.length === 0) {
        results.push({
          test: 'Duplicate Deals',
          status: 'pass',
          message: 'No duplicate deals found'
        });
      } else {
        results.push({
          test: 'Duplicate Deals',
          status: 'warn',
          message: `${duplicates.length} potential duplicates`,
          details: { count: duplicates.length },
          fix: 'Review and manually deduplicate'
        });
      }
    }
  } catch (error: any) {
    results.push({
      test: 'Duplicate Deals',
      status: 'warn',
      message: 'Failed to check duplicates',
      details: error.message
    });
  }

  // TEST 6: Performance Check - Query Speed
  try {
    const start = Date.now();
    await supabase.from('deals').select('id').limit(100);
    const duration = Date.now() - start;

    if (duration < 500) {
      results.push({
        test: 'Query Performance',
        status: 'pass',
        message: `Queries fast (${duration}ms)`
      });
    } else if (duration < 2000) {
      results.push({
        test: 'Query Performance',
        status: 'warn',
        message: `Queries slow (${duration}ms)`,
        fix: 'Check database indexes'
      });
    } else {
      results.push({
        test: 'Query Performance',
        status: 'fail',
        message: `Queries very slow (${duration}ms)`,
        fix: 'Add indexes or upgrade database'
      });
    }
  } catch (error: any) {
    results.push({
      test: 'Query Performance',
      status: 'fail',
      message: 'Performance check failed',
      details: error.message
    });
  }

  // TEST 7: Demo Account Integrity
  try {
    const { data: users } = await supabase.auth.admin.listUsers();
    const demoUser = users.users.find((u: any) => u.email === 'stageflow@startupstage.com');

    if (demoUser) {
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: workspace } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', demoUser.id)
        .single();

      if (workspace) {
        const { data: deals } = await supabase
          .from('deals')
          .select('id')
          .eq('organization_id', workspace.organization_id);

        if (deals && deals.length >= 200) {
          results.push({
            test: 'Demo Account',
            status: 'pass',
            message: `Demo has ${deals.length} deals`
          });
        } else {
          results.push({
            test: 'Demo Account',
            status: 'fail',
            message: `Demo only has ${deals?.length || 0} deals (expected 241)`,
            fix: 'Regenerate demo data'
          });
        }
      } else {
        results.push({
          test: 'Demo Account',
          status: 'fail',
          message: 'Demo user has no organization',
          fix: 'Run: node scripts/fix-demo-account.mjs'
        });
      }
    }
  } catch (error: any) {
    results.push({
      test: 'Demo Account',
      status: 'warn',
      message: 'Cannot check demo account',
      details: error.message
    });
  }

  // TEST 8: API Keys RLS
  try {
    const { data: keys, error } = await supabase
      .from('api_keys')
      .select('id')
      .limit(1);

    results.push({
      test: 'API Keys Table',
      status: 'pass',
      message: 'API keys table accessible'
    });
  } catch (error: any) {
    results.push({
      test: 'API Keys Table',
      status: 'fail',
      message: 'Cannot query api_keys',
      details: error.message,
      fix: 'Apply RLS policies for api_keys'
    });
  }

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warn').length;
  const total = results.length;

  const summary = {
    timestamp: new Date().toISOString(),
    total_tests: total,
    passed,
    failed,
    warnings,
    health_score: Math.round((passed / total) * 100),
    status: failed === 0 ? (warnings === 0 ? 'healthy' : 'degraded') : 'unhealthy',
    results
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary, null, 2)
  };
};
