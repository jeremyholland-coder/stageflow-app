import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead

/**
 * GET AI USAGE ENDPOINT
 *
 * PHASE D FIX: Provides AI usage data for Settings → General tab.
 * Uses service role to bypass RLS (required for Phase 3 Cookie-Only Auth).
 *
 * Returns:
 * - used: Number of AI requests used this month
 * - limit: AI request limit based on plan (-1 for unlimited)
 * - plan: Current organization plan
 */

export default async (req: Request, context: Context) => {
  // CORS headers
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const origin = req.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://stageflow.startupstage.com';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    // Authenticate user via HttpOnly cookies
    const user = await requireAuth(req);
    console.log('[get-ai-usage] Authenticated user:', user.id);

    // Get Supabase config
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[get-ai-usage] Missing Supabase configuration');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers }
      );
    }

    // Create service role client (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get organization_id from request body (POST)
    let organizationId: string | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        organizationId = body.organization_id || body.organizationId;
      } catch (e) {
        // Body parsing failed
      }
    } else {
      const url = new URL(req.url);
      organizationId = url.searchParams.get('organization_id');
    }

    // If no organization_id provided, get user's organization from team_members
    if (!organizationId) {
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single();

      if (memberError || !membership) {
        console.error('[get-ai-usage] User not in any organization:', memberError);
        return new Response(
          JSON.stringify({ error: 'No organization found for user' }),
          { status: 404, headers }
        );
      }

      organizationId = membership.organization_id;
    }

    // Verify user belongs to this organization
    const { data: memberCheck, error: memberCheckError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (memberCheckError || !memberCheck) {
      console.error('[get-ai-usage] User not authorized for organization:', organizationId);
      return new Response(
        JSON.stringify({ error: 'Not authorized for this organization' }),
        { status: 403, headers }
      );
    }

    // Fetch organization AI usage data
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('ai_requests_used_this_month, plan')
      .eq('id', organizationId)
      .maybeSingle();

    if (orgError) {
      console.error('[get-ai-usage] Failed to fetch org data:', orgError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch organization data', details: orgError.message }),
        { status: 500, headers }
      );
    }

    // Calculate AI limit based on plan
    const planLimits: Record<string, number> = {
      'free': 100,
      'starter': 500,
      'startup': 1000,
      'growth': 5000,
      'pro': -1, // -1 means unlimited
      'enterprise': -1
    };

    const plan = orgData?.plan?.toLowerCase() || 'free';
    const limit = planLimits[plan] ?? 100;
    const used = orgData?.ai_requests_used_this_month || 0;

    console.log('[get-ai-usage] Usage data:', { plan, used, limit, organizationId });

    return new Response(
      JSON.stringify({
        success: true,
        used,
        limit,
        plan,
        organizationId
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('[get-ai-usage] Error:', error);

    // Handle auth errors specifically
    if (error.message?.includes('auth') || error.message?.includes('unauthorized') || error.message?.includes('token')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required', code: 'AUTH_REQUIRED' }),
        { status: 401, headers }
      );
    }

    // PHASE F FIX: Return error with CORS headers
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while fetching AI usage';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "GET_USAGE_ERROR"
      }),
      { status: 500, headers }
    );
  }
};
