import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';
import { decrypt, isLegacyEncryption, decryptLegacy } from './lib/encryption';
import { withTimeout, TIMEOUTS } from './lib/timeout-wrapper';
import {
  runWithFallback,
  PROVIDER_NAMES,
  AllProvidersFailedError
} from './lib/ai-fallback';

/**
 * AI Insights Endpoint
 *
 * FIX 2025-12-02: Complete rewrite to use fallback chain architecture
 * Previously hardcoded to Claude, now uses user's configured providers
 * with automatic failover (openai → anthropic → google → xai)
 *
 * SECURITY: Always requires authentication (removed legacy bypass)
 */

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Get all active AI providers for organization
async function getActiveProviders(organizationId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ai-insights] Error fetching providers:', error);
    return [];
  }

  return data || [];
}

// Call OpenAI/GPT for insights
async function callOpenAI(apiKey: string, prompt: string, modelName?: string): Promise<string> {
  const response = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a professional sales advisor. Provide clear, actionable insights. Be concise and specific.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'OpenAI API call'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  if (!data?.choices?.[0]?.message?.content) {
    throw new Error('OpenAI returned invalid response structure');
  }

  return data.choices[0].message.content;
}

// Call Anthropic/Claude for insights
async function callAnthropic(apiKey: string, prompt: string, modelName?: string): Promise<string> {
  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelName || 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: 'You are a professional sales advisor. Provide clear, actionable insights. Be concise and specific.',
        messages: [{ role: 'user', content: prompt }]
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Anthropic API call'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  if (!data?.content?.[0]?.text) {
    throw new Error('Anthropic returned invalid response structure');
  }

  return data.content[0].text;
}

// Call Google Gemini for insights
async function callGemini(apiKey: string, prompt: string, modelName?: string): Promise<string> {
  const model = modelName || 'gemini-1.5-pro';

  const response = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a professional sales advisor. Provide clear, actionable insights. Be concise and specific.\n\n${prompt}`
          }]
        }]
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Gemini API call'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Gemini returned invalid response structure');
  }

  return data.candidates[0].content.parts[0].text;
}

// Call xAI/Grok for insights
async function callGrok(apiKey: string, prompt: string, modelName?: string): Promise<string> {
  const response = await withTimeout(
    fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName || 'grok-beta',
        messages: [
          {
            role: 'system',
            content: 'You are a professional sales advisor. Provide clear, actionable insights. Be concise and specific.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    }),
    TIMEOUTS.AI_PROVIDER,
    'Grok API call'
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  if (!data?.choices?.[0]?.message?.content) {
    throw new Error('Grok returned invalid response structure');
  }

  return data.choices[0].message.content;
}

// Route to appropriate AI provider
async function callAIProvider(provider: any, prompt: string): Promise<{ insight: string; provider: string }> {
  // Decrypt API key
  let apiKey: string;
  try {
    if (isLegacyEncryption(provider.api_key_encrypted)) {
      apiKey = decryptLegacy(provider.api_key_encrypted);
    } else {
      apiKey = decrypt(provider.api_key_encrypted);
    }
  } catch (error: any) {
    console.error('[ai-insights] Failed to decrypt API key:', error);
    throw new Error('Invalid API key encryption. Please re-save your AI provider configuration.');
  }

  const modelName = provider.model;
  let insight: string;

  switch (provider.provider_type) {
    case 'openai':
      insight = await callOpenAI(apiKey, prompt, modelName);
      return { insight, provider: 'ChatGPT' };

    case 'anthropic':
      insight = await callAnthropic(apiKey, prompt, modelName);
      return { insight, provider: 'Claude' };

    case 'google':
      insight = await callGemini(apiKey, prompt, modelName);
      return { insight, provider: 'Gemini' };

    case 'xai':
      insight = await callGrok(apiKey, prompt, modelName);
      return { insight, provider: 'Grok' };

    default:
      throw new Error(`Unsupported AI provider: ${provider.provider_type}`);
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // SECURITY FIX: Always require authentication (removed legacy bypass)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
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
      console.error('[ai-insights] No organization found for user:', user.id);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No organization found' })
      };
    }

    const organizationId = membership.organization_id;

    // Parse request body
    const { dealData, action } = JSON.parse(event.body || '{}');

    if (!dealData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Deal data is required' })
      };
    }

    // Build prompts for different actions
    const prompts: Record<string, string> = {
      summarize: `Summarize this deal in 2-3 sentences:\n${JSON.stringify(dealData, null, 2)}`,
      nextSteps: `Based on this deal at ${dealData.stage} stage, suggest 3 specific next actions:\n${JSON.stringify(dealData, null, 2)}`,
      emailDraft: `Draft a professional follow-up email for this deal:\nDeal: ${dealData.name}\nStage: ${dealData.stage}\nValue: $${dealData.value}\nContact: ${dealData.contact_name}`,
      scoreQuality: `Score this lead quality from 1-10 and explain why:\n${JSON.stringify(dealData, null, 2)}`,
      winProbability: `Estimate win probability (0-100%) for this deal and explain:\n${JSON.stringify(dealData, null, 2)}`
    };

    const prompt = prompts[action] || prompts.summarize;

    // Get all active providers for the organization
    const providers = await getActiveProviders(organizationId);

    if (providers.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          error: 'No AI provider configured',
          insight: "I'm not connected to any AI providers yet. Please configure an AI provider in Integrations → AI Settings."
        })
      };
    }

    // FIX 2025-12-02: Use fallback chain instead of hardcoded Claude
    // Fallback order: openai → anthropic → google → xai
    const fallbackResult = await runWithFallback(
      'deal-insights',
      providers,
      async (provider) => callAIProvider(provider, prompt)
    );

    if (!fallbackResult.success || !fallbackResult.result) {
      // All providers failed
      console.error('[ai-insights] All providers failed:', fallbackResult.errors);

      const providerNames = fallbackResult.errors
        .map(e => PROVIDER_NAMES[e.provider] || e.provider)
        .filter(Boolean)
        .join(', ');

      return {
        statusCode: 503,
        body: JSON.stringify({
          error: 'ALL_PROVIDERS_FAILED',
          insight: `I tried all available AI providers (${providerNames}) but none could respond. Please try again in a moment.`,
          errors: fallbackResult.errors.map(e => ({
            provider: e.provider,
            errorType: e.errorType
          }))
        })
      };
    }

    // Success - return insight with provider info
    return {
      statusCode: 200,
      body: JSON.stringify({
        insight: fallbackResult.result.insight,
        action,
        provider: fallbackResult.result.provider,
        providerUsed: fallbackResult.providerUsed
      })
    };

  } catch (error: any) {
    console.error('[ai-insights] Error:', error);

    // Handle AllProvidersFailedError specifically
    if (error instanceof AllProvidersFailedError) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: 'ALL_PROVIDERS_FAILED',
          insight: 'All AI providers failed. Please check your API keys or try again later.',
          providersAttempted: error.providersAttempted
        })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'AI insight failed',
        details: error.message
      })
    };
  }
};
