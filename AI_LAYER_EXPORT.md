# StageFlow AI Layer Export Bundle

**Generated**: 2025-12-09
**Purpose**: Complete documentation of the AI connectivity layer for debugging and handoff.

---

## 1. Architecture Overview

### 1.1 High-Level Flow

```
User Action → Frontend Component → API Client → Netlify Function → AI Provider
     ↑                                                      ↓
     └──────────────── Response / SSE Stream ←─────────────┘
```

### 1.2 Authentication Flow

```
1. User logs in → Backend sets HttpOnly cookies (access_token, refresh_token)
2. Frontend calls ensureValidSession() before AI requests
3. ensureValidSession() → GET /.netlify/functions/auth-session
4. auth-session validates cookies/JWT → returns { valid, user, session }
5. On 401: Frontend shows "Session expired" (NOT "AI unavailable")
```

### 1.3 Provider Configuration Flow

```
1. useAIProviderStatus hook → POST /.netlify/functions/get-ai-providers
2. Backend authenticates via requireAuth() middleware
3. Backend queries ai_providers table with service role
4. Returns { success, providers, organizationId }
5. Hook sets hasProvider, authError, providerFetchError states
```

### 1.4 AI Request Flow (Streaming)

```
1. CustomQueryView.handleQueryStreaming()
2. ensureValidSession() to get auth token
3. POST /.netlify/functions/ai-assistant-stream
4. Backend: Auth → Rate limit check → Provider selection → AI call
5. SSE stream: data: { content, provider, chartData... }
6. On error: data: { error, code, message, providers }
```

---

## 2. File Inventory

### 2.1 Backend (Netlify Functions)

| File | Purpose |
|------|---------|
| `netlify/functions/auth-session.mts` | Validates session from cookies, returns user/session |
| `netlify/functions/ai-assistant.mts` | Non-streaming AI endpoint with fallback |
| `netlify/functions/ai-assistant-stream.mts` | Streaming AI endpoint (primary) |
| `netlify/functions/get-ai-providers.mts` | Fetches org's AI provider configs |
| `netlify/functions/save-ai-provider.mts` | Saves/updates AI provider with encrypted key |
| `netlify/functions/lib/ai-error-codes.ts` | Canonical error codes for AI endpoints |
| `netlify/functions/lib/encryption.ts` | Encrypt/decrypt API keys |
| `netlify/functions/lib/auth-middleware.ts` | requireAuth(), requireOrgAccess() |
| `netlify/functions/lib/ai-fallback.ts` | Provider fallback logic |
| `netlify/functions/lib/select-provider.ts` | Unified provider selection |
| `netlify/functions/lib/rate-limiter.ts` | Rate limiting logic |

### 2.2 Frontend (React)

| File | Purpose |
|------|---------|
| `src/hooks/useAIProviderStatus.js` | Checks if org has AI providers, caches result |
| `src/lib/ai-error-codes.js` | Error classification, messages, actions |
| `src/lib/api-client.js` | API wrapper with auth, retry, timeout |
| `src/lib/supabase.js` | Supabase client, ensureValidSession() |
| `src/components/CustomQueryView.jsx` | Main AI chat component with streaming |
| `src/components/MissionControlPanel.jsx` | Dashboard AI panel wrapper |
| `src/components/AIProviderErrorDisplay.jsx` | Detailed provider error UI |
| `src/components/AIInlineError.jsx` | Inline error display |
| `src/config/dashboardCards.js` | Dashboard card registry |

---

## 3. Error Code Contract

### 3.1 Backend Error Codes (`AI_ERROR_CODES`)

```typescript
{
  CONFIG_ERROR: 'CONFIG_ERROR',           // Missing ENCRYPTION_KEY
  NO_PROVIDERS: 'NO_PROVIDERS',           // No AI providers configured
  PROVIDER_FETCH_ERROR: 'PROVIDER_FETCH_ERROR', // DB query failed
  ALL_PROVIDERS_FAILED: 'ALL_PROVIDERS_FAILED', // All providers errored
  SESSION_ERROR: 'SESSION_ERROR',         // Auth expired
  AUTH_REQUIRED: 'AUTH_REQUIRED',         // No auth provided
  AI_LIMIT_REACHED: 'AI_LIMIT_REACHED',   // Monthly limit exceeded
  INVALID_API_KEY: 'INVALID_API_KEY',     // Provider rejected key
  RATE_LIMITED: 'RATE_LIMITED',           // 429 from provider
  TIMEOUT: 'TIMEOUT',                     // Request timed out
  PROVIDER_ERROR: 'PROVIDER_ERROR',       // Generic provider error
}
```

### 3.2 Frontend Error Handling

Each code maps to:
- **Message**: User-friendly text
- **Severity**: error/warning/info
- **Retryable**: boolean
- **Action**: { label, type: 'retry' | 'settings' | 'none' }

### 3.3 Error Response Shape

```typescript
// Non-streaming response
{
  ok: false,
  code: 'ALL_PROVIDERS_FAILED',
  message: 'Human-readable message',
  providers: [
    { provider: 'openai', code: 'BILLING_OR_QUOTA', message: '...', dashboardUrl: '...' }
  ],
  fallbackPlan?: { summary, tasks }
}

// Streaming error (SSE)
data: {
  error: {
    type: 'AI_PROVIDER_FAILURE',
    code: 'ALL_PROVIDERS_FAILED',
    message: '...',
    providers: [...]
  },
  fallbackPlan?: {...}
}
```

---

## 4. Request/Response Contract

### 4.1 AI Request Shape

```typescript
interface StageflowAIRequest {
  message: string;
  deals: Deal[];
  mode?: 'plan_my_day' | 'analytics' | 'deal_helper' | 'generic';
  taskMode?: 'planning' | 'analysis' | 'explain' | 'compose';
  healthCheckOnly?: boolean;
  preferredProvider?: 'openai' | 'anthropic' | 'google';
}
```

### 4.2 AI Response Shape

```typescript
interface StageflowAIResponse {
  ok: boolean;
  code?: string;
  message?: string;
  provider?: string;
  response?: string;           // AI text response
  chartData?: any[];           // For chart generation
  chartType?: string;
  fallbackPlan?: {
    summary: string;
    tasks: any[];
  };
  configHealthy?: boolean;     // For health checks
}
```

---

## 5. Debugging Guide

### 5.1 Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Session expired" on every request | Cookies not being sent | Check SameSite, Secure cookie settings |
| "AI providers temporarily unavailable" | ALL_PROVIDERS_FAILED | Check provider API keys in Netlify env |
| "ReadableStream is locked" | Stream consumed twice | Fixed in CustomQueryView.jsx |
| 401 from auth-session | No valid cookies | User needs to re-login |
| CONFIG_ERROR | Missing ENCRYPTION_KEY | Set in Netlify env vars |

### 5.2 Debug Mode

Add `?debug=1` to URL to show diagnostic panel with:
- Provider status
- Auth state
- Network status
- Deal count

### 5.3 Console Logging Tags

Search Netlify logs for:
- `[StageFlow][AI][ERROR]` - Errors
- `[StageFlow][AI][INFO]` - Info
- `[StageFlow][P0]` - Critical production issues
- `[AUTH_SESSION]` - Auth flow

---

## 6. Environment Variables

### Required for AI

| Variable | Purpose |
|----------|---------|
| `ENCRYPTION_KEY` | Encrypt/decrypt stored API keys |
| `SUPABASE_URL` | Database URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for bypassing RLS |

### NOT Required (Stored in DB)

- `OPENAI_API_KEY` - Stored encrypted per-org
- `ANTHROPIC_API_KEY` - Stored encrypted per-org
- `GEMINI_API_KEY` - Stored encrypted per-org

---

## 7. Recent Fixes (2025-12-09)

### 7.1 ReadableStream is locked

**File**: `src/components/CustomQueryView.jsx` (lines 760-819)

**Issue**: When backend returns JSON error (Content-Type: application/json), the code called `response.json()` to parse it, but if the error conditions didn't match, it fell through to `response.body.getReader()` - causing "ReadableStream is locked" because the body was already consumed.

**Fix**: After parsing JSON, always return - never fall through to streaming code.

### 7.2 Auth Error vs "AI unavailable"

**Files**:
- `src/config/dashboardCards.js` - Added `aiAuthError` to props
- `src/components/MissionControlPanel.jsx` - Pass `aiAuthError` through
- `src/components/CustomQueryView.jsx` - Accept and use `aiAuthError` prop

**Issue**: When auth-session returned 401, the UI showed "AI providers temporarily unavailable" instead of "Session expired".

**Fix**: Propagate `authError` from `useAIProviderStatus` through the component tree. CustomQueryView now shows "Session Expired" banner when `aiAuthError` is true.

### 7.3 Removed Hardcoded Model Restrictions

**File**: `netlify/functions/lib/ai-models.ts`

**Issue**: Model list was hardcoded - users couldn't use new models (gpt-5, claude-4, etc.) until StageFlow updated code and redeployed. This is a maintenance nightmare and blocks users from using newer, better models.

**Fix**:
- `validateModel()` now always returns `{ valid: true }` - no model rejection
- Provider API is now the source of truth for valid models
- UI shows "recommended" models as suggestions, but users can enter ANY model ID
- If a model doesn't exist, the provider API returns a clear error

**Philosophy**: Don't gatekeep what models users can try. Let the provider API validate.

**Updated defaults**:
- OpenAI: `gpt-4o` (unchanged)
- Anthropic: `claude-sonnet-4-20250514` (updated to Claude 4)
- Google: `gemini-2.0-flash` (updated to 2.0)

---

## 8. Testing Checklist

- [ ] Fresh login → AI chat works
- [ ] Expired session → Shows "Session expired" (not "AI unavailable")
- [ ] No AI providers → Shows "No AI provider connected"
- [ ] Invalid API key → Shows "API key invalid" with dashboard link
- [ ] All providers fail → Shows fallback plan with provider status
- [ ] Offline → Shows "You're offline" message
- [ ] Plan My Day → Generates checklist or shows fallback

---

## 9. Handoff Notes

If handing this to another model (e.g., Gemini):

1. **Start with**: `netlify/functions/lib/ai-error-codes.ts` - this is the source of truth for error codes
2. **For streaming issues**: Check `ai-assistant-stream.mts` and `CustomQueryView.jsx`
3. **For auth issues**: Check `auth-session.mts` and `useAIProviderStatus.js`
4. **Build command**: `npm run build` (must pass with zero errors)
5. **Test command**: `npm run test:scenarios` (if available)
