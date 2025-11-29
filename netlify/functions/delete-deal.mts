import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
import { createErrorResponse } from "./lib/error-sanitizer";

/**
 * DELETE DEAL ENDPOINT (Soft Delete)
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles deal soft-deletion
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - useDealManagement.js (syncOfflineCommands, delete operations)
 * - DealDetailsModal.jsx (delete button)
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

    console.warn("[delete-deal] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { dealId, organizationId } = body;

    if (!dealId || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: dealId, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[delete-deal] Delete request:", { dealId, organizationId });

    // STEP 3: Get Supabase client with service role (bypasses RLS)
    const supabase = getSupabaseClient();

    // STEP 4: Verify user belongs to organization
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (membershipError || !membership) {
      console.error("[delete-deal] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Verify deal exists and belongs to organization
    const { data: existingDeal, error: dealCheckError } = await supabase
      .from("deals")
      .select("id, organization_id, stage, deleted_at")
      .eq("id", dealId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (dealCheckError || !existingDeal) {
      console.error("[delete-deal] Deal not found:", { dealId, organizationId, error: dealCheckError });
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Check if already deleted
    if (existingDeal.deleted_at) {
      console.warn("[delete-deal] Deal already deleted:", { dealId });
      return new Response(
        JSON.stringify({ error: "Deal already deleted", code: "ALREADY_DELETED" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // STEP 6: Soft delete - set deleted_at and deleted_by
    const { data: deletedDeal, error: deleteError } = await supabase
      .from("deals")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
      })
      .eq("id", dealId)
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (deleteError) {
      console.error("[delete-deal] Delete failed:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete deal", details: deleteError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.warn("[delete-deal] Success:", { dealId, deletedAt: deletedDeal.deleted_at });

    return new Response(JSON.stringify({ success: true, deal: deletedDeal }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[delete-deal] Error:", error);

    // Handle auth errors specifically
    if (error.message?.includes("auth") || error.message?.includes("unauthorized")) {
      return new Response(
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: corsHeaders }
      );
    }

    return createErrorResponse(error, 500, "delete-deal", "DELETE_DEAL_ERROR");
  }
};
