import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
import { createErrorResponse } from "./lib/error-sanitizer";

/**
 * CREATE DEAL ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations and RPCs fail RLS. This endpoint handles deal creation
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - NewDealModal.jsx (create new deal form)
 */

export default async (req: Request, context: Context) => {
  // PHASE 10 FIX: Secure CORS with whitelist instead of wildcard
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
    // CRITICAL FIX: requireAuth returns User directly, not { user: User }
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[create-deal] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { dealData, organizationId } = body;

    if (!dealData || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: dealData, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[create-deal] Create request:", { organizationId, dealKeys: Object.keys(dealData) });

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
      console.error("[create-deal] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Sanitize deal data - only allow specific fields
    const allowedFields = [
      "client", "email", "phone", "value", "stage", "status", "notes",
      "company", "contact_name", "contact_email", "contact_phone",
      "expected_close", "probability", "source"
    ];

    const sanitizedDeal: Record<string, any> = {
      organization_id: organizationId,
      created_by: userId,
      created: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    };

    for (const [key, value] of Object.entries(dealData)) {
      if (allowedFields.includes(key)) {
        sanitizedDeal[key] = value;
      }
    }

    // PHASE 14 FIX: Comprehensive stage validation
    // All valid stages from ALL pipeline templates (healthcare, vc_pe, real_estate, professional_services, saas, default)
    // Plus legacy stages and stages from pipelineConfig.js
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

    // Ensure required fields have defaults
    if (!sanitizedDeal.status) sanitizedDeal.status = "active";
    if (!sanitizedDeal.value) sanitizedDeal.value = 0;
    if (!sanitizedDeal.stage) sanitizedDeal.stage = "lead"; // Default to first stage

    // Ensure value is a number
    if (typeof sanitizedDeal.value === 'string') {
      sanitizedDeal.value = parseFloat(sanitizedDeal.value) || 0;
    }

    // Validate stage value
    if (!VALID_STAGES.has(sanitizedDeal.stage)) {
      console.error("[create-deal] Invalid stage value:", sanitizedDeal.stage);
      return new Response(
        JSON.stringify({
          error: `Invalid stage value: ${sanitizedDeal.stage}`,
          hint: "Stage must be a valid pipeline stage"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[create-deal] Sanitized deal data:", {
      stage: sanitizedDeal.stage,
      status: sanitizedDeal.status,
      value: sanitizedDeal.value,
      valueType: typeof sanitizedDeal.value,
      hasClient: !!sanitizedDeal.client
    });

    // STEP 6: Insert the deal
    // PHASE 11 LOGGING: Log full deal data before insert for debugging
    console.warn("[create-deal] Inserting deal:", {
      client: sanitizedDeal.client,
      stage: sanitizedDeal.stage,
      status: sanitizedDeal.status,
      value: sanitizedDeal.value,
      organization_id: sanitizedDeal.organization_id,
      created_by: sanitizedDeal.created_by,
      hasNotes: !!sanitizedDeal.notes
    });

    const { data: newDeal, error: insertError } = await supabase
      .from("deals")
      .insert(sanitizedDeal)
      .select()
      .single();

    if (insertError) {
      // PHASE 11: Enhanced error logging with full Supabase error details
      console.error("[create-deal] Insert FAILED:", {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        // Log the sanitized deal (without sensitive data) to see what was being inserted
        dealData: {
          stage: sanitizedDeal.stage,
          status: sanitizedDeal.status,
          value: sanitizedDeal.value,
          valueType: typeof sanitizedDeal.value,
          organization_id: sanitizedDeal.organization_id
        }
      });
      return new Response(
        JSON.stringify({
          error: "Failed to create deal",
          details: insertError.message,
          code: insertError.code,
          hint: insertError.hint
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    // STEP 7: Record initial stage history
    if (newDeal && newDeal.stage) {
      try {
        await supabase.from("deal_stage_history").insert({
          deal_id: newDeal.id,
          previous_stage: null,
          new_stage: newDeal.stage,
          changed_by: userId,
          changed_at: new Date().toISOString(),
        });
        console.warn("[create-deal] Initial stage history recorded");
      } catch (historyError) {
        // Non-fatal - log but don't fail the request
        console.warn("[create-deal] Failed to record initial stage history:", historyError);
      }
    }

    console.warn("[create-deal] Success:", { dealId: newDeal.id, stage: newDeal.stage });

    return new Response(JSON.stringify({ deal: newDeal }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    // Enhanced error logging for debugging
    console.error("[create-deal] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack?.split('\n').slice(0, 3).join('\n') // First 3 lines of stack
    });

    // Handle auth errors specifically
    if (error.message?.includes("auth") || error.message?.includes("unauthorized") || error.message?.includes("token")) {
      return new Response(
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Handle RLS/permission errors
    if (error.code === "42501" || error.message?.includes("permission denied")) {
      console.error("[create-deal] RLS policy violation - check team_members/deals RLS");
      return new Response(
        JSON.stringify({ error: "Permission denied", code: "PERMISSION_DENIED" }),
        { status: 403, headers: corsHeaders }
      );
    }

    return createErrorResponse(error, 500, "create-deal", "CREATE_DEAL_ERROR");
  }
};
