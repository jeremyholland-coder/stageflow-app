import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
import { createErrorResponse } from './lib/error-sanitizer';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';

// Profile Save Endpoint
//
// PURPOSE: Save user profile data (first_name, last_name)
// - Uses HttpOnly cookie authentication
// - Service role bypasses RLS for reliable saves
// - Supports partial updates (only saves provided fields)
//
// DOES NOT MODIFY: Auth, billing, onboarding, or AI integrations

export default async (req: Request, context: Context) => {
  // CORS headers
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const origin = req.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://stageflow.startupstage.com';

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // CRITICAL: Authenticate user via HttpOnly cookies
    const user = await requireAuth(req);
    console.log('[PROFILE SAVE] Authenticated user:', user.email);

    // Parse request body
    const body = await req.json();
    const { first_name, last_name } = body;

    // Validate input (allow empty strings to clear values)
    if (first_name !== undefined && typeof first_name !== 'string') {
      return new Response(
        JSON.stringify({ error: 'first_name must be a string' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    if (last_name !== undefined && typeof last_name !== 'string') {
      return new Response(
        JSON.stringify({ error: 'last_name must be a string' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize input (trim whitespace, limit length)
    const sanitizedFirstName = first_name !== undefined
      ? first_name.trim().slice(0, 100)
      : undefined;
    const sanitizedLastName = last_name !== undefined
      ? last_name.trim().slice(0, 100)
      : undefined;

    // Get Supabase config
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Missing Supabase configuration');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Build update object (only include provided fields)
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (sanitizedFirstName !== undefined) {
      updateData.first_name = sanitizedFirstName || null; // Convert empty string to null
    }
    if (sanitizedLastName !== undefined) {
      updateData.last_name = sanitizedLastName || null; // Convert empty string to null
    }

    console.log('[PROFILE SAVE] Saving profile data:', {
      userId: user.id,
      first_name: updateData.first_name,
      last_name: updateData.last_name
    });

    // Upsert profile (create if doesn't exist, update if exists)
    // FIX PH7∞-L5-01: Wrap PostgrestBuilder in Promise.resolve() for withTimeout compatibility
    const { data, error: updateError } = await withTimeout(
      Promise.resolve(
        supabase
          .from('profiles')
          .upsert({
            id: user.id,
            ...updateData
          })
          .select('id, first_name, last_name, avatar_url')
          .single()
      ),
      TIMEOUTS.DATABASE_QUERY,
      'Profile save'
    );

    if (updateError) {
      console.error('❌ Profile save failed:', updateError);
      throw updateError;
    }

    console.log('[PROFILE SAVE] Profile saved successfully:', data);

    return new Response(
      JSON.stringify({
        success: true,
        profile: data,
        message: 'Profile saved successfully'
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Profile save error:', error);
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);

    return createErrorResponse(
      error,
      500,
      'profile_save',
      'PROFILE_SAVE_FAILED'
    );
  }
};
