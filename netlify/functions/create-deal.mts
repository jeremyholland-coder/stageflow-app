import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// P0 FIX 2025-12-09: Import AuthError for instanceof checks (more reliable than name checks)
import { AuthError } from "./lib/auth-errors";
// PHASE 1 2025-12-08: Invariant validation for guaranteed response consistency
import {
  validateDealSchema,
  trackInvariantViolation,
  VALID_STAGES,
  isValidStageFormat
} from "./lib/invariant-validator";
// ENGINE REBUILD Phase 5: Centralized CORS config
import { buildCorsHeaders, getCorsOrigin, ALLOWED_ORIGINS } from "./lib/cors";
// PHASE E: Removed unused createErrorResponse import - using manual CORS response instead

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
  // FIX: Early environment variable validation to catch config issues
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[create-deal] CRITICAL: Missing environment variables", {
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: "Server configuration error",
        code: "ENV_CONFIG_ERROR"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // ENGINE REBUILD Phase 5: Use centralized CORS config (fixes DEAL-102)
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
    // CRITICAL FIX: requireAuth returns User directly, not { user: User }
    const user = await requireAuth(req);
    const userId = user.id;

    console.warn("[create-deal] Authenticated user:", userId);

    // STEP 2: Parse request body with defensive error handling
    // FIX: JSON parsing could fail if body is malformed, causing 500 without clear message
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("[create-deal] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body - expected JSON" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const { dealData, organizationId } = body;

    if (!dealData || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: dealData, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // FIX: Validate organizationId is a valid UUID to catch data corruption early
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(organizationId)) {
      console.error("[create-deal] Invalid organizationId format:", organizationId);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid organization ID format" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // FIX: Validate required client field - frontend requires it but server should validate too
    if (!dealData.client || typeof dealData.client !== 'string' || dealData.client.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Client name is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[create-deal] Create request:", { organizationId, dealKeys: Object.keys(dealData) });

    // STEP 3: Get Supabase client with service role (bypasses RLS)
    // PHASE I FIX: Wrap in explicit try-catch to identify pool initialization failures
    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (poolError: any) {
      console.error("[create-deal] Supabase pool initialization failed:", {
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
      console.error("[create-deal] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ success: false, error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Sanitize deal data - only allow specific fields that exist in DB schema
    // PHASE 10 FIX: Removed columns that don't exist in DB schema:
    //   - company, contact_name, contact_email, contact_phone, expected_close, probability, source
    //   These caused PGRST204 errors
    const allowedFields = [
      "client", "email", "phone", "value", "stage", "status", "notes"
    ];

    // PHASE K FIX: removed `created_by` - column doesn't exist in deals table
    // The deals table tracks ownership via organization_id, not individual user
    // FIX: Set assigned_to to the current user to ensure all new deals have an owner
    // This prevents "Unknown Member" in Team Performance and enables deal assignment
    const sanitizedDeal: Record<string, any> = {
      organization_id: organizationId,
      created: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      assigned_to: userId, // Default owner is the user creating the deal
      assigned_at: new Date().toISOString(),
    };

    for (const [key, value] of Object.entries(dealData)) {
      if (allowedFields.includes(key)) {
        sanitizedDeal[key] = value;
      }
    }

    // PHASE 14 FIX: Comprehensive stage validation
    // PHASE 1 2025-12-08: Uses centralized VALID_STAGES from invariant-validator

    // Ensure required fields have defaults
    if (!sanitizedDeal.status) sanitizedDeal.status = "active";
    if (!sanitizedDeal.value) sanitizedDeal.value = 0;
    if (!sanitizedDeal.stage) sanitizedDeal.stage = "lead"; // Default to first stage

    // Ensure value is a number
    if (typeof sanitizedDeal.value === 'string') {
      sanitizedDeal.value = parseFloat(sanitizedDeal.value) || 0;
    }

    // ENGINE REBUILD Phase 5: PERMISSIVE stage validation (fixes DEAL-101)
    // Use same logic as update-deal.mts - allow custom stages, just validate format
    if (!isValidStageFormat(sanitizedDeal.stage)) {
      console.error("[create-deal] Invalid stage format:", sanitizedDeal.stage);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid stage format: ${sanitizedDeal.stage}. Stage must be lowercase snake_case.`,
          code: "VALIDATION_ERROR",
          hint: "Stage must be lowercase snake_case format (e.g., lead_captured, custom_stage)"
        }),
        { status: 400, headers: corsHeaders }
      );
    }
    // Warn if stage is not in known list (may be custom)
    if (!VALID_STAGES.has(sanitizedDeal.stage)) {
      console.log("[create-deal] ⚠️ Custom stage detected:", sanitizedDeal.stage, "- allowing");
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

      // DEAL-BUG-1 FIX 2025-12-09: Classify Supabase errors properly
      // Return 400 for client errors, 500 only for true server errors
      // Same classification logic as update-deal.mts
      const isClientError =
        insertError.code === '23505' || // Unique constraint violation
        insertError.code === '23503' || // Foreign key violation
        insertError.code === '23502' || // Not null violation
        insertError.code === '22P02' || // Invalid text representation
        insertError.code === '22001' || // String data too long
        insertError.code === '42501' || // RLS policy violation
        insertError.code === '42P01' || // Undefined table
        insertError.code === 'PGRST116' || // PostgREST: Row not found
        insertError.code?.startsWith('22') || // Data exception
        insertError.code?.startsWith('23') || // Integrity constraint violation
        insertError.code?.startsWith('42'); // Syntax/Access rule violation

      const statusCode = isClientError ? 400 : 500;
      const errorCode = isClientError ? 'CREATE_VALIDATION_ERROR' : 'SERVER_ERROR';

      return new Response(
        JSON.stringify({
          success: false,
          error: isClientError
            ? `Failed to create deal: ${insertError.message}`
            : "Something went wrong creating this deal. Please try again.",
          code: errorCode,
          details: insertError.message,
          hint: insertError.hint
        }),
        { status: statusCode, headers: corsHeaders }
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

    // PHASE 1 2025-12-08: Backend invariant validation using centralized module
    // NEVER return success:true without a valid, complete deal object
    // This prevents false positive "100% success" conditions
    try {
      validateDealSchema(newDeal, 'create-deal');
    } catch (validationError: any) {
      // Track the violation for telemetry
      trackInvariantViolation('create-deal', validationError.code || 'UNKNOWN', {
        dealId: newDeal?.id,
        dealKeys: Object.keys(newDeal || {}),
        error: validationError.message
      });

      console.error("[create-deal] INVARIANT VIOLATION:", validationError.message);

      // DEAL-BUG-2 FIX 2025-12-09: Return 422 (Unprocessable Entity), not 500
      // This is a validation error after successful insert, not a server error
      return new Response(
        JSON.stringify({
          success: false,
          error: "Deal was created but data is incomplete. Please refresh and try again.",
          code: validationError.code || "INVARIANT_VIOLATION",
          details: validationError.message
        }),
        { status: 422, headers: corsHeaders }
      );
    }

    // FIX: Include success: true in response for consistent API shape
    return new Response(JSON.stringify({ success: true, deal: newDeal }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    // Enhanced error logging for debugging
    console.error("[create-deal] Error:", {
      message: error.message,
      code: error.code,
      name: error.name,
      statusCode: error.statusCode,
      stack: error.stack?.split('\n').slice(0, 3).join('\n') // First 3 lines of stack
    });

    // P0 FIX 2025-12-09: Use instanceof AuthError FIRST (most reliable check)
    // instanceof works even when error.name is mangled by minification
    if (error instanceof AuthError) {
      console.warn("[create-deal] AuthError instance detected, returning", error.statusCode || 401);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    // PHASE G FIX: Fallback auth error detection for non-AuthError errors
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    const isAuthError = error.statusCode === 401 ||
                        error.statusCode === 403 ||
                        errorCode === 'UNAUTHORIZED' ||
                        errorCode === 'TOKEN_EXPIRED' ||
                        errorCode === 'INVALID_TOKEN' ||
                        errorCode === 'AUTH_REQUIRED' ||
                        errorCode === 'NO_SESSION' ||
                        errorCode === 'SESSION_INVALID' ||
                        errorCode === 'SESSION_ROTATED' ||
                        error.name === 'UnauthorizedError' ||
                        error.name === 'TokenExpiredError' ||
                        error.name === 'InvalidTokenError' ||
                        error.name === 'AuthError' ||
                        errorMessage.includes("auth") ||
                        errorMessage.includes("unauthorized") ||
                        errorMessage.includes("token") ||
                        errorMessage.includes("cookie") ||
                        errorMessage.includes("session") ||
                        errorMessage.includes("please log in");

    if (isAuthError) {
      console.warn("[create-deal] Auth error detected via fallback checks, returning", error.statusCode || 401);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    // FIX 2025-12-09: JSON parse errors should return 400, not 500
    // This happens when client sends malformed JSON in request body
    if (error.name === 'SyntaxError' || errorMessage.includes('json') || errorMessage.includes('unexpected token')) {
      console.warn("[create-deal] JSON parse error detected, returning 400");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request format. Please check your data and try again.",
          code: "INVALID_JSON"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Handle RLS/permission errors
    if (error.code === "42501" || error.message?.includes("permission denied")) {
      console.error("[create-deal] RLS policy violation - check team_members/deals RLS");
      return new Response(
        JSON.stringify({ success: false, error: "Permission denied", code: "PERMISSION_DENIED" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // PHASE E FIX: Return error with CORS headers (createErrorResponse doesn't include CORS)
    // Without CORS headers, browser blocks the response and shows generic error
    // P0 FIX 2025-12-10: Renamed to finalErrorMessage to avoid duplicate declaration (line 365)
    const finalErrorMessage = typeof error.message === 'string'
      ? error.message
      : 'An error occurred while creating the deal';

    // FIX: Include diagnostic info in response (safe for client, helps debugging)
    return new Response(
      JSON.stringify({
        success: false,
        error: finalErrorMessage,
        code: error.code || "CREATE_DEAL_ERROR",
        // Include hint for common issues (safe to expose)
        hint: error.hint || (error.code === '23505' ? 'Duplicate entry detected' :
              error.code === '23503' ? 'Referenced record not found' :
              error.code === '42501' ? 'Permission denied - check RLS policies' : undefined)
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
