import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./lib/validate-config";
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json() as any;
    const {
      organizationId,
      operationType,
      entityType,
      entityId,
      errorMessage,
      context: operationContext
    } = body;

    // Validate required fields
    if (!organizationId || !operationType || !entityType || !errorMessage) {
      return new Response(JSON.stringify({
        error: "Missing required fields"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 7: Add authentication + validate org access
    if (shouldUseNewAuth('log-failed-operation', organizationId)) {
      try {
        // NEW AUTH PATH: Validate session and organization membership
        await requireAuth(req);
        await requireOrgAccess(req, organizationId);
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    }
    // LEGACY AUTH PATH: No validation (CRITICAL VULNERABILITY - accepts org ID from client)

    const supabaseConfig = getSupabaseConfig();
    const supabase = createClient(
      supabaseConfig.url,
      supabaseConfig.serviceRoleKey || supabaseConfig.anonKey
    );

    // Insert into failed_operations table
    const { data, error } = await supabase
      .from("failed_operations")
      .insert([{
        organization_id: organizationId,
        operation_type: operationType,
        entity_type: entityType,
        entity_id: entityId,
        error_message: errorMessage,
        context: operationContext || {}
      }])
      .select()
      .single();

    if (error) {
      console.error("Failed to log failed operation:", error);
      return new Response(JSON.stringify({
        error: "Failed to log operation"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      id: data.id
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Exception in log-failed-operation:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/.netlify/functions/log-failed-operation",
};
