// netlify/functions/process-webhook-queue.mts
import { WebhookDLQ } from './lib/webhook-dlq';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

export async function handler(event: any, context: any) {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth('process-webhook-queue')) {
    try {
      const authHeader = event.headers?.authorization || event.headers?.Authorization;
      if (authHeader) {
        const request = new Request("https://dummy.com", {
          method: "POST",
          headers: { "Authorization": authHeader }
        });
        await requireAuth(request);
      }
      // No auth header = scheduled execution (allowed)
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        body: await errorResponse.text()
      };
    }
  }
  // LEGACY AUTH PATH: No authentication (allows both manual and scheduled execution)

  try {
    const dlq = new WebhookDLQ(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const results = await dlq.processQueue();
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ...results,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error: any) {
    console.error('[DLQ Processor] Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
