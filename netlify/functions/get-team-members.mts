import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { buildCorsHeaders } from './lib/cors';

/**
 * GET TEAM MEMBERS ENDPOINT
 *
 * P2 FIX 2025-12-04: Created to replace direct Supabase queries in DealDetailsModal
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * This means RLS policies block direct client queries to team_members + user_profiles.
 *
 * This endpoint fetches team members using service role (bypasses RLS).
 *
 * Used by:
 * - DealDetailsModal.jsx (team member assignment dropdown)
 */

export default async (req: Request, context: Context) => {
  // ENGINE REBUILD Phase 9: Use centralized CORS spine
  const origin = req.headers.get('origin') || '';
  const headers = buildCorsHeaders(origin, { methods: 'GET, POST, OPTIONS' });

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
    // Authenticate user via HttpOnly cookies or Authorization header
    const user = await requireAuth(req);
    console.log('[get-team-members] Authenticated user:', user.id);

    // Get Supabase config
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[get-team-members] Missing Supabase configuration');
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
        console.error('[get-team-members] User not in any organization:', memberError);
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
      console.error('[get-team-members] User not authorized for organization:', organizationId);
      return new Response(
        JSON.stringify({ error: 'Not authorized for this organization' }),
        { status: 403, headers }
      );
    }

    // Step 1: Get all team members for this organization
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('user_id, role')
      .eq('organization_id', organizationId);

    if (membersError) {
      console.error('[get-team-members] Failed to fetch team members:', membersError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch team members', details: membersError.message }),
        { status: 500, headers }
      );
    }

    // Handle empty members gracefully
    if (!members || members.length === 0) {
      console.warn('[get-team-members] No team members found for org:', organizationId);
      return new Response(
        JSON.stringify({
          success: true,
          teamMembers: [],
          organizationId
        }),
        { status: 200, headers }
      );
    }

    // Step 2: Fetch user profiles from user_profiles view
    // This view has email and full_name (profiles table does NOT)
    const userIds = members.map(m => m.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    if (profilesError) {
      console.error('[get-team-members] Failed to fetch user profiles:', profilesError);
      // Don't fail entirely - return members without profile info
      console.warn('[get-team-members] Returning members without profile details');
    }

    // Step 3: Map profiles to members
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    const formattedMembers = members.map(m => {
      const profile = profileMap.get(m.user_id) as any;
      const fullName = profile?.full_name;
      const email = profile?.email;

      return {
        id: m.user_id,
        name: fullName || email?.split('@')[0] || 'Team Member',
        email: email || null,
        role: m.role
      };
    });

    console.log('[get-team-members] Found team members:', {
      count: formattedMembers.length,
      orgId: organizationId
    });

    return new Response(
      JSON.stringify({
        success: true,
        teamMembers: formattedMembers,
        organizationId
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('[get-team-members] Error:', error);
    console.error('Error type:', error.constructor?.name);
    console.error('Error message:', error.message);

    // Comprehensive auth error detection
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

    // Return error with CORS headers
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while fetching team members';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "GET_TEAM_MEMBERS_ERROR"
      }),
      { status: 500, headers }
    );
  }
};
