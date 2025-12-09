import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// Phase 1 Telemetry: Request tracking and metrics
import {
  buildRequestContext,
  trackDealUpdate,
  trackTelemetryEvent,
  TelemetryEvents,
  calculateDuration,
} from "./lib/telemetry";
// PHASE 1 2025-12-08: Invariant validation for guaranteed response consistency
import {
  validateDealSchema,
  trackInvariantViolation,
  VALID_STAGES,
  isValidStageFormat
} from "./lib/invariant-validator";
// ENGINE REBUILD Phase 5: Centralized CORS config
import { buildCorsHeaders } from "./lib/cors";

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
  // ENGINE REBUILD Phase 5: Use centralized CORS config (fixes DEAL-102)
  const requestOrigin = req.headers.get("origin") || '';
  const corsHeaders: Record<string, string> = buildCorsHeaders(requestOrigin, { methods: 'POST, OPTIONS' });

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

  // Phase 1 Telemetry: Build request context for tracing
  // P0 FIX 2025-12-09: Wrap ctx initialization in try-catch to prevent uncaught exceptions
  // If buildRequestContext fails, we still want the function to work with a fallback context
  let ctx: { correlationId: string; endpoint: string; method: string; startTime: number; frontendStartTime: number | null };
  try {
    ctx = buildRequestContext(req, 'update-deal');
  } catch (ctxError) {
    console.warn('[update-deal] buildRequestContext failed, using fallback:', ctxError);
    ctx = {
      correlationId: `fallback-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      endpoint: 'update-deal',
      method: req.method,
      startTime: Date.now(),
      frontendStartTime: null
    };
  }

  // P0 FIX 2025-12-09: Wrap telemetry in try-catch - telemetry failures should never block the request
  try {
    trackTelemetryEvent(TelemetryEvents.DEAL_UPDATE_START, ctx.correlationId, {
      endpoint: ctx.endpoint,
      method: ctx.method,
    });
  } catch (telemetryError) {
    console.warn('[update-deal] Telemetry tracking failed (non-fatal):', telemetryError);
  }

  // Add correlation ID to response headers for end-to-end tracing
  corsHeaders['X-Correlation-ID'] = ctx.correlationId;

  try {
    // STEP 1: Authenticate user via HttpOnly cookies
    // PHASE 9 FIX: requireAuth returns User directly, not {user: User}
    // FIX 2025-12-03: Log auth attempt for production debugging
    console.log("[UPDATE_DEAL] Auth attempt starting...");

    const user = await requireAuth(req);
    const userId = user.id;

    console.log("[UPDATE_DEAL] Auth SUCCESS:", { userId });

    // STEP 2: Parse request body
    const body = await req.json();
    const { dealId, updates, organizationId } = body;

    if (!dealId || !updates || !organizationId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: dealId, updates, organizationId",
          code: "VALIDATION_ERROR"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // KANBAN DRAG FIX 2025-12-04: Enhanced logging for drag-drop debugging
    console.log("[KANBAN][BACKEND] Update request received:", {
      dealId,
      organizationId,
      updateKeys: Object.keys(updates),
      stageUpdate: updates.stage || 'no stage change',
      statusUpdate: updates.status || 'no status change'
    });

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
        JSON.stringify({
          success: false,
          error: "Not authorized for this organization",
          code: "FORBIDDEN"
        }),
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
        JSON.stringify({
          success: false,
          error: "Deal not found",
          code: "NOT_FOUND"
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    // STEP 6: Sanitize updates - only allow specific fields that exist in DB schema
    // P0 WAR ROOM FIX 2025-12-09: Removed fields that don't exist in DB schema:
    //   - company, expected_close, probability (caused PGRST204 errors)
    //   - client_name, name, contact_email, contact_phone (legacy aliases not in schema)
    // Only fields that actually exist in the deals table are allowed
    const allowedFields = [
      // Core deal fields (verified to exist in DB)
      "client", "email", "phone", "value", "stage", "status", "notes",
      "last_activity",
      // Lost fields (verified to exist)
      "lost_reason", "lost_reason_notes",
      // AI health fields (verified to exist)
      "ai_health_score", "ai_health_analysis", "ai_health_updated_at",
      // Deal assignment fields (verified to exist)
      "assigned_to", "assigned_by", "assigned_at",
      // Disqualification fields (verified to exist)
      "disqualified_reason_category", "disqualified_reason_notes",
      "stage_at_disqualification", "disqualified_at", "disqualified_by",
      // Unified outcome fields (verified to exist)
      "outcome_reason_category", "outcome_notes",
      "outcome_recorded_at", "outcome_recorded_by"
    ];

    const sanitizedUpdates: Record<string, any> = {};
    // M5 HARDENING 2025-12-04: Track ignored fields for debugging
    // This helps catch typos in field names (e.g., "clinet" instead of "client")
    const ignoredFields: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      // FIX 2025-12-02: Only include allowed fields AND filter out undefined values
      // Undefined values can break the Supabase JS client
      if (allowedFields.includes(key) && value !== undefined) {
        sanitizedUpdates[key] = value;
      } else {
        // M5 HARDENING: Track fields that were ignored
        // Don't track undefined values - those are expected to be filtered
        if (value !== undefined) {
          ignoredFields.push(key);
        }
      }
    }

    // M5 HARDENING: Log ignored fields for debugging
    if (ignoredFields.length > 0) {
      console.warn('[StageFlow][DEAL][WARN] update-deal ignored unknown fields:', {
        dealId,
        ignoredFields,
        hint: 'Check for typos in field names or add fields to allowedFields list'
      });
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No valid fields to update",
          code: "VALIDATION_ERROR"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // PHASE 14 FIX: Validate stage value if provided
    // P0 FIX 2025-12-08: Use PERMISSIVE validation to support custom pipeline stages
    // Organizations can create custom stages via pipeline_stages table
    // We only validate the format (lowercase snake_case), not against a hardcoded list
    if (sanitizedUpdates.stage) {
      if (!isValidStageFormat(sanitizedUpdates.stage)) {
        console.error("[KANBAN][BACKEND] ❌ Invalid stage format:", sanitizedUpdates.stage);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Invalid stage format: ${sanitizedUpdates.stage}. Stage must be lowercase with underscores.`,
            code: "VALIDATION_ERROR",
            hint: "Stage must be lowercase snake_case format (e.g., lead_captured, custom_stage)"
          }),
          { status: 400, headers: corsHeaders }
        );
      }
      // Warn if stage is not in known list (may be custom)
      if (!VALID_STAGES.has(sanitizedUpdates.stage)) {
        console.log("[KANBAN][BACKEND] ⚠️ Custom stage detected:", sanitizedUpdates.stage, "- allowing");
      } else {
        console.log("[KANBAN][BACKEND] ✓ Stage validation passed:", sanitizedUpdates.stage);
      }
    }

    // STEP 7: Validate lost/disqualified mutual exclusivity
    // Lost and Disqualified are STRICTLY mutually exclusive states
    // PHASE 4 2025-12-08: Also populate unified outcome fields
    // ENGINE REBUILD Phase 5 (DEAL-104): Auto-sync status from stage changes
    // If stage implies a status (e.g., deal_won → won), auto-set status
    let status = sanitizedUpdates.status || existingDeal.status;

    if (sanitizedUpdates.stage && !sanitizedUpdates.status) {
      // Check if the new stage implies a status change
      const STAGE_TO_STATUS: Record<string, string> = {
        'deal_won': 'won', 'closed_won': 'won', 'won': 'won', 'closed': 'won',
        'investment_closed': 'won', 'contract_signed': 'won', 'escrow_completed': 'won', 'payment_received': 'won',
        'deal_lost': 'lost', 'closed_lost': 'lost', 'lost': 'lost',
      };
      const impliedStatus = STAGE_TO_STATUS[sanitizedUpdates.stage];

      // If stage implies "active" (any non-terminal stage), revert to active
      if (!impliedStatus && (existingDeal.status === 'lost' || existingDeal.status === 'disqualified')) {
        console.log(`[update-deal] ⚠️ Stage "${sanitizedUpdates.stage}" implies active status - reverting from "${existingDeal.status}"`);
        sanitizedUpdates.status = 'active';
        status = 'active';
      } else if (impliedStatus && impliedStatus !== existingDeal.status) {
        console.log(`[update-deal] Auto-syncing status from "${existingDeal.status}" to "${impliedStatus}" based on stage "${sanitizedUpdates.stage}"`);
        sanitizedUpdates.status = impliedStatus;
        status = impliedStatus;
      }
    }

    // PHASE 4: Map legacy reason IDs to unified taxonomy
    const LEGACY_TO_UNIFIED_REASON: Record<string, string> = {
      // Lost reasons
      'competitor': 'competitor',
      'no_interest': 'no_interest',
      'budget': 'budget',
      'timing': 'timing',
      // Disqualified reasons
      'no_budget': 'budget',
      'not_a_fit': 'no_fit',
      'wrong_timing': 'timing',
      'went_with_competitor': 'competitor',
      'unresponsive': 'unresponsive',
      // Common
      'other': 'other'
    };

    if (status === 'lost') {
      // Lost deals must have a lost reason (check both legacy and unified fields)
      const hasLostReason = !!sanitizedUpdates.lost_reason || !!sanitizedUpdates.outcome_reason_category;
      const lostReason = sanitizedUpdates.lost_reason || sanitizedUpdates.outcome_reason_category;
      // ENGINE REBUILD Phase 5 (DEAL-103): Fixed duplicate condition bug
      // Check if reason is "other" OR starts with "Other:" (legacy custom format)
      const isOtherReason = lostReason === 'other' || (typeof lostReason === 'string' && lostReason.startsWith('Other:'));
      const hasLostNotes = isOtherReason
        ? !!(sanitizedUpdates.lost_reason_notes || sanitizedUpdates.outcome_notes)
        : true;

      if (sanitizedUpdates.status === 'lost' && (!hasLostReason || !hasLostNotes)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Lost deals must have a lost reason. If 'Other' is selected, notes are required.",
            code: "VALIDATION_ERROR"
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      // PHASE 4: Populate unified outcome fields from legacy fields if not already set
      if (sanitizedUpdates.lost_reason && !sanitizedUpdates.outcome_reason_category) {
        sanitizedUpdates.outcome_reason_category = LEGACY_TO_UNIFIED_REASON[sanitizedUpdates.lost_reason] || 'other';
      }
      if (sanitizedUpdates.lost_reason_notes && !sanitizedUpdates.outcome_notes) {
        sanitizedUpdates.outcome_notes = sanitizedUpdates.lost_reason_notes;
      }
      // Set outcome metadata
      if (!sanitizedUpdates.outcome_recorded_at) {
        sanitizedUpdates.outcome_recorded_at = new Date().toISOString();
      }
      if (!sanitizedUpdates.outcome_recorded_by) {
        sanitizedUpdates.outcome_recorded_by = userId;
      }

      // Clear any disqualified fields to keep the model clean
      sanitizedUpdates.disqualified_reason_category = null;
      sanitizedUpdates.disqualified_reason_notes = null;
      sanitizedUpdates.stage_at_disqualification = null;
      sanitizedUpdates.disqualified_at = null;
      sanitizedUpdates.disqualified_by = null;
    }

    if (status === 'disqualified') {
      // Disqualified deals must have a disqualified reason (check both legacy and unified fields)
      const hasDisqReason = !!sanitizedUpdates.disqualified_reason_notes ||
                            !!sanitizedUpdates.disqualified_reason_category ||
                            !!sanitizedUpdates.outcome_reason_category;

      if (sanitizedUpdates.status === 'disqualified' && !hasDisqReason) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Disqualified deals must include a disqualification reason.",
            code: "VALIDATION_ERROR"
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      // PHASE 4: Populate unified outcome fields from legacy fields if not already set
      if (sanitizedUpdates.disqualified_reason_category && !sanitizedUpdates.outcome_reason_category) {
        sanitizedUpdates.outcome_reason_category = LEGACY_TO_UNIFIED_REASON[sanitizedUpdates.disqualified_reason_category] || 'other';
      }
      if (sanitizedUpdates.disqualified_reason_notes && !sanitizedUpdates.outcome_notes) {
        sanitizedUpdates.outcome_notes = sanitizedUpdates.disqualified_reason_notes;
      }
      // Set outcome metadata (use disqualified_at/by if provided, otherwise generate)
      if (!sanitizedUpdates.outcome_recorded_at) {
        sanitizedUpdates.outcome_recorded_at = sanitizedUpdates.disqualified_at || new Date().toISOString();
      }
      if (!sanitizedUpdates.outcome_recorded_by) {
        sanitizedUpdates.outcome_recorded_by = sanitizedUpdates.disqualified_by || userId;
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
      // PHASE 4: Also clear unified outcome fields
      sanitizedUpdates.outcome_reason_category = null;
      sanitizedUpdates.outcome_notes = null;
      sanitizedUpdates.outcome_recorded_at = null;
      sanitizedUpdates.outcome_recorded_by = null;
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

      // FIX 2025-12-07: Comprehensive Supabase error classification
      // Return 400 for client errors, 500 only for true server errors
      // Added RLS errors (42501) and permission errors to client errors
      const isClientError =
        updateError.code === '23505' || // Unique constraint violation
        updateError.code === '23503' || // Foreign key violation
        updateError.code === '23502' || // Not null violation
        updateError.code === '22P02' || // Invalid text representation
        updateError.code === '22001' || // String data too long
        updateError.code === '42501' || // RLS policy violation (insufficient_privilege)
        updateError.code === '42P01' || // Undefined table
        updateError.code === 'PGRST116' || // PostgREST: Row not found
        updateError.code?.startsWith('22') || // Data exception
        updateError.code?.startsWith('23') || // Integrity constraint violation
        updateError.code?.startsWith('42'); // Syntax/Access rule violation

      const statusCode = isClientError ? 400 : 500;
      const errorCode = isClientError ? 'UPDATE_VALIDATION_ERROR' : 'SERVER_ERROR';

      return new Response(
        JSON.stringify({
          success: false,
          error: isClientError
            ? `Update failed: ${updateError.message}`
            : "Something went wrong updating this deal. Please try again.",
          code: errorCode,
          details: updateError.message
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

    console.log("[KANBAN][BACKEND] ✓ Update success:", {
      dealId,
      previousStage: existingDeal.stage,
      newStage: updatedDeal.stage,
      status: updatedDeal.status
    });

    // PHASE 1 2025-12-08: Backend invariant validation using centralized module
    // NEVER return success:true without a valid, complete deal object
    // This prevents false positive "100% success" conditions
    try {
      validateDealSchema(updatedDeal, 'update-deal');
    } catch (validationError: any) {
      // Track the violation for telemetry
      trackInvariantViolation('update-deal', validationError.code || 'UNKNOWN', {
        dealId,
        dealKeys: Object.keys(updatedDeal),
        error: validationError.message
      });

      console.error("[update-deal] INVARIANT VIOLATION:", validationError.message);

      // FIX 2025-12-08: Return 422 (Unprocessable Entity) instead of 500
      // This is a validation error, not a server error
      return new Response(
        JSON.stringify({
          success: false,
          error: "Update succeeded but deal data is incomplete. Please refresh and try again.",
          code: validationError.code || "INVARIANT_VIOLATION",
          details: validationError.message
        }),
        { status: 422, headers: corsHeaders }
      );
    }

    // Phase 1 Telemetry: Track successful deal update
    // P0 FIX 2025-12-09: Wrap in try-catch - telemetry failures should never block successful updates
    try {
      trackDealUpdate(ctx.correlationId, true, stageChanged, calculateDuration(ctx));
    } catch (telemetryError) {
      console.warn('[update-deal] Success telemetry failed (non-fatal):', telemetryError);
    }

    // FIX 2025-12-02: Include success: true for proper frontend error handling
    // M5 HARDENING 2025-12-04: Include ignoredFields for debugging
    const responseData: { success: boolean; deal: any; ignoredFields?: string[] } = {
      success: true,
      deal: updatedDeal
    };

    // Only include ignoredFields if there are any (keeps response clean)
    if (ignoredFields.length > 0) {
      responseData.ignoredFields = ignoredFields;
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    // Phase 1 Telemetry: Track failed deal update
    // P0 FIX 2025-12-09: Wrap in try-catch - telemetry failures should never mask the real error
    try {
      trackDealUpdate(ctx.correlationId, false, false, calculateDuration(ctx), error.code || 'UNKNOWN_ERROR');
    } catch (telemetryError) {
      console.warn('[update-deal] Error telemetry failed (non-fatal):', telemetryError);
    }

    // P0 FIX 2025-12-08: Precise logging with P0 tag for Netlify log search
    // This enables "Search logs for [StageFlow][P0][UPDATE_DEAL_FAILED]" investigation
    console.error("[StageFlow][P0][UPDATE_DEAL_FAILED]", {
      correlationId: ctx.correlationId,
      message: error?.message,
      name: error?.name,
      code: error?.code,
      statusCode: error?.statusCode,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      // Include request context for debugging
      requestMethod: req.method,
      timestamp: new Date().toISOString()
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
          success: false,
          error: error.message || "Authentication required",
          code: error.code || "AUTH_REQUIRED"
        }),
        { status: error.statusCode || 401, headers: corsHeaders }
      );
    }

    // PHASE E FIX: Return error with CORS headers (createErrorResponse doesn't include CORS)
    // FIX 2025-12-07: Return user-friendly message for server errors
    console.error("[update-deal] Non-auth error, returning 500");

    return new Response(
      JSON.stringify({
        success: false,
        error: "Something went wrong updating this deal. Please try again.",
        code: error.code || "SERVER_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
