# Telemetry & Observability Guide

> Phase 1 Production Hardening - December 2025

## Overview

StageFlow uses a lightweight telemetry system for production observability:
- **Frontend**: Sentry SDK with request breadcrumbs
- **Backend**: Correlation ID tracking with structured console logs
- **No PII**: Only operational data (endpoints, status codes, durations)

---

## Correlation IDs

Every request gets a unique correlation ID that flows from frontend to backend.

### Format
```
sf-{timestamp_base36}-{random_suffix}
Example: sf-m4x2k7p-a8f3bc91
```

### Where to Find
1. **DevTools Network tab**: `X-Correlation-ID` request header
2. **Netlify Function logs**: `[Telemetry] event_name { correlationId: "sf-..." }`
3. **Sentry breadcrumbs**: Tagged with `correlationId`

### Tracing a Request
1. Open DevTools → Network
2. Find the failed request
3. Copy `X-Correlation-ID` from headers
4. Search Netlify logs: `correlationId: "sf-m4x2k7p-a8f3bc91"`

---

## Log Formats & Search Patterns

### Frontend (Sentry Breadcrumbs)
```
Category: api.request    - Request started
Category: api.response   - Request completed
Category: telemetry      - High-level events
```

### Backend (Console Logs - Netlify)

| Pattern | Description | Example |
|---------|-------------|---------|
| `[Telemetry]` | Event tracking | `[Telemetry] ai_call_success { correlationId, provider, durationMs }` |
| `[Metrics]` | Periodic rollups | `[Metrics] Rollup Summary { ai: {...}, deals: {...} }` |
| `[REQUEST]` | Request lifecycle | `[REQUEST][sf-xxx] START { endpoint, method }` |
| `[ERROR]` | Errors (always logged) | `[ERROR][sf-xxx] message` |
| `[WARN]` | Warnings (always logged) | `[WARN][sf-xxx] message` |

### Telemetry Events

| Event | Trigger | Metadata |
|-------|---------|----------|
| `ai_call_start` | AI request begins | endpoint |
| `ai_call_success` | AI request succeeds | provider, taskType, durationMs |
| `ai_call_failed` | AI request fails | provider, errorCode, durationMs |
| `ai_provider_fallback` | Provider failover | fromProvider, toProvider, reason |
| `ai_all_providers_failed` | All providers failed | providersAttempted, durationMs |
| `deal_update_start` | Deal update begins | endpoint, method |
| `deal_update_success` | Deal update succeeds | hasStageChange, durationMs |
| `deal_update_failed` | Deal update fails | errorCode, durationMs |
| `deal_stage_change` | Stage changed | (empty) |

---

## Metric Rollups

Every 50 events, a summary is logged:

```json
[Metrics] Rollup Summary {
  "timestamp": 1733594123456,
  "ai": {
    "total": 127,
    "success": 118,
    "failed": 9,
    "successRate": "92.9%",
    "fallbacks": 12
  },
  "deals": {
    "total": 456,
    "success": 451,
    "failed": 5,
    "successRate": "98.9%",
    "stageChanges": 89
  },
  "providers": {
    "openai": { "success": 98, "failed": 5 },
    "anthropic": { "success": 15, "failed": 2 },
    "google": { "success": 5, "failed": 2 }
  }
}
```

### What to Monitor

1. **AI Success Rate** - Should be >90%. Drops indicate provider issues.
2. **Fallback Count** - High numbers = primary provider problems.
3. **Deal Success Rate** - Should be >98%. Drops indicate RLS/auth issues.
4. **Provider Distribution** - Verify preferred provider is being used.

---

## Spotting Issues

### AI Failure Spikes

**Symptoms:**
- `ai_call_failed` events increasing
- `ai_all_providers_failed` appearing
- `ai_provider_fallback` count rising

**Search:**
```
[Telemetry] ai_call_failed
[Telemetry] ai_all_providers_failed
```

**Root Causes:**
- API key expired/invalid
- Provider rate limiting (quota exceeded)
- Network issues
- Model deprecated

### Deal Update Failures

**Symptoms:**
- `deal_update_failed` events
- Users report "unable to save"

**Search:**
```
[Telemetry] deal_update_failed
[ERROR][sf-xxx] update-deal
```

**Root Causes:**
- Session expired (auth error)
- RLS policy violation
- Invalid field values

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/lib/sentry.js` | Frontend Sentry + correlation IDs |
| `src/lib/api-client.js` | Request tracking + headers |
| `netlify/functions/lib/telemetry.ts` | Backend telemetry + metrics |
| `netlify/functions/lib/sentry-backend.ts` | Backend Sentry (lazy load) |
| `netlify/functions/lib/logger.ts` | Correlation-aware logging |

---

## Quick Reference

### Search Patterns for Netlify Logs

```bash
# All telemetry for a specific request
correlationId: "sf-m4x2k7p-a8f3bc91"

# All AI failures in last hour
[Telemetry] ai_call_failed

# All provider fallbacks
[Telemetry] ai_provider_fallback

# Metric rollups
[Metrics] Rollup Summary

# Deal update errors
[Telemetry] deal_update_failed

# Auth errors
AUTH_ERROR
SESSION_ERROR
```

### Sentry Dashboard

1. Filter by `correlationId` tag to see all events for a request
2. Check breadcrumbs for `api.request` / `api.response` categories
3. Use `errorBoundary: true` tag to find React crashes

---

## No PII Policy

The telemetry system explicitly does NOT log:
- User emails, names, or IDs (except internal user_id for debugging)
- Deal names, client names, or values
- API keys (even partially)
- Request/response bodies
- Authentication tokens

Only operational metadata is captured: endpoints, status codes, durations, provider names, and error codes.
