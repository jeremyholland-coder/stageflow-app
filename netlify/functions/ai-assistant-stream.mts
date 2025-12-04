import { createClient } from '@supabase/supabase-js';
import { withTimeout, TIMEOUTS, TimeoutError } from './lib/timeout-wrapper';
import { decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';
import { parseCookies, COOKIE_NAMES } from './lib/cookie-auth';
// M3 HARDENING 2025-12-04: Standardized error codes across all AI endpoints
import { AI_ERROR_CODES } from './lib/ai-error-codes';
// DIAGNOSTICS 2025-12-04: Import environment verification
import { verifyProviderEnvironment } from './lib/provider-registry';

// ============================================================================
// [StageFlow][AI][DIAGNOSTICS] COLD-START ENVIRONMENT CHECK
// This runs ONCE when the function cold-starts to verify environment config
// ============================================================================
console.log("[StageFlow][AI][DIAGNOSTICS][ai-assistant-stream]", {
  // NOTE: AI provider keys are NOT env vars - they're stored encrypted in DB
  // These checks confirm they're NOT being read from env (which is correct)
  OPENAI_KEY_PRESENT: !!process.env.OPENAI_API_KEY,       // Should be FALSE
  ANTHROPIC_KEY_PRESENT: !!process.env.ANTHROPIC_API_KEY, // Should be FALSE
  GEMINI_KEY_PRESENT: !!process.env.GEMINI_API_KEY,       // Should be FALSE
  // These are the ACTUAL required env vars for AI functionality:
  ENCRYPTION_KEY_PRESENT: !!process.env.ENCRYPTION_KEY,   // CRITICAL - must be TRUE
  SUPABASE_URL_PRESENT: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
  SUPABASE_SERVICE_KEY_PRESENT: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  NODE_ENV: process.env.NODE_ENV,
  BUILD_TIMESTAMP: new Date().toISOString()
});
import {
  detectChartType,
  calculateChartData,
  determineTaskType,
  TaskType,
  isPlanMyDayRequest,
  buildPlanMyDayResponse,
  AIStructuredResponse
} from './lib/ai-analytics';
// PHASE 5.3: Adaptive AI User Profile
import {
  AISignal,
  AIUserProfile,
  getAIUserProfile,
  updateUserProfileFromSignals,
  buildAdaptationPromptSnippet,
} from './lib/aiUserProfile';
// UNIFIED PROVIDER SELECTION: Single source of truth for provider selection
import { selectProvider as unifiedSelectProvider } from './lib/select-provider';
// TASK 1: Provider health caching to reduce DB reads
import { getProvidersWithCache } from './lib/provider-cache';
// FIX 2025-12-03: Import fallback utilities for proper provider failover
// FIX 2025-12-04: Added detectSoftFailure for streaming soft-failure handling
import {
  sortProvidersForFallback,
  classifyError,
  logProviderAttempt,
  detectSoftFailure,
  summarizeProviderErrors,
  FALLBACK_TRIGGERS,
  PROVIDER_NAMES,
  ProviderType,
  ProviderError
} from './lib/ai-fallback';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CRITICAL FIX: Streaming timeout protection
// Each chunk must arrive within this time, or stream is considered hung
const STREAM_CHUNK_TIMEOUT = 45000; // 45 seconds per chunk

// Model tier definitions (premium = 3, standard = 2, economy = 1)
const MODEL_TIERS: { [key: string]: number } = {
  'gpt-5': 3, 'gpt-5-mini': 2, 'gpt-4.1': 2, 'gpt-4.1-mini': 1, 'gpt-4o-mini': 1, 'gpt-4o': 1,
  'claude-sonnet-4-5-20250929': 3, 'claude-opus-4-1-20250805': 3, 'claude-sonnet-3-7-20250219': 2,
  'claude-haiku-4-5-20251001': 1, 'claude-3-5-sonnet-20241022': 2,
  'gemini-2.5-pro': 3, 'gemini-2.5-flash': 2, 'gemini-2.5-flash-lite': 1, 'gemini-1.5-pro': 2
};

function getModelTier(modelName: string | null): number {
  if (!modelName) return 0;
  return MODEL_TIERS[modelName] || 0;
}

// PHASE 3: Task-specific model preferences (mirrors ai-assistant.mts)
// FIX 2025-12-04: Removed xAI/Grok - deprecated provider
const TASK_MODEL_AFFINITY: { [taskType: string]: { [providerType: string]: number } } = {
  'chart_insight': { 'openai': 3, 'anthropic': 3, 'google': 2 },
  'coaching': { 'anthropic': 3, 'openai': 2, 'google': 2 },
  'text_analysis': { 'openai': 2, 'anthropic': 2, 'google': 2 },
  'image_suitable': { 'openai': 2, 'anthropic': 2, 'google': 3 }
};

// PHASE 3 / QA FIX: Provider selection now uses unified selectProvider from lib/select-provider.ts
// This ensures consistent provider selection logic across all AI endpoints.
function selectBestProvider(providers: any[], taskType: TaskType = 'text_analysis'): any {
  return unifiedSelectProvider(providers, taskType);
}

// PHASE 3: Build visual spec instructions for task types
function buildVisualSpecInstructions(taskType: TaskType): string {
  if (taskType === 'image_suitable') {
    return ' When recommending visuals, include VISUAL_SPEC: { "layout": "...", "headline": "...", "subtext": "..." }.';
  }
  if (taskType === 'chart_insight') {
    return ' A chart will be displayed. Keep text brief and focus on insights.';
  }
  return '';
}

// Simplified pipeline analysis for streaming (cached version used in real handler)
function analyzeDealsPipeline(deals: any[]): string {
  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum: number, d: any) => sum + Number(d.value || 0), 0);
  const wonDeals = deals.filter(d => d.status === 'won');
  const lostDeals = deals.filter(d => d.status === 'lost');
  const winRate = (wonDeals.length + lostDeals.length) > 0
    ? ((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100).toFixed(1)
    : '0';

  return `Total Deals: ${totalDeals}, Total Value: $${totalValue.toLocaleString()}, Win Rate: ${winRate}%`;
}

// CRITICAL FIX: Timeout-protected stream reader
// Prevents infinite hanging if AI provider stops sending data
async function readStreamWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  return withTimeout(
    reader.read(),
    STREAM_CHUNK_TIMEOUT,
    'AI stream chunk read'
  );
}

// Stream from OpenAI
// PHASE 5.1: Updated to Advisor persona with StageFlow philosophy
// PHASE 19 FIX: Return accumulated text for structured response parsing
async function streamOpenAI(apiKey: string, message: string, context: string, model: string, conversationHistory: any[], controller: ReadableStreamDefaultController): Promise<string> {
  const encoder = new TextEncoder();
  let accumulatedText = '';

  const messages = [
    {
      role: 'system',
      content: `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. ${context}.

YOUR CORE VALUES: Partnership over transaction. Professionalism over pressure. Momentum over manipulation. Relationship development over pure follow-up.

FORBIDDEN: Never use money-hungry phrases, hard-selling verbs (push, hammer, pressure, force), shaming tactics, or salesy framing.

Be SPECIFIC, SUPPORTIVE, and CONCISE (max 4-5 sentences). CRITICAL: Output clean text with NO markdown syntax (##, ***, ---). Use plain text for emphasis. Suggest constructive next steps, not demands.`
    }
  ];

  conversationHistory.forEach((msg: any) => {
    if (msg.role && msg.content) {
      messages.push({ role: msg.role, content: msg.content });
    }
  });

  messages.push({ role: 'user', content: message });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      // CRITICAL FIX: Timeout protection on each chunk read
      const { done, value } = await readStreamWithTimeout(reader);
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;

            if (content) {
              accumulatedText += content; // PHASE 19 FIX: Accumulate for structured parsing
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content, provider: 'ChatGPT' })}\n\n`));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    }
  } catch (error: any) {
    // CRITICAL FIX: Handle timeout errors gracefully
    if (error.name === 'TimeoutError') {
      const errorEncoder = new TextEncoder();
      controller.enqueue(errorEncoder.encode(`data: ${JSON.stringify({ error: 'AI response timed out. Please try again.' })}\n\n`));
    } else {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }
  return accumulatedText; // PHASE 19 FIX: Return accumulated text
}

// Stream from Anthropic
// PHASE 5.1: Updated to Advisor persona with StageFlow philosophy
// PHASE 19 FIX: Return accumulated text for structured response parsing
async function streamAnthropic(apiKey: string, message: string, context: string, model: string, conversationHistory: any[], controller: ReadableStreamDefaultController): Promise<string> {
  const encoder = new TextEncoder();
  let accumulatedText = '';

  const systemPrompt = `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. ${context}.

YOUR CORE VALUES: Partnership over transaction. Professionalism over pressure. Momentum over manipulation. Relationship development over pure follow-up.

FORBIDDEN: Never use money-hungry phrases, hard-selling verbs (push, hammer, pressure, force), shaming tactics, or salesy framing.

Be SPECIFIC, SUPPORTIVE, and CONCISE (max 4-5 sentences). CRITICAL: Output clean text with NO markdown syntax (##, ***, ---). Use plain text for emphasis. Suggest constructive next steps, not demands.`;

  const messages: any[] = [];
  if (conversationHistory.length === 0) {
    messages.push({ role: 'user', content: message });
  } else {
    conversationHistory.forEach((msg: any) => {
      if (msg.role && msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    });
    messages.push({ role: 'user', content: message });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      // CRITICAL FIX: Timeout protection on each chunk read
      const { done, value } = await readStreamWithTimeout(reader);
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              accumulatedText += parsed.delta.text; // PHASE 19 FIX: Accumulate for structured parsing
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: parsed.delta.text, provider: 'Claude' })}\n\n`));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    }
  } catch (error: any) {
    // CRITICAL FIX: Handle timeout errors gracefully
    if (error.name === 'TimeoutError') {
      const errorEncoder = new TextEncoder();
      controller.enqueue(errorEncoder.encode(`data: ${JSON.stringify({ error: 'AI response timed out. Please try again.' })}\n\n`));
    } else {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }
  return accumulatedText; // PHASE 19 FIX: Return accumulated text
}

export default async (req: Request, context: any) => {
  // PHASE 8 FIX 2025-12-03: Add CORS headers for Authorization support
  const allowedOrigins = [
    'https://stageflow.startupstage.com',
    'http://localhost:8888',
    'http://localhost:5173'
  ];
  const origin = req.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://stageflow.startupstage.com';

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    // DIAGNOSTICS 2025-12-04: Runtime environment health check
    const envProblems = verifyProviderEnvironment();
    if (envProblems.length > 0) {
      console.warn("[StageFlow][AI][CONFIG][WARN] Missing provider keys:", envProblems);
    }

    const body = await req.json() as any;
    const { message, deals = [], conversationHistory = [], aiSignals = [] } = body;

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 3: Centralize authentication (inline -> middleware)
    let user: any;
    let organizationId: string;

    // MEDIUM-04 FIX: Wrap feature flag check in try-catch with fallback to legacy auth
    let useNewAuth = false;
    try {
      useNewAuth = shouldUseNewAuth('ai-assistant-stream');
    } catch (flagError) {
      console.error('Feature flag check failed, falling back to legacy auth:', flagError);
      useNewAuth = false;
    }

    if (useNewAuth) {
      try {
        // NEW AUTH PATH: Use centralized authentication
        user = await requireAuth(req);
        // CRITICAL FIX: Don't call requireOrgAccess(req) because body is already consumed
        // Instead, query team_members directly like the legacy path does
        const { data: membership } = await supabase
          .from('team_members')
          .select('organization_id')
          .eq('user_id', user.id)
          .single();

        if (!membership) {
          return new Response(JSON.stringify({ error: 'No organization found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        organizationId = membership.organization_id;
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    } else {
      // LEGACY AUTH PATH: Inline auth check (will be removed after migration)
      // FIX 2025-12-03: Accept both Authorization header AND HttpOnly cookies
      const authHeader = req.headers.get('authorization');
      let token = authHeader?.replace('Bearer ', '').trim() || '';

      // FIX 2025-12-03: Fallback to cookies if no Authorization header
      if (!token) {
        const cookieHeader = req.headers.get('cookie') || '';
        const cookies = parseCookies(cookieHeader);
        const cookieToken = cookies[COOKIE_NAMES.ACCESS_TOKEN];
        if (cookieToken) {
          token = cookieToken;
        }
      }

      if (!token) {
        return new Response(JSON.stringify({ error: 'Not authenticated', code: AI_ERROR_CODES.AUTH_REQUIRED }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !authUser) {
        return new Response(JSON.stringify({ error: 'Session expired or invalid', code: AI_ERROR_CODES.SESSION_ERROR }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      user = authUser;

      // Get organization
      // MIGRATION FIX: Changed from user_workspaces to team_members (v1.7.22)
      const { data: membership } = await supabase
        .from('team_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        return new Response(JSON.stringify({ error: 'No organization found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      organizationId = membership.organization_id;
    }

    // Check AI usage limits
    // FIX: Use 'plan' column (matches stripe-webhook.mts:156)
    const { data: orgData } = await supabase
      .from('organizations')
      .select('ai_requests_used_this_month, plan')
      .eq('id', organizationId)
      .single();

    if (orgData) {
      // Must match Stripe pricing structure
      const AI_LIMITS: { [key: string]: number } = {
        'free': 100, 'startup': 1000, 'growth': 5000, 'pro': -1  // Unlimited for Pro plan
      };
      // FIX PH7∞-L4-01: Normalize plan case for lookup (Startup → startup)
      const limit = AI_LIMITS[(orgData.plan || 'free').toLowerCase()] || AI_LIMITS['free'];
      const used = orgData.ai_requests_used_this_month || 0;

      if (limit > 0 && used >= limit) {
        return new Response(JSON.stringify({
          error: AI_ERROR_CODES.AI_LIMIT_REACHED,
          code: AI_ERROR_CODES.AI_LIMIT_REACHED,
          message: `You've reached your monthly limit of ${limit} AI requests. Upgrade your plan to continue.`,
          limitReached: true,
          used, limit
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // PHASE 5.3: Fetch and update AI user profile from signals
    let userProfile: AIUserProfile | null = null;
    let adaptationSnippet = '';
    try {
      if (aiSignals && aiSignals.length > 0) {
        userProfile = await updateUserProfileFromSignals(
          supabase,
          user.id,
          organizationId,
          aiSignals as AISignal[]
        );
      } else {
        userProfile = await getAIUserProfile(supabase, user.id, organizationId);
      }
      if (userProfile) {
        adaptationSnippet = buildAdaptationPromptSnippet(userProfile);
      }
    } catch (profileError) {
      console.error('AI profile fetch/update error (non-fatal):', profileError);
    }

    // Get AI providers (TASK 1: Now uses 60s cache)
    // P0 FIX 2025-12-04: Wrap in try/catch to distinguish "fetch failed" from "no providers"
    let providers: any[];
    try {
      providers = await getProvidersWithCache(supabase as any, organizationId);
    } catch (providerError) {
      // P0 FIX: Provider fetch failed - return 503, NOT "no providers" message
      console.error('[StageFlow][AI][ERROR] Provider fetch failed:', providerError);
      return new Response(JSON.stringify({
        error: AI_ERROR_CODES.PROVIDER_FETCH_ERROR,
        code: AI_ERROR_CODES.PROVIDER_FETCH_ERROR,
        message: 'Unable to load AI provider configuration. Please retry in a few moments.'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // FIX 2025-12-04: Only allow 3 providers (OpenAI, Anthropic, Google)
    const runtimeProviders = providers.filter(
      (p: any) => ['openai', 'anthropic', 'google'].includes(p.provider_type)
    );

    // FIX 2025-12-02: Return 422 (Unprocessable Entity) for NO_PROVIDERS
    // This is the REAL "no providers configured" case (empty list, no error)
    if (!runtimeProviders || runtimeProviders.length === 0) {
      return new Response(JSON.stringify({
        error: AI_ERROR_CODES.NO_PROVIDERS,
        code: AI_ERROR_CODES.NO_PROVIDERS,
        message: 'No AI provider is connected. Go to Settings → AI Providers to connect ChatGPT, Claude, or Gemini.'
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // PHASE 3: Determine task type for smart provider selection
    const taskType = determineTaskType(message);

    // FIX 2025-12-03: Sort providers for fallback - best provider first, then others
    // FIX 2025-12-04: Pass taskType for task-aware fallback ordering (ChatGPT → Claude → Gemini for planning)
    // FIX 2025-12-04: Use runtimeProviders (xAI/Grok filtered out)
    const bestProvider = selectBestProvider(runtimeProviders, taskType);
    const sortedProviders = sortProvidersForFallback(runtimeProviders, bestProvider?.provider_type, taskType);

    // Analyze pipeline (simplified for streaming)
    const pipelineContext = analyzeDealsPipeline(deals);

    // PHASE 3: Add visual spec instructions based on task type
    const visualInstructions = buildVisualSpecInstructions(taskType);
    // PHASE 5.3: Include adaptation snippet in context
    const enrichedContext = pipelineContext + visualInstructions + (adaptationSnippet ? '\n' + adaptationSnippet : '');

    // CHART PARITY: Detect chart type BEFORE streaming (same logic as non-streaming)
    const { chartType, chartTitle } = detectChartType(message);

    // PHASE 17: Detect Plan My Day request for structured response
    const isPlanMyDay = isPlanMyDayRequest(message);

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        // STREAM-02 FIX: Track if text streaming completed successfully for chart handling
        let textStreamCompleted = false;
        // PHASE 17: Accumulate response text for structured parsing
        let accumulatedResponse = '';
        // FIX 2025-12-03: Track which provider succeeded for logging
        let successfulProvider: string | null = null;

        // STREAM-01 FIX: Helper to safely enqueue with basic backpressure check
        const safeEnqueue = (data: Uint8Array) => {
          try {
            // Basic backpressure: skip if controller is under pressure
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              console.warn('Stream backpressure detected, skipping chunk');
              return;
            }
            controller.enqueue(data);
          } catch (enqueueError) {
            console.error('Enqueue error:', enqueueError);
          }
        };

        // FIX 2025-12-03: FALLBACK LOOP - try providers in order until one succeeds
        const providerErrors: Array<{ provider: string; errorType: string; message: string }> = [];

        for (const currentProvider of sortedProviders) {
          const providerType = currentProvider.provider_type as ProviderType;

          // Decrypt API key for this provider
          let apiKey: string;
          try {
            if (isLegacyEncryption(currentProvider.api_key_encrypted)) {
              apiKey = decryptLegacy(currentProvider.api_key_encrypted);
            } else {
              apiKey = decrypt(currentProvider.api_key_encrypted);
            }
          } catch (decryptError: any) {
            logProviderAttempt('streaming', providerType, 'failed', 'KEY_DECRYPT_FAILED');
            providerErrors.push({ provider: providerType, errorType: 'KEY_DECRYPT_FAILED', message: 'Failed to decrypt API key' });
            continue; // Try next provider
          }

          logProviderAttempt('streaming', providerType, 'attempting');

          try {
            // Stream based on provider type (using enrichedContext with visual instructions)
            if (currentProvider.provider_type === 'openai') {
              accumulatedResponse = await streamOpenAI(apiKey, message, enrichedContext, currentProvider.model || 'gpt-4o-mini', conversationHistory, controller);
              // FIX 2025-12-04: Check streaming response for soft failures too
              const { isSoftFailure: oaiSoftFailure } = detectSoftFailure(accumulatedResponse);
              const oaiIsLast = sortedProviders.indexOf(currentProvider) === sortedProviders.length - 1;
              if (oaiSoftFailure && !oaiIsLast) {
                console.warn(`[ai-stream-fallback] OpenAI returned soft failure, trying next...`);
                providerErrors.push({ provider: providerType, errorType: 'SOFT_FAILURE', message: accumulatedResponse.substring(0, 200) });
                continue;
              }
              textStreamCompleted = true;
              successfulProvider = providerType;
              logProviderAttempt('streaming', providerType, oaiSoftFailure ? 'soft_failure' : 'success');
              break; // Success! Exit the loop
            } else if (currentProvider.provider_type === 'anthropic') {
              accumulatedResponse = await streamAnthropic(apiKey, message, enrichedContext, currentProvider.model || 'claude-3-5-sonnet-20241022', conversationHistory, controller);
              // FIX 2025-12-04: Check streaming response for soft failures too
              const { isSoftFailure: claudeSoftFailure } = detectSoftFailure(accumulatedResponse);
              const claudeIsLast = sortedProviders.indexOf(currentProvider) === sortedProviders.length - 1;
              if (claudeSoftFailure && !claudeIsLast) {
                console.warn(`[ai-stream-fallback] Anthropic returned soft failure, trying next...`);
                providerErrors.push({ provider: providerType, errorType: 'SOFT_FAILURE', message: accumulatedResponse.substring(0, 200) });
                continue;
              }
              textStreamCompleted = true;
              successfulProvider = providerType;
              logProviderAttempt('streaming', providerType, claudeSoftFailure ? 'soft_failure' : 'success');
              break; // Success! Exit the loop
            } else if (currentProvider.provider_type === 'google') {
              // CRITICAL-02 FIX: For Gemini, use non-streaming fallback
              const systemPrompt = `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. ${enrichedContext}.

YOUR CORE VALUES: Partnership over transaction. Professionalism over pressure. Momentum over manipulation. Relationship development over pure follow-up.

FORBIDDEN: Never use money-hungry phrases, hard-selling verbs (push, hammer, pressure, force), shaming tactics, or salesy framing.

Be SPECIFIC, SUPPORTIVE, and CONCISE (max 4-5 sentences). CRITICAL: Output clean text with NO markdown syntax (##, ***, ---). Use plain text for emphasis. Suggest constructive next steps, not demands.`;

              let providerName = PROVIDER_NAMES[providerType] || 'AI';
              let responseText = '';

              // Gemini non-streaming fallback
              const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentProvider.model || 'gemini-1.5-pro'}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [
                    { role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + message }] }
                  ],
                  generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
                })
              });
              if (!geminiResponse.ok) {
                // FIX 2025-12-03: Better error classification for Google
                const { errorType } = classifyError({ message: `Gemini API error: ${geminiResponse.status}` }, geminiResponse.status);
                throw { message: `Gemini API error: ${geminiResponse.status}`, status: geminiResponse.status, errorType };
              }
              const geminiData = await geminiResponse.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
              responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate response.';

              // FIX 2025-12-04: Streaming soft-failure handling for last provider (match non-stream behavior)
              // Check if the response content indicates a soft failure (200 OK but error message)
              const { isSoftFailure: responseIsSoftFailure, pattern: softFailurePattern } = detectSoftFailure(responseText);
              const isLastProvider = sortedProviders.indexOf(currentProvider) === sortedProviders.length - 1;

              if (responseIsSoftFailure) {
                if (isLastProvider) {
                  // Last provider returned a soft failure - show their message with warning flag
                  // instead of ALL_PROVIDERS_FAILED (matches non-streaming behavior from ai-fallback.js:288-315)
                  console.warn(`[ai-stream-fallback] Last provider ${providerType} returned soft failure: "${softFailurePattern}"`);
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                    content: responseText,
                    provider: providerName,
                    isSoftFailure: true,
                    softFailureMessage: `${providerName} returned an error. Check your API key or try again.`
                  })}\n\n`));
                  textStreamCompleted = true;
                  successfulProvider = providerType;
                  accumulatedResponse = responseText;
                  logProviderAttempt('streaming', providerType, 'soft_failure');
                  break; // Exit loop - we've handled this gracefully
                } else {
                  // Not last provider - try next one (treat as error for fallback purposes)
                  console.warn(`[ai-stream-fallback] Provider ${providerType} returned soft failure, trying next...`);
                  providerErrors.push({ provider: providerType, errorType: 'SOFT_FAILURE', message: responseText.substring(0, 200) });
                  continue; // Try next provider
                }
              }

              // No soft failure - send the complete response as a single SSE event
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ content: responseText, provider: providerName })}\n\n`));
              textStreamCompleted = true;
              successfulProvider = providerType;
              accumulatedResponse = responseText;
              logProviderAttempt('streaming', providerType, 'success');
              break; // Success! Exit the loop
            }
          } catch (providerError: any) {
            // FIX 2025-12-03: Classify the error and decide whether to fallback
            const statusCode = providerError?.status || providerError?.statusCode;
            const { shouldFallback, errorType } = classifyError(providerError, statusCode);

            logProviderAttempt('streaming', providerType, 'failed', errorType);
            providerErrors.push({
              provider: providerType,
              errorType,
              message: providerError?.message || 'Unknown error'
            });

            console.log(`[ai-stream-fallback] Provider ${providerType} failed with ${errorType}, trying next...`);

            // If this is a user error (not provider error), don't fallback - fail immediately
            if (!shouldFallback) {
              console.log(`[ai-stream-fallback] Not falling back - user error: ${errorType}`);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: providerError?.message || errorType })}\n\n`));
              controller.close();
              return;
            }

            // Continue to next provider
          }
        }

        // FIX 2025-12-03: If ALL providers failed, send error
        // FIX 2025-12-04: Use intelligent error summarization for actionable guidance
        if (!textStreamCompleted) {
          console.error('[StageFlow][AI][ERROR] All providers failed:', providerErrors);

          // Convert to ProviderError format for summarization
          const formattedErrors: ProviderError[] = providerErrors.map(e => ({
            provider: e.provider as ProviderType,
            errorType: e.errorType,
            message: e.message,
            timestamp: new Date().toISOString()
          }));

          const userMessage = summarizeProviderErrors(formattedErrors);

          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            error: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
            code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
            message: userMessage,
            errors: providerErrors
          })}\n\n`));
          controller.close();
          return;
        }

        // CHART PARITY: Send chart data as final SSE event AFTER text stream completes
        // STREAM-02 FIX: Only send chart if text streaming completed successfully
        if (textStreamCompleted && chartType && deals.length > 0) {
          try {
            const chartData = await calculateChartData(chartType, deals, organizationId, supabase);
            if (chartData && chartData.length > 0) {
              // Send chart event with type, title, and data
              safeEnqueue(encoder.encode(`event: chart\ndata: ${JSON.stringify({
                chartType,
                chartTitle,
                chartData
              })}\n\n`));
            }
          } catch (chartError) {
            console.error('Chart calculation error:', chartError);
            // Don't fail the stream if chart calculation fails
          }
        }

        // PHASE 17: Send structured response for Plan My Day
        // This provides checklist data for the PlanMyDayChecklist component
        if (textStreamCompleted && isPlanMyDay && accumulatedResponse) {
          try {
            const structuredResponse = buildPlanMyDayResponse(accumulatedResponse, deals);
            safeEnqueue(encoder.encode(`event: structured\ndata: ${JSON.stringify(structuredResponse)}\n\n`));
          } catch (structuredError) {
            console.error('Structured response error:', structuredError);
            // Don't fail the stream if structured parsing fails
          }
        }

        // Increment AI usage after stream completes
        // FIX 2025-12-03: Use direct UPDATE instead of RPC (RPC may not exist in all environments)
        try {
          const { error: incrementError } = await supabase
            .from('organizations')
            .update({
              ai_requests_used_this_month: (orgData?.ai_requests_used_this_month || 0) + 1
            })
            .eq('id', organizationId);

          if (incrementError) {
            console.error('[ai-stream] Failed to increment AI usage:', incrementError);
          } else {
            console.log('[ai-stream] AI usage incremented for org:', organizationId);
          }
        } catch (usageError) {
          console.error('[ai-stream] Error tracking AI usage:', usageError);
        }

        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders
      }
    });

  } catch (error: any) {
    console.error('[StageFlow][AI][ERROR] AI Streaming error:', error);

    // M3 HARDENING: Use standardized error codes for frontend classification
    const errorMessage = error.message || 'AI request failed';
    let errorCode: string = AI_ERROR_CODES.PROVIDER_ERROR;
    let status = 500;

    // Classify the error for proper frontend handling
    if (errorMessage.includes('API key') || errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      errorCode = AI_ERROR_CODES.INVALID_API_KEY;
      status = 401;
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      errorCode = AI_ERROR_CODES.RATE_LIMITED;
      status = 429;
    } else if (errorMessage.includes('timeout')) {
      errorCode = AI_ERROR_CODES.TIMEOUT;
      status = 504;
    }

    return new Response(JSON.stringify({
      error: errorCode,
      code: errorCode,
      message: errorMessage
    }), {
      status: status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
