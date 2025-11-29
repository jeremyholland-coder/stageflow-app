import type { Handler } from "@netlify/functions";
import { shouldUseNewAuth } from "./lib/feature-flags";
import { requireAuth, createAuthErrorResponse } from "./lib/auth-middleware";
import { createClient } from '@supabase/supabase-js';

const handler: Handler = async (event) => {
  // SECURITY: Feature-flagged authentication migration
  // Phase 4 Batch 9: Add authentication to scheduled job (allows internal scheduling)
  if (shouldUseNewAuth("verify-feedback-system")) {
    try {
      const authHeader = (event as any).headers?.authorization || (event as any).headers?.Authorization;
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

  const results: any = {
    timestamp: new Date().toISOString(),
    checks: {},
    overallStatus: 'healthy',
    errors: [],
    warnings: []
  };

  try {
    // Check 1: Supabase credentials
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      results.checks.supabaseCredentials = 'FAILED';
      results.errors.push('Missing Supabase credentials');
      results.overallStatus = 'unhealthy';
    } else {
      results.checks.supabaseCredentials = 'OK';
    }

    // Check 2: RESEND_API_KEY
    if (!process.env.RESEND_API_KEY) {
      results.checks.resendApiKey = 'MISSING';
      results.errors.push('RESEND_API_KEY not configured - feedback emails will not be sent');
      results.overallStatus = 'degraded';
    } else {
      results.checks.resendApiKey = 'OK';
    }

    // Check 3: Feedback table exists and has correct schema
    if (results.checks.supabaseCredentials === 'OK') {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      try {
        // Try to query the feedback table
        const { data, error } = await supabase
          .from('feedback')
          .select('id, user_id, organization_id, user_email, rating, category, message, page_url, user_agent, created_at')
          .limit(1);

        if (error) {
          results.checks.feedbackTable = 'FAILED';
          results.errors.push(`Feedback table error: ${error.message}`);
          results.overallStatus = 'unhealthy';
        } else {
          results.checks.feedbackTable = 'OK';
          results.feedbackTableExists = true;
        }
      } catch (error: any) {
        results.checks.feedbackTable = 'FAILED';
        results.errors.push(`Feedback table query error: ${error.message}`);
        results.overallStatus = 'unhealthy';
      }

      // Check 4: Get feedback count (last 24 hours)
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await supabase
          .from('feedback')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', yesterday);

        if (!error) {
          results.checks.feedbackCount24h = count || 0;
        }
      } catch (error: any) {
        results.warnings.push(`Could not get feedback count: ${error.message}`);
      }

      // Check 5: Get total feedback count
      try {
        const { count, error } = await supabase
          .from('feedback')
          .select('*', { count: 'exact', head: true });

        if (!error) {
          results.checks.totalFeedbackCount = count || 0;
        }
      } catch (error: any) {
        results.warnings.push(`Could not get total feedback count: ${error.message}`);
      }
    }

    // Check 6: Daily digest schedule configuration
    results.checks.dailyDigestSchedule = '0 16 * * * (8am PST)';
    results.checks.dailyDigestRecipient = 'jeremy.holland@icloud.com';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(results, null, 2)
    };

  } catch (error: any) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Verification failed',
        details: error.message,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }
};

export { handler };
