import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";

// Simple correlation ID generator
const generateCorrelationId = () => `onb-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

/**
 * UPDATE ONBOARDING STATE
 * Area 6 - First-Run Onboarding Experience
 *
 * Updates the user's onboarding checklist state:
 * - Mark individual items as complete
 * - Dismiss the entire onboarding UI
 *
 * Input body:
 * - itemId: string (optional) - Mark a specific item as complete
 * - dismissed: boolean (optional) - Dismiss onboarding entirely
 * - orgId: string (required) - Organization ID
 */

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
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;

    // Parse body
    const body = await req.json();
    const { orgId, itemId, dismissed } = body;

    console.log(`[update-onboarding-state] [${correlationId}] User: ${userId}, OrgId: ${orgId}, ItemId: ${itemId}, Dismissed: ${dismissed}`);

    if (!orgId) {
      return new Response(
        JSON.stringify({ success: false, error: "Organization ID required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = getSupabaseClient();

    // Get current state
    const { data: currentState, error: fetchError } = await supabase
      .from("onboarding_state")
      .select("*")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error(`[update-onboarding-state] [${correlationId}] Fetch error:`, fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch onboarding state" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // If no state exists, create one first
    if (!currentState) {
      const DEFAULT_CHECKLIST = [
        { id: "create_first_deal", completed: false, completedAt: null },
        { id: "move_deal_in_pipeline", completed: false, completedAt: null },
        { id: "configure_ai_provider", completed: false, completedAt: null },
        { id: "run_plan_my_day", completed: false, completedAt: null },
      ];

      const { data: newState, error: insertError } = await supabase
        .from("onboarding_state")
        .insert({
          user_id: userId,
          organization_id: orgId,
          checklist: DEFAULT_CHECKLIST,
          dismissed: false,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`[update-onboarding-state] [${correlationId}] Insert error:`, insertError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to create onboarding state" }),
          { status: 500, headers: corsHeaders }
        );
      }

      // Continue with the new state
      return handleUpdate(supabase, newState, { itemId, dismissed }, correlationId, userId, orgId, corsHeaders);
    }

    return handleUpdate(supabase, currentState, { itemId, dismissed }, correlationId, userId, orgId, corsHeaders);
  } catch (error: any) {
    console.error(`[update-onboarding-state] [${correlationId}] Error:`, {
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
        code: "ONBOARDING_UPDATE_ERROR",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

/**
 * Handle the actual update logic
 */
async function handleUpdate(
  supabase: any,
  state: any,
  updates: { itemId?: string; dismissed?: boolean },
  correlationId: string,
  userId: string,
  orgId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { itemId, dismissed } = updates;
  const now = new Date().toISOString();

  let updatedChecklist = [...state.checklist];
  let updatedDismissed = state.dismissed;

  // Handle dismissal
  if (dismissed === true) {
    updatedDismissed = true;

    // Log telemetry
    console.log(`[TELEMETRY] onboarding_dismissed`, {
      correlationId,
      userId,
      organizationId: orgId,
      completedSteps: updatedChecklist.filter((i: any) => i.completed).length,
      totalSteps: updatedChecklist.length,
    });
  }

  // Handle item completion
  if (itemId) {
    const itemIndex = updatedChecklist.findIndex((i: any) => i.id === itemId);
    if (itemIndex !== -1 && !updatedChecklist[itemIndex].completed) {
      updatedChecklist[itemIndex] = {
        ...updatedChecklist[itemIndex],
        completed: true,
        completedAt: now,
      };

      // Log telemetry
      console.log(`[TELEMETRY] onboarding_step_completed`, {
        correlationId,
        userId,
        organizationId: orgId,
        stepId: itemId,
        completedSteps: updatedChecklist.filter((i: any) => i.completed).length,
        totalSteps: updatedChecklist.length,
      });
    }
  }

  // Update the database
  const { data: updated, error: updateError } = await supabase
    .from("onboarding_state")
    .update({
      checklist: updatedChecklist,
      dismissed: updatedDismissed,
    })
    .eq("id", state.id)
    .select()
    .single();

  if (updateError) {
    console.error(`[update-onboarding-state] [${correlationId}] Update error:`, updateError);
    return new Response(
      JSON.stringify({ success: false, error: "Failed to update onboarding state" }),
      { status: 500, headers: corsHeaders }
    );
  }

  console.log(`[update-onboarding-state] [${correlationId}] Updated successfully`);

  return new Response(
    JSON.stringify({ success: true, onboarding: updated }),
    { status: 200, headers: corsHeaders }
  );
}
