import { createClient } from '@supabase/supabase-js';
import { withTimeout, TIMEOUTS, TimeoutError } from './lib/timeout-wrapper';
import { decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, requireOrgAccess, createAuthErrorResponse } from './lib/auth-middleware';
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
  'gemini-2.5-pro': 3, 'gemini-2.5-flash': 2, 'gemini-2.5-flash-lite': 1, 'gemini-1.5-pro': 2,
  'grok-4': 3, 'grok-4-fast': 2, 'grok-3-mini': 1, 'grok-beta': 1
};

function getModelTier(modelName: string | null): number {
  if (!modelName) return 0;
  return MODEL_TIERS[modelName] || 0;
}

// PHASE 3: Task-specific model preferences (mirrors ai-assistant.mts)
const TASK_MODEL_AFFINITY: { [taskType: string]: { [providerType: string]: number } } = {
  'chart_insight': { 'openai': 3, 'anthropic': 3, 'google': 2, 'xai': 1 },
  'coaching': { 'anthropic': 3, 'openai': 2, 'google': 2, 'xai': 2 },
  'text_analysis': { 'openai': 2, 'anthropic': 2, 'google': 2, 'xai': 2 },
  'image_suitable': { 'openai': 2, 'anthropic': 2, 'google': 2, 'xai': 1 }
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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json() as any;
    const { message, deals = [], conversationHistory = [], aiSignals = [] } = body;

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
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
            headers: { 'Content-Type': 'application/json' }
          });
        }

        organizationId = membership.organization_id;
      } catch (authError) {
        return createAuthErrorResponse(authError);
      }
    } else {
      // LEGACY AUTH PATH: Inline auth check (will be removed after migration)
      const authHeader = req.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !authUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
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
          headers: { 'Content-Type': 'application/json' }
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
          error: 'AI_LIMIT_REACHED',
          limitReached: true,
          used, limit
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
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
    const providers = await getProvidersWithCache(supabase, organizationId);

    // FIX 2025-12-02: Return 422 (Unprocessable Entity) for NO_PROVIDERS
    // Previously returned 200 which confused frontend error handling
    if (!providers || providers.length === 0) {
      return new Response(JSON.stringify({
        error: 'NO_PROVIDERS',
        code: 'NO_PROVIDERS',
        message: 'No AI provider configured. Please connect an AI provider in Settings.'
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PHASE 3: Determine task type for smart provider selection
    const taskType = determineTaskType(message);
    const selectedProvider = selectBestProvider(providers, taskType);

    // Decrypt API key
    let apiKey: string;
    try {
      if (isLegacyEncryption(selectedProvider.api_key_encrypted)) {
        apiKey = decryptLegacy(selectedProvider.api_key_encrypted);
      } else {
        apiKey = decrypt(selectedProvider.api_key_encrypted);
      }
    } catch (error: any) {
      throw new Error('Invalid API key encryption');
    }

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

        try {
          // Stream based on provider type (using enrichedContext with visual instructions)
          // PHASE 19 FIX: Capture accumulated response for structured parsing
          if (selectedProvider.provider_type === 'openai') {
            accumulatedResponse = await streamOpenAI(apiKey, message, enrichedContext, selectedProvider.model, conversationHistory, controller);
            textStreamCompleted = true;
          } else if (selectedProvider.provider_type === 'anthropic') {
            accumulatedResponse = await streamAnthropic(apiKey, message, enrichedContext, selectedProvider.model, conversationHistory, controller);
            textStreamCompleted = true;
          } else {
            // CRITICAL-02 FIX: For Gemini/Grok, use non-streaming fallback
            // Generate a single response and send it as one SSE event
            const systemPrompt = `You are a professional sales advisor for StageFlow - an AI-powered partnership and pipeline management platform. ${enrichedContext}.

YOUR CORE VALUES: Partnership over transaction. Professionalism over pressure. Momentum over manipulation. Relationship development over pure follow-up.

FORBIDDEN: Never use money-hungry phrases, hard-selling verbs (push, hammer, pressure, force), shaming tactics, or salesy framing.

Be SPECIFIC, SUPPORTIVE, and CONCISE (max 4-5 sentences). CRITICAL: Output clean text with NO markdown syntax (##, ***, ---). Use plain text for emphasis. Suggest constructive next steps, not demands.`;

            let providerName = 'AI';
            let responseText = '';

            if (selectedProvider.provider_type === 'google') {
              // Gemini non-streaming fallback
              providerName = 'Gemini';
              const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedProvider.model || 'gemini-1.5-pro'}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [
                    { role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + message }] }
                  ],
                  generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
                })
              });
              if (!geminiResponse.ok) throw new Error(`Gemini API error: ${geminiResponse.status}`);
              const geminiData = await geminiResponse.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
              responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate response.';
            } else if (selectedProvider.provider_type === 'xai') {
              // Grok non-streaming fallback
              providerName = 'Grok';
              const grokResponse = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                  model: selectedProvider.model || 'grok-beta',
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                  ],
                  temperature: 0.7, max_tokens: 500
                })
              });
              // CRITICAL FIX A2: Handle Grok 403 permission errors gracefully
              if (!grokResponse.ok) {
                if (grokResponse.status === 403) {
                  responseText = "I'm unable to connect to Grok right now. This usually means your xAI API key needs credits or permissions. Please check your xAI account at console.x.ai to verify your API key has available credits.";
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ content: responseText, provider: providerName })}\n\n`));
                  textStreamCompleted = true;
                  // Increment usage and close stream gracefully
                  await supabase.rpc('increment_ai_usage', { org_id: organizationId });
                  controller.close();
                  return;
                }
                throw new Error(`Grok API error: ${grokResponse.status}`);
              }
              const grokData = await grokResponse.json() as { choices?: { message?: { content?: string } }[] };
              responseText = grokData.choices?.[0]?.message?.content || 'Unable to generate response.';
            } else {
              throw new Error(`Unsupported provider type: ${selectedProvider.provider_type}`);
            }

            // Send the complete response as a single SSE event
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ content: responseText, provider: providerName })}\n\n`));
            textStreamCompleted = true;
            // PHASE 17: Store for structured parsing
            accumulatedResponse = responseText;
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
          await supabase.rpc('increment_ai_usage', {
            org_id: organizationId
          });

          controller.close();
        } catch (error: any) {
          console.error('Streaming error:', error);
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error: any) {
    console.error('AI Streaming error:', error);

    // FIX 2025-12-02: Include proper error codes for frontend classification
    const errorMessage = error.message || 'AI request failed';
    let errorCode = 'PROVIDER_ERROR';
    let status = 500;

    // Classify the error for proper frontend handling
    if (errorMessage.includes('API key') || errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      errorCode = 'INVALID_API_KEY';
      status = 401;
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      errorCode = 'RATE_LIMITED';
      status = 429;
    } else if (errorMessage.includes('timeout')) {
      errorCode = 'TIMEOUT';
      status = 504;
    }

    return new Response(JSON.stringify({
      error: errorMessage,
      code: errorCode,
      message: errorMessage
    }), {
      status: status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
