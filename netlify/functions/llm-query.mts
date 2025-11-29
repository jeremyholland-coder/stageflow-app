import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "./lib/encryption";
import { LLMQuerySchema, validate } from "./lib/validation";
import { RATE_LIMITS } from "./lib/rate-limiter";
import { requireAuth, validateUserIdMatch, createAuthErrorResponse } from './lib/auth-middleware';

// Removed config export - Netlify will auto-route based on function name

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LLMProvider {
  name: string;
  endpoint: string;
  headers: Record<string, string>;
  requestFormatter: (prompt: string) => any;
  responseFormatter: (data: any) => { text: string; tokensUsed: number };
}

const getProviderConfig = (providerName: string, encryptedKey: string, modelName: string, isTestMode: boolean = false): LLMProvider | null => {
  // CRITICAL: Decrypt API key before use (unless in test mode)
  let apiKey: string;
  if (isTestMode) {
    // Test keys are sent as plaintext from frontend
    apiKey = encryptedKey;
  } else {
    try {
      apiKey = decrypt(encryptedKey);
    } catch (error: any) {
      console.error('Failed to decrypt API key:', error);
      throw new Error('Invalid API key encryption');
    }
  }

  const providers: Record<string, LLMProvider> = {
    openai: {
      name: 'ChatGPT',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      requestFormatter: (prompt: string) => ({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7
      }),
      responseFormatter: (data: any) => ({
        text: data?.choices?.[0]?.message?.content || 'No response',
        tokensUsed: data?.usage?.total_tokens || 0
      })
    },
    anthropic: {
      name: 'Claude',
      endpoint: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      requestFormatter: (prompt: string) => ({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000
      }),
      responseFormatter: (data: any) => ({
        text: data?.content?.[0]?.text || 'No response',
        tokensUsed: (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0)
      })
    },
    google: {
      name: 'Gemini',
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      headers: {
        'Content-Type': 'application/json'
      },
      requestFormatter: (prompt: string) => ({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7
        }
      }),
      responseFormatter: (data: any) => ({
        text: data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response',
        tokensUsed: data?.usageMetadata?.totalTokenCount || 0
      })
    },
    xai: {
      name: 'Grok',
      endpoint: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      requestFormatter: (prompt: string) => ({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7,
        stream: false
      }),
      responseFormatter: (data: any) => ({
        text: data?.choices?.[0]?.message?.content || 'No response',
        tokensUsed: data?.usage?.total_tokens || 0
      })
    }
  };

  return providers[providerName] || null;
};

export default async (req: Request, context: Context) => {
  // Rate limiting for LLM queries
  const rateCheck = await RATE_LIMITS.LLM(req);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ 
      error: 'Too many requests', 
      retryAfter: Math.ceil((rateCheck.resetTime - Date.now()) / 1000)
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    
    // VALIDATE INPUT
    const validation = validate(LLMQuerySchema, body);
    if (!validation.success) {
      return new Response(JSON.stringify({ 
        error: 'Validation failed', 
        details: validation.error 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { prompt, deal_id, user_id, organization_id, test_key, test_provider } = validation.data;

    // PHASE 12 FIX: Always require authentication, query team_members directly
    // (requireOrgAccess was being called after body was already consumed)
    try {
      console.warn('[llm-query] Authenticating user...');
      const user = await requireAuth(req);
      await validateUserIdMatch(user, user_id);
      console.warn('[llm-query] Auth succeeded, user:', user.id);

      // Verify membership directly
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', organization_id)
        .maybeSingle();

      if (memberError || !membership) {
        console.error('[llm-query] User not in organization:', { userId: user.id, organizationId: organization_id });
        return new Response(JSON.stringify({ error: 'Not authorized for this organization' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.warn('[llm-query] Membership verified');
    } catch (authError: any) {
      console.error('[llm-query] Auth error:', authError.message);
      return createAuthErrorResponse(authError);
    }

    // MOBILE FIX: Detect and reject image data in prompt
    // Some mobile browsers/apps try to include base64 image data
    if (typeof prompt === 'string' && (
      prompt.includes('data:image/') ||
      prompt.includes('base64,') && prompt.length > 10000
    )) {
      return new Response(JSON.stringify({
        error: 'Image uploads not supported',
        details: 'Text-only queries are supported. Please describe your question without images.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // CRITICAL: Fetch organization's deals data to provide context to AI
    let dealsContext = '';
    if (!test_key && !test_provider) {
      try {
        // DATE-FIELD-01 FIX: Include 'created' field for deals table compatibility
        const { data: deals, error: dealsError } = await supabase
          .from('deals')
          .select('id, client, value, stage, status, confidence, notes, created, created_at, updated_at')
          .eq('organization_id', organization_id)
          .order('created', { ascending: false });

        if (!dealsError && deals && deals.length > 0) {
          // Build context with deals data (NO PII - only business data)
          // DATE-FIELD-01 FIX: Use d.created || d.created_at for deals table compatibility
          const dealsData = deals.map(d => ({
            id: d.id.substring(0, 8), // Short ID for reference
            client: d.client, // Business name is OK
            value: d.value,
            stage: d.stage,
            status: d.status,
            confidence: d.confidence,
            has_notes: !!d.notes, // Don't include actual notes (may contain PII)
            days_in_stage: Math.floor((new Date().getTime() - new Date(d.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
            age_days: Math.floor((new Date().getTime() - new Date(d.created || d.created_at).getTime()) / (1000 * 60 * 60 * 24))
          }));

          dealsContext = `\n\n=== CRM DATA CONTEXT ===\nYou have access to the following deals data from this organization's CRM:\n\nTotal Deals: ${deals.length}\n\nDeals:\n${JSON.stringify(dealsData, null, 2)}\n\n=== INSTRUCTIONS ===\n- Analyze this data to answer the user's question\n- Provide specific insights with numbers and deal references where relevant\n- For deal values, use $ formatting\n- If asked about "last" or "recent" deals, sort by created_at\n- "Closed" or "won" deals have status="won"\n- "Lost" deals have status="lost"\n- "Active" deals are those not won or lost\n- Calculate totals, averages, and statistics as needed\n- Be concise but thorough in your response\n\n`;
        }
      } catch (error: any) {
        console.error('Failed to fetch deals context:', error);
        // Continue without context - AI will respond that data isn't available
      }
    }

    // Handle test mode (when user is testing a new key)
    if (test_key && test_provider) {
      const providerConfig = getProviderConfig(test_provider, test_key, 'gpt-4o', true);
      
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: 'Unsupported provider' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        const requestBody = providerConfig.requestFormatter('Test connection');
        const response = await fetch(providerConfig.endpoint, {
          method: 'POST',
          headers: providerConfig.headers,
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API test failed (${response.status}): ${errorText}`);
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Connection successful' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } catch (error: any) {
        console.error('Test failed:', error);
        return new Response(
          JSON.stringify({ 
            error: 'Connection test failed',
            details: error.message 
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Fetch user's configured AI providers from database
    const { data: providers, error: dbError } = await supabase
      .from('ai_providers')
      .select('*')
      .eq('created_by', user_id)
      .eq('organization_id', organization_id)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch AI providers',
          details: dbError.message 
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!providers || providers.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No AI providers configured',
          details: 'Please connect an AI provider in Settings to use the AI Assistant'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Try each provider in order until one succeeds
    let responseText = '';
    let usedProvider = '';
    let tokensUsed = 0;
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        const providerConfig = getProviderConfig(provider.provider_type, provider.api_key_encrypted, provider.model || '');
        
        if (!providerConfig) {
          console.warn(`Unsupported provider: ${provider.provider_type}`);
          continue;
        }


        // CRITICAL: Enhance prompt with CRM data context
        const enhancedPrompt = dealsContext ? `${dealsContext}\n=== USER QUESTION ===\n${prompt}` : prompt;

        const requestBody = providerConfig.requestFormatter(enhancedPrompt);
        const response = await fetch(providerConfig.endpoint, {
          method: 'POST',
          headers: providerConfig.headers,
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`${providerConfig.name} API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;
        const formatted = providerConfig.responseFormatter(data);

        responseText = formatted.text;
        tokensUsed = formatted.tokensUsed;
        usedProvider = providerConfig.name;

        // CRITICAL FIX: Check if response is the fallback "No response" text
        // This means the API returned but without proper data structure
        if (responseText === 'No response') {
          throw new Error(`${providerConfig.name} returned empty response`);
        }

        break;

      } catch (error: any) {
        lastError = error as Error;
        console.warn(`Provider ${provider.provider_type} failed:`, error.message);
        continue;
      }
    }

    // FIX: Check for both falsy values AND the fallback "No response" text
    if (!responseText || responseText === 'No response') {
      console.error('All LLM providers failed:', lastError);
      const providerNames = providers.map(p => {
        const configs = { openai: 'ChatGPT', anthropic: 'Claude', google: 'Gemini', xai: 'Grok' };
        return configs[p.provider_type] || p.provider_type;
      }).join(', ');

      return new Response(
        JSON.stringify({
          error: providers.length === 1
            ? `${providerNames} couldn't answer this question`
            : `All AI providers (${providerNames}) are currently unavailable`,
          details: providers.length === 1
            ? `Try connecting additional AI providers (Claude or ChatGPT) in Settings for better reliability`
            : lastError?.message || 'No providers returned a valid response',
          providersAttempted: providerNames
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Save query and response to database
    try {
      const { error: logError } = await supabase
        .from('ai_queries')
        .insert({
          user_id,
          organization_id,
          deal_id: deal_id || null,
          prompt,
          response: responseText,
          model: usedProvider
        });

      if (logError) {
        console.error('Failed to save AI query to database:', logError);
      }
    } catch (error: any) {
      console.error('Database logging error:', error);
    }

    return new Response(
      JSON.stringify({
        response: responseText,
        provider: usedProvider,
        tokensUsed
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('LLM query error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process AI query',
        details: error.message 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
