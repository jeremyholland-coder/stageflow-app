// Diagnostic function to check user state
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email required' })
      };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing Supabase config' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Query auth.users using admin API
    const { data: users, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to list users',
          details: usersError
        })
      };
    }

    const user = users.users.find(u => u.email === email);

    // Raw SQL query to check for ANY record including soft-deleted
    const { data: rawAuthUsers, error: rawError } = await supabase.rpc('check_raw_user', {
      email_to_check: email
    }).catch(async () => {
      // Fallback: Try direct SQL if RPC doesn't exist
      return await supabase.from('auth.users').select('*').eq('email', email).limit(10);
    });

    // Query team_members
    let teamMembersData = null;
    if (user) {
      const { data: tm, error: tmError } = await supabase
        .from('team_members')
        .select(`
          id,
          user_id,
          organization_id,
          role,
          created_at,
          organizations (
            name
          )
        `)
        .eq('user_id', user.id);

      teamMembersData = { data: tm, error: tmError };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        userExists: !!user,
        user: user ? {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          banned_until: user.banned_until,
          deleted_at: user.deleted_at
        } : null,
        rawAuthCheck: {
          found: rawAuthUsers ? rawAuthUsers.length > 0 : false,
          data: rawAuthUsers,
          error: rawError
        },
        teamMembers: teamMembersData
      })
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Diagnostic failed',
        message: error.message,
        stack: error.stack
      })
    };
  }
};
