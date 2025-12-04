import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { z } from "zod";
import { createErrorResponse } from "./lib/error-sanitizer";
import { getSupabaseConfig } from "./lib/validate-config";
import { validateWebhookURL } from "./lib/ssrf-protection";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // SECURITY FIX: Validate webhook payload structure and size
    const WebhookPayloadSchema = z.object({
      webhook_id: z.string().uuid('Invalid webhook ID format'),
      event: z.string().min(1).max(100, 'Event name too long'),
      data: z.record(z.string(), z.unknown()).refine(
        (obj) => {
          const jsonString = JSON.stringify(obj);
          return jsonString.length < 100000; // 100KB limit
        },
        { message: "Payload too large (max 100KB)" }
      )
    });

    const rawBody = await req.json();
    const validation = WebhookPayloadSchema.safeParse(rawBody);

    if (!validation.success) {
      console.error('Webhook payload validation failed:', validation.error);
      const zodError = validation.error as any;
      return new Response(JSON.stringify({
        error: 'Invalid webhook payload',
        details: zodError.errors.map((e: any) => e.message).join(', ')
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { webhook_id, event, data } = validation.data;

    // C2 FIX: DEFENSE IN DEPTH - Redundant authentication check
    // Critical endpoints like webhook-trigger ALWAYS require authentication,
    // regardless of ENABLE_AUTH_MIDDLEWARE setting.
    // This prevents webhook abuse/spam if feature flags are accidentally disabled.
    try {
      await requireAuth(req);
    } catch (redundantAuthError) {
      console.error('❌ Webhook auth failed (critical endpoint protection)');
      return createAuthErrorResponse(redundantAuthError);
    }

    // SECURITY: Feature-flagged authentication migration (redundant with above, kept for migration tracking)
    if (shouldUseNewAuth('webhook-trigger', webhook_id)) {
      // Auth already verified above - this block is now a no-op but kept for migration consistency
    }

    // Get validated Supabase configuration
    let supabaseConfig;
    try {
      supabaseConfig = getSupabaseConfig();
    } catch (error: any) {
      console.error('❌ Database configuration error:', error.message);
      return new Response(JSON.stringify({ 
        error: 'Server configuration error',
        code: 'CONFIG_ERROR'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Initialize Supabase client
    const supabase = createClient(
      supabaseConfig.url,
      supabaseConfig.serviceRoleKey || supabaseConfig.anonKey
    );

    // Fetch webhook configuration
    const { data: webhook, error: webhookError } = await supabase
      .from("webhooks")
      .select("*")
      .eq("id", webhook_id)
      .eq("active", true)
      .single();

    if (webhookError || !webhook) {
      return new Response("Webhook not found", { status: 404 });
    }

    // SECURITY FIX H3: SSRF Protection
    const urlValidation = await validateWebhookURL(webhook.url);
    if (!urlValidation.allowed) {
      console.error('[SSRF] Blocked webhook URL:', webhook.url, urlValidation.reason);
      return new Response(JSON.stringify({
        error: 'Webhook URL not allowed',
        reason: urlValidation.reason
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prepare payload
    const payload = {
      event,
      data,
      webhook_id,
      timestamp: new Date().toISOString(),
    };

    // Create delivery record
    const deliveryRecord = {
      webhook_id,
      event,
      payload,
      status: "pending",
    };

    const { data: delivery, error: deliveryError } = await supabase
      .from("webhook_deliveries")
      .insert([deliveryRecord])
      .select()
      .single();

    if (deliveryError) {
      console.error("Failed to create delivery record:", deliveryError);
      return new Response("Failed to create delivery record", { status: 500 });
    }

    // CRITICAL FIX: Send webhook with timeout protection
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for external service

      // C5 FIX: Generate HMAC signature instead of sending raw secret
      // This proves payload authenticity without exposing the secret
      const payloadString = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signaturePayload = `${timestamp}.${payloadString}`;
      const signature = createHmac('sha256', webhook.secret)
        .update(signaturePayload)
        .digest('hex');

      const webhookResponse = await fetch(webhook.url, {
        method: "POST",
        signal: controller.signal, // CRITICAL FIX: Add abort signal
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `t=${timestamp},v1=${signature}`,
          "User-Agent": "StageFlow-Webhooks/1.0",
        },
        body: payloadString,
      });

      clearTimeout(timeoutId); // CRITICAL FIX: Clear timeout on success

      const responseBody = await webhookResponse.text();

      // Update delivery record
      await supabase
        .from("webhook_deliveries")
        .update({
          status: webhookResponse.ok ? "success" : "failed",
          response_status: webhookResponse.status,
          response_body: responseBody.substring(0, 1000), // Limit to 1000 chars
          delivered_at: new Date().toISOString(),
          error: webhookResponse.ok ? null : `HTTP ${webhookResponse.status}`,
        })
        .eq("id", delivery.id);

      return new Response(
        JSON.stringify({
          success: true,
          delivery_id: delivery.id,
          status: webhookResponse.status,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (fetchError: any) {
      // Update delivery record with error
      await supabase
        .from("webhook_deliveries")
        .update({
          status: "failed",
          error: fetchError.message || "Network error",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: fetchError.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error: any) {
    console.error("Webhook trigger error:", error);
    // SECURITY FIX: Sanitize error message
    return createErrorResponse(error, 500, 'webhook_trigger', 'WEBHOOK_ERROR');
  }
};

export const config: Config = {
  path: "/.netlify/functions/webhook-trigger",
};
