# Phase 10: Scenario Engine + E2E QA Report

**Date**: 2025-12-09
**Build**: v1.7.93

## Summary

Created automated scenario tests for realistic user journeys. Tests exposed schema mismatches between the codebase and database that need resolution.

## Scenario Matrix

| ID | Name | Status | Notes |
|----|------|--------|-------|
| D1 | Create Deal Full Journey | BLOCKED | DB trigger expects `assignment_type` column |
| D2 | Stage Drag & Status Sync | BLOCKED | Depends on D1 passing |
| D3 | Lost Deal with Reason | BLOCKED | Depends on D1 passing |
| D4 | Delete & Soft-Delete | BLOCKED | Depends on D1 passing |
| A1 | AI Insights Request | PASS (auth) | Auth test passes, AI test blocked by D1 |
| A3 | AI Assistant | PASS (auth) | Auth test passes, AI test blocked by D1 |
| S1 | Session Refresh Flow | PASS | Both tests pass |
| S2 | CORS Origin Validation | PASS | All 3 tests pass |

## Test Results

```
Tests:  7 passed, 13 failed
Duration: ~15s
```

### Passing Tests (7)
- S1: auth-session returns valid session
- S1: returns 401 for invalid/missing cookies
- S2: CORS headers for production origin
- S2: default origin for unknown origin
- S2: Netlify deploy preview origins
- A1: returns 401 without authentication
- A3: returns 401 without authentication

### Failing Tests (13)
All deal-related tests fail due to the database trigger issue.

## Bugs Found

### P0: Database Trigger Schema Mismatch
**Error**: `record "new" has no field "assignment_type"`
**Code**: 42703
**Location**: Database trigger on `deals` table
**Impact**: All deal creation operations fail

This indicates a trigger was added that expects an `assignment_type` column, but:
1. The column doesn't exist in the table schema
2. The `create-deal.mts` function doesn't include it

**Fix Required**: Either:
- Add `assignment_type` column to deals table via migration
- Or remove/modify the trigger that expects this field

### P1: Schema Mismatch in allowedFields
**Removed from create-deal.mts**:
- `company` (PGRST204)
- `contact_name` (PGRST204)
- `contact_email` (PGRST204)
- `contact_phone` (PGRST204)
- `expected_close` (PGRST204)
- `probability` (PGRST204)
- `source` (PGRST204)

These fields are defined in `domain/deal.ts` but don't exist in the actual database schema.

**Note**: These fields were removed from `allowedFields` to prevent PGRST204 errors, but this means deal creation now ignores these fields.

## Files Modified

1. `netlify/functions/create-deal.mts` - Fixed allowedFields to match actual DB schema
2. `tests/e2e/scenarios.test.ts` - New comprehensive scenario tests
3. `tests/e2e/utils/api.ts` - Added `get` helper (existing)
4. `package.json` - Added `test:scenarios` npm script
5. `vitest.config.ts` - Restored to simple config

## Infrastructure Created

- `npm run test:scenarios` - Runs scenario tests with Netlify env injection
- Scenario tests cover D1-D4, A1, A3, S1-S2 scenarios
- Tests use production API endpoints with test user credentials

## Recommendations

1. **Immediate**: Investigate and fix the `assignment_type` trigger issue
2. **Short-term**: Run database schema audit to identify all mismatches
3. **Long-term**: Add schema validation tests to prevent drift

## Test Command

```bash
npm run test:scenarios
```

Requires Netlify CLI linked to project for environment variable injection.
