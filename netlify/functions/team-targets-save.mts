/**
 * Team Targets Save
 *
 * Combined endpoint to save both organization targets and member targets in one request.
 * Used by the Team dashboard's single "Save changes" button.
 *
 * Payload:
 * - organization_id: required
 * - orgTargetAnnual?: number (optional - if provided, quarterly/monthly auto-derived)
 * - members?: Array<{ userId, monthlyTarget, quarterlyTarget, annualTarget }> (optional)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface MemberTargetInput {
  userId: string;
  monthlyTarget: number;
  quarterlyTarget: number;
  annualTarget: number;
}

interface SaveTargetsPayload {
  organization_id: string;
  orgTargetAnnual?: number;
  members?: MemberTargetInput[];
}

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const corsHeaders = getCorsHeaders(event.headers);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    console.log('[team-targets-save] Request received');

    // Validate environment
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Server configuration error' })
      };
    }

    // Get access token from cookie or Authorization header
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const cookies = parseCookies(cookieHeader);
    let accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!accessToken && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    }

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not authenticated' })
      };
    }

    // Parse request body
    const body: SaveTargetsPayload = JSON.parse(event.body || '{}');
    const { organization_id, orgTargetAnnual, members } = body;

    console.log('[team-targets-save] Payload:', {
      organization_id,
      hasOrgTarget: orgTargetAnnual !== undefined,
      memberCount: members?.length || 0
    });

    if (!organization_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Missing organization_id' })
      };
    }

    // Authenticate user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    // Use service role for data access
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify admin/owner role
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError || !membership) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not a member of this organization' })
      };
    }

    if (!['owner', 'admin'].includes(membership.role)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Only owners and admins can save targets' })
      };
    }

    const results = {
      orgTargetSaved: false,
      memberTargetsSaved: 0,
      memberTargetsFailed: 0,
      errors: [] as string[]
    };

    // 1. Save org target if provided
    if (orgTargetAnnual !== undefined) {
      const annual = orgTargetAnnual || 0;
      const quarterly = Math.round(annual / 4);
      const monthly = Math.round(annual / 12);

      const { error: orgError } = await supabase
        .from('organization_targets')
        .upsert({
          organization_id,
          annual_target: annual,
          quarterly_target: quarterly,
          monthly_target: monthly,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'organization_id'
        });

      if (orgError) {
        console.error('[team-targets-save] Org target error:', orgError);
        results.errors.push(`Failed to save org target: ${orgError.message}`);
      } else {
        results.orgTargetSaved = true;
        console.log('[team-targets-save] Org target saved:', { annual, quarterly, monthly });
      }
    }

    // 2. Save member targets if provided
    if (members && members.length > 0) {
      // Validate all members belong to the org
      const memberUserIds = members.map(m => m.userId);
      const { data: validMembers } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('organization_id', organization_id)
        .in('user_id', memberUserIds);

      const validMemberIds = new Set((validMembers || []).map(m => m.user_id));

      for (const member of members) {
        if (!validMemberIds.has(member.userId)) {
          results.memberTargetsFailed++;
          results.errors.push(`User ${member.userId} not in organization`);
          continue;
        }

        const { error: memberError } = await supabase
          .from('user_targets')
          .upsert({
            user_id: member.userId,
            organization_id,
            annual_target: member.annualTarget || null,
            quarterly_target: member.quarterlyTarget || null,
            monthly_target: member.monthlyTarget || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,organization_id'
          });

        if (memberError) {
          console.error('[team-targets-save] Member target error:', member.userId, memberError);
          results.memberTargetsFailed++;
          results.errors.push(`Failed for user ${member.userId}: ${memberError.message}`);
        } else {
          results.memberTargetsSaved++;
        }
      }
    }

    const allSucceeded = results.errors.length === 0;

    console.log('[team-targets-save] Complete:', results);

    return {
      statusCode: allSucceeded ? 200 : 207, // 207 Multi-Status if partial success
      headers: corsHeaders,
      body: JSON.stringify({
        success: allSucceeded,
        partial: !allSucceeded && (results.orgTargetSaved || results.memberTargetsSaved > 0),
        ...results
      })
    };

  } catch (error: any) {
    console.error('[team-targets-save] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
