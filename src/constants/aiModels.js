// FIX v1.7.62 (#5): AI Model Constants - REAL models as of November 2025
// Removed speculative future models (GPT-5, Grok-4, Gemini 2.5) that don't exist yet
// Updated to ACTUAL available models to prevent API errors

export const AI_MODELS = {
  openai: [
    // GPT-4o Family (Latest - November 2024)
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Latest multimodal flagship - Best for complex analytics' },
    { id: 'gpt-4o-2024-11-20', name: 'GPT-4o (Nov 2024)', description: 'Specific version for consistency' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & affordable - $0.15/$0.60 per M tokens' },

    // GPT-4 Turbo Family (Production Standard)
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation flagship' },
    { id: 'gpt-4-turbo-2024-04-09', name: 'GPT-4 Turbo (Apr 2024)', description: 'Stable production version' },

    // GPT-3.5 Family (Most Economical)
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Lowest cost option for simple tasks' },
  ],

  anthropic: [
    // Claude Sonnet 4 (Latest - May 2025)
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest flagship - Best coding & analysis' },

    // Claude Opus 4 (Most Powerful)
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most intelligent model for complex tasks' },

    // Claude 3.7 Sonnet (Extended Thinking)
    { id: 'claude-sonnet-3-7-20250219', name: 'Claude Sonnet 3.7', description: 'Extended thinking for deep analysis' },

    // Claude 3.5 Haiku (Most Economical)
    { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', description: 'Fast & affordable - $1/$5 per M tokens' },
  ],

  google: [
    // Gemini 2.0 Flash (Latest - December 2024)
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', description: 'Experimental next-gen model' },

    // Gemini 1.5 Pro (Most Capable)
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '2M token context - Best for large datasets' },
    { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Latest)', description: 'Auto-updated to newest version' },

    // Gemini 1.5 Flash (Balanced)
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast & cost-effective' },
    { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash (Latest)', description: 'Auto-updated flash model' },
  ],

  xai: [
    // Grok Beta (Current Model)
    { id: 'grok-beta', name: 'Grok', description: 'X.AI flagship with real-time X platform integration' },
  ]
};

// Recommended default models (PREMIUM tier - best quality)
export const DEFAULT_MODELS = {
  openai: 'gpt-4o',                         // Latest flagship
  anthropic: 'claude-sonnet-4-20250514',    // Best coding & analysis
  google: 'gemini-1.5-pro',                 // 2M token context - best for large datasets
  xai: 'grok-beta'                          // Flagship with X integration
};

// Economy tier models (for cost-conscious users)
export const ECONOMY_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-3-5-20241022',
  google: 'gemini-1.5-flash',
  xai: 'grok-beta'
};

// Model pricing tiers
export const MODEL_TIERS = {
  premium: ['gpt-4o', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
  standard: ['gpt-4-turbo', 'claude-sonnet-3-7-20250219', 'gemini-1.5-flash', 'grok-beta'],
  economy: ['gpt-4o-mini', 'gpt-3.5-turbo', 'claude-haiku-3-5-20241022']
};

// Context window sizes (for reference)
export const CONTEXT_WINDOWS = {
  'gpt-4o': 128000,
  'gpt-4o-2024-11-20': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-2024-04-09': 128000,
  'gpt-3.5-turbo': 16385,
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-sonnet-3-7-20250219': 200000,
  'claude-haiku-3-5-20241022': 200000,
  'gemini-2.0-flash-exp': 1048576,
  'gemini-1.5-pro': 2097152,
  'gemini-1.5-pro-latest': 2097152,
  'gemini-1.5-flash': 1048576,
  'gemini-1.5-flash-latest': 1048576,
  'grok-beta': 131072
};
