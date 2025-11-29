/**
 * Save Organization Targets
 *
 * CRITICAL FIX v1.7.89: Backend endpoint for organization revenue targets with HttpOnly cookie auth
 * PROBLEM: Direct frontend Supabase queries fail RLS because auth.uid() unavailable with HttpOnly cookies
 * SOLUTION: Backend endpoint uses service role to bypass RLS (same pattern as notification-preferences-save)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // v1.7.98: CORS headers with origin validation (no wildcard with credentials)
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('[Organization Targets] Save request received');

    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[Organization Targets] Missing environment variables:', {
        hasUrl: !!SUPABASE_URL,
        hasAnonKey: !!SUPABASE_ANON_KEY,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY
      });
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
      console.error('[Organization Targets] No access token in cookies');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const {
      organization_id,
      annual_target,
      quarterly_target,
      monthly_target
    } = body;

    console.log('[Organization Targets] Request body:', {
      organization_id,
      hasAnnual: annual_target !== undefined,
      hasQuarterly: quarterly_target !== undefined,
      hasMonthly: monthly_target !== undefined
    });

    // Validate required fields
    if (!organization_id) {
      console.error('[Organization Targets] Missing organization_id in request');
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing organization_id' })
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
      console.error('[Organization Targets] Auth error:', userError);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    console.log('[Organization Targets] Authenticated user:', user.id);

    // CRITICAL: Use service role client to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is an admin/owner of the organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError) {
      console.error('[Organization Targets] Membership query error:', memberError);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to verify membership', details: memberError.message })
      };
    }

    if (!membership) {
      console.error('[Organization Targets] User not a member:', { userId: user.id, organizationId: organization_id });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not a member of this organization' })
      };
    }

    console.log('[Organization Targets] User role:', membership.role);

    // Only owners and admins can save organization targets
    if (!['owner', 'admin'].includes(membership.role)) {
      console.error('[Organization Targets] Insufficient permissions:', membership.role);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only owners and admins can save organization targets' })
      };
    }

    // Upsert organization targets using service role (bypasses RLS)
    console.log('[Organization Targets] Attempting upsert for organization:', organization_id);

    const { data, error } = await supabase
      .from('organization_targets')
      .upsert({
        organization_id,
        annual_target: annual_target || null,
        quarterly_target: quarterly_target || null,
        monthly_target: monthly_target || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'organization_id'
      })
      .select()
      .single();

    if (error) {
      console.error('[Organization Targets] Save error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to save targets', details: error.message })
      };
    }

    console.log('[Organization Targets] Save successful:', data);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data })
    };

  } catch (error: any) {
    console.error('[Organization Targets] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
