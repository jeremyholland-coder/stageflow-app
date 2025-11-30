# Phase F QA Checklist - CORS & Error Handling Fixes

## Overview
This checklist verifies all CORS and error handling fixes applied in Phase E/F.
All browser-facing endpoints now return proper CORS headers on both success AND error responses.

## Critical Auth Flows

### Login Flow
- [ ] Open browser DevTools Network tab
- [ ] Go to https://stageflow.startupstage.com/
- [ ] Enter valid credentials → Should see 200 with `Set-Cookie` headers
- [ ] Enter invalid credentials → Should see 401 with actual error message (not "An unexpected error occurred")
- [ ] Enter unconfirmed email → Should see 403 with `EMAIL_NOT_CONFIRMED` code

### Logout Flow
- [ ] Click logout button
- [ ] Should see 200 response with `Set-Cookie` (clearing cookies)
- [ ] Session cookies should be removed

### Token Refresh
- [ ] Stay logged in for 50+ minutes
- [ ] Token refresh should work silently (200 responses in Network tab)
- [ ] No "Session expired" errors unless actually expired

---

## Deal Operations

### Create Deal
**Endpoint:** `create-deal.mts`
- [ ] Create new deal from Kanban → Should succeed with deal data
- [ ] Force an error (e.g., disconnect WiFi) → Should see actual error message, not generic
- [ ] Check Network tab → Error responses should have `Access-Control-Allow-Origin` header

### Update Deal
**Endpoint:** `update-deal.mts`
- [ ] Move deal between stages → Should succeed
- [ ] Edit deal details → Should succeed with updated data

### Delete Deal
**Endpoint:** `delete-deal.mts`
- [ ] Delete a deal → Should succeed
- [ ] Check Network tab for CORS headers on response

---

## AI Provider Management

### Get AI Providers
**Endpoint:** `get-ai-providers.mts`
- [ ] Go to Settings → Integrations
- [ ] AI providers should load
- [ ] If error, should show actual message not generic

### Save AI Provider
**Endpoint:** `save-ai-provider.mts`
- [ ] Add new AI provider (e.g., OpenAI key)
- [ ] Should save successfully
- [ ] If invalid key format, should show validation error

### Remove AI Provider
**Endpoint:** `remove-ai-provider.mts`
- [ ] Remove an AI provider
- [ ] Should succeed with confirmation
- [ ] Provider should disappear from list

---

## Profile & Avatar

### Profile Save
**Endpoint:** `profile-save.mts`
- [ ] Go to Settings → General
- [ ] Update full name
- [ ] Should save successfully

### Upload Avatar
**Endpoint:** `upload-avatar.mts`
- [ ] Upload new profile picture
- [ ] Should succeed and display new avatar

### Remove Avatar
**Endpoint:** `remove-avatar.mts`
- [ ] Remove profile picture
- [ ] Should succeed and show default avatar

---

## Webhook Management

### Create Webhook
**Endpoint:** `create-webhook.mts`
- [ ] Go to Settings → Webhooks (if available)
- [ ] Create new webhook
- [ ] Should succeed

### Delete Webhook
**Endpoint:** `delete-webhook.mts`
- [ ] Delete a webhook
- [ ] Should succeed

---

## Organization Setup

### Setup Organization
**Endpoint:** `setup-organization.mts`
- [ ] (Test during onboarding flow)
- [ ] Create new organization
- [ ] Should complete without errors

---

## CSV Import

### Import Deals CSV
**Endpoint:** `import-deals-csv.mts`
- [ ] Go to Import Deals
- [ ] Upload valid CSV
- [ ] Should import successfully
- [ ] Upload invalid CSV → Should show specific validation errors

---

## Notification Preferences

### Get Preferences
**Endpoints:** `notification-preferences-get.mts`, `notification-preferences-legacy-get.mts`
- [ ] Go to Settings → Notifications
- [ ] Preferences should load
- [ ] Toggle states should reflect saved values

### Update Preferences
**Endpoint:** `notification-preferences-update.mts`
- [ ] Toggle a notification preference
- [ ] Should save immediately
- [ ] Refresh page → Preference should persist

---

## Error Message Verification

For any endpoint that fails, verify:
- [ ] Error message is user-friendly (not "An unexpected error occurred")
- [ ] Error includes a `code` field (e.g., `"code": "AUTH_REQUIRED"`)
- [ ] Network tab shows CORS headers (`Access-Control-Allow-Origin`) even on error responses

---

## Fixed Endpoints Summary

| Endpoint | Status | Error Code Pattern |
|----------|--------|-------------------|
| auth-login.mts | CORS Fixed | LOGIN_ERROR, EMAIL_NOT_CONFIRMED |
| auth-logout.mts | CORS Fixed | (always 200) |
| auth-refresh.mts | CORS Fixed | SESSION_EXPIRED, RATE_LIMIT_EXCEEDED |
| create-deal.mts | CORS Fixed | CREATE_DEAL_ERROR |
| update-deal.mts | CORS Fixed | UPDATE_DEAL_ERROR |
| delete-deal.mts | CORS Fixed | DELETE_DEAL_ERROR |
| get-ai-providers.mts | CORS Fixed | GET_AI_PROVIDERS_ERROR |
| save-ai-provider.mts | CORS Fixed | SAVE_AI_PROVIDER_ERROR |
| remove-ai-provider.mts | CORS Fixed | REMOVE_AI_PROVIDER_ERROR |
| upload-avatar.mts | CORS Fixed | UPLOAD_ERROR |
| remove-avatar.mts | CORS Fixed | REMOVE_AVATAR_ERROR |
| profile-save.mts | CORS Fixed | PROFILE_SAVE_ERROR |
| create-webhook.mts | CORS Fixed | CREATE_WEBHOOK_ERROR |
| delete-webhook.mts | CORS Fixed | DELETE_WEBHOOK_ERROR |
| setup-organization.mts | CORS Fixed | SETUP_ORG_ERROR |
| import-deals-csv.mts | CORS Fixed | IMPORT_ERROR |

---

## Date: 2025-11-30
## Phase: F Final Hardening
