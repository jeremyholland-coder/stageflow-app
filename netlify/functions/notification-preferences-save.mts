/**
 * Save Notification Preferences
 *
 * CRITICAL FIX v1.7.87: Backend endpoint for notification preferences with HttpOnly cookie auth
 * PROBLEM: Direct frontend Supabase queries fail RLS because auth.uid() unavailable with HttpOnly cookies
 * SOLUTION: Backend endpoint uses service role to bypass RLS (same pattern as onboarding-progress-save)
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { parseCookies, COOKIE_NAMES, getCorsHeaders } from './lib/cookie-auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
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
    // DUAL-MODE AUTH: Check Authorization header first, then fall back to cookies
    // This supports both API clients (Bearer token) and browser sessions (cookies)
    let accessToken: string | undefined;

    // Primary: Authorization header
    // CRITICAL FIX: Add type guard to prevent "e.split is not a function" error (React #31)
    // Headers can sometimes be arrays or other types in certain environments
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1].length > 20) {
        accessToken = parts[1];
      }
    }

    // Fallback: HttpOnly cookie
    // CRITICAL FIX: Ensure cookieHeader is always a string before splitting
    if (!accessToken) {
      const rawCookie = event.headers.cookie || event.headers.Cookie;
      const cookieHeader = typeof rawCookie === 'string' ? rawCookie : '';
      const cookies = parseCookies(cookieHeader);
      accessToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];
    }

    if (!accessToken) {
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
      all_notifications,
      notify_deal_created,
      notify_stage_changed,
      notify_deal_won,
      notify_deal_lost,
      weekly_digest,
      digest_day,
      digest_time,
      digest_timezone,
      digest_time_format
    } = body;

    // Validate required fields
    if (!organization_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing organization_id' })
      };
    }

    // Create authenticated Supabase client to get user
    const supabaseAuth = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY!, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    });

    // Get current user
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(accessToken);

    if (userError || !user) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid session' })
      };
    }

    // CRITICAL: Use service role client to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user is a member of the organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError || !membership) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not a member of this organization' })
      };
    }

    // Upsert notification preferences using service role (bypasses RLS)
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: user.id,
        organization_id,
        all_notifications: all_notifications ?? true,
        notify_deal_created: notify_deal_created ?? true,
        notify_stage_changed: notify_stage_changed ?? true,
        notify_deal_won: notify_deal_won ?? true,
        notify_deal_lost: notify_deal_lost ?? false,
        weekly_digest: weekly_digest ?? false,
        digest_day: digest_day || 'monday',
        digest_time: digest_time || '09:00',
        digest_timezone: digest_timezone || 'America/New_York',
        digest_time_format: digest_time_format || '12h',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,organization_id'
      })
      .select()
      .single();

    if (error) {
      console.error('[Notification Preferences] Save error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to save preferences', details: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data })
    };

  } catch (error: any) {
    console.error('[Notification Preferences] Exception:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
