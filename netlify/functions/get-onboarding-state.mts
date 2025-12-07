import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";

// Simple correlation ID generator
const generateCorrelationId = () => `onb-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

/**
 * GET ONBOARDING STATE
 * Area 6 - First-Run Onboarding Experience
 *
 * Returns the user's onboarding checklist state for their organization.
 * If no state exists, creates a default one with all items incomplete.
 *
 * Auto-completion logic:
 * - Checks actual data (deals, AI providers, etc.) to infer completed steps
 * - Updates the state if items have been completed since last check
 */

// Default checklist items for new users
const DEFAULT_CHECKLIST = [
  { id: "create_first_deal", completed: false, completedAt: null },
  { id: "move_deal_in_pipeline", completed: false, completedAt: null },
  { id: "configure_ai_provider", completed: false, completedAt: null },
  { id: "run_plan_my_day", completed: false, completedAt: null },
];

export default async (req: Request, context: Context) => {
  const correlationId = generateCorrelationId();

  // CORS headers
  const allowedOrigins = [
    "https://stageflow.startupstage.com",
    "https://stageflow-app.netlify.app",
    "http://localhost:8888",
    "http://localhost:5173",
  ];
  const requestOrigin = req.headers.get("origin") || "";
  const corsOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : "https://stageflow.startupstage.com";

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

    console.log(`[get-onboarding-state] [${correlationId}] User: ${userId}`);

    // Get organization ID from query params
    const url = new URL(req.url);
    const orgId = url.searchParams.get("orgId");

    if (!orgId) {
      return new Response(
        JSON.stringify({ success: false, error: "Organization ID required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = getSupabaseClient();

    // Check if onboarding state exists
    const { data: existingState, error: fetchError } = await supabase
      .from("onboarding_state")
      .select("*")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error(`[get-onboarding-state] [${correlationId}] Fetch error:`, fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch onboarding state" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // If state exists, check for auto-completion and return
    if (existingState) {
      const updatedChecklist = await checkAutoCompletion(
        supabase,
        existingState.checklist,
        userId,
        orgId
      );

      // Update if changes detected
      if (JSON.stringify(updatedChecklist) !== JSON.stringify(existingState.checklist)) {
        await supabase
          .from("onboarding_state")
          .update({ checklist: updatedChecklist })
          .eq("id", existingState.id);

        console.log(`[get-onboarding-state] [${correlationId}] Auto-completed items updated`);

        return new Response(
          JSON.stringify({
            success: true,
            onboarding: {
              ...existingState,
              checklist: updatedChecklist,
            },
          }),
          { status: 200, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ success: true, onboarding: existingState }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Create new onboarding state with auto-completion check
    const checklist = await checkAutoCompletion(
      supabase,
      DEFAULT_CHECKLIST,
      userId,
      orgId
    );

    const { data: newState, error: insertError } = await supabase
      .from("onboarding_state")
      .insert({
        user_id: userId,
        organization_id: orgId,
        checklist,
        dismissed: false,
      })
      .select()
      .single();

    if (insertError) {
      // Handle race condition - another request may have created it
      if (insertError.code === "23505") {
        const { data: raceState } = await supabase
          .from("onboarding_state")
          .select("*")
          .eq("user_id", userId)
          .eq("organization_id", orgId)
          .single();

        if (raceState) {
          return new Response(
            JSON.stringify({ success: true, onboarding: raceState }),
            { status: 200, headers: corsHeaders }
          );
        }
      }

      console.error(`[get-onboarding-state] [${correlationId}] Insert error:`, insertError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create onboarding state" }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log(`[get-onboarding-state] [${correlationId}] Created new onboarding state`);

    // Log telemetry event
    console.log(`[TELEMETRY] onboarding_state_created`, {
      correlationId,
      userId,
      organizationId: orgId,
    });

    return new Response(
      JSON.stringify({ success: true, onboarding: newState }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error(`[get-onboarding-state] [${correlationId}] Error:`, {
      message: error.message,
      code: error.code,
    });

    const isAuthError =
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.message?.includes("auth") ||
      error.message?.includes("token");

    if (isAuthError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Authentication required",
          code: "AUTH_REQUIRED",
        }),
        { status: 401, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An error occurred",
        code: "ONBOARDING_GET_ERROR",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

/**
 * Check for auto-completion of onboarding items based on actual data
 */
async function checkAutoCompletion(
  supabase: any,
  checklist: any[],
  userId: string,
  orgId: string
): Promise<any[]> {
  const now = new Date().toISOString();
  const updated = [...checklist];

  // Check each item that isn't already completed
  for (const item of updated) {
    if (item.completed) continue;

    switch (item.id) {
      case "create_first_deal": {
        // Check if org has any deals
        const { count } = await supabase
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null);

        if (count && count > 0) {
          item.completed = true;
          item.completedAt = now;
        }
        break;
      }

      case "move_deal_in_pipeline": {
        // Check if any deal has been moved (has last_activity after created)
        // This is a proxy for pipeline movement
        const { data: movedDeals } = await supabase
          .from("deals")
          .select("id, created, last_activity")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .limit(10);

        if (movedDeals) {
          const hasMoved = movedDeals.some(
            (d: any) => d.last_activity && d.created && d.last_activity !== d.created
          );
          if (hasMoved) {
            item.completed = true;
            item.completedAt = now;
          }
        }
        break;
      }

      case "configure_ai_provider": {
        // Check if org has any AI providers configured
        const { count } = await supabase
          .from("ai_providers")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("active", true);

        if (count && count > 0) {
          item.completed = true;
          item.completedAt = now;
        }
        break;
      }

      case "run_plan_my_day": {
        // Check AI usage for plan_my_day bucket
        const { count } = await supabase
          .from("rate_limits")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("bucket", "ai.plan_my_day")
          .gt("count", 0);

        if (count && count > 0) {
          item.completed = true;
          item.completedAt = now;
        }
        break;
      }
    }
  }

  return updated;
}
