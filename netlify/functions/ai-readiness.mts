import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
import { buildCorsHeaders } from './lib/cors';
import { getConnectedProviders } from './lib/provider-registry';

/**
 * AI Readiness Endpoint
 * Returns a single payload indicating whether AI is ready, plus active provider info.
 * This reduces multiple round-trips (session + providers + health) down to one.
 */

export default async (req: Request, context: Context) => {
  const origin = req.headers.get('origin') || '';
  const headers = buildCorsHeaders(origin, { methods: 'GET, POST, OPTIONS' });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    // Auth via cookies/headers
    const user = await requireAuth(req);

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error', code: 'CONFIG_ERROR' }),
        { status: 500, headers }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // orgId from body (POST) or query (GET) or membership fallback
    let orgId: string | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        orgId = body.organization_id || body.organizationId || null;
      } catch (e) {
        // ignore body parse error; fallback to membership
      }
    } else {
      const url = new URL(req.url);
      orgId = url.searchParams.get('organization_id');
    }

    if (!orgId) {
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberError || !membership) {
        return new Response(
          JSON.stringify({ error: 'No organization found for user', code: 'NO_ORG' }),
          { status: 404, headers }
        );
      }

      orgId = membership.organization_id;
    }

    // Check membership/authorization
    const { data: memberCheck, error: memberCheckError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (memberCheckError || !memberCheck) {
      return new Response(
        JSON.stringify({ error: 'Not authorized for this organization', code: 'FORBIDDEN' }),
        { status: 403, headers }
      );
    }

    // Get providers via central registry (service role + caching)
    const { providers, fetchError, errorMessage } = await getConnectedProviders(supabase, orgId, { useCache: false });

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: errorMessage || 'Provider fetch failed', code: 'PROVIDER_FETCH_ERROR' }),
        { status: 503, headers }
      );
    }

    const ready = providers.length > 0;
    const activeProvider = ready ? providers[0] : null;
    const variant = ready ? 'ready' : 'connect_provider';
    // Pass through provider types so frontend can show a hint when providers are filtered out
    const filteredProviders = providers.map(p => p.provider_type);

    return new Response(
      JSON.stringify({
        success: true,
        ready,
        variant,
        providerCount: providers.length,
        activeProvider: activeProvider
          ? {
              id: activeProvider.id,
              provider_type: activeProvider.provider_type,
              display_name: activeProvider.display_name,
              model: activeProvider.model
            }
          : null,
        filteredProviders,
        organizationId: orgId
      }),
      { status: 200, headers }
    );
  } catch (error: any) {
    const message = error?.message || 'AI readiness check failed';
    const status = error?.statusCode || error?.status || 401;
    return new Response(
      JSON.stringify({ error: message, code: error?.code || 'AUTH_REQUIRED' }),
      { status, headers }
    );
  }
};
