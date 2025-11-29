/**
 * ADMIN ONLY: Reset user password
 *
 * SECURITY (v1.7.98):
 * - Requires authentication via HttpOnly cookies
 * - Caller must be admin/owner of an organization
 * - Target user must be in the SAME organization as the admin
 * - All attempts are logged for audit trail
 *
 * Usage: POST /.netlify/functions/admin-reset-password
 * Body: { email: string, newPassword: string }
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
import { AuthError } from './lib/auth-errors';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Get Supabase with service role (needed for all checks)
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing Supabase configuration' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // SECURITY: Require authentication
    const request = new Request(`https://example.com${event.path}`, {
      method: event.httpMethod,
      headers: new Headers(event.headers as Record<string, string>)
    });

    let adminUser;
    try {
      adminUser = await requireAuth(request);
    } catch (authError: any) {
      console.warn('[Admin Reset] Authentication failed:', authError);
      const statusCode = authError instanceof AuthError ? authError.statusCode : 401;
      const errorMessage = authError instanceof AuthError ? authError.message : 'Authentication required';
      return {
        statusCode,
        body: JSON.stringify({ error: errorMessage })
      };
    }

    console.log(`[Admin Reset] Authenticated admin: ${adminUser.email}`);

    // SECURITY: Verify caller is admin/owner of at least one organization
    const { data: adminMemberships, error: memberError } = await supabase
      .from('team_members')
      .select('organization_id, role')
      .eq('user_id', adminUser.id)
      .in('role', ['admin', 'owner']);

    if (memberError || !adminMemberships || adminMemberships.length === 0) {
      console.warn(`[Admin Reset] User ${adminUser.email} is not an admin/owner of any organization`);
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Access denied',
          details: 'Only organization administrators and owners can reset passwords'
        })
      };
    }

    const adminOrgIds = adminMemberships.map(m => m.organization_id);
    console.log(`[Admin Reset] Admin ${adminUser.email} has admin/owner role in ${adminOrgIds.length} organization(s)`);

    const { email, newPassword } = JSON.parse(event.body || '{}');

    if (!email || !newPassword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email and newPassword required' })
      };
    }

    // Get target user
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError || !users?.users) {
      console.error('[Admin Reset] Failed to list users:', listError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch users' })
      };
    }

    const targetUser = users.users.find((u: any) => u.email === email);

    if (!targetUser) {
      console.warn(`[Admin Reset] Target user not found: ${email}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    // SECURITY: Verify target user is in an organization the admin manages
    const { data: targetMemberships, error: targetMemberError } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', targetUser.id)
      .in('organization_id', adminOrgIds);

    if (targetMemberError || !targetMemberships || targetMemberships.length === 0) {
      console.warn(`[Admin Reset] BLOCKED: ${adminUser.email} tried to reset password for ${email} who is not in their organization`);
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Access denied',
          details: 'You can only reset passwords for users in your organization'
        })
      };
    }

    // AUDIT: Log the password reset attempt
    console.log(`[Admin Reset] AUTHORIZED: ${adminUser.email} resetting password for ${email}`);

    // Update password using admin API
    const { data, error } = await supabase.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );

    if (error) {
      console.error(`[Admin Reset] Password reset failed for ${email}:`, error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    // AUDIT: Log successful reset
    console.log(`[Admin Reset] SUCCESS: ${adminUser.email} reset password for ${email}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Password updated for ${email}`,
        user: {
          id: data.user.id,
          email: data.user.email
        }
      })
    };

  } catch (error: any) {
    console.error('[Admin Reset] Exception:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
