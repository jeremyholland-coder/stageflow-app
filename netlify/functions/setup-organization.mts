import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { createErrorResponse, sanitizeError } from './lib/error-sanitizer';
import { getSupabaseConfig } from './lib/validate-config';
import { withTimeout, TIMEOUTS, safeRequestJson } from './lib/timeout-wrapper';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, validateUserIdMatch, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {

    // CRITICAL FIX: Safe JSON parsing with timeout
    let body;
    try {
      body = await safeRequestJson(req);
    } catch (e: any) {
      console.error('❌ JSON parsing failed:', e.message);
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { userId, email } = body;

    if (!userId || !email) {
      console.error('❌ Missing params:', { userId, email });
      return new Response(JSON.stringify({ error: 'Missing userId or email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DEFENSE IN DEPTH: Redundant authentication check
    // This provides a safety net if feature flags are accidentally disabled.
    // Critical endpoints like setup-organization ALWAYS require authentication,
    // regardless of ENABLE_AUTH_MIDDLEWARE setting.
    //
    // Rationale: Organization setup is a privileged operation that creates
    // database records and grants permissions. User impersonation here would
    // allow attackers to create organizations under victim accounts.
    try {
      const user = await requireAuth(req);
      await validateUserIdMatch(user, userId);
    } catch (redundantAuthError) {
      // If redundant check fails, ALWAYS block the request
      console.error('❌ Redundant auth check failed (feature flags may be disabled)');
      return createAuthErrorResponse(redundantAuthError);
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4: Gradually enable new auth middleware
    // Note: The redundant check above makes this redundant, but we keep it for
    // consistency with other endpoints during the migration phase.
    if (shouldUseNewAuth('setup-organization', userId)) {
      try {
        // NEW AUTH PATH: Validate session and prevent user impersonation
        const user = await requireAuth(req);
        await validateUserIdMatch(user, userId);

        // User is authenticated and userId matches session - proceed with setup
        // (rest of logic continues below with authenticated user.id)
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    }
    // LEGACY AUTH PATH: No validation (VULNERABLE - will be removed after migration)

    // Get validated Supabase configuration
    let supabaseConfig;
    try {
      supabaseConfig = getSupabaseConfig();
    } catch (error: any) {
      console.error('❌ Database configuration error:', error.message);
      return new Response(JSON.stringify({
        error: 'Server configuration error. Please contact support.',
        code: 'CONFIG_ERROR',
        details: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      supabaseConfig.url,
      supabaseConfig.serviceRoleKey || supabaseConfig.anonKey
    );


    // CRITICAL FIX: Add timeout to RPC call - this is the most critical operation
    // RPC can take longer as it creates multiple records atomically
    const rpcResult = await withTimeout(
      (async () => {
        return await supabase.rpc('setup_organization_atomic', {
          p_user_id: userId,
          p_email: email
        });
      })(),
      TIMEOUTS.DATABASE_RPC,
      'Organization setup RPC'
    ) as { data: any; error: any };

    const { data, error } = rpcResult;

    if (error) {
      console.error('❌ RPC Error:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error details:', error.details);
      console.error('❌ Error hint:', error.hint);

      // Return detailed error for debugging
      return new Response(JSON.stringify({
        error: 'Organization setup failed',
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = data as { organization_id: string; role: string };

    // CRITICAL FIX: Add timeout to organization fetch
    const orgResult = await withTimeout(
      (async () => {
        return await supabase
          .from('organizations')
          .select('id, name')
          .eq('id', result.organization_id)
          .single();
      })(),
      TIMEOUTS.DATABASE_QUERY,
      'Organization fetch'
    ) as { data: any; error: any };

    const { data: org, error: orgError } = orgResult;

    if (orgError) {
      console.error('❌ Error fetching org:', orgError);
      // SECURITY FIX: Sanitize error message
      return createErrorResponse(orgError, 500, 'fetch_organization', 'ORG_FETCH_FAILED');
    }

    return new Response(JSON.stringify({ 
      organization: org, 
      role: result.role 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('💥 Exception:', error);
    // SECURITY FIX: Sanitize exception message
    return createErrorResponse(error, 500, 'setup_organization_exception', 'SYSTEM_ERROR');
  }
};

// Removed config export - Netlify will auto-route based on function name
