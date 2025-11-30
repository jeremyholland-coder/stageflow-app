import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
import { createErrorResponse } from "./lib/error-sanitizer";

/**
 * REMOVE AI PROVIDER ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles AI provider removal
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - AISettings.jsx (Remove button on connected providers)
 */

export default async (req: Request, context: Context) => {
  // PHASE 9 FIX: Secure CORS with whitelist instead of wildcard
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // STEP 1: Authenticate user via HttpOnly cookies
    // PHASE 9 FIX: requireAuth returns User directly, not {user: User}
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[remove-ai-provider] Authenticated user:", userId);

    // STEP 2: Parse request body with defensive error handling
    // PHASE I FIX: JSON parsing could fail if body is malformed, causing 500 without clear message
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("[remove-ai-provider] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body - expected JSON" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const { providerId, organizationId } = body;

    if (!providerId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: providerId, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[remove-ai-provider] Remove request:", { providerId, organizationId });

    // STEP 3: Get Supabase client with service role (bypasses RLS)
    // PHASE I FIX: Wrap in explicit try-catch to identify pool initialization failures
    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (poolError: any) {
      console.error("[remove-ai-provider] Supabase pool initialization failed:", {
        message: poolError.message,
        stack: poolError.stack?.split('\n').slice(0, 3).join('\n')
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: "Database connection error",
          code: "DB_INIT_ERROR"
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    // STEP 4: Verify user belongs to organization
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (membershipError || !membership) {
      console.error("[remove-ai-provider] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ success: false, error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Verify AI provider exists and belongs to organization
    const { data: existingProvider, error: providerCheckError } = await supabase
      .from("ai_providers")
      .select("id, organization_id, provider_type, active")
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (providerCheckError || !existingProvider) {
      console.error("[remove-ai-provider] Provider not found:", { providerId, organizationId, error: providerCheckError });
      return new Response(
        JSON.stringify({ success: false, error: "AI provider not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Check if already inactive
    if (!existingProvider.active) {
      console.warn("[remove-ai-provider] Provider already inactive:", { providerId });
      return new Response(
        JSON.stringify({ success: false, error: "AI provider already removed", code: "ALREADY_REMOVED" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // STEP 6: Soft delete - set active to false
    const { data: removedProvider, error: removeError } = await supabase
      .from("ai_providers")
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (removeError) {
      console.error("[remove-ai-provider] Remove failed:", removeError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to remove AI provider", details: removeError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.warn("[remove-ai-provider] Success:", { providerId, providerType: removedProvider.provider_type });

    return new Response(JSON.stringify({ success: true, provider: removedProvider }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[remove-ai-provider] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode
    });

    // PHASE G FIX: Handle AuthError instances properly
    // AuthError classes have statusCode property and specific error codes
    // Previous check for string matches missed errors like "Missing authentication cookies"
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

    // Return error with CORS headers to prevent browser blocking
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while removing the AI provider';

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        code: "REMOVE_AI_PROVIDER_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
