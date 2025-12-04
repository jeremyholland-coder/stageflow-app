import type { Context } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead
import { sanitizeError } from './lib/error-sanitizer';
import { getSupabaseConfig } from './lib/validate-config';
import { withTimeout, TIMEOUTS, safeRequestJson } from './lib/timeout-wrapper';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, validateUserIdMatch, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  // PHASE F FIX: Add CORS headers for browser requests
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'https://stageflow-app.netlify.app',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const requestOrigin = req.headers.get("origin") || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : 'https://stageflow.startupstage.com';

  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
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
        headers: corsHeaders
      });
    }

    const { userId, email } = body;

    if (!userId || !email) {
      console.error('❌ Missing params:', { userId, email });
      return new Response(JSON.stringify({ error: 'Missing userId or email' }), {
        status: 400,
        headers: corsHeaders
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
    // H7 FIX: The redundant check above (lines 72-79) already enforces auth unconditionally.
    // This feature-flagged block is now redundant but kept for migration tracking.
    // IMPORTANT: This endpoint is NOT vulnerable - auth is enforced regardless of feature flags.
    if (shouldUseNewAuth('setup-organization', userId)) {
      // Auth already verified above - this block is now a no-op but kept for migration consistency
    }
    // NOTE: Auth is enforced unconditionally by the redundant check above.

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
        headers: corsHeaders
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
        headers: corsHeaders
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
      // PHASE F FIX: Return error with CORS headers
      const errorMessage = sanitizeError(orgError, 'fetch_organization');
      return new Response(JSON.stringify({
        error: errorMessage,
        code: 'ORG_FETCH_FAILED'
      }), {
        status: 500,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({
      organization: org,
      role: result.role
    }), {
      headers: corsHeaders
    });

  } catch (error: any) {
    console.error('💥 Exception:', error);
    // PHASE F FIX: Return error with CORS headers
    const errorMessage = sanitizeError(error, 'setup_organization_exception');
    return new Response(JSON.stringify({
      error: errorMessage,
      code: 'SYSTEM_ERROR'
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
};

// Removed config export - Netlify will auto-route based on function name
