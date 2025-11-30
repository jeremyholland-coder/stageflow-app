/**
 * Get Organization Targets
 *
 * CRITICAL FIX: Backend endpoint for fetching organization revenue targets with HttpOnly cookie auth
 * PROBLEM: Direct frontend Supabase queries fail RLS because auth.uid() unavailable with HttpOnly cookies
 * SOLUTION: Backend endpoint uses service role to bypass RLS (same pattern as organization-targets-save)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // CORS headers with origin validation (no wildcard with credentials)
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Allow GET or POST (POST for flexibility with body params)
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
    };
  }

  try {
    console.log('[Organization Targets GET] Request received');

    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[Organization Targets GET] Missing environment variables');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Server configuration error', code: 'CONFIG_ERROR' })
      };
    }

    // Get access token from HttpOnly cookie
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    const accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    if (!accessToken) {
      console.error('[Organization Targets GET] No access token in cookies');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not authenticated', code: 'NOT_AUTHENTICATED' })
      };
    }

    // Get organization_id from query params (GET) or body (POST)
    let organization_id: string | null = null;

    if (event.httpMethod === 'GET') {
      organization_id = event.queryStringParameters?.organization_id || null;
    } else {
      const body = JSON.parse(event.body || '{}');
      organization_id = body.organization_id || null;
    }

    console.log('[Organization Targets GET] Organization ID:', organization_id);

    // Validate required fields
    if (!organization_id) {
      console.error('[Organization Targets GET] Missing organization_id');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Missing organization_id', code: 'MISSING_ORG_ID' })
      };
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
      console.error('[Organization Targets GET] Auth error:', userError);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Invalid session', code: 'INVALID_SESSION' })
      };
    }

    console.log('[Organization Targets GET] Authenticated user:', user.id);

    // CRITICAL: Use service role client to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is a member of the organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError) {
      console.error('[Organization Targets GET] Membership query error:', memberError);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Failed to verify membership', code: 'MEMBERSHIP_ERROR' })
      };
    }

    if (!membership) {
      console.error('[Organization Targets GET] User not a member:', { userId: user.id, organizationId: organization_id });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not a member of this organization', code: 'NOT_MEMBER' })
      };
    }

    console.log('[Organization Targets GET] User role:', membership.role);

    // Fetch organization targets using service role (bypasses RLS)
    const { data, error } = await supabase
      .from('organization_targets')
      .select('annual_target, quarterly_target, monthly_target')
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (error) {
      console.error('[Organization Targets GET] Fetch error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Failed to fetch targets', code: 'FETCH_ERROR' })
      };
    }

    // If no row exists yet, return null targets (not an error)
    if (!data) {
      console.log('[Organization Targets GET] No targets found for organization');
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          targets: null
        })
      };
    }

    console.log('[Organization Targets GET] Targets found:', data);

    // Return targets in consistent shape
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        targets: {
          monthly: data.monthly_target,
          quarterly: data.quarterly_target,
          yearly: data.annual_target
        }
      })
    };

  } catch (error: any) {
    console.error('[Organization Targets GET] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' })
    };
  }
};
