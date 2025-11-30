import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';

// FIX v1.7.62 (#9): Backend avatar remove endpoint
// REASON: Same as upload - Phase 3 Cookie-Only Auth means client has no session

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
    console.log('[AVATAR REMOVE] Authenticated user:', user.email);

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

    // PERSIST-03 FIX: Fetch current avatar_url before clearing, then delete from storage
    // This prevents orphaned files from accumulating in storage
    // CRITICAL: Wrap in Promise.resolve() to convert PostgrestBuilder to proper Promise
    const fetchResult = await withTimeout(
      Promise.resolve(
        supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle()
      ),
      TIMEOUTS.DATABASE_QUERY,
      'Profile avatar_url fetch'
    ) as { data: { avatar_url: string | null } | null; error: any };
    const profile = fetchResult?.data;
    const fetchError = fetchResult?.error;

    if (fetchError) {
      console.error('❌ Failed to fetch current profile:', fetchError);
      // Continue anyway - still try to clear the DB field
    }

    // If avatar_url exists, delete the file from storage
    if (profile?.avatar_url) {
      try {
        // Extract storage path from URL
        // URL format: https://{project}.supabase.co/storage/v1/object/public/avatars/profile-pictures/{filename}
        const avatarsMatch = profile.avatar_url.match(/\/avatars\/(.+)$/);
        if (avatarsMatch && avatarsMatch[1]) {
          const storagePath = avatarsMatch[1];
          console.log('[AVATAR REMOVE] Deleting storage file:', storagePath);

          const { error: storageError } = await supabase.storage
            .from('avatars')
            .remove([storagePath]);

          if (storageError) {
            // Log but don't fail - still proceed to clear DB field
            console.warn('[AVATAR REMOVE] Storage deletion failed (non-fatal):', storageError);
          } else {
            console.log('[AVATAR REMOVE] Storage file deleted successfully');
          }
        } else {
          console.warn('[AVATAR REMOVE] Could not parse storage path from URL:', profile.avatar_url);
        }
      } catch (storageErr) {
        // Defensive: don't let storage errors break the endpoint
        console.warn('[AVATAR REMOVE] Storage deletion error (non-fatal):', storageErr);
      }
    }

    // Update user profile - set avatar_url to null
    // CRITICAL: Wrap in Promise.resolve() to convert PostgrestBuilder to proper Promise
    const updateResult = await withTimeout(
      Promise.resolve(
        supabase
          .from('profiles')
          .update({
            avatar_url: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id)
      ),
      TIMEOUTS.DATABASE_QUERY,
      'Profile avatar_url removal'
    ) as { error: any };
    const updateError = updateResult?.error;

    if (updateError) {
      console.error('❌ Profile update failed:', updateError);
      throw updateError;
    }

    console.log('[AVATAR REMOVE] Avatar removed successfully for user:', user.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Profile picture removed successfully'
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Avatar remove error:', error);
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);

    // PHASE K FIX: Handle AuthError instances properly - return 401 for auth errors
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
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // PHASE F FIX: Return error with CORS headers
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while removing avatar';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "AVATAR_REMOVE_FAILED"
      }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
};
