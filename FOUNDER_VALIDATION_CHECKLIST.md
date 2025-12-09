# StageFlow Founder Validation Checklist
## P0 Bug Fixes - December 9, 2025

Use this 12-step checklist to validate all fixes from the WAR-ROOM DEBUG SESSION.
Each step includes the expected behavior and what to look for.

---

## PREREQUISITES

1. **Deploy the latest code** (this session's commits)
2. **Clear localStorage**: Open DevTools > Application > Storage > Clear site data
3. **Hard refresh**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
4. **Have a valid AI provider connected** (OpenAI, Anthropic, or Google)

---

## SECTION A: Deal Updates (Server Error Fix)

### Step 1: Basic Drag-Drop Test
**What to test:**
- [ ] Drag any deal from one stage to another (e.g., "Lead" to "Qualified")
- [ ] Deal should move immediately (optimistic update)
- [ ] No "Server error. Please try again later." toast should appear
- [ ] Deal stays in the new stage after page refresh

**Expected result:** Smooth drag-drop with no errors

### Step 2: Won Stage Sync Test
**What to test:**
- [ ] Drag a deal to a "won" stage (e.g., "Deal Won", "Contract Signed", "Escrow Completed")
- [ ] Deal status should change to "won" automatically
- [ ] No error toast should appear
- [ ] Refresh page - deal should still be in won stage with status "won"

**Expected result:** Deal status syncs correctly to "won"

### Step 3: Lost Stage with Reason Test
**What to test:**
- [ ] Drag a deal to a "lost" stage
- [ ] Lost reason modal should appear
- [ ] Select a reason and submit
- [ ] Deal should move to lost stage with correct reason
- [ ] No error toast should appear

**Expected result:** Lost flow completes without errors

---

## SECTION B: Stage-Status Synchronization (Real Bug Fix)

### Step 4: Real Estate Pipeline Test (if applicable)
**What to test:**
- [ ] Create a deal in Real Estate pipeline
- [ ] Drag to "Contract Signed" stage
- [ ] Verify status changes to "won" (not "active")
- [ ] Drag to "Escrow Completed" stage
- [ ] Verify status remains "won"

**Expected result:** Real estate won stages correctly sync to "won" status

### Step 5: VC Pipeline Test (if applicable)
**What to test:**
- [ ] Create a deal in VC pipeline
- [ ] Drag to "Investment Closed" stage
- [ ] Verify status changes to "won"
- [ ] Drag to "Capital Received" stage
- [ ] Verify status remains "won"

**Expected result:** VC won stages correctly sync to "won" status

---

## SECTION C & D: AI Features (Plan My Day)

### Step 6: AI Provider Connectivity Test
**What to test:**
- [ ] Go to Settings > AI Providers
- [ ] Verify your provider shows as "Connected"
- [ ] Click "Test Connection" - should succeed

**Expected result:** Provider test passes

### Step 7: Plan My Day Execution Test
**What to test:**
- [ ] Go to Today tab (AI Assistant)
- [ ] Click "Plan My Day" button
- [ ] Loading indicator should appear
- [ ] Wait for response (up to 50 seconds)
- [ ] AI should generate a structured daily plan

**Expected result:** Plan My Day returns actionable recommendations

### Step 8: AI Error Handling Test
**What to test:**
- [ ] (Optional) Temporarily use an invalid API key
- [ ] Try Plan My Day
- [ ] Should see clear error message (not generic "Server error")
- [ ] Error should suggest checking API key or retrying

**Expected result:** Clear, actionable error messages

---

## SECTION E: AI Status Indicator

### Step 9: Provider Status Display Test
**What to test:**
- [ ] With a valid provider connected, go to Dashboard
- [ ] AI features should be enabled (Plan My Day button visible)
- [ ] No "Connect AI Provider" banner should appear
- [ ] Usage indicator should show remaining queries (if applicable)

**Expected result:** AI status correctly reflects connected state

### Step 10: Cache Invalidation Test
**What to test:**
- [ ] Go to Settings > AI Providers
- [ ] Remove your AI provider
- [ ] Go back to Dashboard
- [ ] "Connect AI Provider" hint should appear immediately (not after refresh)
- [ ] Re-add the provider
- [ ] AI features should re-enable immediately

**Expected result:** Status updates immediately on provider changes

---

## SECTION F: Debug Mode

### Step 11: Debug Panel Test
**What to test:**
- [ ] Add `?debug=1` to your URL (e.g., `https://app.stageflow.co/dashboard?debug=1`)
- [ ] Debug panel should appear in bottom-right corner
- [ ] Shows: Auth (green if logged in), AI (green if provider connected), Net (green if online)
- [ ] Click to expand for detailed diagnostics
- [ ] "Copy Diagnostics" button copies JSON to clipboard
- [ ] Remove `?debug=1` - panel should disappear

**Expected result:** Diagnostic panel appears with accurate info

---

## SECTION G: End-to-End User Journey

### Step 12: Complete User Flow Test
**What to test:**
1. [ ] Login to StageFlow
2. [ ] Verify Dashboard loads without errors
3. [ ] Create a new deal
4. [ ] Drag deal through stages (Lead → Qualified → Proposal)
5. [ ] Click on deal to open details modal
6. [ ] Add notes to the deal
7. [ ] Close modal
8. [ ] Run "Plan My Day"
9. [ ] Verify AI response mentions your deals
10. [ ] Drag deal to won stage
11. [ ] Verify status changes to "won"
12. [ ] Refresh page - all data persists

**Expected result:** Complete flow works without any errors

---

## TROUBLESHOOTING

If any test fails:

1. **Check the Debug Panel** (`?debug=1`)
   - Auth should be green
   - AI should be green (if provider connected)
   - Copy diagnostics and share with support

2. **Check Browser Console** (F12 > Console)
   - Look for red errors
   - Search for `[StageFlow]` prefixed logs for context

3. **Check Network Tab** (F12 > Network)
   - Look for failed requests (red status codes)
   - Check response body for error details

4. **Common Issues:**
   - Session expired: Refresh page and re-login
   - AI unavailable: Check provider API key in Settings
   - Deals not moving: Check network connection

---

## SIGN-OFF

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| Step 1 | | |
| Step 2 | | |
| Step 3 | | |
| Step 4 | | |
| Step 5 | | |
| Step 6 | | |
| Step 7 | | |
| Step 8 | | |
| Step 9 | | |
| Step 10 | | |
| Step 11 | | |
| Step 12 | | |

**Validated by:** ________________________

**Date:** ________________________

**Version:** 1.7.93+
