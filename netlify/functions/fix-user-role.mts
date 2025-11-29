import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { email } = await req.json() as { email: string };

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email required' }),
        { status: 400, headers }
      );
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 4: Add authentication to admin function
    if (shouldUseNewAuth('fix-user-role')) {
      try {
        // NEW AUTH PATH: Require authentication for admin operations
        // This is an admin tool - require valid session
        await requireAuth(req);

        // Admin operation authenticated
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    }
    // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - admin function exposed)

    // Get user ID from email
    const { data: users, error: userError } = await supabase
      .from('auth.users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (userError || !users) {
      console.error('User lookup error:', userError);
      return new Response(
        JSON.stringify({
          error: 'User not found',
          details: 'Cannot find user with that email'
        }),
        { status: 404, headers }
      );
    }

    const userId = users.id;

    // Check current team_members record
    const { data: memberRecord, error: memberError } = await supabase
      .from('team_members')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (memberError) {
      console.error('Team member lookup error:', memberError);
    }

    const diagnostics = {
      user: {
        id: userId,
        email: users.email
      },
      currentMembership: memberRecord || null
    };

    // If no membership exists OR role is not owner, fix it
    if (!memberRecord) {
      // Need to find their organization first
      const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('created_by', userId)
        .maybeSingle();

      if (orgError || !orgs) {
        return new Response(
          JSON.stringify({
            ...diagnostics,
            error: 'No organization found for user',
            fix: 'Cannot auto-fix: User has no organization'
          }),
          { status: 200, headers }
        );
      }

      // Create team_members record with owner role
      const { data: newMember, error: insertError } = await supabase
        .from('team_members')
        .insert({
          user_id: userId,
          organization_id: orgs.id,
          role: 'owner'
        })
        .select()
        .single();

      if (insertError) {
        return new Response(
          JSON.stringify({
            ...diagnostics,
            error: 'Failed to create team member record',
            details: insertError.message
          }),
          { status: 500, headers }
        );
      }

      return new Response(
        JSON.stringify({
          ...diagnostics,
          fixed: true,
          action: 'Created team_members record with owner role',
          newRecord: newMember
        }),
        { status: 200, headers }
      );

    } else if (memberRecord.role !== 'owner') {
      // Update role to owner
      const { data: updated, error: updateError } = await supabase
        .from('team_members')
        .update({ role: 'owner' })
        .eq('id', memberRecord.id)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({
            ...diagnostics,
            error: 'Failed to update role',
            details: updateError.message
          }),
          { status: 500, headers }
        );
      }

      return new Response(
        JSON.stringify({
          ...diagnostics,
          fixed: true,
          action: `Updated role from '${memberRecord.role}' to 'owner'`,
          updatedRecord: updated
        }),
        { status: 200, headers }
      );
    }

    // Already has owner role
    return new Response(
      JSON.stringify({
        ...diagnostics,
        status: 'OK',
        message: 'User already has owner role'
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('Fix user role error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal error',
        message: error.message
      }),
      { status: 500, headers }
    );
  }
};
