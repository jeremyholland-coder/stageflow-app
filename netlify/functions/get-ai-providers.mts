import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead

/**
 * GET AI PROVIDERS ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * This means RLS policies block direct client queries to ai_providers table.
 *
 * This endpoint fetches AI providers using service role (bypasses RLS).
 *
 * Used by:
 * - AISettings.jsx (fetchProviders)
 * - useAIProviderStatus.js (checking if provider exists)
 */

export default async (req: Request, context: Context) => {
  // CORS headers
  // P0 FIX 2025-12-08: Added all Netlify deploy origins to prevent CORS errors
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'https://stageflow-rev-ops.netlify.app',
    'https://stageflow-app.netlify.app',
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

  // Allow both GET and POST (POST for body parameters)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    // Authenticate user via HttpOnly cookies
    const user = await requireAuth(req);
    console.log('[get-ai-providers] Authenticated user:', user.id);

    // Get Supabase config
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[get-ai-providers] Missing Supabase configuration');
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

    // Get organization_id from request body (POST) or query params (GET)
    let organizationId: string | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        organizationId = body.organization_id || body.organizationId;
      } catch (e) {
        // Body parsing failed, will try to get from team_members
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
        console.error('[get-ai-providers] User not in any organization:', memberError);
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
      console.error('[get-ai-providers] User not authorized for organization:', organizationId);
      return new Response(
        JSON.stringify({ error: 'Not authorized for this organization' }),
        { status: 403, headers }
      );
    }

    // Fetch AI providers for the organization
    const { data: providers, error: fetchError } = await supabase
      .from('ai_providers')
      .select('id, provider_type, display_name, model, active, created_at, api_key_encrypted')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[get-ai-providers] Failed to fetch providers:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch AI providers', details: fetchError.message }),
        { status: 500, headers }
      );
    }

    // SAFETY GUARD: Only allow known providers (prevents zombie entries from DB)
    const allowedProviders = ['openai', 'anthropic', 'google'];
    const filteredProviders = (providers || []).filter(
      (p: any) => allowedProviders.includes(p.provider_type)
    );

    console.log('[get-ai-providers] Found providers:', {
      count: filteredProviders.length,
      types: filteredProviders.map((p: any) => p.provider_type)
    });

    return new Response(
      JSON.stringify({
        success: true,
        providers: filteredProviders,
        organizationId
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('[get-ai-providers] Error:', error);
    console.error('Error type:', error.constructor?.name);
    console.error('Error message:', error.message);

    // PHASE K FIX: Comprehensive auth error detection (matches create-deal pattern)
    const isAuthError = error.statusCode === 401 ||
                        error.statusCode === 403 ||
                        error.name === 'UnauthorizedError' ||
                        error.name === 'TokenExpiredError' ||
                        error.name === 'InvalidTokenError' ||
                        error.code === 'UNAUTHORIZED' ||
                        error.code === 'TOKEN_EXPIRED' ||
                        error.message?.includes("auth") ||
                        error.message?.includes("unauthorized") ||
                        error.message?.includes("token") ||
                        error.message?.includes("cookie") ||
                        error.message?.includes("Authentication");

    if (isAuthError) {
      return new Response(
        JSON.stringify({
          error: error.message || 'Authentication required',
          code: error.code || 'AUTH_REQUIRED'
        }),
        { status: error.statusCode || 401, headers }
      );
    }

    // PHASE F FIX: Return error with CORS headers
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while fetching AI providers';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "GET_PROVIDERS_ERROR"
      }),
      { status: 500, headers }
    );
  }
};
