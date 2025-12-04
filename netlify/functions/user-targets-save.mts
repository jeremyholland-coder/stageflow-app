/**
 * Save User Targets (Team Member Targets)
 *
 * PHASE 14 FIX: Backend endpoint for user revenue targets with HttpOnly cookie auth
 * PROBLEM: Direct frontend Supabase queries fail RLS because auth.uid() unavailable with HttpOnly cookies
 * SOLUTION: Backend endpoint uses service role to bypass RLS
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface UserTarget {
  user_id: string;
  annual_target?: number | null;
  quarterly_target?: number | null;
  monthly_target?: number | null;
  show_on_dashboard?: boolean;
  visible_to_team?: boolean;
  is_active?: boolean;
  notes?: string;
}

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

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('[User Targets] Save request received');

    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[User Targets] Missing environment variables');
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
      console.error('[User Targets] No access token in cookies');
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { organization_id, user_targets } = body as {
      organization_id: string;
      user_targets: UserTarget[];
    };

    console.log('[User Targets] Request body:', {
      organization_id,
      targetCount: user_targets?.length || 0
    });

    // Validate required fields
    if (!organization_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing organization_id' })
      };
    }

    if (!user_targets || !Array.isArray(user_targets) || user_targets.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or empty user_targets array' })
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
      console.error('[User Targets] Auth error:', userError);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    console.log('[User Targets] Authenticated user:', user.id);

    // CRITICAL: Use service role client to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is an admin/owner of the organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError || !membership) {
      console.error('[User Targets] Membership error:', memberError);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not a member of this organization' })
      };
    }

    // Only owners and admins can save team member targets
    if (!['owner', 'admin'].includes(membership.role)) {
      console.error('[User Targets] Insufficient permissions:', membership.role);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only owners and admins can save team targets' })
      };
    }

    // Process each user target
    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };

    // C13 FIX: Batch fetch all org members instead of N+1 queries
    const targetUserIds = user_targets.map(t => t.user_id).filter(Boolean);
    const { data: orgMembers, error: membersError } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('organization_id', organization_id)
      .in('user_id', targetUserIds);

    if (membersError) {
      console.error('[User Targets] Failed to fetch org members:', membersError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to verify team members', details: membersError.message })
      };
    }

    // Create a Set for O(1) lookup
    const validMemberIds = new Set((orgMembers || []).map(m => m.user_id));

    for (const target of user_targets) {
      if (!target.user_id) {
        results.failed++;
        results.errors.push('Missing user_id in target');
        continue;
      }

      // C13 FIX: Use pre-fetched membership data instead of individual query
      if (!validMemberIds.has(target.user_id)) {
        results.failed++;
        results.errors.push(`User ${target.user_id} not in organization`);
        continue;
      }

      // Upsert user target
      const { error: upsertError } = await supabase
        .from('user_targets')
        .upsert({
          user_id: target.user_id,
          organization_id,
          annual_target: target.annual_target ?? null,
          quarterly_target: target.quarterly_target ?? null,
          monthly_target: target.monthly_target ?? null,
          show_on_dashboard: target.show_on_dashboard ?? true,
          visible_to_team: target.visible_to_team ?? false,
          is_active: target.is_active ?? true,
          notes: target.notes || '',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,organization_id'
        });

      if (upsertError) {
        console.error('[User Targets] Upsert error for user', target.user_id, ':', upsertError);
        results.failed++;
        results.errors.push(`Failed to save target for user ${target.user_id}: ${upsertError.message}`);
      } else {
        results.success++;
      }
    }

    console.log('[User Targets] Save complete:', results);

    if (results.failed > 0 && results.success === 0) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Failed to save any targets',
          details: results.errors
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        saved: results.success,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined
      })
    };

  } catch (error: any) {
    console.error('[User Targets] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
