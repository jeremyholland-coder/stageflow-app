import type { Context, Config } from "@netlify/functions";
import { createHash } from "crypto";
import { DealSchema, validate } from "./lib/validation";
import { RATE_LIMITS } from "./lib/rate-limiter";
import { createErrorResponse } from "./lib/error-sanitizer";
import { getSupabaseClient } from "./lib/supabase-pool";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const hashApiKey = (apiKey: string): string => {
  return createHash('sha256').update(apiKey).digest('hex');
};

/**
 * Route webhooks through DLQ for reliable delivery
 */
const queueWebhooks = async (supabase: any, orgId: string, event: string, dealData: any) => {
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .contains("events", [event]);

  if (!webhooks?.length) return;

  for (const webhook of webhooks) {
    try {
      await supabase
        .from("webhook_dlq")
        .insert({
          webhook_id: webhook.id,
          event_type: event,
          payload: dealData,
          attempts: 0,
          max_attempts: 5,
          next_retry_at: new Date().toISOString(),
          status: 'pending'
        });
    } catch (error: any) {
      console.error(`❌ Failed to queue webhook ${webhook.id}:`, error);
    }
  }
};

export default async (req: Request, context: Context) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 10: Add session auth support alongside API key auth
  if (shouldUseNewAuth('api-deals')) {
    try {
      // NEW AUTH PATH: Support both session auth and API key auth
      const authHeader = req.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ey')) {
        // JWT session token - use new auth
        await requireAuth(req);
      }
      // API key auth will be handled below in legacy path
    } catch (authError) {
      return createAuthErrorResponse(authError);
    }
  }
  // LEGACY AUTH PATH: API key authentication (continues below)

  // Rate limiting
  const rateCheck = await RATE_LIMITS.API(req);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({
      error: 'Too many requests',
      retryAfter: Math.ceil((rateCheck.resetTime - Date.now()) / 1000)
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': rateCheck.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateCheck.resetTime).toISOString()
      }
    });
  }

  // PERFORMANCE FIX: Use connection pool singleton
  // Reduces database connections from ~126 to ~1 per burst
  const supabase = getSupabaseClient();
  
  // Verify API key
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key required" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const keyHash = hashApiKey(apiKey);
  const { data: keyData } = await supabase
    .from("api_keys")
    .select("id, organization_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .single();

  if (!keyData) {
    return new Response(JSON.stringify({ error: "Invalid API key" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const orgId = keyData.organization_id;
  const apiKeyId = keyData.id;

  // Track API key usage (fire and forget with proper error handling)
  (async () => {
    try {
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKeyId);
    } catch (err: any) {
      console.error(`⚠️ Failed to track key usage:`, err.message);
    }
  })();

  try {
    // POST - Create deal
    if (req.method === "POST") {
      const body = await req.json();
      
      // VALIDATE INPUT
      const validation = validate(DealSchema, body);
      if (!validation.success) {
        return new Response(JSON.stringify({ 
          error: "Validation failed", 
          details: validation.error 
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Get a user from the organization for user_id
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: orgUser } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("organization_id", orgId)
        .limit(1)
        .single();
      
      // CRITICAL FIX #3: Use atomic function to ensure deal + stage history created together
      // This eliminates race conditions where one succeeds and the other fails
      const { data: deal, error } = await supabase
        .rpc('create_deal_with_history', {
          p_deal_data: validation.data,
          p_organization_id: orgId,
          p_user_id: orgUser?.user_id
        });

      if (error) {
        console.error("Atomic deal creation failed:", error);
        throw new Error(`Failed to create deal: ${error.message}`);
      }
      
      await queueWebhooks(supabase, orgId, "deal.created", deal);
      
      return new Response(JSON.stringify(deal), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }

    // GET - List deals (excludes soft-deleted)
    if (req.method === "GET") {
      const { data: deals, error } = await supabase
        .from("deals")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null) // Exclude soft-deleted deals
        .order("created", { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify(deals), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // PUT - Update deal
    if (req.method === "PUT") {
      const url = new URL(req.url);
      const dealId = url.pathname.split("/").pop();
      
      if (!dealId) {
        return new Response(JSON.stringify({ error: "Deal ID required" }), { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const body = await req.json();
      
      // VALIDATE INPUT
      const validation = validate(DealSchema.partial(), body);
      if (!validation.success) {
        return new Response(JSON.stringify({ 
          error: "Validation failed", 
          details: validation.error 
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Get current deal to get user_id for history
      const { data: currentDeal } = await supabase
        .from("deals")
        .select("user_id")
        .eq("id", dealId)
        .eq("organization_id", orgId)
        .single();
      
      if (!currentDeal) {
        return new Response(JSON.stringify({ error: "Deal not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // CRITICAL FIX #3: Use atomic function to ensure deal + stage history updated together
      const { data: deal, error } = await supabase
        .rpc('update_deal_with_history', {
          p_deal_id: dealId,
          p_organization_id: orgId,
          p_updates: validation.data,
          p_changed_by: currentDeal.user_id
        });

      if (error) {
        console.error("Atomic deal update failed:", error);
        throw new Error(`Failed to update deal: ${error.message}`);
      }
      
      await queueWebhooks(supabase, orgId, "deal.updated", deal);
      
      return new Response(JSON.stringify(deal), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // DELETE - Soft delete deal (v1.7.98: preserve audit trail)
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const dealId = url.pathname.split("/").pop();

      if (!dealId) {
        return new Response(JSON.stringify({ error: "Deal ID required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Get API key owner for audit trail
      const { data: keyOwner } = await supabase
        .from("api_keys")
        .select("created_by")
        .eq("id", apiKeyId)
        .single();

      // SOFT DELETE: Set deleted_at instead of hard delete
      // This preserves audit trail and allows recovery
      const { data: deletedDeal, error } = await supabase
        .from("deals")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: keyOwner?.created_by || null
        })
        .eq("id", dealId)
        .eq("organization_id", orgId)
        .select()
        .single();

      if (error) throw error;

      if (!deletedDeal) {
        return new Response(JSON.stringify({ error: "Deal not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      await queueWebhooks(supabase, orgId, "deal.deleted", {
        id: dealId,
        deleted_at: deletedDeal.deleted_at,
        soft_delete: true
      });

      return new Response(JSON.stringify({
        success: true,
        message: "Deal soft deleted",
        deleted_at: deletedDeal.deleted_at
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Method not allowed", { status: 405 });

  } catch (error: any) {
    console.error("API deals error:", error);
    return createErrorResponse(error, 500, 'api_deals', 'API_ERROR');
  }
};

export const config: Config = {
  path: "/api/deals*",
};
