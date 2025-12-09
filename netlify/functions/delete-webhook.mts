import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// ENGINE REBUILD Phase 9: Centralized CORS spine
import { buildCorsHeaders } from './lib/cors';

/**
 * DELETE WEBHOOK ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles webhook deletion
 * using HttpOnly cookie authentication.
 *
 * Note: Performs soft delete (sets is_active = false) rather than hard delete.
 *
 * Used by:
 * - Integrations.jsx WebhooksTab (delete webhook button)
 */

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
    // STEP 1: Authenticate user via HttpOnly cookies
    // PHASE 9 FIX: requireAuth returns User directly, not {user: User}
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[delete-webhook] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { webhookId, organizationId } = body;

    if (!webhookId || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: webhookId, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[delete-webhook] Delete request:", { webhookId, organizationId });

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
      console.error("[delete-webhook] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Verify webhook exists and belongs to organization
    const { data: existingWebhook, error: webhookCheckError } = await supabase
      .from("webhooks")
      .select("id, organization_id, is_active")
      .eq("id", webhookId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (webhookCheckError || !existingWebhook) {
      console.error("[delete-webhook] Webhook not found:", { webhookId, organizationId, error: webhookCheckError });
      return new Response(
        JSON.stringify({ error: "Webhook not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // Check if already inactive
    if (!existingWebhook.is_active) {
      console.warn("[delete-webhook] Webhook already inactive:", { webhookId });
      return new Response(
        JSON.stringify({ error: "Webhook already deleted", code: "ALREADY_DELETED" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // STEP 6: Soft delete - set is_active to false
    const { data: deletedWebhook, error: deleteError } = await supabase
      .from("webhooks")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", webhookId)
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (deleteError) {
      console.error("[delete-webhook] Delete failed:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete webhook", details: deleteError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.warn("[delete-webhook] Success:", { webhookId });

    return new Response(JSON.stringify({ success: true, webhook: deletedWebhook }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[delete-webhook] Error:", error);

    // Handle auth errors specifically
    if (error.message?.includes("auth") || error.message?.includes("unauthorized")) {
      return new Response(
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // PHASE F FIX: Return error with CORS headers
    const errorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while deleting webhook';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "DELETE_WEBHOOK_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
