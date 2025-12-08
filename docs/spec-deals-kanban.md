# StageFlow Deals + Kanban System Specification

**Version:** 2.0.0
**Date:** 2025-12-07
**Status:** CANONICAL SPECIFICATION - ALL CODE MUST COMPLY

---

## Table of Contents

1. [Deal Model](#1-deal-model)
2. [Required Fields](#2-required-fields)
3. [Constraints](#3-constraints)
4. [Allowed Statuses](#4-allowed-statuses)
5. [Status Transitions](#5-status-transitions)
6. [Column Mapping](#6-column-mapping)
7. [Lost Reason Rules](#7-lost-reason-rules)
8. [Disqualified Reason Rules](#8-disqualified-reason-rules)
9. [Canonical DealCard Layout](#9-canonical-dealcard-layout)
10. [Error Handling States](#10-error-handling-states)
11. [Auth/Session Rules](#11-authsession-rules)
12. [API Response Formats](#12-api-response-formats)
13. [Code Inventory](#13-code-inventory)
14. [Call Graph](#14-call-graph)

---

## 1. Deal Model

### Database Table: `deals`

```sql
CREATE TABLE deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id         UUID REFERENCES auth.users(id),

  -- Core Fields
  client          TEXT NOT NULL,           -- Client/Company name (2-200 chars)
  email           TEXT,                    -- Contact email (validated format)
  phone           TEXT,                    -- Contact phone (E.164 format preferred)
  value           NUMERIC NOT NULL DEFAULT 0, -- Deal value in dollars (0-999,999,999)
  stage           TEXT NOT NULL,           -- Current pipeline stage ID
  status          TEXT NOT NULL DEFAULT 'active', -- active|won|lost|disqualified
  notes           TEXT,                    -- Freeform notes (max 5000 chars)

  -- Assignment
  assigned_to     UUID REFERENCES auth.users(id), -- Assigned team member

  -- Lost Tracking
  lost_reason     TEXT,                    -- Reason when status = 'lost'

  -- Disqualified Tracking
  disqualified_reason_category TEXT,       -- Category: no_budget|not_a_fit|wrong_timing|went_with_competitor|unresponsive|other
  disqualified_reason_notes    TEXT,       -- Custom notes for disqualification
  stage_at_disqualification    TEXT,       -- Stage when disqualified (for re-qualification)
  disqualified_at             TIMESTAMPTZ, -- When disqualified

  -- Soft Delete
  deleted_at      TIMESTAMPTZ,             -- NULL = active, non-NULL = soft deleted
  deleted_by      UUID REFERENCES auth.users(id),

  -- Timestamps
  created         TIMESTAMPTZ DEFAULT now(),
  updated         TIMESTAMPTZ DEFAULT now()
);
```

### TypeScript Interface

```typescript
interface Deal {
  id: string;
  organization_id: string;
  user_id: string | null;

  // Core
  client: string;
  email: string | null;
  phone: string | null;
  value: number;
  stage: string;
  status: 'active' | 'won' | 'lost' | 'disqualified';
  notes: string | null;

  // Assignment
  assigned_to: string | null;

  // Lost
  lost_reason: string | null;

  // Disqualified
  disqualified_reason_category: string | null;
  disqualified_reason_notes: string | null;
  stage_at_disqualification: string | null;
  disqualified_at: string | null;

  // Soft Delete
  deleted_at: string | null;
  deleted_by: string | null;

  // Timestamps
  created: string;
  updated: string;
}
```

---

## 2. Required Fields

### For Deal Creation

| Field | Required | Validation |
|-------|----------|------------|
| `client` | **YES** | 2-200 characters, non-empty |
| `email` | **YES** | Valid email format |
| `phone` | NO | Optional, E.164 preferred |
| `value` | **YES** | Positive number, 0-999,999,999 |
| `stage` | **YES** | Valid stage ID from pipeline |
| `notes` | NO | Max 5000 characters |

### For Deal Update

All fields optional. Only provided fields are updated.

### Backend-Set Fields (Never from frontend)

- `organization_id` - Set from authenticated user's org
- `user_id` - Set from authenticated user
- `deleted_at` / `deleted_by` - Set during soft delete
- `created` / `updated` - Set by database

---

## 3. Constraints

### Business Rules

1. **One Status at a Time**: A deal can only have ONE status at any time
2. **Lost Reason Required**: When status = 'lost', `lost_reason` MUST be provided
3. **Disqualify Category Required**: When status = 'disqualified', `disqualified_reason_category` MUST be provided
4. **Stage Preservation**: `stage_at_disqualification` MUST be set when disqualifying (for re-activation)
5. **Soft Delete Only**: Deals are NEVER hard deleted; `deleted_at` is set instead
6. **Organization Scoping**: ALL queries MUST include `organization_id` filter
7. **Exclude Deleted**: ALL list queries MUST filter `deleted_at IS NULL`

### Database Constraints

```sql
-- Ensure lost deals have a reason
ALTER TABLE deals ADD CONSTRAINT check_lost_reason
  CHECK (status != 'lost' OR lost_reason IS NOT NULL);

-- Ensure disqualified deals have a category
ALTER TABLE deals ADD CONSTRAINT check_disqualified_reason
  CHECK (status != 'disqualified' OR disqualified_reason_category IS NOT NULL);
```

---

## 4. Allowed Statuses

| Status | Description | Visible on Kanban? |
|--------|-------------|-------------------|
| `active` | Deal is in progress | YES - in assigned stage column |
| `won` | Deal closed successfully | YES - in 'retention'/'deal_won' column |
| `lost` | Deal lost to competitor/other | YES - in 'lost'/'deal_lost' column |
| `disqualified` | Lead disqualified before becoming deal | **NO** - filtered out of Kanban |

### Status Icons

- `active`: No icon (default state)
- `won`: Green checkmark badge
- `lost`: Red X badge
- `disqualified`: Yellow/Amber ban badge (in dedicated view)

---

## 5. Status Transitions

### Valid Transitions

```
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
    ┌─────────► active ◄─────────┐        │
    │              │              │        │
    │              │              │        │
    │              ▼              │        │
    │         ┌────┴────┐        │        │
    │         │         │        │        │
    │         ▼         ▼        │        │
    │        won      lost ──────┘        │
    │         │         │                 │
    │         └────┬────┘                 │
    │              │                      │
    │              ▼                      │
    │       disqualified ─────────────────┘
    │              │
    └──────────────┘ (re-activate)
```

### Transition Rules

| From | To | Allowed? | Requires |
|------|-----|----------|----------|
| `active` | `won` | YES | Stage change to won stage |
| `active` | `lost` | YES | `lost_reason` required |
| `active` | `disqualified` | YES | `disqualified_reason_category` required |
| `won` | `active` | YES | Clear `lost_reason`, change stage |
| `lost` | `active` | YES | Clear `lost_reason`, change stage |
| `disqualified` | `active` | YES | Clear disqualified fields, restore `stage_at_disqualification` |
| `won` | `lost` | NO | Must go through `active` first |
| `lost` | `won` | NO | Must go through `active` first |

---

## 6. Column Mapping

### Stage to Status Mapping

The `STAGE_STATUS_MAP` in `pipelineTemplates.js` defines which stages trigger status changes:

```javascript
const STAGE_STATUS_MAP = {
  // Won stages (set status = 'won')
  retention: 'won',
  retention_renewal: 'won',
  deal_won: 'won',
  closed_won: 'won',
  investment_closed: 'won',
  contract_signed: 'won',

  // Lost stages (set status = 'lost')
  lost: 'lost',
  deal_lost: 'lost',
  passed: 'lost'
};
```

### Helper Functions

```javascript
// Check if stage is a "won" stage
function isWonStage(stageId) {
  return STAGE_STATUS_MAP[stageId] === 'won';
}

// Check if stage is a "lost" stage
function isLostStage(stageId) {
  return STAGE_STATUS_MAP[stageId] === 'lost';
}
```

### Kanban Display Rules

1. **Disqualified deals**: NEVER shown on Kanban (filtered out)
2. **Deleted deals**: NEVER shown (filtered by `deleted_at IS NULL`)
3. **Won/Lost deals**: Shown in their respective stage columns with status badges
4. **Active deals**: Shown in their assigned stage with confidence score

---

## 7. Lost Reason Rules

### Lost Reason Modal

When a deal is moved to a "lost" stage (e.g., 'lost', 'deal_lost'), the LostReasonModal MUST appear.

### Required Data

```javascript
{
  lost_reason: string // Free text reason (required)
}
```

### Update Payload

```javascript
{
  stage: 'lost', // or 'deal_lost' depending on pipeline
  status: 'lost',
  lost_reason: 'Price too high - competitor offered 30% less'
}
```

### Display on Card

When `status === 'lost'` and `lost_reason` exists:
- Show red "Lost" badge
- Show truncated `lost_reason` below badge
- Strip "Other: " prefix if present for display

---

## 8. Disqualified Reason Rules

### Disqualified Categories

```javascript
const DISQUALIFY_CATEGORIES = {
  no_budget: 'No budget',
  not_a_fit: 'Not a fit',
  wrong_timing: 'Wrong timing',
  went_with_competitor: 'Went with competitor',
  unresponsive: 'Unresponsive',
  other: 'Other'
};
```

### Required Data

```javascript
{
  disqualified_reason_category: string, // One of above keys (required)
  disqualified_reason_notes: string | null, // Optional notes
  stage_at_disqualification: string, // Current stage before disqualification
  disqualified_at: string // ISO timestamp
}
```

### Update Payload

```javascript
{
  status: 'disqualified',
  disqualified_reason_category: 'no_budget',
  disqualified_reason_notes: 'Client said they have no budget until Q2',
  stage_at_disqualification: 'quote',
  disqualified_at: new Date().toISOString()
}
```

### Display Rules

- Disqualified deals are EXCLUDED from the main Kanban view
- Shown in dedicated "Disqualified Leads" section/filter
- Show amber badge with category label
- Show notes if present

---

## 9. Canonical DealCard Layout

### Structure (Top to Bottom)

```
┌─────────────────────────────────────────────────┐
│ ┌─────┐  Client Name                    $Value  │
│ │Icon │  email@example.com                      │
│ └─────┘                                         │
│                                                 │
│ [Confidence Label]                    [Score%]  │
│ [═══════════════════════─────────────] Progress │
│                                                 │
│ [Status Badge if won/lost]                      │
│                                                 │
│ [Lost Reason if status=lost]                    │
│ [Disqualified Reason if status=disqualified]    │
│                                                 │
│ [AssigneeSelector if active]                    │
│                                                 │
│ [Hover Actions: Email | Edit | More...]   [Grip]│
└─────────────────────────────────────────────────┘
```

### Layout Rules

1. **Card Height**: Minimum 168px for consistent column layout
2. **Client Name**: Truncated with ellipsis if too long
3. **Email**: Truncated with ellipsis, gray color
4. **Value**: Right-aligned, teal-400 color, formatted with $
5. **Confidence Bar**: Only shown when `status === 'active'`
6. **Status Badge**: Only shown when `status === 'won'` OR `status === 'lost'`
7. **Lost Reason**: Only shown when `status === 'lost'` AND `lost_reason` exists
8. **Assignee**: Only shown when `status === 'active'` AND `organizationId` exists
9. **Hover Actions**: Email, Edit, More (Disqualify option in More menu)

### Colors

- Card background: `bg-gradient-to-br from-gray-900 to-black`
- Border: `border-teal-500/30`
- Orphaned card (no valid stage): `ring-4 ring-amber-400/50` with pulse
- Client name: `text-white`
- Email: `text-gray-300`
- Value: `text-teal-400`
- Won badge: `bg-emerald-900/30 text-emerald-400`
- Lost badge: `bg-rose-900/30 text-rose-400`

### Zero Confidence Tooltip (0% Confidence Explainer)

**Added:** 2025-12-08

When a deal has 0% confidence, hovering over the confidence label ("LOW CONFIDENCE") or percentage ("0%") displays an Apple-style tooltip explaining why and how to improve it.

#### Trigger Behavior
- Tooltip appears on hover over confidence label OR percentage
- Only displays when `confidenceScore === 0`
- Fade in/out: 0.12s ease-out animation
- Auto-adjusts to viewport edges (never clips)

#### Tooltip Text (Apple-style, concise)
- **Title:** "Why 0% confidence?"
- **Body:** "No recent activity. Add notes, update the stage, or log contact to improve confidence."

#### Styling (Apple aesthetic)
```css
/* Container */
background: rgba(10, 10, 10, 0.72);
backdrop-filter: blur(12px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 12px;
padding: 12px 14px;
max-width: 260px;
box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);

/* Title */
font-size: 13px;
font-weight: 600;
color: rgba(255, 255, 255, 0.9);

/* Body */
font-size: 13px;
color: #D1D5DB; /* text-gray-300 */
```

#### Placement
- Default: Above the confidence area, centered
- Auto-adjust: Uses `calculateDropdownPosition` with viewport boundary checks

#### Accessibility
- `role="tooltip"` on container
- `aria-label="Why 0% confidence?"`
- Does not block pointer events for dragging

#### Component
- **File:** `src/components/ZeroConfidenceTooltip.jsx`
- **Integration:** Wraps confidence display in `KanbanCard` (KanbanBoard.jsx:532-541)

#### ASCII Mockup
```
                    ┌─────────────────────────────────────────┐
                    │  Why 0% confidence?                     │
                    │                                         │
                    │  No recent activity. Add notes, update  │
                    │  the stage, or log contact to improve   │
                    │  confidence.                            │
                    └─────────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│ ┌─────┐  Client Name                              $5,000    │
│ │Icon │  email@example.com                                  │
│ └─────┘                                                     │
│                                                             │
│ [LOW CONFIDENCE] ← (hover here)                      [0%]   │
│ [════════════════════════════════════════════────] Progress │
│                                                             │
│ [AssigneeSelector]                                          │
│                                                             │
│ [Hover Actions: Email | Edit | More...]               [Grip]│
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Error Handling States

### Frontend Error States

| Context | Error | User Message | Action |
|---------|-------|--------------|--------|
| NewDealModal | Network failure | "Connection issue. Please check your internet and try again." | Retry button |
| NewDealModal | Validation error | Field-specific errors shown inline | Fix fields |
| NewDealModal | Auth expired | "Your session has expired. Please refresh the page and log in again." | Redirect to login |
| NewDealModal | Permission denied | "You don't have permission to create deals in this workspace." | Contact admin |
| NewDealModal | Plan limit | "Deal limit reached (X deals on Free). Upgrade your plan." | Show upgrade |
| KanbanBoard | Deals load failure | "Failed to Load Deals" with retry | Retry button |
| KanbanBoard | Empty state | Filter-specific empty message | Create deal CTA |
| DealDetailsModal | Update failure | "Failed to update deal. Please try again." | Retry |
| Drag-Drop | Update failure | Toast: "Failed to move deal" | Undo available |

### Backend Error Responses

All errors MUST return structured JSON:

```javascript
{
  success: false,
  error: "Human-readable message",
  code: "ERROR_CODE",
  hint?: "Actionable suggestion",
  details?: {} // Debug info (not exposed to user)
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INVALID_JSON` | 400 | Request body not valid JSON |
| `MISSING_FIELDS` | 400 | Required fields missing |
| `UNAUTHORIZED` | 401 | No valid session |
| `TOKEN_EXPIRED` | 401 | JWT expired |
| `NO_SESSION` | 401 | No session cookie/header |
| `FORBIDDEN` | 403 | User lacks permission |
| `NOT_FOUND` | 404 | Deal/resource not found |
| `ALREADY_DELETED` | 400 | Attempted action on deleted deal |
| `RATE_LIMITED` | 429 | Too many requests |
| `DB_ERROR` | 500 | Database operation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 11. Auth/Session Rules

### Authentication Flow

1. User logs in via `/auth-login` → Sets HttpOnly cookies
2. Frontend calls `/auth-session` to validate → Returns user + org + session
3. API calls include `credentials: 'include'` for cookie auth
4. Backend validates via `requireAuth()` middleware

### Cookie Configuration

```javascript
{
  httpOnly: true,
  secure: true, // HTTPS only in production
  sameSite: 'Strict',
  path: '/',
  maxAge: 3600 // 1 hour for access token
}
```

### Token Sources (Priority Order)

1. HttpOnly cookie (`sb-access-token`)
2. Authorization header (`Bearer <token>`)

### Session Validation

```typescript
// auth-middleware.ts
async function requireAuth(req: Request): Promise<User> {
  // 1. Extract token from cookies or header
  // 2. Validate with Supabase
  // 3. Verify org membership
  // 4. Return user or throw
}
```

### Frontend Session Handling

```javascript
// Before any authenticated API call:
const sessionResult = await ensureValidSession();
if (!sessionResult.valid) {
  // Handle based on sessionResult.code
  if (sessionResult.code === 'SESSION_INVALID') {
    await handleSessionInvalid(); // Redirect to login
  }
  return;
}
// Proceed with API call
```

---

## 12. API Response Formats

### create-deal

**Request:**
```javascript
POST /.netlify/functions/create-deal
{
  dealData: {
    client: "Acme Corp",
    email: "john@acme.com",
    phone: "+15551234567",
    value: 50000,
    stage: "lead_qualified",
    notes: "Hot lead from conference"
  },
  organizationId: "uuid"
}
```

**Success Response (201):**
```javascript
{
  success: true,
  deal: { /* full deal object */ }
}
```

**Error Response (4xx/5xx):**
```javascript
{
  success: false,
  error: "Validation failed",
  code: "VALIDATION_ERROR",
  details: { client: "Client name is required" }
}
```

### update-deal

**Request:**
```javascript
POST /.netlify/functions/update-deal
{
  dealId: "uuid",
  updates: {
    stage: "quote",
    value: 75000
  },
  organizationId: "uuid"
}
```

**Success Response (200):**
```javascript
{
  success: true,
  deal: { /* updated deal object */ }
}
```

### delete-deal

**Request:**
```javascript
POST /.netlify/functions/delete-deal
{
  dealId: "uuid",
  organizationId: "uuid"
}
```

**Success Response (200):**
```javascript
{
  success: true,
  deal: { /* deal with deleted_at set */ }
}
```

### get-team-members

**Request:**
```javascript
GET /.netlify/functions/get-team-members?organizationId=uuid
```

**Success Response (200):**
```javascript
{
  success: true,
  members: [
    { id: "uuid", name: "John Doe", email: "john@example.com", role: "admin" }
  ]
}
```

---

## 13. Code Inventory

### Backend Files

| File | Role | Key Lines |
|------|------|-----------|
| `netlify/functions/create-deal.mts` | Deal creation endpoint | L1-200 |
| `netlify/functions/update-deal.mts` | Deal update endpoint | L1-200 |
| `netlify/functions/delete-deal.mts` | Soft delete endpoint | L1-200 |
| `netlify/functions/api-deals.mts` | API key-based CRUD | L1-316 |
| `netlify/functions/auth-session.mts` | Session validation | L1-296 |
| `netlify/functions/get-team-members.mts` | Team list for assignment | L1-150 |
| `netlify/functions/lib/auth-middleware.ts` | Central auth logic | L1-200 |
| `netlify/functions/lib/supabase-pool.ts` | DB connection pool | L1-100 |
| `netlify/functions/lib/cookie-auth.ts` | Cookie parsing/setting | L1-150 |

### Frontend Components

| File | Role | Key Lines |
|------|------|-----------|
| `src/components/KanbanBoard.jsx` | Main board + columns + DnD | L1-1649 |
| `src/components/NewDealModal.jsx` | Create deal form | L1-523 |
| `src/components/DealDetailsModal.jsx` | Edit deal modal | L1-800+ |
| `src/components/LostReasonModal.jsx` | Lost reason capture | L1-150 |
| `src/components/DisqualifyModal.jsx` | Disqualify reason capture | L1-200 |
| `src/components/AssigneeSelector.jsx` | Team member assignment | L1-250 |

### Frontend Libraries

| File | Role | Key Lines |
|------|------|-----------|
| `src/lib/api-client.js` | Auth-aware HTTP client | L1-400 |
| `src/lib/supabase.js` | Supabase client + session | L1-520 |
| `src/config/pipelineTemplates.js` | Stage definitions | L1-500 |

### Hooks

| File | Role |
|------|------|
| `src/hooks/useFormValidation.js` | Form validation logic |
| `src/hooks/useStageVisibility.js` | Hidden stages preference |
| `src/hooks/useDealManagement.js` | Deal CRUD operations |

---

## 14. Call Graph

### Deal Creation Flow

```
User clicks "+" in column
        ↓
NewDealModal opens (lazy loaded)
        ↓
User fills form → validation (useFormValidation)
        ↓
handleSubmit()
        ↓
Check plan limits (supabase.from('deals').select(count))
        ↓
api.post('create-deal', { dealData, organizationId })
        ↓
api-client.js:
  1. ensureValidSession()
  2. Fetch with credentials: 'include'
  3. Handle response/errors
        ↓
create-deal.mts:
  1. requireAuth(req) → extract user from cookie
  2. Validate body (zod schema)
  3. Verify org membership
  4. supabase.from('deals').insert()
  5. Return { success: true, deal }
        ↓
NewDealModal:
  1. addNotification('Deal created!')
  2. onDealCreated(deal)
  3. Close modal
        ↓
Dashboard/KanbanBoard:
  1. setDeals([...deals, newDeal])
  2. Card appears in correct column
```

### Drag-Drop Flow

```
User drags KanbanCard
        ↓
KanbanCard.handleDragStart()
  - Set dataTransfer: dealId, dealName, currentStatus
        ↓
KanbanColumn.handleDragOver()
  - Set dragOver visual state
        ↓
User drops on target column
        ↓
KanbanColumn.handleDrop()
        ↓
processDrop(dealId, dealName, currentStatus)
        ↓
If target = 'lost' stage:
  → onLostReasonRequired(dealId, dealName, stageId)
  → Open LostReasonModal
  → On confirm: onUpdateDeal(dealId, { stage, status: 'lost', lost_reason })
        ↓
If target = 'retention'/'won' stage:
  → onUpdateDeal(dealId, { stage, status: 'won' })
        ↓
If moving from won/lost to active stage:
  → Instant move with undo toast
  → onUpdateDeal(dealId, { stage, status: 'active', lost_reason: null })
        ↓
Otherwise (normal stage change):
  → onUpdateDeal(dealId, { stage })
        ↓
onUpdateDeal() (Dashboard):
  1. Optimistic update: setDeals(...)
  2. api.post('update-deal', { dealId, updates, organizationId })
        ↓
update-deal.mts:
  1. requireAuth(req)
  2. Validate updates
  3. Check stage transition rules
  4. supabase.from('deals').update()
  5. Return { success: true, deal }
        ↓
If error:
  - Rollback optimistic update
  - Show error toast
```

### Auth Flow

```
Page Load
        ↓
AppShell.jsx: initializeAuth()
        ↓
bootstrapSession()
  1. Check if session in memory
  2. Call auth-session endpoint
  3. setSession() if tokens returned
        ↓
ensureValidSession() (before each API call)
  1. Check session validity
  2. Refresh if expiring soon
  3. Return { valid, error, code }
        ↓
API Call with credentials: 'include'
        ↓
Backend: requireAuth(req)
  1. Extract token from cookie/header
  2. Validate with supabase.auth.getUser()
  3. Check org membership
  4. Return user or throw 401
```

---

## Appendix: RLS Policies

### deals Table

```sql
-- Read: Users can read deals in their organization
CREATE POLICY "Users can view org deals" ON deals
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
    )
  );

-- Insert: Users can create deals in their organization
CREATE POLICY "Users can create org deals" ON deals
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
    )
  );

-- Update: Users can update deals in their organization
CREATE POLICY "Users can update org deals" ON deals
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
    )
  );
```

**Note:** Backend functions use service role to bypass RLS after manual org membership verification.

---

*This specification is the single source of truth. All code MUST comply with these definitions.*

---

## Appendix B: Failure Path Trace (2025-12-07 Audit)

### CRITICAL BUG #1: KanbanBoard ReferenceError

**File:** `src/components/KanbanBoard.jsx`
**Lines:** 1061, 1235-1236, 1283, 1331

**Symptom:** App crashes with `ReferenceError: addNotification is not defined` when:
1. User drags deal from won/lost stage to active stage
2. User clicks "Undo" button in the undo toast
3. User hides a stage from the column menu

**Root Cause:**
```javascript
// Line 1061 - MISSING addNotification
const { organization, user } = useApp();
```

But `addNotification` is used at:
- Line 1235-1238: `addNotification(\`Moved "${dealName}" to active...\`, 'success');`
- Line 1283: `addNotification(\`"${undoableStatusChange.dealName}" restored...\`, 'success');`
- Line 1331: `addNotification(\`"${stageName}" hidden...\`, 'success');`

**Fix:** Add `addNotification` to the destructuring at line 1061.

---

### VERIFIED WORKING PATHS

After audit, the following paths are CORRECT:

1. **create-deal.mts**: Properly validates all fields, returns `{ success: true, deal }` on success
2. **update-deal.mts**: Properly validates stages, handles lost/disqualified mutual exclusivity
3. **get-team-members.mts**: Uses `user_profiles` view correctly for email/name
4. **NewDealModal.jsx**: Uses api-client correctly, handles errors gracefully
5. **DealDetailsModal.jsx**: Auto-save works correctly with 800ms debounce
6. **AssigneeSelector.jsx**: Uses correct endpoint and handles response structure

---

## Appendix C: Fix Plan (2025-12-07)

### Fix #1: KanbanBoard Missing addNotification

**File:** `src/components/KanbanBoard.jsx`
**Line:** 1061

**Before:**
```javascript
const { organization, user } = useApp();
```

**After:**
```javascript
const { organization, user, addNotification } = useApp();
```

**Impact:** Fixes crash on drag-drop status change, undo, and stage hiding.

---

## Appendix D: Test Coverage Requirements

### Backend Tests Required

1. `create-deal.mts` - Validation, auth, org membership
2. `update-deal.mts` - Stage transitions, lost/disqualified rules
3. `delete-deal.mts` - Soft delete, auth
4. `get-team-members.mts` - Auth, response format

### Frontend Tests Required

1. `KanbanBoard` - Drag-drop, status changes, addNotification calls
2. `NewDealModal` - Form validation, submission, error handling
3. `DealDetailsModal` - Auto-save, team member loading
4. `AssigneeSelector` - Team member fetch, assignment API

---

## Appendix E: Final QA Report (2025-12-07)

### Build Verification

| Check | Status | Details |
|-------|--------|---------|
| `npm run build` | **PASS** | Built in 4.49s, 30 precache entries |
| Production bundle | **PASS** | 3046.26 KiB total |
| No build errors | **PASS** | Clean build with no errors |

### Unit Test Results

| Test Suite | Tests | Status |
|------------|-------|--------|
| KanbanBoard.test.jsx | 11 tests | **PASS** |
| deal-endpoints.test.js | 27 tests | **PASS** |
| sanitizeAIOutput.test.js | 23 tests | **PASS** |
| formatAIResponse.test.js | 10 tests | **PASS** |
| PlanMyDayComponents.test.jsx | 16 tests | **PASS** |
| **TOTAL** | **87 tests** | **ALL PASS** |

### Fix Verification

| Issue | Fixed | Verified |
|-------|-------|----------|
| KanbanBoard missing `addNotification` | YES | Line 1062 updated |
| Drag-drop status change crash | YES | No longer crashes |
| Undo button crash | YES | No longer crashes |
| Hide stage crash | YES | No longer crashes |

### Diff Summary

**File: src/components/KanbanBoard.jsx**
```diff
- const { organization, user } = useApp();
+ // FIX 2025-12-07: Added addNotification - was missing, causing ReferenceError on drag-drop status change
+ const { organization, user, addNotification } = useApp();
```

### Regression Checklist

| Flow | Status | Notes |
|------|--------|-------|
| Deal Creation | VERIFIED | create-deal.mts validated |
| Deal Update | VERIFIED | update-deal.mts validated |
| Deal Delete | VERIFIED | delete-deal.mts soft delete works |
| Kanban Drag-Drop | FIXED | addNotification now available |
| Lost Reason Modal | VERIFIED | Works correctly |
| Disqualify Modal | VERIFIED | Works correctly |
| Team Member Loading | VERIFIED | get-team-members.mts works |
| AssigneeSelector | VERIFIED | Uses correct API pattern |

### Files Modified

1. **src/components/KanbanBoard.jsx** - Line 1061-1062: Added `addNotification` to useApp destructuring
2. **docs/spec-deals-kanban.md** - Created canonical specification
3. **tests/unit/KanbanBoard.test.jsx** - Added regression tests
4. **tests/unit/deal-endpoints.test.js** - Added API contract tests

### Outstanding Items

None. All identified issues have been resolved.

### Sign-Off

- **Date:** 2025-12-07
- **Engineer:** Principal Engineer Audit
- **Status:** COMPLETE - All tests pass, build succeeds, fix verified
