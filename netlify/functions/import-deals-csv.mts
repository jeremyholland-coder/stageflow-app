import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
import { createErrorResponse } from "./lib/error-sanitizer";

/**
 * IMPORT DEALS FROM CSV ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles bulk deal imports
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - Integrations.jsx CSVImportTab (CSV import functionality)
 */

// Allowed fields for deal creation
const ALLOWED_FIELDS = [
  "client", "email", "phone", "value", "stage", "status", "notes",
  "company", "contact_name", "contact_email", "contact_phone"
];

// Valid stages and statuses
const VALID_STAGES = ["lead", "quote", "approval", "invoice", "onboarding", "delivery", "retention"];
const VALID_STATUSES = ["active", "won", "lost"];

// Limits
const MAX_BATCH_SIZE = 100;
const MAX_TOTAL_ROWS = 1000;

interface DealRow {
  client?: string;
  email?: string;
  phone?: string;
  value?: number | string;
  stage?: string;
  status?: string;
  notes?: string;
  [key: string]: any;
}

interface ImportResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; errors: string[] }>;
}

function validateDealRow(deal: DealRow, rowIndex: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Client name is required
  if (!deal.client || typeof deal.client !== "string" || !deal.client.trim()) {
    errors.push("Client name is required");
  }

  // Email validation (if provided)
  if (deal.email && typeof deal.email === "string") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(deal.email.trim())) {
      errors.push("Invalid email format");
    }
  }

  // Phone validation (if provided)
  if (deal.phone && typeof deal.phone === "string") {
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(deal.phone.trim()) || deal.phone.trim().length < 7) {
      errors.push("Invalid phone format");
    }
  }

  // Value validation (if provided)
  if (deal.value !== undefined && deal.value !== null && deal.value !== "") {
    const value = typeof deal.value === "string" ? parseFloat(deal.value) : deal.value;
    if (isNaN(value) || value < 0) {
      errors.push("Deal value must be a positive number");
    }
  }

  // Stage validation (if provided)
  if (deal.stage && typeof deal.stage === "string") {
    const stage = deal.stage.toLowerCase().trim();
    if (!VALID_STAGES.includes(stage)) {
      errors.push(`Invalid stage. Must be one of: ${VALID_STAGES.join(", ")}`);
    }
  }

  // Status validation (if provided)
  if (deal.status && typeof deal.status === "string") {
    const status = deal.status.toLowerCase().trim();
    if (!VALID_STATUSES.includes(status)) {
      errors.push(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function sanitizeDeal(deal: DealRow, userId: string, organizationId: string): Record<string, any> {
  const sanitized: Record<string, any> = {
    organization_id: organizationId,
    created_by: userId,
    created: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  // Only copy allowed fields
  for (const [key, value] of Object.entries(deal)) {
    if (ALLOWED_FIELDS.includes(key) && value !== undefined && value !== null && value !== "") {
      if (key === "value") {
        sanitized[key] = typeof value === "string" ? parseFloat(value) || 0 : value;
      } else if (key === "stage") {
        sanitized[key] = (value as string).toLowerCase().trim();
      } else if (key === "status") {
        sanitized[key] = (value as string).toLowerCase().trim();
      } else if (typeof value === "string") {
        sanitized[key] = value.trim();
      } else {
        sanitized[key] = value;
      }
    }
  }

  // Defaults
  if (!sanitized.status) sanitized.status = "active";
  if (!sanitized.value) sanitized.value = 0;
  if (!sanitized.stage) sanitized.stage = "lead";

  return sanitized;
}

export default async (req: Request, context: Context) => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
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
    const authResult = await requireAuth(req);
    const userId = authResult.user.id;

    console.warn("[import-deals-csv] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { deals, organizationId } = body;

    if (!deals || !Array.isArray(deals)) {
      return new Response(
        JSON.stringify({ error: "Missing required field: deals (array)" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate row count
    if (deals.length === 0) {
      return new Response(
        JSON.stringify({ error: "No deals to import" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (deals.length > MAX_TOTAL_ROWS) {
      return new Response(
        JSON.stringify({ error: `Too many rows (${deals.length}). Maximum: ${MAX_TOTAL_ROWS}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[import-deals-csv] Import request:", { organizationId, dealCount: deals.length });

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
      console.error("[import-deals-csv] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Validate and sanitize all deals
    const validDeals: Record<string, any>[] = [];
    const invalidRows: Array<{ row: number; errors: string[] }> = [];

    deals.forEach((deal: DealRow, index: number) => {
      const validation = validateDealRow(deal, index + 1);
      if (validation.valid) {
        validDeals.push(sanitizeDeal(deal, userId, organizationId));
      } else {
        invalidRows.push({ row: index + 1, errors: validation.errors });
      }
    });

    // STEP 6: Insert valid deals in batches
    const result: ImportResult = {
      total: deals.length,
      successful: 0,
      failed: invalidRows.length,
      errors: invalidRows,
    };

    if (validDeals.length > 0) {
      for (let i = 0; i < validDeals.length; i += MAX_BATCH_SIZE) {
        const batch = validDeals.slice(i, i + MAX_BATCH_SIZE);

        const { data: insertedDeals, error: insertError } = await supabase
          .from("deals")
          .insert(batch)
          .select();

        if (insertError) {
          console.error("[import-deals-csv] Batch insert failed:", insertError);
          // Add batch to errors
          batch.forEach((_, idx) => {
            result.errors.push({
              row: i + idx + 1,
              errors: [`Database error: ${insertError.message}`],
            });
          });
          result.failed += batch.length;
        } else {
          result.successful += insertedDeals?.length || 0;
          console.warn("[import-deals-csv] Batch inserted:", { count: insertedDeals?.length });
        }
      }
    }

    console.warn("[import-deals-csv] Import complete:", {
      total: result.total,
      successful: result.successful,
      failed: result.failed,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[import-deals-csv] Error:", error);

    // Handle auth errors specifically
    if (error.message?.includes("auth") || error.message?.includes("unauthorized")) {
      return new Response(
        JSON.stringify({ error: "Authentication required", code: "AUTH_REQUIRED" }),
        { status: 401, headers: corsHeaders }
      );
    }

    return createErrorResponse(error, 500, "import-deals-csv", "IMPORT_DEALS_CSV_ERROR");
  }
};
