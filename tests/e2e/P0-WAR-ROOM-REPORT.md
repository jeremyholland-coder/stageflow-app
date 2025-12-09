# P0 War Room: Deal Engine / Drag-Drop / Status Report

**Date**: 2025-12-09
**Build**: v1.7.93

## 1. Flow Map

### Deal Creation Flow
```
NewDealModal → api.post('create-deal') → create-deal.mts → Supabase INSERT → Response → onDealCreated() → setDeals()
```

### Deal Editing Flow (DealDetailsModal)
```
DealDetailsModal form change → setFormData() + setIsDirty(true) → 800ms debounce → performAutoSave()
  → api.deal('update-deal') → update-deal.mts → Supabase UPDATE → Response → onDealUpdated()
```

### Drag-Drop Flow (KanbanBoard)
```
handleDragStart() → dataTransfer.setData('dealId') → handleDrop() → processDrop()
  → [isLostStage()?] → onLostReasonRequired() → LostReasonModal
  → [isWonStage()?] → onUpdateDeal(dealId, {stage, status:'won'})
  → [else] → onUpdateDeal(dealId, {stage})
  → useDealManagement.updateDeal() → optimistic update → api.deal('update-deal')
  → update-deal.mts → Supabase UPDATE → Response → setDeals() with server data
  → [error?] → rollback to originalDeal + addNotification('error')
```

## 2. Failure Modes Identified & Fixed

### P0-1: Update-deal.mts Schema Mismatch
**Before**: `allowedFields` included non-existent columns (`company`, `expected_close`, `probability`)
**Symptom**: PGRST204 errors on deal updates
**Fix**: Removed all non-existent columns from allowedFields

**File**: [update-deal.mts](netlify/functions/update-deal.mts#L143-L164)
```typescript
// BEFORE (broken)
const allowedFields = [
  "client", "company", "expected_close", "probability", ...
];

// AFTER (fixed)
const allowedFields = [
  "client", "email", "phone", "value", "stage", "status", "notes",
  "last_activity", "lost_reason", "lost_reason_notes", ...
];
```

### P0-2: DealDetailsModal Stage/Status Sync Incomplete
**Before**: Only handled 'lost' and 'retention' stages specially
**Symptom**: Status didn't auto-sync for deal_won, deal_lost, and other pipeline stages
**Fix**: Use centralized `getStatusForStage()` for ALL stage changes

**File**: [DealDetailsModal.jsx](src/components/DealDetailsModal.jsx#L333-L351)
```javascript
// BEFORE
if (newStage === 'lost') { ... }
else if (newStage === 'retention') { setFormData({...formData, stage: newStage, status: 'won'}); }
else { setFormData({...formData, stage: newStage}); } // STATUS NOT UPDATED

// AFTER
const isLostStage = newStage === 'lost' || newStage === 'deal_lost';
if (isLostStage) { /* show modal */ }
const newStatus = getStatusForStage(newStage); // ALWAYS compute correct status
setFormData({ ...formData, stage: newStage, status: newStatus });
```

### P0-3: KanbanBoard Drag-Drop Only Checked Hard-coded Stages
**Before**: Only checked `stage.id === 'lost'` and `stage.id === 'retention'`
**Symptom**: Healthcare, VC, Real Estate pipelines with different stage names didn't trigger won/lost flows
**Fix**: Use centralized `isWonStage()` and `isLostStage()` functions

**File**: [KanbanBoard.jsx](src/components/KanbanBoard.jsx#L888-L908)
```javascript
// BEFORE
if (stage.id === 'lost') { ... }
else if (stage.id === 'retention') { ... }

// AFTER
if (isLostStage(stage.id)) { /* show modal */ }
else if (isWonStage(stage.id)) { onUpdateDeal(dealId, {stage: stage.id, status: 'won'}); }
```

### P0-4: Realtime Overwrite Race Condition
**Before**: Realtime UPDATE events blindly overwrote local state
**Symptom**: After drag-drop, deal could "snap back" to old stage briefly
**Fix**: Compare `last_activity` timestamps; skip stale realtime events

**File**: [useDealManagement.js](src/hooks/useDealManagement.js#L509-L534)
```javascript
// ADDED: Race condition protection
const localTime = d.last_activity ? new Date(d.last_activity).getTime() : 0;
const realtimeTime = normalizedUpdatedDeal.last_activity ? new Date(normalizedUpdatedDeal.last_activity).getTime() : 0;
if (localTime > realtimeTime) {
  console.log('[RealTime] Skipping stale update for deal:', d.id);
  return d; // Keep local version
}
return normalizedUpdatedDeal;
```

## 3. Fixes Applied

| File | Change | Lines |
|------|--------|-------|
| `netlify/functions/update-deal.mts` | Removed non-existent columns from allowedFields | L143-164 |
| `src/components/DealDetailsModal.jsx` | Centralized stage/status sync in handleStageChange | L333-351 |
| `src/components/DealDetailsModal.jsx` | Fixed handleLostReasonConfirm to use pending stage | L353-366 |
| `src/components/KanbanBoard.jsx` | Use isWonStage/isLostStage for all pipelines | L888-908 |
| `src/hooks/useDealManagement.js` | Realtime race condition protection | L509-534 |

## 4. Scenario Tests Implemented

**File**: [tests/e2e/deal-scenarios.test.ts](tests/e2e/deal-scenarios.test.ts)

| Test | What It Guarantees |
|------|-------------------|
| D1: Create + Edit + Drag | Deal can be created, fields updated, stage changed, and status auto-syncs |
| D2: Lost + Restore | Deal can be marked lost with reason, then restored to active with fields cleared |
| D3: Disqualified + Display | Deal can be disqualified with category/notes, fields are mutually exclusive with lost |
| D4: Rapid Drag-Drop | Multiple rapid stage changes result in correct final state, no duplicates, no NaN values |
| Edge: Stage-Status Sync | All won stages (deal_won, retention, payment_received) auto-sync to won status |
| Edge: Clear Outcome | Moving from lost to active clears all outcome fields |

### Run Tests
```bash
npm run test:deals        # With Netlify env
npm run test:deals:local  # Without Netlify env (requires .env)
```

## 5. Remaining Unknowns

### Browser-Only Issues (Cannot Test in Node)
- **Drag physics**: Actual pointer events, touch handling, drag preview rendering
- **Z-index layering**: Modal stacking, dropdown positioning during drag
- **Animation timing**: CSS transitions during rapid state changes

### What Jeremy Would See If These Are Wrong
1. **Drag preview wrong**: Card disappears or shows wrong content while dragging
2. **Modal behind backdrop**: LostReasonModal not visible or not clickable
3. **Visual flicker**: Card briefly shows old stage before settling on new stage

### Database Trigger Issue (Still Outstanding)
Phase 10 tests revealed: `record "new" has no field "assignment_type"` (42703)

This is a Supabase database trigger expecting a column that doesn't exist. **This blocks deal CREATION** but not UPDATE operations (which this war room fixed).

**Action Required**: DBA investigation to identify and fix/remove the faulty trigger.

## Build Status

- **Build**: PASSES
- **Modules**: 2524
- **Duration**: 4.94s
- **PWA**: 30 entries precached
