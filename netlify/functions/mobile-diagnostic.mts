import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './lib/validate-config';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { requireDebugMode, createDebugDisabledResponse } from './lib/debug-mode';

/**
 * Mobile Diagnostic Endpoint (DEBUG ONLY)
 * Tests organization setup flow step-by-step to identify failures
 * Call from mobile browser console to debug setup issues
 *
 * SECURITY: Only available when ENABLE_DEBUG_ENDPOINTS=true
 */
export default async (req: Request, context: Context) => {
  // SECURITY: Block access in production unless debug mode enabled
  try {
    requireDebugMode();
  } catch (error) {
    return createDebugDisabledResponse();
  }


  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    userAgent: req.headers.get('user-agent'),
    steps: [],
    errors: [],
    warnings: []
  };

  try {
    let user: any;
    let supabase: any;

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 6: Centralize authentication for diagnostic endpoint
    if (shouldUseNewAuth('mobile-diagnostic')) {
      try {
        // NEW AUTH PATH: Use centralized authentication
        user = await requireAuth(req);
        diagnostics.steps.push({
          step: 1,
          name: 'Authentication (centralized)',
          status: 'passed',
          userId: user.id,
          userEmail: user.email
        });

        const supabaseConfig = getSupabaseConfig();
        supabase = createClient(
          supabaseConfig.url,
          supabaseConfig.serviceRoleKey || supabaseConfig.anonKey
        );
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    } else {
      // LEGACY AUTH PATH: Inline authentication
      // Step 1: Check authorization header
      diagnostics.steps.push({ step: 1, name: 'Check authorization header', status: 'running' });
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        diagnostics.steps[0].status = 'failed';
        diagnostics.errors.push('Missing Authorization header');
        return new Response(JSON.stringify(diagnostics), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      diagnostics.steps[0].status = 'passed';
      diagnostics.steps[0].hasToken = true;

      // Step 2: Parse request body
      diagnostics.steps.push({ step: 2, name: 'Parse request body', status: 'running' });
      let body;
      try {
        body = await req.json();
      } catch (e: any) {
        diagnostics.steps[1].status = 'failed';
        diagnostics.errors.push(`JSON parse failed: ${e.message}`);
        return new Response(JSON.stringify(diagnostics), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      diagnostics.steps[1].status = 'passed';

      // Step 3: Validate Supabase config
      diagnostics.steps.push({ step: 3, name: 'Validate Supabase config', status: 'running' });
      let supabaseConfig;
      try {
        supabaseConfig = getSupabaseConfig();
        diagnostics.steps[2].status = 'passed';
        diagnostics.steps[2].hasUrl = !!supabaseConfig.url;
        diagnostics.steps[2].hasServiceKey = !!supabaseConfig.serviceRoleKey;
        diagnostics.steps[2].hasAnonKey = !!supabaseConfig.anonKey;
      } catch (error: any) {
        diagnostics.steps[2].status = 'failed';
        diagnostics.errors.push(`Config error: ${error.message}`);
        return new Response(JSON.stringify(diagnostics), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Step 4: Create Supabase client
      diagnostics.steps.push({ step: 4, name: 'Create Supabase client', status: 'running' });
      supabase = createClient(
        supabaseConfig.url,
        supabaseConfig.serviceRoleKey || supabaseConfig.anonKey
      );
      diagnostics.steps[3].status = 'passed';

      // Step 5: Verify user from token
      diagnostics.steps.push({ step: 5, name: 'Verify user from token', status: 'running' });
      const token = authHeader.replace('Bearer ', '');
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !authUser) {
        diagnostics.steps[4].status = 'failed';
        diagnostics.errors.push(`User verification failed: ${userError?.message || 'No user'}`);
        return new Response(JSON.stringify(diagnostics), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      user = authUser;
      diagnostics.steps[4].status = 'passed';
      diagnostics.steps[4].userId = user.id;
      diagnostics.steps[4].userEmail = user.email;
    }

    // Step 6: Check existing workspace
    diagnostics.steps.push({ step: 6, name: 'Check existing workspace', status: 'running' });
    // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
    const { data: existingWorkspace, error: workspaceError } = await supabase
      .from('team_members')
      .select('organization_id, role, organizations(*)')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (workspaceError) {
      diagnostics.warnings.push(`Workspace query error: ${workspaceError.message}`);
      diagnostics.steps[5].status = 'warning';
      diagnostics.steps[5].error = workspaceError.message;
      diagnostics.steps[5].code = workspaceError.code;
    } else {
      diagnostics.steps[5].status = 'passed';
      diagnostics.steps[5].hasExisting = !!existingWorkspace;
      if (existingWorkspace) {
        diagnostics.steps[5].organizationId = existingWorkspace.organization_id;
        diagnostics.steps[5].role = existingWorkspace.role;
        diagnostics.steps[5].organizationName = existingWorkspace.organizations?.name;
      }
    }

    // Step 7: Test RPC function (if no existing workspace)
    if (!existingWorkspace) {
      diagnostics.steps.push({ step: 7, name: 'Test setup_organization_atomic RPC', status: 'running' });
      const rpcStartTime = Date.now();

      const { data: rpcData, error: rpcError } = await supabase.rpc('setup_organization_atomic', {
        p_user_id: user.id,
        p_email: user.email
      });

      const rpcDuration = Date.now() - rpcStartTime;
      diagnostics.steps[6].duration = `${rpcDuration}ms`;

      if (rpcError) {
        diagnostics.steps[6].status = 'failed';
        diagnostics.errors.push(`RPC failed: ${rpcError.message}`);
        diagnostics.steps[6].error = {
          message: rpcError.message,
          code: rpcError.code,
          details: rpcError.details,
          hint: rpcError.hint
        };
        return new Response(JSON.stringify(diagnostics), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      diagnostics.steps[6].status = 'passed';
      diagnostics.steps[6].organizationId = rpcData?.organization_id;
      diagnostics.steps[6].role = rpcData?.role;

      // Step 8: Verify organization was created
      diagnostics.steps.push({ step: 8, name: 'Verify organization created', status: 'running' });
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('id, name, plan')
        .eq('id', rpcData.organization_id)
        .single();

      if (orgError) {
        diagnostics.steps[7].status = 'failed';
        diagnostics.errors.push(`Organization fetch failed: ${orgError.message}`);
        diagnostics.steps[7].error = orgError.message;
      } else {
        diagnostics.steps[7].status = 'passed';
        diagnostics.steps[7].organization = org;
      }
    } else {
      diagnostics.steps.push({
        step: 7,
        name: 'Skip RPC (existing workspace)',
        status: 'skipped',
        reason: 'User already has workspace'
      });
    }

    // Success summary
    diagnostics.success = true;
    diagnostics.summary = existingWorkspace
      ? 'User already has workspace - no setup needed'
      : 'Organization setup completed successfully';

    return new Response(JSON.stringify(diagnostics), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    diagnostics.success = false;
    diagnostics.errors.push(`Unexpected error: ${error.message}`);
    diagnostics.stack = error.stack;

    return new Response(JSON.stringify(diagnostics), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
