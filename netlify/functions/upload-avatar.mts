import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth-middleware';
import { createErrorResponse } from './lib/error-sanitizer';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';

// FIX v1.7.62 (#9): Backend avatar upload endpoint
//
// PROBLEM: Phase 3 Cookie-Only Auth broke client-side storage uploads
// - Supabase client has persistSession: false (no auth session in client)
// - Client tries supabase.storage.from('avatars').upload() → 403 Permission Denied
// - Storage API needs authenticated context, but client has none
//
// SOLUTION: Backend function with service role handles upload
// - Frontend sends file via multipart/form-data
// - Backend authenticates via HttpOnly cookies
// - Backend uploads to storage with authenticated Supabase service client
// - Returns public URL to frontend

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
    console.log('[AVATAR UPLOAD] Authenticated user:', user.email);

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

    // Create service role client (bypasses RLS, has full storage access)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'File too large. Maximum size is 2MB.' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Please upload JPG, PNG, or GIF.' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}-${Date.now()}.${fileExt}`;
    const filePath = `profile-pictures/${fileName}`;

    // Convert File to ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    const fileUint8Array = new Uint8Array(fileBuffer);

    // Upload to Supabase Storage with timeout protection
    const { error: uploadError } = await withTimeout(
      supabase.storage
        .from('avatars')
        .upload(filePath, fileUint8Array, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false
        }),
      TIMEOUTS.FILE_UPLOAD,
      'Avatar upload to storage'
    );

    if (uploadError) {
      console.error('❌ Storage upload failed:', uploadError);

      // Handle specific storage errors
      if (uploadError.message?.includes('Bucket not found')) {
        return new Response(
          JSON.stringify({
            error: 'Storage not configured. Please contact support.',
            details: 'avatars bucket does not exist'
          }),
          { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      throw uploadError;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    console.log('[AVATAR UPLOAD] File uploaded successfully:', publicUrl);

    // Update user profile in database with timeout protection
    // CRITICAL FIX v1.7.92: Properly await the Supabase query as a Promise
    // Wrap in Promise.resolve() to convert PromiseLike to proper Promise
    const updateResult = await withTimeout(
      Promise.resolve(
        supabase
          .from('profiles')
          .upsert({
            id: user.id,
            avatar_url: publicUrl,
            updated_at: new Date().toISOString()
          })
          .select('id, avatar_url')
          .single()
      ),
      TIMEOUTS.DATABASE_QUERY,
      'Profile avatar_url update'
    );
    const updateError = updateResult?.error;

    if (updateError) {
      console.error('❌ Profile update failed:', updateError);

      // CRITICAL FIX v1.7.92: Do NOT return success if DB update fails!
      // Problem: Avatar file exists in storage but URL not saved to profiles table
      // Result: User sees avatar temporarily, but it disappears on page reload
      // Solution: Return error so user knows to try again
      //
      // Also attempt to clean up the orphaned file in storage
      try {
        await supabase.storage.from('avatars').remove([filePath]);
        console.log('[AVATAR UPLOAD] Cleaned up orphaned file:', filePath);
      } catch (cleanupErr) {
        console.warn('[AVATAR UPLOAD] Failed to clean up orphaned file:', cleanupErr);
      }

      return new Response(
        JSON.stringify({
          error: 'Failed to save avatar to your profile. Please try again.',
          details: 'Storage upload succeeded but database update failed'
        }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[AVATAR UPLOAD] Profile updated successfully for user:', user.id);

    return new Response(
      JSON.stringify({
        success: true,
        avatarUrl: publicUrl,
        message: 'Profile picture uploaded and saved successfully'
      }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Avatar upload error:', error);
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    return createErrorResponse(
      error,
      500,
      'upload_avatar',
      'AVATAR_UPLOAD_FAILED'
    );
  }
};
