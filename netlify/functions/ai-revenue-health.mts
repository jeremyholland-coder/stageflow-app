/**
 * AI REVENUE HEALTH - Revenue Coach Endpoint
 *
 * Continuous, revenue-centric AI system that:
 * 1. Runs deterministic calculations (no AI) to compute projections
 * 2. Calls AI layer once to interpret as "Revenue Coach"
 * 3. Logs as AI usage
 * 4. Returns projections + coach interpretation to frontend
 *
 * Modes:
 * - 'hourly': Background health pulse (triggered by frontend on dashboard load)
 * - 'daily': Daily plan context
 * - 'weekly': Weekly review
 * - 'monthly': Monthly forecast
 *
 * @author StageFlow Engineering
 * @date 2025-12-10
 */

import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Core utilities
import { buildCorsHeaders, createPreflightResponse, createErrorResponse, createSuccessResponse } from './lib/cors';
import { requireAuth } from './lib/auth-middleware';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';
import { decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';

// AI infrastructure
import { AI_ERROR_CODES, createAIErrorResponse, AIErrorCode } from './lib/ai-error-codes';
import { runWithFallback, AllProvidersFailedError, PROVIDER_NAMES } from './lib/ai-fallback';
import { getProvidersWithCache, ProviderFetchError } from './lib/provider-cache';

// Revenue engine (deterministic)
import { computeRevenueProjections, summarizeProjectionForAI, RevenueProjectionResult } from './lib/revenue-engine';

// AI usage logging
import { logAIUsageAndIncrement, AIRequestType } from './lib/ai-usage-logger';

// ============================================================================
// TYPES
// ============================================================================

type RevenueHealthMode = 'hourly' | 'daily' | 'weekly' | 'monthly';

interface RevenueHealthRequest {
  organization_id: string;
  user_id?: string;
  mode?: RevenueHealthMode;
}

interface CoachResponse {
  tone: 'encouraging' | 'urgent' | 'neutral';
  summary: string;
  top_actions: string[];
  risk_level: 'low' | 'medium' | 'high';
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ============================================================================
// AI PROVIDER CALLS
// ============================================================================

/**
 * Call OpenAI for Revenue Coach interpretation
 */
async function callOpenAICoach(
  apiKey: string,
  projection: RevenueProjectionResult,
  model?: string
): Promise<CoachResponse> {
  const projectionSummary = summarizeProjectionForAI(projection);

  const systemPrompt = `You are StageFlow's Revenue Coach - a supportive, data-driven advisor focused on sustainable revenue growth.

You receive a deterministic revenue projection snapshot and provide:
1. A brief, encouraging or urgent summary (2-4 sentences)
2. Top 3 actionable next steps
3. Overall risk assessment

RULES:
- Be SPECIFIC with numbers and percentages
- Be SUPPORTIVE not pushy
- Focus on momentum and progress
- NEVER use hard-selling language
- Keep it brief and actionable

ALWAYS respond with valid JSON in this exact format:
{
  "tone": "encouraging" | "urgent" | "neutral",
  "summary": "2-4 sentence summary of their position",
  "top_actions": ["Action 1", "Action 2", "Action 3"],
  "risk_level": "low" | "medium" | "high"
}`;

  const response = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Revenue Projection Snapshot:\n\n${projectionSummary}\n\nProvide your Revenue Coach interpretation as JSON.` },
        ],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    }),
    TIMEOUTS.AI_PROVIDER,
    'OpenAI Revenue Coach'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  if (!data?.choices?.[0]?.message?.content) {
    throw new Error('OpenAI returned invalid response structure');
  }

  try {
    return JSON.parse(data.choices[0].message.content) as CoachResponse;
  } catch {
    // Fallback if JSON parsing fails
    return {
      tone: 'neutral',
      summary: data.choices[0].message.content,
      top_actions: ['Review your pipeline', 'Check stagnant deals', 'Focus on high-value opportunities'],
      risk_level: projection.risk_flags.length > 2 ? 'high' : projection.risk_flags.length > 0 ? 'medium' : 'low',
    };
  }
}

/**
 * Call Anthropic for Revenue Coach interpretation
 */
async function callAnthropicCoach(
  apiKey: string,
  projection: RevenueProjectionResult,
  model?: string
): Promise<CoachResponse> {
  const projectionSummary = summarizeProjectionForAI(projection);

  const systemPrompt = `You are StageFlow's Revenue Coach - a supportive, data-driven advisor focused on sustainable revenue growth.

ALWAYS respond with valid JSON in this exact format:
{
  "tone": "encouraging" | "urgent" | "neutral",
  "summary": "2-4 sentence summary of their position",
  "top_actions": ["Action 1", "Action 2", "Action 3"],
  "risk_level": "low" | "medium" | "high"
}

Be SPECIFIC with numbers, SUPPORTIVE not pushy, focus on momentum.`;

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2024-01-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Revenue Projection Snapshot:\n\n${projectionSummary}\n\nProvide your Revenue Coach interpretation as JSON.` },
        ],
      }),
    }),
    TIMEOUTS.AI_PROVIDER,
    'Anthropic Revenue Coach'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  if (!data?.content?.[0]?.text) {
    throw new Error('Anthropic returned invalid response structure');
  }

  try {
    return JSON.parse(data.content[0].text) as CoachResponse;
  } catch {
    return {
      tone: 'neutral',
      summary: data.content[0].text,
      top_actions: ['Review your pipeline', 'Check stagnant deals', 'Focus on high-value opportunities'],
      risk_level: projection.risk_flags.length > 2 ? 'high' : projection.risk_flags.length > 0 ? 'medium' : 'low',
    };
  }
}

/**
 * Call Gemini for Revenue Coach interpretation
 */
async function callGeminiCoach(
  apiKey: string,
  projection: RevenueProjectionResult,
  model?: string
): Promise<CoachResponse> {
  const projectionSummary = summarizeProjectionForAI(projection);

  const prompt = `You are StageFlow's Revenue Coach. Analyze this revenue projection and respond with JSON:

${projectionSummary}

Respond ONLY with valid JSON in this format:
{
  "tone": "encouraging" | "urgent" | "neutral",
  "summary": "2-4 sentence summary",
  "top_actions": ["Action 1", "Action 2", "Action 3"],
  "risk_level": "low" | "medium" | "high"
}`;

  const modelName = model || 'gemini-1.5-flash';

  const response = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }),
    TIMEOUTS.AI_PROVIDER,
    'Gemini Revenue Coach'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;

  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Gemini returned invalid response structure');
  }

  const text = data.candidates[0].content.parts[0].text;

  try {
    // Extract JSON from response (Gemini may wrap it in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as CoachResponse;
    }
    throw new Error('No JSON found in response');
  } catch {
    return {
      tone: 'neutral',
      summary: text.slice(0, 500),
      top_actions: ['Review your pipeline', 'Check stagnant deals', 'Focus on high-value opportunities'],
      risk_level: projection.risk_flags.length > 2 ? 'high' : projection.risk_flags.length > 0 ? 'medium' : 'low',
    };
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async (req: Request, context: Context) => {
  const origin = req.headers.get('origin') || '';
  const headers = buildCorsHeaders(origin);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return createPreflightResponse(origin);
  }

  if (req.method !== 'POST') {
    return createErrorResponse(origin, {
      message: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
      status: 405,
    });
  }

  try {
    // ========================================================================
    // STEP 1: Authentication
    // ========================================================================
    const user = await requireAuth(req);
    console.log('[ai-revenue-health] Authenticated user:', user.id);

    // ========================================================================
    // STEP 2: Parse request body
    // ========================================================================
    let body: RevenueHealthRequest;
    try {
      body = await req.json();
    } catch {
      return createErrorResponse(origin, {
        message: 'Invalid request body',
        code: 'INVALID_REQUEST',
        status: 400,
      });
    }

    const { organization_id, user_id, mode = 'hourly' } = body;

    if (!organization_id) {
      return createErrorResponse(origin, {
        message: 'organization_id is required',
        code: 'MISSING_ORG_ID',
        status: 400,
      });
    }

    const targetUserId = user_id || user.id;

    console.log('[ai-revenue-health] Request:', { organization_id, targetUserId, mode });

    // ========================================================================
    // STEP 3: Verify ENCRYPTION_KEY exists
    // ========================================================================
    if (!process.env.ENCRYPTION_KEY) {
      console.error('[ai-revenue-health] CONFIG_ERROR: ENCRYPTION_KEY not set');
      return new Response(
        JSON.stringify({
          ok: false,
          ...createAIErrorResponse(AI_ERROR_CODES.CONFIG_ERROR, 'AI configuration incomplete. Please contact support.'),
        }),
        { status: 500, headers }
      );
    }

    // ========================================================================
    // STEP 4: Fetch deals and targets
    // ========================================================================
    const supabase = getSupabaseClient();

    // Verify user is member of org
    const { data: membership, error: memberError } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (memberError || !membership) {
      return createErrorResponse(origin, {
        message: 'Not a member of this organization',
        code: 'NOT_MEMBER',
        status: 403,
      });
    }

    // Fetch deals
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('id, value, stage, status, expected_close, created_at, updated_at, last_activity, confidence, assigned_to')
      .eq('organization_id', organization_id)
      .is('deleted_at', null);

    if (dealsError) {
      console.error('[ai-revenue-health] Deals fetch error:', dealsError);
      return createErrorResponse(origin, {
        message: 'Failed to fetch deals',
        code: 'DB_ERROR',
        status: 500,
      });
    }

    // Fetch organization targets
    const { data: orgTargets } = await supabase
      .from('organization_targets')
      .select('monthly_target, quarterly_target, annual_target')
      .eq('organization_id', organization_id)
      .maybeSingle();

    // Fetch user targets (if different from org-level)
    const { data: userTargets } = await supabase
      .from('user_targets')
      .select('monthly_target, quarterly_target, annual_target')
      .eq('organization_id', organization_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    // Use user targets if set, otherwise org targets
    const targets = {
      month_goal: userTargets?.monthly_target || orgTargets?.monthly_target || null,
      quarter_goal: userTargets?.quarterly_target || orgTargets?.quarterly_target || null,
      year_goal: userTargets?.annual_target || orgTargets?.annual_target || null,
    };

    console.log('[ai-revenue-health] Data loaded:', {
      dealCount: deals?.length || 0,
      hasOrgTargets: !!orgTargets,
      hasUserTargets: !!userTargets,
    });

    // ========================================================================
    // STEP 5: Run deterministic revenue engine
    // ========================================================================
    const mappedDeals = (deals || []).map(d => ({
      id: d.id,
      value: d.value,
      stage: d.stage,
      status: d.status,
      expected_close_date: d.expected_close,
      created_at: d.created_at,
      updated_at: d.updated_at,
      last_activity: d.last_activity,
      confidence: d.confidence,
      assigned_to: d.assigned_to,
    }));

    const projection = computeRevenueProjections(mappedDeals, targets, new Date());

    console.log('[ai-revenue-health] Projection computed:', {
      month_projected: projection.month_projected,
      quarter_projected: projection.quarter_projected,
      risk_flags: projection.risk_flags,
    });

    // ========================================================================
    // STEP 6: Fetch AI providers and call Revenue Coach
    // ========================================================================
    let providers: any[] = [];
    let coachResponse: CoachResponse | null = null;
    let providerUsed: string | null = null;
    let aiError: string | null = null;

    try {
      providers = await getProvidersWithCache(supabase, organization_id);
    } catch (err) {
      if (err instanceof ProviderFetchError) {
        console.error('[ai-revenue-health] Provider fetch error:', err);
        aiError = 'PROVIDER_FETCH_ERROR';
      }
    }

    if (providers.length === 0) {
      console.log('[ai-revenue-health] No AI providers configured - returning projection only');
      aiError = 'NO_PROVIDERS';
    } else {
      // Try to get AI coach interpretation
      try {
        const result = await runWithFallback(
          'revenue_coach',
          providers,
          async (provider) => {
            // Decrypt API key
            let apiKey: string;
            try {
              apiKey = isLegacyEncryption(provider.api_key_encrypted)
                ? decryptLegacy(provider.api_key_encrypted)
                : decrypt(provider.api_key_encrypted);
            } catch (decryptError: any) {
              throw new Error(`Key decryption failed: ${decryptError.message}`);
            }

            // Call appropriate provider
            switch (provider.provider_type) {
              case 'openai':
                return await callOpenAICoach(apiKey, projection, provider.model);
              case 'anthropic':
                return await callAnthropicCoach(apiKey, projection, provider.model);
              case 'google':
                return await callGeminiCoach(apiKey, projection, provider.model);
              default:
                throw new Error(`Unsupported provider: ${provider.provider_type}`);
            }
          },
          undefined,
          'coaching' // Task type for affinity-based provider selection
        );

        if (result.success && result.result) {
          coachResponse = result.result;
          providerUsed = result.providerUsed || null;
        }
      } catch (err) {
        if (err instanceof AllProvidersFailedError) {
          console.error('[ai-revenue-health] All providers failed:', err.errors);
          aiError = 'ALL_PROVIDERS_FAILED';
        } else {
          console.error('[ai-revenue-health] Unexpected AI error:', err);
          aiError = 'PROVIDER_ERROR';
        }
      }
    }

    // ========================================================================
    // STEP 7: Upsert revenue_projection_state
    // ========================================================================
    const { error: upsertError } = await supabase
      .from('revenue_projection_state')
      .upsert({
        organization_id: organization_id,
        user_id: targetUserId,
        snapshot_ts: new Date().toISOString(),
        month_projected: projection.month_projected,
        quarter_projected: projection.quarter_projected,
        year_projected: projection.year_projected,
        month_goal: projection.month_goal,
        quarter_goal: projection.quarter_goal,
        year_goal: projection.year_goal,
        month_pct_to_goal: projection.month_pct_to_goal,
        quarter_pct_to_goal: projection.quarter_pct_to_goal,
        year_pct_to_goal: projection.year_pct_to_goal,
        pace_month: projection.pace_month,
        pace_quarter: projection.pace_quarter,
        pace_year: projection.pace_year,
        month_closed: projection.month_closed,
        quarter_closed: projection.quarter_closed,
        year_closed: projection.year_closed,
        risk_flags: projection.risk_flags,
        coach_tone: coachResponse?.tone || null,
        coach_summary: coachResponse?.summary || null,
        coach_top_actions: coachResponse?.top_actions || null,
        coach_risk_level: coachResponse?.risk_level || null,
        coach_generated_at: coachResponse ? new Date().toISOString() : null,
        engine_version: projection.engine_version,
      }, {
        onConflict: 'organization_id,user_id',
      });

    if (upsertError) {
      console.error('[ai-revenue-health] Upsert error (non-fatal):', upsertError);
    }

    // ========================================================================
    // STEP 8: Log AI usage (if AI was called)
    // ========================================================================
    const requestTypeMap: Record<RevenueHealthMode, AIRequestType> = {
      hourly: 'hourly_health',
      daily: 'daily_plan',
      weekly: 'weekly_review',
      monthly: 'monthly_forecast',
    };

    await logAIUsageAndIncrement({
      organization_id: organization_id,
      user_id: targetUserId,
      request_type: requestTypeMap[mode],
      provider: providerUsed || undefined,
      model: undefined,
      tokens_in: 0, // TODO: Extract from provider response if available
      tokens_out: 0,
      success: !!coachResponse,
      error_code: aiError || undefined,
      metadata: {
        mode,
        risk_flags: projection.risk_flags,
        month_pct_to_goal: projection.month_pct_to_goal,
        has_coach: !!coachResponse,
      },
    });

    // ========================================================================
    // STEP 9: Return response
    // ========================================================================
    return new Response(
      JSON.stringify({
        ok: true,
        type: 'revenue_health',
        mode,
        projection: {
          month_projected: projection.month_projected,
          quarter_projected: projection.quarter_projected,
          year_projected: projection.year_projected,
          month_closed: projection.month_closed,
          quarter_closed: projection.quarter_closed,
          year_closed: projection.year_closed,
          month_pipeline: projection.month_pipeline,
          quarter_pipeline: projection.quarter_pipeline,
          year_pipeline: projection.year_pipeline,
          month_goal: projection.month_goal,
          quarter_goal: projection.quarter_goal,
          year_goal: projection.year_goal,
          month_pct_to_goal: projection.month_pct_to_goal,
          quarter_pct_to_goal: projection.quarter_pct_to_goal,
          year_pct_to_goal: projection.year_pct_to_goal,
          pace_month: projection.pace_month,
          pace_quarter: projection.pace_quarter,
          pace_year: projection.pace_year,
          risk_flags: projection.risk_flags,
          period_info: projection.period_info,
        },
        coach: coachResponse || null,
        ai_available: providers.length > 0,
        ai_error: aiError || null,
      }),
      { status: 200, headers }
    );

  } catch (error: any) {
    console.error('[ai-revenue-health] Unexpected error:', error);

    // Handle auth errors
    if (error.message?.includes('auth') || error.message?.includes('unauthorized') || error.statusCode === 401) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: AI_ERROR_CODES.AUTH_REQUIRED,
          message: 'Authentication required',
        }),
        { status: 401, headers }
      );
    }

    return createErrorResponse(origin, {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      status: 500,
    });
  }
};
