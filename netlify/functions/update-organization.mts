/**
 * Update Organization Settings
 *
 * PHASE 14 FIX: Backend endpoint for organization updates with HttpOnly cookie auth
 * Handles updates to organization settings like selected_industry, pipeline_template, etc.
 *
 * SECURITY: Uses service role to bypass RLS, validates user membership (owner/admin only)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Fields that can be updated via this endpoint
const ALLOWED_FIELDS = [
  'selected_industry',
  'pipeline_template',
  'pipeline_template_id',
  'name',
  'settings'
];

export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  const corsHeaders = getCorsHeaders(event.headers);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('[Update Organization] Request received');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
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
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { organization_id, updates } = body;

    if (!organization_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing organization_id' })
      };
    }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing or empty updates object' })
      };
    }

    // Filter to only allowed fields
    const sanitizedUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedUpdates[key] = value;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No valid fields to update', allowedFields: ALLOWED_FIELDS })
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
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    // Use service role client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is admin/owner of organization
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Only owners and admins can update organization settings' })
      };
    }

    // Perform the update
    const { data, error } = await supabase
      .from('organizations')
      .update(sanitizedUpdates)
      .eq('id', organization_id)
      .select()
      .single();

    if (error) {
      console.error('[Update Organization] Error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to update organization', details: error.message })
      };
    }

    console.log('[Update Organization] Success:', { organization_id, fields: Object.keys(sanitizedUpdates) });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, organization: data })
    };

  } catch (error: any) {
    console.error('[Update Organization] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
