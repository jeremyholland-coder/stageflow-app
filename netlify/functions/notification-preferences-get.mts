import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";

/**
 * GET NOTIFICATION PREFERENCES ENDPOINT
 *
 * Returns all notification categories merged with the user's preferences.
 * If a user has no preference set for a category, returns the default values.
 *
 * Response shape:
 * {
 *   categories: [
 *     {
 *       code: "DEAL_ASSIGNED",
 *       name: "Deal assigned to you",
 *       description: "...",
 *       is_critical: true,
 *       default_enabled: true,
 *       userPreference: {
 *         enabled: true,
 *         channel_email: true,
 *         channel_in_app: true,
 *         channel_push: false
 *       }
 *     }
 *   ]
 * }
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
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[notification-preferences] GET for user:", userId);

    const supabase = getSupabaseClient();

    // Fetch all notification categories
    const { data: categories, error: categoriesError } = await supabase
      .from("notification_categories")
      .select("code, name, description, is_critical, default_enabled")
      .order("name");

    if (categoriesError) {
      console.error("[notification-preferences] Failed to fetch categories:", categoriesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch notification categories" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Fetch user's preferences
    const { data: userPrefs, error: prefsError } = await supabase
      .from("user_notification_preferences")
      .select("category_code, enabled, channel_email, channel_in_app, channel_push")
      .eq("user_id", userId);

    if (prefsError) {
      console.error("[notification-preferences] Failed to fetch user prefs:", prefsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch user preferences" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Create a map of user preferences by category code
    const prefsMap = new Map<string, {
      enabled: boolean;
      channel_email: boolean;
      channel_in_app: boolean;
      channel_push: boolean;
    }>();

    for (const pref of userPrefs || []) {
      prefsMap.set(pref.category_code, {
        enabled: pref.enabled,
        channel_email: pref.channel_email,
        channel_in_app: pref.channel_in_app,
        channel_push: pref.channel_push
      });
    }

    // Merge categories with user preferences
    const mergedCategories = (categories || []).map(cat => {
      const userPref = prefsMap.get(cat.code);

      return {
        code: cat.code,
        name: cat.name,
        description: cat.description,
        is_critical: cat.is_critical,
        default_enabled: cat.default_enabled,
        userPreference: userPref || {
          // Default values when user has no preference set
          enabled: cat.default_enabled,
          channel_email: true,
          channel_in_app: true,
          channel_push: false
        }
      };
    });

    console.warn("[notification-preferences] Returning", mergedCategories.length, "categories");

    return new Response(JSON.stringify({ categories: mergedCategories }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[notification-preferences] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode
    });

    // FIX: Comprehensive auth error detection (matches create-deal.mts pattern)
    // This ensures auth errors from requireAuth are properly caught and return 401 with CORS headers
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
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};
