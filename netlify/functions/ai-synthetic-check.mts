/**
 * AI Synthetic Health Check Endpoint
 *
 * Apple-Grade Engineering: Proactive monitoring to detect AI issues
 * before users do. Call this endpoint every 5 minutes from external
 * monitoring (Checkly, Better Uptime, or cron job).
 *
 * Endpoint: GET /.netlify/functions/ai-synthetic-check
 *
 * Response:
 * {
 *   status: 'healthy' | 'degraded' | 'critical',
 *   checks: { ... },
 *   timestamp: string,
 *   version: string
 * }
 *
 * @author StageFlow Engineering
 * @date 2025-12-09
 */

import { createClient } from '@supabase/supabase-js';
import { buildCorsHeaders } from './lib/cors';
import { getAIFeatureFlagStatus, isAIFeatureEnabled } from './lib/ai-feature-flags';
import { buildBasicMissionControlPlan } from './lib/mission-control-fallback';

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, any>;
}

interface SyntheticCheckResponse {
  status: 'healthy' | 'degraded' | 'critical';
  checks: {
    encryptionKey: CheckResult;
    database: CheckResult;
    providerCount: CheckResult;
    fallbackLogic: CheckResult;
    featureFlags: CheckResult;
  };
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
  };
  timestamp: string;
  version: string;
}

/**
 * Check if ENCRYPTION_KEY is valid
 */
function checkEncryptionKey(): CheckResult {
  const startTime = Date.now();

  try {
    const key = process.env.ENCRYPTION_KEY;

    if (!key) {
      return { ok: false, error: 'ENCRYPTION_KEY not set' };
    }

    // Check hex format
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      return { ok: false, error: 'ENCRYPTION_KEY contains invalid hex characters' };
    }

    // Check length (64 hex chars = 32 bytes)
    if (key.length !== 64) {
      return { ok: false, error: `ENCRYPTION_KEY wrong length: ${key.length} (expected 64)` };
    }

    return {
      ok: true,
      latencyMs: Date.now() - startTime,
      details: { length: key.length, format: 'valid hex' }
    };
  } catch (error: any) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<CheckResult> {
  const startTime = Date.now();

  try {
    // Simple query to verify database connection
    const { error } = await supabase
      .from('organizations')
      .select('id')
      .limit(1);

    if (error) {
      return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
    }

    return { ok: true, latencyMs: Date.now() - startTime };
  } catch (error: any) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
  }
}

/**
 * Check provider count in database
 */
async function checkProviderCount(): Promise<CheckResult> {
  const startTime = Date.now();

  try {
    const { data, error } = await supabase
      .from('ai_providers')
      // Select both active and is_active to support mixed schemas
      .select('provider_type, active, is_active', { count: 'exact' });

    if (error) {
      return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
    }

    const activeProviders = (data || []).filter((p: any) => {
      const isActive = typeof p.active === 'boolean' ? p.active : p.is_active;
      return isActive === true;
    });

    const count = activeProviders.length;

    return {
      ok: count > 0,
      latencyMs: Date.now() - startTime,
      details: {
        activeProviders: count,
        message: count > 0 ? `${count} active provider(s)` : 'No active providers configured'
      }
    };
  } catch (error: any) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
  }
}

/**
 * Check fallback logic works
 */
function checkFallbackLogic(): CheckResult {
  const startTime = Date.now();

  try {
    // Test that fallback plan generation works
    const testDeals = [
      { id: '1', client_name: 'Test Corp', value: 10000, status: 'active', current_stage: 'Discovery', days_in_stage: 5 },
      { id: '2', client_name: 'Demo Inc', value: 25000, status: 'active', current_stage: 'Proposal', days_in_stage: 10 },
    ];

    const fallbackPlan = buildBasicMissionControlPlan(testDeals as any);

    if (!fallbackPlan || !fallbackPlan.summary) {
      return { ok: false, error: 'Fallback plan generation returned invalid result' };
    }

    return {
      ok: true,
      latencyMs: Date.now() - startTime,
      details: {
        hasSummary: !!fallbackPlan.summary,
        hasTasks: Array.isArray(fallbackPlan.tasks),
        taskCount: fallbackPlan.tasks?.length || 0
      }
    };
  } catch (error: any) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
  }
}

/**
 * Check feature flags status
 */
function checkFeatureFlags(): CheckResult {
  const startTime = Date.now();

  try {
    const flags = getAIFeatureFlagStatus();
    const aiEnabled = isAIFeatureEnabled('AI_ENABLED');

    return {
      ok: aiEnabled,
      latencyMs: Date.now() - startTime,
      details: {
        AI_ENABLED: flags.AI_ENABLED.enabled,
        OPENAI: flags.OPENAI_ENABLED.enabled,
        ANTHROPIC: flags.ANTHROPIC_ENABLED.enabled,
        GOOGLE: flags.GOOGLE_ENABLED.enabled,
      }
    };
  } catch (error: any) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startTime };
  }
}

/**
 * Main handler
 */
export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = buildCorsHeaders(origin, { methods: 'GET, OPTIONS' });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    // Run all checks
    const checks = {
      encryptionKey: checkEncryptionKey(),
      database: await checkDatabase(),
      providerCount: await checkProviderCount(),
      fallbackLogic: checkFallbackLogic(),
      featureFlags: checkFeatureFlags(),
    };

    // Calculate summary
    const checkResults = Object.values(checks);
    const passedChecks = checkResults.filter(c => c.ok).length;
    const failedChecks = checkResults.filter(c => !c.ok).length;

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

    // Critical if encryption key or database fails
    if (!checks.encryptionKey.ok || !checks.database.ok) {
      status = 'critical';
    }
    // Degraded if providers or fallback fails
    else if (!checks.providerCount.ok || !checks.fallbackLogic.ok) {
      status = 'degraded';
    }
    // Degraded if AI is disabled via feature flag
    else if (!checks.featureFlags.ok) {
      status = 'degraded';
    }

    const response: SyntheticCheckResponse = {
      status,
      checks,
      summary: {
        totalChecks: checkResults.length,
        passedChecks,
        failedChecks,
      },
      timestamp: new Date().toISOString(),
      version: '1.7.93',
    };

    // Log for Netlify monitoring
    console.log('[StageFlow][AI][SyntheticCheck]', {
      status,
      passed: passedChecks,
      failed: failedChecks,
      timestamp: response.timestamp,
    });

    return new Response(JSON.stringify(response, null, 2), {
      status: status === 'critical' ? 503 : 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...corsHeaders
      }
    });

  } catch (error: any) {
    console.error('[StageFlow][AI][SyntheticCheck][ERROR]', error.message);

    return new Response(JSON.stringify({
      status: 'critical',
      error: error.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
