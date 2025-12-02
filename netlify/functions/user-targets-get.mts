/**
 * Get User Targets (Team Member Targets)
 *
 * Backend endpoint to fetch user revenue targets for all team members.
 * Uses HttpOnly cookie auth and service role to bypass RLS.
 *
 * Returns targets for all members in the organization (if requester is admin/owner)
 * or just the requester's own targets (if regular member).
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // CORS headers with origin validation
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Allow both GET and POST (POST for body parameters)
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('[user-targets-get] Request received');

    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[user-targets-get] Missing environment variables');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Get access token from HttpOnly cookie
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    const accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    if (!accessToken) {
      console.error('[user-targets-get] No access token in cookies');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Parse request body or query params for organization_id
    let organizationId: string | null = null;

    if (event.httpMethod === 'POST' && event.body) {
      try {
        const body = JSON.parse(event.body);
        organizationId = body.organization_id;
      } catch (e) {
        // Ignore parse errors
      }
    } else {
      // GET request - check query params
      organizationId = event.queryStringParameters?.organization_id || null;
    }

    // Create authenticated Supabase client to get user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    });

    // Get current user
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      console.error('[user-targets-get] Auth error:', userError);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    console.log('[user-targets-get] Authenticated user:', user.id);

    // CRITICAL: Use service role client to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // If no organization_id provided, get user's organization
    if (!organizationId) {
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberError || !membership) {
        console.error('[user-targets-get] Membership error:', memberError);
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not a member of any organization' })
        };
      }

      organizationId = membership.organization_id;
    }

    // Verify user is a member of this organization and get their role
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (memberError || !membership) {
      console.error('[user-targets-get] Membership verification failed:', memberError);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not a member of this organization' })
      };
    }

    const isAdminOrOwner = ['owner', 'admin'].includes(membership.role);

    // Fetch user targets
    let query = supabase
      .from('user_targets')
      .select('*')
      .eq('organization_id', organizationId);

    // If not admin/owner, only return their own targets
    if (!isAdminOrOwner) {
      query = query.eq('user_id', user.id);
    }

    const { data: targets, error: targetsError } = await query;

    if (targetsError) {
      console.error('[user-targets-get] Error fetching targets:', targetsError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch targets', details: targetsError.message })
      };
    }

    console.log('[user-targets-get] Found targets:', targets?.length || 0);

    // Return targets keyed by user_id for easy lookup
    const targetsMap: { [userId: string]: any } = {};
    (targets || []).forEach(target => {
      targetsMap[target.user_id] = {
        monthly_target: target.monthly_target,
        quarterly_target: target.quarterly_target,
        annual_target: target.annual_target,
        show_on_dashboard: target.show_on_dashboard,
        visible_to_team: target.visible_to_team,
        is_active: target.is_active,
        notes: target.notes,
        updated_at: target.updated_at
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        targets: targetsMap,
        organization_id: organizationId,
        is_admin: isAdminOrOwner
      })
    };

  } catch (error: any) {
    console.error('[user-targets-get] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
