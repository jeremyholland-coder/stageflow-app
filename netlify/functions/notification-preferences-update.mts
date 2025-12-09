import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { buildCorsHeaders } from './lib/cors';

/**
 * UPDATE NOTIFICATION PREFERENCES ENDPOINT
 *
 * Updates user's notification preferences for one or more categories.
 * Uses upsert to create or update preferences.
 *
 * Request body:
 * {
 *   preferences: [
 *     {
 *       categoryCode: "DEAL_ASSIGNED",
 *       enabled: true,
 *       channel_email: true,
 *       channel_in_app: true,
 *       channel_push: false
 *     }
 *   ]
 * }
 *
 * Returns the same shape as GET endpoint after update.
 */

interface PreferenceUpdate {
  categoryCode: string;
  enabled?: boolean;
  channel_email?: boolean;
  channel_in_app?: boolean;
  channel_push?: boolean;
}

export default async (req: Request, context: Context) => {
  // ENGINE REBUILD Phase 9: Use centralized CORS spine
  const requestOrigin = req.headers.get("origin") || '';
  const corsHeaders = buildCorsHeaders(requestOrigin, { methods: 'POST, OPTIONS' });

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
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[notification-preferences] UPDATE for user:", userId);

    // Parse request body
    const body = await req.json();
    const { preferences } = body as { preferences: PreferenceUpdate[] };

    if (!preferences || !Array.isArray(preferences)) {
      return new Response(
        JSON.stringify({ error: "Missing required field: preferences (array)" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (preferences.length === 0) {
      return new Response(
        JSON.stringify({ error: "Preferences array cannot be empty" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = getSupabaseClient();

    // Validate all category codes exist
    const categoryCodes = preferences.map(p => p.categoryCode);
    const { data: validCategories, error: catError } = await supabase
      .from("notification_categories")
      .select("code")
      .in("code", categoryCodes);

    if (catError) {
      console.error("[notification-preferences] Failed to validate categories:", catError);
      return new Response(
        JSON.stringify({ error: "Failed to validate notification categories" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const validCodes = new Set((validCategories || []).map(c => c.code));
    const invalidCodes = categoryCodes.filter(code => !validCodes.has(code));

    if (invalidCodes.length > 0) {
      console.warn("[notification-preferences] Invalid category codes:", invalidCodes);
      return new Response(
        JSON.stringify({
          error: "Invalid notification category codes",
          invalidCodes
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Prepare upsert data
    const upsertData = preferences.map(pref => ({
      user_id: userId,
      category_code: pref.categoryCode,
      enabled: pref.enabled ?? true,
      channel_email: pref.channel_email ?? true,
      channel_in_app: pref.channel_in_app ?? true,
      channel_push: pref.channel_push ?? false,
    }));

    console.warn("[notification-preferences] Upserting", upsertData.length, "preferences");

    // Upsert preferences
    const { error: upsertError } = await supabase
      .from("user_notification_preferences")
      .upsert(upsertData, {
        onConflict: "user_id,category_code",
        ignoreDuplicates: false
      });

    if (upsertError) {
      console.error("[notification-preferences] Upsert failed:", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to update preferences" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Fetch all categories and updated preferences to return
    const { data: categories, error: categoriesError } = await supabase
      .from("notification_categories")
      .select("code, name, description, is_critical, default_enabled")
      .order("name");

    if (categoriesError) {
      console.error("[notification-preferences] Failed to fetch categories:", categoriesError);
      return new Response(
        JSON.stringify({ error: "Preferences saved but failed to fetch updated data" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const { data: userPrefs, error: prefsError } = await supabase
      .from("user_notification_preferences")
      .select("category_code, enabled, channel_email, channel_in_app, channel_push")
      .eq("user_id", userId);

    if (prefsError) {
      console.error("[notification-preferences] Failed to fetch updated prefs:", prefsError);
      return new Response(
        JSON.stringify({ error: "Preferences saved but failed to fetch updated data" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Merge for response
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

    const mergedCategories = (categories || []).map(cat => ({
      code: cat.code,
      name: cat.name,
      description: cat.description,
      is_critical: cat.is_critical,
      default_enabled: cat.default_enabled,
      userPreference: prefsMap.get(cat.code) || {
        enabled: cat.default_enabled,
        channel_email: true,
        channel_in_app: true,
        channel_push: false
      }
    }));

    console.warn("[notification-preferences] Update successful, returning", mergedCategories.length, "categories");

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
