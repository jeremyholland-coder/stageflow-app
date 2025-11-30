import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";

/**
 * GET LEGACY NOTIFICATION PREFERENCES ENDPOINT
 *
 * PHASE E FIX: Backend endpoint for reading notification preferences
 * from the `notification_preferences` table (used by Settings.jsx).
 *
 * PROBLEM: Direct Supabase queries fail RLS because auth.uid() is NULL
 * with Phase 3 Cookie-Only Auth (persistSession: false).
 *
 * This endpoint pairs with notification-preferences-save.mts which writes
 * to the same table.
 */

export default async (req: Request, context: Context) => {
  // CORS whitelist
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // Authenticate user via HttpOnly cookies
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[notification-preferences-legacy-get] User:", userId);

    // Get organization_id from request body (POST) or query params (GET)
    let organizationId: string | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        organizationId = body.organization_id || body.organizationId;
      } catch (e) {
        // Body parsing failed
      }
    } else {
      const url = new URL(req.url);
      organizationId = url.searchParams.get("organization_id");
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organization_id" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = getSupabaseClient();

    // Verify user is a member of the organization
    const { data: membership, error: memberError } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (memberError || !membership) {
      return new Response(
        JSON.stringify({ error: "Not a member of this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Fetch notification preferences from legacy table
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("[notification-preferences-legacy-get] Fetch error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch preferences" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Return preferences with defaults if no data exists
    const preferences = data || {
      all_notifications: true,
      notify_deal_created: true,
      notify_stage_changed: true,
      notify_deal_won: true,
      notify_deal_lost: false,
      weekly_digest: false,
      digest_day: "monday",
      digest_time: "09:00",
      digest_timezone: "America/New_York",
      digest_time_format: "12h"
    };

    console.warn("[notification-preferences-legacy-get] Returning preferences for user:", userId);

    return new Response(JSON.stringify({ preferences }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[notification-preferences-legacy-get] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode
    });

    // Handle auth errors - comprehensive check matching auth-middleware patterns
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
        JSON.stringify({ error: error.message || "Authentication required", code: "AUTH_REQUIRED" }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};
