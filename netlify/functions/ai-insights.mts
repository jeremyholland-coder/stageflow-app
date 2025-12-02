import type { Handler } from '@netlify/functions';
import { shouldUseNewAuth } from './lib/feature-flags';
import { requireAuth, createAuthErrorResponse } from './lib/auth-middleware';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // SECURITY: Feature-flagged authentication migration
    // Phase 4 Batch 5: Add authentication to AI insights (user-facing feature)
    if (shouldUseNewAuth('ai-insights')) {
      try {
        // NEW AUTH PATH: Require authentication for AI features
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader) {
          return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authentication required' })
          };
        }

        const request = new Request('https://dummy.com', {
          method: 'POST',
          headers: { 'Authorization': authHeader }
        });

        await requireAuth(request);

        // User is authenticated
      } catch (authError) {
        const errorResponse = createAuthErrorResponse(authError);
        return {
          statusCode: errorResponse.status,
          body: await errorResponse.text()
        };
      }
    }
    // LEGACY AUTH PATH: No authentication (CRITICAL VULNERABILITY - AI feature exposed)

    const { dealData, action } = JSON.parse(event.body || '{}');

    const prompts = {
      summarize: `Summarize this deal in 2-3 sentences:\n${JSON.stringify(dealData, null, 2)}`,
      nextSteps: `Based on this deal at ${dealData.stage} stage, suggest 3 specific next actions:\n${JSON.stringify(dealData, null, 2)}`,
      emailDraft: `Draft a professional follow-up email for this deal:\nDeal: ${dealData.name}\nStage: ${dealData.stage}\nValue: $${dealData.value}\nContact: ${dealData.contact_name}`,
      scoreQuality: `Score this lead quality from 1-10 and explain why:\n${JSON.stringify(dealData, null, 2)}`,
      winProbability: `Estimate win probability (0-100%) for this deal and explain:\n${JSON.stringify(dealData, null, 2)}`
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: prompts[action as keyof typeof prompts] || prompts.summarize
        }]
      })
    });

    const data = await response.json() as any;

    return {
      statusCode: 200,
      body: JSON.stringify({
        insight: data.content[0].text,
        action
      })
    };
  } catch (error: any) {
    console.error('AI insight error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'AI insight failed' })
    };
  }
};
