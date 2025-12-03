import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// PHASE E: Removed unused createErrorResponse import - using manual CORS response instead

/**
 * UPDATE DEAL ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles deal updates
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - DealDetailsModal.jsx (stage dropdown, form changes)
 * - KanbanBoard.jsx (drag-and-drop)
 * - useDealManagement.js (all deal operations)
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

    console.warn("[update-deal] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { dealId, updates, organizationId } = body;

    if (!dealId || !updates || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: dealId, updates, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[update-deal] Update request:", { dealId, organizationId, updateKeys: Object.keys(updates) });

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
      console.error("[update-deal] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Verify deal belongs to organization
    // FIX 2025-12-03: Added 'status' to select - needed for lost/disqualified validation
    const { data: existingDeal, error: dealCheckError } = await supabase
      .from("deals")
      .select("id, organization_id, stage, status")
      .eq("id", dealId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (dealCheckError || !existingDeal) {
      console.error("[update-deal] Deal not found:", { dealId, organizationId, error: dealCheckError });
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    // STEP 6: Sanitize updates - only allow specific fields
    // FIX 2025-12-02: Added client, email, phone (frontend field names)
    // alongside contact_name, contact_email, contact_phone (legacy/alternate names)
    const allowedFields = [
      // Core deal fields - support both naming conventions
      "client", "client_name", "name",
      "email", "contact_email",
      "phone", "contact_phone",
      "value", "stage", "status", "probability",
      "company", "notes", "expected_close", "last_activity",
      "lost_reason", "lost_reason_notes",
      // AI health fields
      "ai_health_score", "ai_health_analysis", "ai_health_updated_at",
      // Deal assignment fields
      "assigned_to", "assigned_by", "assigned_at",
      // Disqualification fields
      "disqualified_reason_category", "disqualified_reason_notes",
      "stage_at_disqualification", "disqualified_at", "disqualified_by"
    ];

    const sanitizedUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      // FIX 2025-12-02: Only include allowed fields AND filter out undefined values
      // Undefined values can break the Supabase JS client
      if (allowedFields.includes(key) && value !== undefined) {
        sanitizedUpdates[key] = value;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid fields to update" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // PHASE 14 FIX: Validate stage value if provided
    // Comprehensive list matching ALL pipeline templates
    if (sanitizedUpdates.stage) {
      const VALID_STAGES = new Set([
        // Legacy default pipeline stages
        "lead", "quote", "approval", "invoice", "onboarding", "delivery", "retention", "lost",
        // Default (StageFlow) pipeline
        "lead_captured", "lead_qualified", "contacted", "needs_identified", "proposal_sent",
        "negotiation", "deal_won", "deal_lost", "invoice_sent", "payment_received", "customer_onboarded",
        // Healthcare pipeline
        "lead_generation", "lead_qualification", "discovery", "scope_defined", "contract_sent",
        "client_onboarding", "renewal_upsell",
        // VC/PE pipeline
        "deal_sourced", "initial_screening", "due_diligence", "term_sheet_presented",
        "investment_closed", "capital_call_sent", "capital_received", "portfolio_mgmt",
        // Real Estate pipeline
        "qualification", "property_showing", "contract_signed", "closing_statement_sent",
        "escrow_completed", "client_followup",
        // Professional Services pipeline
        "lead_identified",
        // SaaS pipeline
        "prospecting", "contact", "proposal", "closed", "adoption", "renewal",
        // Additional stages from pipelineConfig.js
        "discovery_demo", "contract", "payment", "closed_won", "passed"
      ]);

      if (!VALID_STAGES.has(sanitizedUpdates.stage)) {
        console.error("[update-deal] Invalid stage value:", sanitizedUpdates.stage);
        return new Response(
          JSON.stringify({
            error: `Invalid stage value: ${sanitizedUpdates.stage}`,
            hint: "Stage must be a valid pipeline stage"
          }),
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // STEP 7: Validate lost/disqualified mutual exclusivity
    // Lost and Disqualified are STRICTLY mutually exclusive states
    const status = sanitizedUpdates.status || existingDeal.status;

    if (status === 'lost') {
      // Lost deals must have a lost reason
      const hasLostReason = !!sanitizedUpdates.lost_reason;
      const hasLostNotes = sanitizedUpdates.lost_reason === 'other'
        ? !!sanitizedUpdates.lost_reason_notes
        : true;

      if (sanitizedUpdates.status === 'lost' && (!hasLostReason || !hasLostNotes)) {
        return new Response(
          JSON.stringify({
            error: "Lost deals must have a lost reason. If 'Other' is selected, notes are required."
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Clear any disqualified fields to keep the model clean
      sanitizedUpdates.disqualified_reason_category = null;
      sanitizedUpdates.disqualified_reason_notes = null;
      sanitizedUpdates.stage_at_disqualification = null;
      sanitizedUpdates.disqualified_at = null;
      sanitizedUpdates.disqualified_by = null;
    }

    if (status === 'disqualified') {
      // Disqualified deals must have a disqualified reason
      const hasDisqReason = !!sanitizedUpdates.disqualified_reason_notes ||
                            !!sanitizedUpdates.disqualified_reason_category;

      if (sanitizedUpdates.status === 'disqualified' && !hasDisqReason) {
        return new Response(
          JSON.stringify({
            error: "Disqualified deals must include a disqualification reason."
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Clear any lost fields to keep them mutually exclusive
      sanitizedUpdates.lost_reason = null;
      sanitizedUpdates.lost_reason_notes = null;
    }

    // For active/won/etc., clear both sets of reason fields
    if (status !== 'lost' && status !== 'disqualified') {
      sanitizedUpdates.lost_reason = null;
      sanitizedUpdates.lost_reason_notes = null;
      sanitizedUpdates.disqualified_reason_category = null;
      sanitizedUpdates.disqualified_reason_notes = null;
      sanitizedUpdates.stage_at_disqualification = null;
      sanitizedUpdates.disqualified_at = null;
      sanitizedUpdates.disqualified_by = null;
    }

    // STEP 8: Track stage changes for history
    const stageChanged = sanitizedUpdates.stage && sanitizedUpdates.stage !== existingDeal.stage;

    // STEP 9: Perform the update
    const { data: updatedDeal, error: updateError } = await supabase
      .from("deals")
      .update(sanitizedUpdates)
      .eq("id", dealId)
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (updateError) {
      console.error("[update-deal] Update failed:", {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        dealId,
        organizationId,
        updateKeys: Object.keys(sanitizedUpdates)
      });

      // FIX 2025-12-03: Classify Supabase errors properly
      // Return 400 for client errors, 500 only for true server errors
      const isClientError =
        updateError.code === '23505' || // Unique constraint violation
        updateError.code === '23503' || // Foreign key violation
        updateError.code === '23502' || // Not null violation
        updateError.code === '22P02' || // Invalid text representation
        updateError.code === '22001' || // String data too long
        updateError.code?.startsWith('22') || // Data exception
        updateError.code?.startsWith('23'); // Integrity constraint violation

      const statusCode = isClientError ? 400 : 500;

      return new Response(
        JSON.stringify({
          error: "Failed to update deal",
          details: updateError.message,
          code: updateError.code || 'UPDATE_ERROR'
        }),
        { status: statusCode, headers: corsHeaders }
      );
    }

    // STEP 10: Record stage history if stage changed
    if (stageChanged) {
      try {
        await supabase.from("deal_stage_history").insert({
          deal_id: dealId,
          previous_stage: existingDeal.stage,
          new_stage: sanitizedUpdates.stage,
          changed_by: userId,
          changed_at: new Date().toISOString(),
        });
        console.warn("[update-deal] Stage history recorded");
      } catch (historyError) {
        // Non-fatal - log but don't fail the request
        console.warn("[update-deal] Failed to record stage history:", historyError);
      }
    }

    console.warn("[update-deal] Success:", { dealId, stage: updatedDeal.stage });

    // FIX 2025-12-02: Include success: true for proper frontend error handling
    return new Response(JSON.stringify({ success: true, deal: updatedDeal }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    // FIX 2025-12-03: Enhanced error logging for debugging production issues
    console.error("[update-deal] Error caught:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode,
      stack: error.stack?.split('\n').slice(0, 3).join('\n') // First 3 lines of stack
    });

    // FIX 2025-12-03: More comprehensive auth error detection
    // Check multiple properties since error structure may vary between auth-errors.ts and runtime errors
    const errorMessage = error.message?.toLowerCase() || '';
    const errorName = error.name || '';
    const errorCode = error.code || '';

    const isAuthError =
      // Status code checks
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      // Custom error class names from auth-errors.ts
      errorName === 'UnauthorizedError' ||
      errorName === 'TokenExpiredError' ||
      errorName === 'InvalidTokenError' ||
      errorName === 'ForbiddenError' ||
      errorName === 'OrganizationAccessError' ||
      // Error codes
      errorCode === 'UNAUTHORIZED' ||
      errorCode === 'TOKEN_EXPIRED' ||
      errorCode === 'INVALID_TOKEN' ||
      errorCode === 'AUTH_REQUIRED' ||
      errorCode === 'NO_SESSION' ||
      errorCode === 'SESSION_INVALID' ||
      errorCode === 'SESSION_ROTATED' ||
      // Message content checks (case-insensitive)
      errorMessage.includes('auth') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('token') ||
      errorMessage.includes('cookie') ||
      errorMessage.includes('session') ||
      errorMessage.includes('not authenticated') ||
      errorMessage.includes('login');

    if (isAuthError) {
      console.warn("[update-deal] Auth error detected, returning 401");
      return new Response(
        JSON.stringify({
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    // PHASE E FIX: Return error with CORS headers (createErrorResponse doesn't include CORS)
    const safeErrorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while updating the deal';

    console.error("[update-deal] Non-auth error, returning 500:", safeErrorMessage);

    return new Response(
      JSON.stringify({
        error: safeErrorMessage,
        code: error.code || "UPDATE_DEAL_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
