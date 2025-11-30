import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";

/**
 * GET PROFILE ENDPOINT
 *
 * PHASE G FIX: Provides reliable profile data fetching for cookie-only auth.
 * Direct Supabase queries from frontend can fail if session isn't set in client.
 * This endpoint uses HttpOnly cookies which are always available.
 *
 * Used by:
 * - AppShell.jsx (avatar/profile loading)
 */

export default async (req: Request, context: Context) => {
  // CORS headers with whitelist
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'https://stageflow-app.netlify.app',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const requestOrigin = req.headers.get("origin") || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : 'https://stageflow.startupstage.com';

  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Authenticate user via HttpOnly cookies
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[profile-get] Authenticated user:", userId);

    // Get Supabase client with service role (bypasses RLS)
    const supabase = getSupabaseClient();

    // Fetch profile data
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, avatar_url, first_name, last_name, email, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error("[profile-get] Database error:", error);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch profile", details: error.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Return profile data (null if no profile exists yet)
    console.warn("[profile-get] Success for user:", userId);
    return new Response(JSON.stringify({
      success: true,
      profile: profile || null
    }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[profile-get] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode
    });

    // FIX: Comprehensive auth error detection (matches create-deal.mts pattern)
    // Previous check missed errors like "Missing authentication cookies"
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
                        error.message?.includes("cookie");

    if (isAuthError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An error occurred while fetching profile',
        code: "PROFILE_GET_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
