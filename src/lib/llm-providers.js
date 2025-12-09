// LLM Provider Configuration - Production Ready
// Last Updated: December 4, 2025
// FIX 2025-12-04: Removed xAI/Grok - deprecated provider

export const LLM_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    displayName: 'ChatGPT',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast & powerful' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast & affordable' }
    ],
    endpoint: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),
    // CRITICAL FIX: Future-proof validation - accepts all OpenAI key formats
    validateFormat: (key) => {
      if (!key || typeof key !== 'string') return false;
      const trimmed = key.trim(); // CRITICAL: Match frontend/backend trimming behavior
      // OpenAI keys: Must start with sk- (old: sk-...T3BlbkFJ..., new: sk-proj-...)
      // FUTURE-PROOF: Only check prefix and minimum length
      // MUST MATCH validation in AISettings.jsx and save-ai-provider.mts
      return trimmed.startsWith('sk-') && trimmed.length >= 20;
    },
    testRequest: (model) => ({
      model: model,
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5
    }),
    parseResponse: (data) => ({
      success: true,
      text: data.choices?.[0]?.message?.content || ''
    }),
    parseError: (error, status) => {
      if (status === 401) return 'Invalid API key';
      if (status === 429) return 'Rate limit exceeded';
      if (status === 403) return 'Insufficient quota or billing issue';
      return `API error: ${status}`;
    }
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    displayName: 'Claude',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Powerful' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast' }
    ],
    endpoint: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2024-01-01',
      'Content-Type': 'application/json'
    }),
    validateFormat: (key) => {
      if (!key || typeof key !== 'string') return false;
      const trimmed = key.trim(); // CRITICAL: Match frontend/backend trimming behavior
      // CRITICAL FIX: Accept all Anthropic key formats
      // Formats evolve: sk-ant-api03-..., sk-ant-sid01-..., sk-ant-...
      // FUTURE-PROOF: Only check prefix and minimum length, not internal structure
      // MUST MATCH validation in AISettings.jsx and save-ai-provider.mts
      return trimmed.startsWith('sk-ant-') && trimmed.length >= 20;
    },
    testRequest: (model) => ({
      model: model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }]
    }),
    parseResponse: (data) => ({
      success: true,
      text: data.content?.[0]?.text || ''
    }),
    parseError: (error, status) => {
      if (status === 401) return 'Invalid API key';
      if (status === 403) return 'Insufficient credits or billing not configured';
      if (status === 429) return 'Rate limit exceeded';
      return `API error: ${status}`;
    }
  },

  google: {
    id: 'google',
    name: 'Google',
    displayName: 'Gemini',
    models: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast' },
      { id: 'gemini-pro', name: 'Gemini Pro', description: 'Balanced' }
    ],
    endpoint: (model, apiKey) => 
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    validateFormat: (key) => {
      if (!key || typeof key !== 'string') return false;
      const trimmed = key.trim(); // CRITICAL: Match frontend/backend trimming behavior
      // Google AI Studio keys: AIza prefix + base62 chars (typically 39-40 chars total)
      // FUTURE-PROOF: Only check prefix and minimum length
      return trimmed.startsWith('AIza') && trimmed.length >= 35;
    },
    testRequest: () => ({
      contents: [{ parts: [{ text: 'test' }] }],
      generationConfig: { maxOutputTokens: 10 }
    }),
    parseResponse: (data) => ({
      success: true,
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }),
    parseError: (error, status) => {
      if (status === 400) return 'Invalid API key';
      if (status === 403) return 'API not enabled in Google Cloud Console';
      if (status === 429) return 'Rate limit exceeded';
      return `API error: ${status}`;
    }
  }
};

export default LLM_PROVIDERS;