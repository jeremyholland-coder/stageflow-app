import type { Context } from "@netlify/functions";
import { getSupabaseClient } from "./lib/supabase-pool";
import { requireAuth } from "./lib/auth-middleware";
// PHASE F: Removed unused createErrorResponse import - using manual CORS response instead

/**
 * CREATE WEBHOOK ENDPOINT
 *
 * CRITICAL FIX for Phase 3 Cookie-Only Auth:
 * Client-side Supabase has persistSession: false, so auth.uid() is NULL
 * All direct client mutations fail RLS. This endpoint handles webhook creation
 * using HttpOnly cookie authentication.
 *
 * Used by:
 * - Integrations.jsx WebhooksTab (create webhook form)
 */

// Valid webhook events
const VALID_EVENTS = [
  "deal.created",
  "deal.updated",
  "deal.deleted",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "deal.invoice_sent",
  "deal.payment_received",
  "deal.onboarding_started",
  "deal.retention_phase",
  "webhook.test",
];

// Private IP patterns to block (SSRF protection)
const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }

  const trimmedUrl = url.trim();

  try {
    const urlObj = new URL(trimmedUrl);

    // Must be HTTP or HTTPS
    if (!["http:", "https:"].includes(urlObj.protocol)) {
      return { valid: false, error: "URL must use HTTP or HTTPS protocol" };
    }

    // Must have a valid hostname
    if (!urlObj.hostname || urlObj.hostname.length === 0) {
      return { valid: false, error: "URL must have a valid hostname" };
    }

    // SSRF protection: Block private/localhost URLs
    if (PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(urlObj.hostname))) {
      return { valid: false, error: "Private/localhost URLs are not allowed for webhooks" };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: "Invalid URL format" };
  }
}

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

    console.warn("[create-webhook] Authenticated user:", userId);

    // STEP 2: Parse request body
    const body = await req.json();
    const { url, events, secret, organizationId } = body;

    if (!url || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: url, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate URL
    const urlValidation = validateWebhookUrl(url);
    if (!urlValidation.valid) {
      return new Response(
        JSON.stringify({ error: urlValidation.error }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate events
    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one event is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate each event
    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return new Response(
        JSON.stringify({ error: `Invalid events: ${invalidEvents.join(", ")}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.warn("[create-webhook] Create request:", { organizationId, url: url.substring(0, 50), eventCount: events.length });

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
      console.error("[create-webhook] User not in organization:", { userId, organizationId, error: membershipError });
      return new Response(
        JSON.stringify({ error: "Not authorized for this organization" }),
        { status: 403, headers: corsHeaders }
      );
    }

    // STEP 5: Generate secret if not provided
    const webhookSecret = secret?.trim() || `whsec_${crypto.randomUUID().replace(/-/g, "")}`;

    // STEP 6: Insert the webhook
    const { data: newWebhook, error: insertError } = await supabase
      .from("webhooks")
      .insert({
        organization_id: organizationId,
        url: url.trim(),
        events: events,
        secret: webhookSecret,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[create-webhook] Insert failed:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create webhook", details: insertError.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.warn("[create-webhook] Success:", { webhookId: newWebhook.id });

    return new Response(JSON.stringify({ success: true, webhook: newWebhook }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error: any) {
    console.error("[create-webhook] Error:", error);

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
      : 'An error occurred while creating webhook';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: "CREATE_WEBHOOK_ERROR"
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
