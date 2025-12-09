# Founders QA Checklist

## Production Bug Fixes (2025-12-09)

This document contains acceptance criteria for three P0 bug fixes. All tests should be performed in **production** (stageflow.startupstage.com) after deployment.

---

## BUG 1: Deal Lifecycle Errors (401 + 500 from update-deal)

### Symptoms Fixed
- Editing/dragging deals showed "Server error. Please try again later."
- Safari devtools showed: auth-session → 401, then update-deal → 500 (twice)

### Root Cause
- Session validation failures were not properly blocking subsequent API calls
- Some auth errors returned 500 instead of 401
- Frontend error mapping wasn't surfacing session errors correctly

### Files Modified (P0 FIX 2025-12-09)
| File | Changes |
|------|---------|
| [api-client.js](src/lib/api-client.js) | All session validation failures now fatal (P0 FIX 2025-12-08) |
| [update-deal.mts](netlify/functions/update-deal.mts) | **P0 FIX 2025-12-09**: Added `instanceof AuthError` check FIRST (survives minification). Expanded error code detection. |
| [create-deal.mts](netlify/functions/create-deal.mts) | **P0 FIX 2025-12-09**: Same `instanceof AuthError` check + expanded error codes |
| [retry-logic.js](src/lib/retry-logic.js) | **P0 FIX 2025-12-09 (ROOT CAUSE)**: Now copies `error.code` and `error.statusCode` from backend response. Previously error codes weren't propagated to frontend! |
| [useDealManagement.js](src/hooks/useDealManagement.js) | **P0 FIX 2025-12-09**: Enhanced auth error detection - checks `errorCode`, `httpStatus`, and message. Auth errors caught FIRST. |
| [DealDetailsModal.jsx](src/components/DealDetailsModal.jsx) | Same error handling as useDealManagement |

### Acceptance Criteria

#### AC1.1: Session Expiry Shows Correct Message
**Steps:**
1. Log in to StageFlow
2. Open browser devtools > Application > Cookies
3. Delete the `stageflow-access-token` cookie
4. Try to drag a deal from one stage to another

**Expected:**
- Toast shows: "Session expired. Please refresh the page." (NOT "Server error")
- User is redirected to login page within ~5 seconds

---

#### AC1.2: Deal Drag-Drop Works When Session Valid
**Steps:**
1. Log in to StageFlow (fresh session)
2. Drag a deal from "Lead" to "Qualified"
3. Wait for save indicator

**Expected:**
- Deal moves immediately (optimistic update)
- "Saving..." indicator appears briefly
- "Saved" checkmark appears
- No error toast
- Page refresh shows deal in new stage

---

#### AC1.3: Deal Edit Auto-Saves Correctly
**Steps:**
1. Open a deal by clicking on it
2. Change the client name
3. Wait 1 second (auto-save debounce)
4. Watch the "Saving..." / "Saved" indicator

**Expected:**
- "Saving..." appears after ~800ms of inactivity
- "Saved" checkmark appears when complete
- Close modal and reopen - changes persist
- No error toast

---

#### AC1.4: Concurrent Requests Don't Cause 500s
**Steps:**
1. Open Chrome devtools > Network tab
2. Rapidly drag the same deal between stages 3x in quick succession

**Expected:**
- Only 1-2 `update-deal` requests (request deduplication working)
- No 500 errors in Network tab
- Final deal position matches last drag

---

## BUG 2: AI Connectivity & ReadableStream Locked

### Symptoms Fixed
- Dashboard AI card showed "AI providers temporarily unavailable"
- Console showed: "ReadableStream is locked" errors
- Plan My Day threw stream errors

### Root Cause
- When backend returned JSON error (Content-Type: application/json), code called `response.json()` but then fell through to `response.body.getReader()` - causing "ReadableStream is locked" because body was already consumed
- AI error classification wasn't properly differentiating CONFIG_ERROR, NO_PROVIDERS, ALL_PROVIDERS_FAILED

### Files Modified (P0 FIX 2025-12-09)
| File | Changes |
|------|---------|
| [CustomQueryView.jsx](src/components/CustomQueryView.jsx) | Lines 772-826: After parsing JSON, always return - never fall through to streaming code |
| [ai-error-codes.js](src/lib/ai-error-codes.js) | Added CONFIG_ERROR, PROVIDER_FETCH_ERROR with proper classification |
| [ai-assistant-stream.mts](netlify/functions/ai-assistant-stream.mts) | Returns correct error codes: CONFIG_ERROR, NO_PROVIDERS, ALL_PROVIDERS_FAILED |
| [ai-assistant.mts](netlify/functions/ai-assistant.mts) | **P0 FIX 2025-12-09**: Health check now returns `code: 'CONFIG_ERROR'` when ENCRYPTION_KEY missing (not just `configHealthy: false`) |
| [useAIProviderStatus.js](src/hooks/useAIProviderStatus.js) | **P0 FIX 2025-12-09**: Captures CONFIG_ERROR code and shows distinct message "AI is temporarily unavailable due to server configuration issue" |

### Acceptance Criteria

#### AC2.1: Plan My Day Works Without Stream Errors
**Steps:**
1. Log in to StageFlow with AI provider configured
2. Click "Plan My Day" in the AI Assistant
3. Watch for streaming response

**Expected:**
- AI response streams character-by-character
- No console errors about "ReadableStream is locked"
- Response completes with action items

---

#### AC2.2: No Providers Shows Correct Message
**Steps:**
1. Go to Settings > AI Providers
2. Remove/disable all AI providers
3. Return to Dashboard
4. Try to use AI Assistant

**Expected:**
- Message: "No AI provider connected yet."
- Action button: "Add Provider" (links to Settings > AI)
- NOT: "AI providers temporarily unavailable"

---

#### AC2.3: CONFIG_ERROR Shows Admin Message (Admin Only)
**Note:** This requires removing ENCRYPTION_KEY from Netlify env (don't do in prod - test in dev)

**Expected if triggered:**
- Message: "AI is temporarily unavailable due to a server configuration issue. Please contact support."
- No "Update in Settings" button (not user-fixable)

---

#### AC2.4: All Providers Failed Shows Retry
**Steps:**
1. Configure an AI provider with an invalid API key
2. Try to use AI Assistant

**Expected:**
- Message: "All AI providers are temporarily unavailable."
- "Try Again" button appears
- After fixing API key and retrying, AI works

---

## BUG 3: DealDetailsModal UI Layout

### Symptoms Fixed
- Right edge visually wrong at ~1440px width (cropping/misalignment)
- Modal was rendering under navbar in some cases

### Root Cause
- z-index layering issue (modal was below navbar z-[150])
- Missing `box-border` on wrapper elements
- Insufficient horizontal padding

### Files Modified
| File | Changes |
|------|---------|
| [DealDetailsModal.jsx](src/components/DealDetailsModal.jsx) | z-index increased to z-[160], added box-border, increased horizontal padding |

### Acceptance Criteria

#### AC3.1: Modal Layout at 1440px
**Steps:**
1. Set browser window to exactly 1440px wide (use Chrome DevTools device toolbar)
2. Click on a deal to open DealDetailsModal

**Expected:**
- Modal is centered horizontally
- No content cut off on right edge
- All form fields visible and properly aligned
- "Done" button fully visible

---

#### AC3.2: Modal Appears Above Navbar
**Steps:**
1. Scroll down the deals page
2. Click on a deal card

**Expected:**
- Modal overlay covers the entire screen including navbar
- No navbar elements peeking through
- Close button (X) in top-right is clickable

---

#### AC3.3: Modal Works on Mobile
**Steps:**
1. View on mobile device or use Chrome DevTools with iPhone 14 Pro preset
2. Open a deal

**Expected:**
- Modal fills screen width with proper padding
- All fields accessible via scroll
- No horizontal overflow

---

#### AC3.4: Escape Key Closes Modal
**Steps:**
1. Open a deal
2. Press Escape key

**Expected:**
- Modal closes
- Any pending changes auto-save before close
- No console errors

---

## Call Chain Documentation

### Deal Edit/Drag Flow
```
User drags deal → KanbanBoard.onDragEnd()
  → useDealManagement.updateDeal(dealId, {stage})
    → setIsDragLocked(true) // Prevent concurrent drags
    → Optimistic UI update (deal moves immediately)
    → api.deal('update-deal', payload)
      → api-client.prepareRequest()
        → ensureValidSession() → auth-session endpoint
          ↳ If 401: throw SESSION_ERROR (stops here)
        → Add Authorization header
      → fetch('/.netlify/functions/update-deal')
        → update-deal.mts
          → requireAuth() validates session
          → Supabase update with service role
          → Return { success: true, deal }
    → Update local state with server response
    → setIsDragLocked(false)
```

### AI Chat Flow
```
User sends message → CustomQueryView.handleQueryStreaming()
  → api.ai('ai-assistant-stream', {message, history})
    → api-client.prepareRequest()
      → ensureValidSession() (same as above)
    → fetch('/.netlify/functions/ai-assistant-stream')
      → Validate ENCRYPTION_KEY (else CONFIG_ERROR)
      → Decrypt stored API keys
      → Try providers: OpenAI → Anthropic → Google
      → Stream SSE response
    → CustomQueryView reads stream via getReader()
      ↳ If Content-Type is JSON: parse and RETURN (never getReader)
      ↳ If Content-Type is text/event-stream: stream normally
```

---

## Quick Smoke Test (5 minutes)

Run this after every deploy:

1. **Login** - Sign in, verify no errors
2. **View Deals** - Kanban loads with deals
3. **Drag Deal** - Move one deal, verify "Saved" indicator
4. **Edit Deal** - Open modal, change value, wait for auto-save
5. **AI Chat** - Ask "How is my pipeline?" - verify streaming response
6. **Plan My Day** - Click button, verify structured response
7. **Logout** - Sign out, verify redirect to login

All 7 steps should complete without:
- Console errors
- "Server error" toasts
- "ReadableStream is locked" messages
- 500 responses in Network tab

---

## Rollback Plan

If critical issues found in production:

1. Netlify Dashboard > Deploys > Click previous deploy > "Publish deploy"
2. Verify rollback in incognito window
3. Create P0 ticket with reproduction steps

---

*Last Updated: 2025-12-09*
*Author: StageFlow Engineering*
