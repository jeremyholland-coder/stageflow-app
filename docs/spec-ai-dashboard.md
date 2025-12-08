# StageFlow AI Dashboard Specification

**Date**: 2025-12-07
**Status**: P0 Repair
**Issue**: AI Dashboard reliability, error handling, graceful degradation

---

## 1. File Map

### Backend (Netlify Functions)

| File | Role | Key Lines |
|------|------|-----------|
| `netlify/functions/ai-assistant.mts` | **Non-streaming AI endpoint**. Handles general AI queries with provider fallback chain, rate limiting, and Mission Control fallback. | Lines 1269-2011: Main handler; Lines 1730-1760: runWithFallback; Lines 1892-1985: AllProvidersFailedError handling |
| `netlify/functions/ai-assistant-stream.mts` | **Streaming AI endpoint**. Handles Plan My Day and streaming responses with SSE. | Lines 674-816: Provider fallback loop |
| `netlify/functions/lib/ai-error-codes.ts` | **Standardized error codes** for all AI endpoints. Defines AI_ERROR_CODES constant. | Lines 1-113: All error code definitions |
| `netlify/functions/lib/provider-cache.ts` | **In-memory provider cache** with 60s TTL. Reduces DB reads. Throws ProviderFetchError on failure. | Lines 34-44: ProviderFetchError class; Lines 164-219: getProvidersWithCache |
| `netlify/functions/lib/select-provider.ts` | **Unified provider selection** with task-aware affinity scoring. Single source of truth. | Lines 168-205: selectProvider function |
| `netlify/functions/lib/mission-control-fallback.ts` | **Non-AI fallback plan** builder. Generates deterministic plan when AI fails. | Lines 100-193: buildMissionControlContext; Lines 206-351: buildBasicMissionControlPlan |
| `netlify/functions/lib/ai-fallback.ts` | **Backend fallback chain** with runWithFallback and AllProvidersFailedError. | (backend version) |

### Frontend (React)

| File | Role | Key Lines |
|------|------|-----------|
| `src/components/MissionControlPanel.jsx` | **Main AI panel container**. Renders tabs (Tasks, Coach), metrics, and wraps CustomQueryView. | Lines 381-822: Main component |
| `src/components/CustomQueryView.jsx` | **AI conversation UI**. Handles queries, Plan My Day, streaming, offline mode. | Lines 336-500+: Main component; Lines 55-236: getErrorGuidance |
| `src/components/AIInlineError.jsx` | **Unified inline error UI**. Shows actionable errors with retry/navigate actions. | Lines 1-196: Error display component |
| `src/hooks/useAIProviderStatus.js` | **Provider status hook**. Checks if AI is configured, with localStorage caching (30min TTL). | Lines 35-432: Hook with providersLoaded, providerFetchError, statusMayBeStale |
| `src/lib/ai-fallback.js` | **Frontend fallback logic**. runAIQueryWithFallback, fetchConnectedProviders. | Lines 235-363: runAIQueryWithFallback; Lines 411-442: runAIQueryWithRetry |
| `src/lib/ai-retry.js` | **Retry with backoff**. Handles transient errors (network, rate limit, timeout). | Lines 37-87: isRetryableError; Lines 101-159: withRetry |

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND                                    │
├─────────────────────────────────────────────────────────────────────┤
│  MissionControlPanel                                                 │
│    └── CustomQueryView                                               │
│          ├── useAIProviderStatus() - checks if AI configured        │
│          ├── runAIQueryWithRetry() - frontend fallback + retry      │
│          │     └── runAIQueryWithFallback()                         │
│          │           └── makeAIRequest() → ai-assistant endpoint    │
│          └── AIInlineError - error display                          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP POST
┌──────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Netlify)                            │
├──────────────────────────────────────────────────────────────────────┤
│  ai-assistant.mts (non-streaming)                                    │
│    ├── requireAuth() - verify session                                │
│    ├── checkRateLimits() - per-user/org limits                      │
│    ├── getProvidersWithCache() - fetch providers (cached 60s)       │
│    │     └── throws ProviderFetchError on DB failure                │
│    ├── runWithFallback() - try each provider                        │
│    │     └── callAIProvider() → OpenAI/Anthropic/Google             │
│    ├── On success: return { response, provider, chartData? }        │
│    └── On failure: AllProvidersFailedError                          │
│          └── Return HTTP 200 with ok: false (P1 HOTFIX)             │
│               └── Include fallbackPlan for graceful degradation     │
├──────────────────────────────────────────────────────────────────────┤
│  ai-assistant-stream.mts (streaming - Plan My Day)                   │
│    └── Same pattern but with SSE streaming                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Error Code Flow

```
AI_ERROR_CODES (from ai-error-codes.ts):
├── NO_PROVIDERS         - No AI provider configured (200, ok: false)
├── ALL_PROVIDERS_FAILED - All providers failed (200, ok: false)
├── SESSION_ERROR        - Auth/session expired (401)
├── AUTH_REQUIRED        - Not authenticated (401)
├── RATE_LIMITED         - Rate limit exceeded (429)
├── TIMEOUT              - Request timeout (200, ok: false)
├── INVALID_API_KEY      - Provider key invalid (200, ok: false)
├── PROVIDER_ERROR       - Generic provider error (200, ok: false)
└── PROVIDER_FETCH_ERROR - DB fetch failed (503)
```

**Critical P1 HOTFIX (2025-12-07)**: `ALL_PROVIDERS_FAILED` now returns HTTP 200 with `ok: false` instead of HTTP 503. This treats provider failures as DATA, not server faults, preventing ErrorBoundary crashes.

---

## 4. Known Issues to Fix

### Issue 1: Frontend error handling for ok: false responses
**Location**: `src/lib/ai-fallback.js:122-134` (makeAIRequest)
**Problem**: After P1 HOTFIX, backend returns 200 with `ok: false`. Frontend `makeAIRequest` only throws on `!response.ok` (HTTP status), not on JSON `ok: false`.
**Impact**: Silent failures where user sees no response.
**Fix Needed**: Check `result.ok === false` after parsing JSON and throw appropriately.

### Issue 2: CustomQueryView getErrorGuidance mismatch
**Location**: `src/components/CustomQueryView.jsx:55-236`
**Problem**: Error classification logic expects certain error shapes that may not match new backend format.
**Impact**: Wrong error messages shown to users.
**Fix Needed**: Update getErrorGuidance to handle `error.error.type === 'AI_PROVIDER_FAILURE'` format.

### Issue 3: Fallback plan not rendered
**Location**: `src/components/CustomQueryView.jsx`
**Problem**: Backend returns `fallbackPlan` on ALL_PROVIDERS_FAILED, but frontend may not render it.
**Impact**: Users get error message instead of helpful fallback plan.
**Fix Needed**: Check for fallbackPlan in response and render it.

### Issue 4: useAIProviderStatus cache staleness
**Location**: `src/hooks/useAIProviderStatus.js:163-167`
**Problem**: 30min cache TTL may show stale "no provider" status after user adds provider.
**Impact**: User adds provider but UI still shows "No AI configured".
**Current Mitigation**: Event listeners for `ai-provider-connected` (lines 279-310).
**Status**: Appears handled, verify with testing.

### Issue 5: Streaming endpoint error format
**Location**: `netlify/functions/ai-assistant-stream.mts`
**Problem**: Need to verify streaming endpoint uses same error format as non-streaming.
**Impact**: Inconsistent error handling between Plan My Day and regular queries.
**Fix Needed**: Audit streaming endpoint error responses.

---

## 5. Invariants (Expected Behavior)

1. **Never HTTP 5xx for provider failures**: Provider quota/billing/misconfiguration should return 200 with `ok: false`, not 503.

2. **Always include actionable guidance**: Error responses must include user-facing message with next steps (Settings link, retry button, etc.).

3. **Fallback plan on total failure**: When all providers fail, include `fallbackPlan` in response so users still get value.

4. **Session errors distinct from provider errors**: AUTH_REQUIRED and SESSION_ERROR should show "Please sign in" not "AI providers failed".

5. **Provider status reflects reality**: useAIProviderStatus should accurately reflect whether user has a working AI provider configured.

6. **Retry only transient errors**: Don't retry INVALID_API_KEY, NO_PROVIDERS, or AI_LIMIT_REACHED - only network/timeout/rate-limit.

---

## 6. Findings from Tracing

### Status After Tracing (2025-12-07)

**Issues 1-3 (Frontend ok: false handling)**: ✅ Already fixed in P1 HOTFIX
- CustomQueryView lines 712-740: Checks for `ok: false` in JSON before reading stream
- CustomQueryView lines 874-901: Handles SSE error events with isAllProvidersFailed
- getErrorGuidance lines 163-206: Extracts fallbackPlan and providerErrors
- AIProviderErrorDisplay: Renders fallbackPlan with FallbackPlanDisplay component

**Issue 4 (useAIProviderStatus cache)**: ✅ Already handled
- Event listeners for `ai-provider-connected` at lines 279-310
- Optimistic updates and 1.5s delayed verification

**Issue 5 (Streaming endpoint error format)**: ⚠️ NEEDS FIX
- Streaming endpoint (ai-assistant-stream.mts lines 833-838) sends error without:
  - `fallbackPlan` - users don't get fallback plan on Plan My Day failures
  - Structured `providers` array with dashboardUrls
- Non-streaming endpoint (ai-assistant.mts lines 1947-1980) includes all of these

---

## 7. Fix Plan

### Fix 1: Streaming endpoint missing fallbackPlan + providers structure
**File**: `netlify/functions/ai-assistant-stream.mts`
**Location**: Lines 833-838 (ALL_PROVIDERS_FAILED SSE event)
**Problem**: When all providers fail, the streaming endpoint sends error data without `fallbackPlan` or structured `providers` array with dashboardUrls.
**Fix Steps**:
1. Import mission-control-fallback utilities at top of file
2. Build fallbackPlan when all providers fail (like non-streaming endpoint at lines 1931-1936)
3. Restructure SSE error event to match non-streaming format:
   - Add `error.type: 'AI_PROVIDER_FAILURE'`
   - Add `error.providers` array with code, message, dashboardUrl per provider
   - Add `error.fallbackPlan` and top-level `fallbackPlan`

**Before**:
```javascript
safeEnqueue(encoder.encode(`data: ${JSON.stringify({
  error: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
  code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
  message: userMessage,
  errors: providerErrors
})}\n\n`));
```

**After**:
```javascript
// Build fallback plan
const fallbackContext = buildMissionControlContext(deals, null);
const fallbackPlan = buildBasicMissionControlPlan(fallbackContext, deals, 0);

safeEnqueue(encoder.encode(`data: ${JSON.stringify({
  error: {
    type: 'AI_PROVIDER_FAILURE',
    reason: 'ALL_PROVIDERS_FAILED',
    code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
    message: userMessage,
    providers: formattedErrors.map(e => ({
      provider: e.provider,
      code: e.errorType,
      message: e.message?.substring(0, 200),
      dashboardUrl: getProviderDashboardUrl(e.provider)
    })),
    fallbackPlan
  },
  code: AI_ERROR_CODES.ALL_PROVIDERS_FAILED,
  message: userMessage,
  fallbackPlan
})}\n\n`));
```

---

## 8. Fix Implementation (2025-12-07)

### Completed Fix
**Status**: ✅ FIXED

**Changes Made**:
1. **netlify/functions/ai-assistant-stream.mts**:
   - Added imports for `classifyProviderError` and mission-control-fallback utilities (lines 78-81)
   - Updated ALL_PROVIDERS_FAILED handling (lines 838-883) to include:
     - `error.type: 'AI_PROVIDER_FAILURE'`
     - `error.providers[]` with classified errors and dashboard URLs
     - `error.fallbackPlan` with pipeline context for graceful degradation
     - Top-level `fallbackPlan` for backwards compatibility

2. **tests/unit/ai-error-handling.test.js**:
   - Added 24 regression tests verifying:
     - Error response format parity between streaming and non-streaming
     - Frontend extraction of providerErrors and fallbackPlan
     - AIProviderErrorDisplay props compatibility

**Verification**:
- Build passes: ✅
- All 121 unit tests pass: ✅
- New AI error tests (24): ✅

---

## 9. Test Scenarios

| Scenario | Expected UI | Backend Response |
|----------|-------------|------------------|
| No AI provider configured | Inline: "No AI provider connected" + Settings link | 200, `ok: false`, code: NO_PROVIDERS |
| API key expired/invalid | Inline: "Your API key appears invalid" + Settings link | 200, `ok: false`, code: INVALID_API_KEY |
| All providers quota exhausted | Inline: "Your AI providers are failing" + Retry + fallbackPlan rendered | 200, `ok: false`, code: ALL_PROVIDERS_FAILED |
| Monthly limit reached | Inline: "Monthly limit reached" + Upgrade link | 429, code: AI_LIMIT_REACHED |
| Session expired | Inline: "Session expired, please sign in" | 401, code: SESSION_ERROR |
| Network timeout | Inline: "Request timed out" + Retry | 200, `ok: false` or throws |
| Provider DB unreachable | Inline: "Temporary error" + Retry | 503, code: PROVIDER_FETCH_ERROR |
