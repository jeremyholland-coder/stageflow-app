import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';
// ENGINE REBUILD Phase 5: Centralized CORS config
import { buildCorsHeaders } from './lib/cors';
// ENGINE REBUILD Phase 5: AI error classification spine
import { classifyAIError, type AIErrorInfo } from './lib/ai-spine';
import {
  runWithConnectedProviders,
  ConnectedProvider,
  NoProvidersConnectedError,
  AllConnectedProvidersFailedError
} from './lib/ai-orchestrator';
// Phase 2 Rate Limiting: Per-user, per-org AI call limits
import {
  checkRateLimits,
  type RateLimitResult,
} from './lib/rate-limiter';
import {
  RATE_LIMIT_GROUPS,
  getRateLimitMessage,
  getRetryAfterSeconds,
  getBucketsForPlan,
  getPlanAwareRateLimitMessage,
} from './lib/rate-limit-config';
import { ERROR_CODES } from './lib/with-error-boundary';
// Area 7: Plan-aware rate limiting
import { getOrgPlan } from './lib/get-org-plan';

/**
 * AI Insights Endpoint
 *
 * Provides AI-powered insights for deals (summarize, next steps, email draft, etc.)
 *
 * FIX 2025-12-02: Now uses ai-orchestrator for provider selection
 * - Uses ONLY connected providers for this org
 * - Tries providers in CONNECTION ORDER (first connected = first tried)
 * - Clear error when no providers connected
 *
 * @author StageFlow Engineering
 */

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Call OpenAI/GPT
async function callOpenAI(apiKey: string, prompt: string, model?: string): Promise<string> {
  const response = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a professional sales advisor. Provide clear, actionable insights. Be concise.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'OpenAI API'
  );

  if (!response.ok) {
    const error = await response.text();
    throw Object.assign(new Error(`OpenAI: ${response.status}`), { status: response.status, details: error });
  }

  const data = await response.json() as any;
  if (!data?.choices?.[0]?.message?.content) throw new Error('OpenAI: invalid response');
  return data.choices[0].message.content;
}

// Call Anthropic/Claude
async function callAnthropic(apiKey: string, prompt: string, model?: string): Promise<string> {
  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2024-01-01'
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: 'You are a professional sales advisor. Provide clear, actionable insights. Be concise.',
        messages: [{ role: 'user', content: prompt }]
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Anthropic API'
  );

  if (!response.ok) {
    const error = await response.text();
    throw Object.assign(new Error(`Anthropic: ${response.status}`), { status: response.status, details: error });
  }

  const data = await response.json() as any;
  if (!data?.content?.[0]?.text) throw new Error('Anthropic: invalid response');
  return data.content[0].text;
}

// Call Google Gemini
async function callGemini(apiKey: string, prompt: string, model?: string): Promise<string> {
  const modelName = model || 'gemini-1.5-pro';
  const response = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a professional sales advisor. Provide clear, actionable insights. Be concise.\n\n${prompt}` }] }]
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Gemini API'
  );

  if (!response.ok) {
    const error = await response.text();
    throw Object.assign(new Error(`Gemini: ${response.status}`), { status: response.status, details: error });
  }

  const data = await response.json() as any;
  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Gemini: invalid response');
  return data.candidates[0].content.parts[0].text;
}

// Route to appropriate provider
async function callProvider(provider: ConnectedProvider, apiKey: string, prompt: string): Promise<string> {
  switch (provider.provider_type) {
    case 'openai':
      return callOpenAI(apiKey, prompt, provider.model || undefined);
    case 'anthropic':
      return callAnthropic(apiKey, prompt, provider.model || undefined);
    case 'google':
      return callGemini(apiKey, prompt, provider.model || undefined);
    default:
      throw new Error(`Unsupported provider: ${provider.provider_type}`);
  }
}

export const handler: Handler = async (event) => {
  // PHASE 8 FIX 2025-12-03: Add CORS headers for Authorization support
  // P0 FIX 2025-12-08: Added all Netlify deploy origins to prevent CORS errors
  // ENGINE REBUILD Phase 5: Use centralized CORS config
  const origin = event.headers.origin || '';
  const corsHeaders = buildCorsHeaders(origin, { methods: 'POST, OPTIONS' });

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // SECURITY: Always require authentication
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Authentication required' })
      };
    }

    let user: any;
    try {
      const request = new Request('https://dummy.com', {
        method: 'POST',
        headers: { 'Authorization': authHeader }
      });
      user = await requireAuth(request);
    } catch (authError) {
      const errorResponse = createAuthErrorResponse(authError);
      return {
        statusCode: errorResponse.status,
        headers: corsHeaders,
        body: await errorResponse.text()
      };
    }

    // Get user's organization
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No organization found' })
      };
    }

    const organizationId = membership.organization_id;

    // =========================================================================
    // Phase 2 Rate Limiting: Check per-user, per-org rate limits
    // Area 7: Now plan-aware - limits vary based on subscription tier
    // =========================================================================

    // Area 7: Get org's plan for plan-aware rate limits
    const orgPlanId = await getOrgPlan(organizationId);
    const planBuckets = getBucketsForPlan(orgPlanId);

    const { allowed: rateLimitAllowed, exceededBucket } = await checkRateLimits(
      user.id,
      organizationId,
      planBuckets.aiInsights,
      []
    );

    if (!rateLimitAllowed && exceededBucket) {
      console.warn('[ai-insights][RateLimit] Request blocked', {
        userId: user.id,
        organizationId,
        planId: orgPlanId,
        bucket: exceededBucket.bucket,
        limit: exceededBucket.limit,
        remaining: exceededBucket.remaining,
      });

      const bucketConfig = planBuckets.aiInsights.find(b => b.bucket === exceededBucket.bucket) || planBuckets.aiInsights[0];
      // Area 7: Plan-aware message with upgrade suggestion for free tier
      const message = getPlanAwareRateLimitMessage(bucketConfig, orgPlanId);
      const retryAfter = exceededBucket.retryAfterSeconds || getRetryAfterSeconds(bucketConfig);

      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(retryAfter),
        },
        body: JSON.stringify({
          ok: false,
          success: false,
          code: ERROR_CODES.RATE_LIMITED,
          errorCode: 'RATE_LIMITED',
          message,
          retryable: true,
          retryAfterSeconds: retryAfter,
          planId: orgPlanId,
          rateLimit: {
            bucket: exceededBucket.bucket,
            limit: exceededBucket.limit,
            remaining: exceededBucket.remaining,
            windowSeconds: exceededBucket.windowSeconds,
          },
          // Area 7: Upgrade prompt for free users
          ...(orgPlanId === 'free' && { upgradePrompt: 'Upgrade to Startup for 3x higher limits' }),
        }),
      };
    }

    // Parse request
    const { dealData, action } = JSON.parse(event.body || '{}');

    if (!dealData) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Deal data is required' })
      };
    }

    // Build prompts
    const prompts: Record<string, string> = {
      summarize: `Summarize this deal in 2-3 sentences:\n${JSON.stringify(dealData, null, 2)}`,
      nextSteps: `Based on this deal at ${dealData.stage} stage, suggest 3 specific next actions:\n${JSON.stringify(dealData, null, 2)}`,
      emailDraft: `Draft a professional follow-up email for this deal:\nDeal: ${dealData.name}\nStage: ${dealData.stage}\nValue: $${dealData.value}\nContact: ${dealData.contact_name}`,
      scoreQuality: `Score this lead quality from 1-10 and explain why:\n${JSON.stringify(dealData, null, 2)}`,
      winProbability: `Estimate win probability (0-100%) for this deal and explain:\n${JSON.stringify(dealData, null, 2)}`
    };

    const prompt = prompts[action] || prompts.summarize;

    // Use orchestrator - tries connected providers in CONNECTION ORDER
    const result = await runWithConnectedProviders<string>(
      'deal-insights',
      organizationId,
      async (provider, apiKey) => callProvider(provider, apiKey, prompt)
    );

    if (!result.success || !result.result) {
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'AI_FAILED',
          insight: 'Unable to generate insight. Please try again.',
          errors: result.errors
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        insight: result.result,
        action,
        provider: result.providerDisplayName,
        providerType: result.providerUsed
      })
    };

  } catch (error: any) {
    console.error('[ai-insights] Error:', error);

    // Handle specific error types
    if (error instanceof NoProvidersConnectedError) {
      return {
        statusCode: 200, // Return 200 so frontend shows the message nicely
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'NO_PROVIDERS_CONNECTED',
          insight: error.message
        })
      };
    }

    if (error instanceof AllConnectedProvidersFailedError) {
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'ALL_PROVIDERS_FAILED',
          insight: error.message,
          providersAttempted: error.providersAttempted
        })
      };
    }

    // ENGINE REBUILD Phase 5: Use AI spine for error classification
    const classifiedError = classifyAIError(error, 'unknown');
    console.log('[ai-insights] Classified error:', classifiedError.code);

    const statusCode = classifiedError.code === 'SESSION_INVALID' ? 401 :
                       classifiedError.retryable ? 503 : 500;

    return {
      statusCode,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: false,
        error: classifiedError,
        code: classifiedError.code,
        insight: classifiedError.message, // User-friendly message
        retryable: classifiedError.retryable
      })
    };
  }
};
