# StageFlow QA Test Suite Report

**Generated:** 2025-11-30
**Version:** 1.7.93

## Executive Summary

This document describes the comprehensive QA test suite implemented for StageFlow. The suite includes:

- **UI E2E Tests** (Playwright) - Browser-based tests for React UI
- **API E2E Tests** (Vitest) - Endpoint validation tests
- **Auth & Onboarding Tests** - Complete authentication flow coverage
- **Billing & Plan Tests** - Stripe integration and limit enforcement
- **Performance Tests** - Lighthouse audits and k6 load tests
- **Data Integrity Tests** - Metrics consistency verification

---

## Test Structure

```
tests/
├── e2e/                      # Vitest API tests
│   ├── setup.ts              # Test environment setup
│   ├── utils/
│   │   ├── auth.ts           # Authentication helpers
│   │   └── api.ts            # API request utilities
│   ├── deals.test.ts         # Deal CRUD tests
│   ├── profile.test.ts       # Profile tests
│   ├── notifications.test.ts # Notification preferences
│   ├── ai-providers.test.ts  # AI integration tests
│   ├── avatar.test.ts        # Avatar upload/remove
│   ├── auth.test.ts          # Authentication flows
│   ├── billing.test.ts       # Stripe/billing tests
│   └── metrics.test.ts       # Data integrity tests
│
├── ui/                       # Playwright UI tests
│   ├── auth.setup.ts         # Auth state setup
│   ├── fixtures/
│   │   └── test-helpers.ts   # Reusable test utilities
│   ├── dashboard.spec.ts     # Dashboard UI tests
│   ├── deals.spec.ts         # Deal creation/editing UI
│   ├── notifications.spec.ts # Notification settings UI
│   ├── ai-providers.spec.ts  # Integrations page UI
│   ├── avatar.spec.ts        # Profile avatar UI
│   ├── auth.spec.ts          # Login/logout/reset UI
│   ├── billing.spec.ts       # Billing page UI
│   ├── metrics.spec.ts       # Metrics display UI
│   └── performance.spec.ts   # Performance measurements
│
└── performance/              # Performance testing
    ├── k6-load-test.js       # Full load test (requires auth)
    └── k6-health-check.js    # Basic health check load test
```

---

## Running Tests

### API Tests (Vitest)

```bash
# Run all API integration tests
npm run test:integration

# Watch mode
npm run test:integration:watch

# With environment variables
SUPABASE_URL='...' SUPABASE_ANON_KEY='...' SUPABASE_SERVICE_ROLE_KEY='...' npm run test:integration
```

### UI Tests (Playwright)

```bash
# Run all UI tests
npm run test:e2e

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run in debug mode
npm run test:e2e:debug

# Run specific browser
npm run test:e2e:chromium
npm run test:e2e:webkit

# Run headed (visible browser)
npm run test:e2e:headed
```

### Performance Tests

```bash
# Playwright performance tests
npm run test:perf

# Lighthouse audit
npm run test:lighthouse

# k6 load test (requires k6 installed)
k6 run tests/performance/k6-health-check.js
k6 run -e AUTH_TOKEN=xxx -e ORG_ID=xxx tests/performance/k6-load-test.js
```

### Full QA Suite

```bash
# Run all tests (API + UI)
npm run test:qa
```

---

## Test Coverage Matrix

### UI Tests (Playwright)

| Test File | Scenarios | Chromium | WebKit | Notes |
|-----------|-----------|----------|--------|-------|
| dashboard.spec.ts | 12 | - | - | Metrics, Kanban, filters |
| deals.spec.ts | 10 | - | - | CRUD, drag-drop |
| notifications.spec.ts | 8 | - | - | Toggle, persist |
| ai-providers.spec.ts | 9 | - | - | Connect, disconnect |
| avatar.spec.ts | 8 | - | - | Upload, remove |
| auth.spec.ts | 15 | - | - | Login, logout, reset |
| billing.spec.ts | 10 | - | - | Plans, limits |
| metrics.spec.ts | 12 | - | - | Display, formatting |
| performance.spec.ts | 8 | - | - | Load times, memory |

### API Tests (Vitest)

| Test File | Scenarios | Status |
|-----------|-----------|--------|
| deals.test.ts | 15 | Tests create/update/delete deals |
| profile.test.ts | 8 | Profile CRUD operations |
| notifications.test.ts | 6 | Preference get/save |
| ai-providers.test.ts | 8 | Provider management |
| avatar.test.ts | 5 | Avatar upload/remove |
| auth.test.ts | 12 | Auth flows, errors |
| billing.test.ts | 10 | Checkout, webhooks |
| metrics.test.ts | 15 | Data integrity |

---

## Key Test Scenarios

### 1. Critical User Flows

- **Login Flow**: Email/password → Dashboard
- **Create Deal**: New Deal → Fill form → Save → Card appears
- **Update Deal Stage**: Drag card OR dropdown → Stage changes
- **Delete Deal**: Delete button → Confirm → Card removed

### 2. Error Handling

- 401 errors → Redirect to login (not error boundary)
- 500 errors → Show toast (not crash)
- Network failures → Graceful degradation

### 3. Edge Cases

- Empty organization (no deals)
- Plan limits reached
- Session expiry
- Multi-tab behavior

---

## Performance Thresholds

| Metric | Target | Notes |
|--------|--------|-------|
| Page Load | < 10s | Full dashboard load |
| First Contentful Paint | < 3s | Login/dashboard |
| Time to Interactive | < 5s | Dashboard usable |
| API Response (p95) | < 3s | Profile, deals endpoints |
| Error Rate | < 1% | Under normal load |
| Memory Growth | < 50MB | After 5 navigation cycles |

---

## Configuration Files

### playwright.config.ts

```typescript
- Test directory: ./tests/ui
- Browsers: Chromium, WebKit
- Base URL: https://stageflow.startupstage.com
- Auth state: Stored for reuse
- Screenshots: On failure
- Videos: On retry
```

### vitest.config.ts

```typescript
- Test directory: ./tests/e2e
- Environment: Node
- Timeout: 30s
- Sequential execution
- Setup file: ./tests/e2e/setup.ts
```

---

## Environment Variables Required

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# Test User (optional - uses defaults)
TEST_USER_EMAIL=stageflow.test+qa@example.com
TEST_USER_PASSWORD=TestPassword123!

# Test Target (optional)
TEST_BASE_URL=https://stageflow.startupstage.com

# k6 Load Testing
AUTH_TOKEN=<access_token>
ORG_ID=<organization_id>
```

---

## Output Artifacts

```
test-results/
├── .auth/
│   └── user.json              # Stored auth state
├── artifacts/                  # Screenshots, videos
├── playwright-report/          # HTML report
│   └── index.html
├── playwright-results.json     # JSON results
└── lighthouse/                 # Lighthouse reports
    ├── login.report.html
    └── lighthouse-report.md
```

---

## Next Steps

1. **Set up CI/CD Integration**
   - Add GitHub Actions workflow
   - Run tests on PR
   - Block merge on failure

2. **Expand Coverage**
   - Mobile viewport tests
   - Firefox browser tests
   - Accessibility audits (axe)

3. **Performance Monitoring**
   - Set up continuous Lighthouse
   - Configure k6 cloud for trending
   - Alert on regression

4. **Test Data Management**
   - Seed data fixtures
   - Isolated test organizations
   - Cleanup automation

---

## Troubleshooting

### "No test user found"
- Ensure test user exists in Supabase
- Check TEST_USER_EMAIL and TEST_USER_PASSWORD

### "Timeout waiting for dashboard"
- Check if the app is running
- Verify TEST_BASE_URL is correct
- Check network connectivity

### "Browser not installed"
- Run: `npx playwright install`

### "Vitest environment errors"
- Run with netlify dev: `netlify dev --command "npx vitest"`
- Or set env vars manually before running

---

## Contact

For questions about this test suite, contact the StageFlow engineering team.
