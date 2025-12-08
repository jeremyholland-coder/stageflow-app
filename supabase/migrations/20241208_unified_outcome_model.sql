-- Migration: Unified Outcome Model
-- Date: 2024-12-08
-- Phase: 4 - Disqualified/Lost System Unification
-- Purpose:
--   1. Add unified outcome fields for consistent lost/disqualified handling
--   2. Migrate existing data from legacy fields to unified fields
--   3. Preserve existing columns for backward compatibility
--   4. Create indexes for efficient outcome-based queries
--
-- Key Design Decisions:
--   - ADDITIVE: Does not drop any existing columns
--   - BACKWARD COMPATIBLE: Old code continues to work with legacy fields
--   - DATA PRESERVING: Existing lost_reason and disqualified_reason data is migrated
--   - UNIFIED: New queries can use consistent outcome_* fields

-- ==============================================================================
-- STEP 1: Add unified outcome columns
-- ==============================================================================

-- Unified reason category (maps both lost and disqualified reasons)
-- Values: competitor, budget, timing, no_fit, unresponsive, no_interest, other
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS outcome_reason_category TEXT;

-- Unified notes field for outcome details
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS outcome_notes TEXT;

-- When the outcome was recorded
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;

-- Who recorded the outcome
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS outcome_recorded_by UUID REFERENCES auth.users(id);

-- ==============================================================================
-- STEP 2: Migrate existing lost deals to unified model
-- ==============================================================================

-- Map lost_reason to unified outcome_reason_category
-- NOTE: lost_reason stores either a reason label (e.g., "Lost to Competitor")
-- or "Other: [custom notes]" format. There is no separate lost_reason_notes column.
UPDATE deals
SET
  outcome_reason_category = CASE
    WHEN lost_reason ILIKE '%competitor%' THEN 'competitor'
    WHEN lost_reason ILIKE '%interest%' THEN 'no_interest'
    WHEN lost_reason ILIKE '%budget%' THEN 'budget'
    WHEN lost_reason ILIKE '%timing%' OR lost_reason ILIKE '%ready%' THEN 'timing'
    WHEN lost_reason ILIKE 'other:%' THEN 'other'
    ELSE 'other'
  END,
  -- Extract notes from "Other: [notes]" format if present
  outcome_notes = CASE
    WHEN lost_reason ILIKE 'other:%' THEN TRIM(SUBSTRING(lost_reason FROM 7))
    ELSE NULL
  END,
  outcome_recorded_at = COALESCE(closed_date, updated)
WHERE status = 'lost'
  AND lost_reason IS NOT NULL
  AND outcome_reason_category IS NULL;

-- ==============================================================================
-- STEP 3: Migrate existing disqualified deals to unified model
-- ==============================================================================

-- Map disqualified_reason_category to unified outcome_reason_category
UPDATE deals
SET
  outcome_reason_category = CASE disqualified_reason_category
    WHEN 'no_budget' THEN 'budget'
    WHEN 'not_a_fit' THEN 'no_fit'
    WHEN 'wrong_timing' THEN 'timing'
    WHEN 'went_with_competitor' THEN 'competitor'
    WHEN 'unresponsive' THEN 'unresponsive'
    WHEN 'other' THEN 'other'
    ELSE 'other'
  END,
  outcome_notes = disqualified_reason_notes,
  outcome_recorded_at = COALESCE(disqualified_at, updated),
  outcome_recorded_by = disqualified_by
WHERE status = 'disqualified'
  AND disqualified_reason_category IS NOT NULL
  AND outcome_reason_category IS NULL;

-- ==============================================================================
-- STEP 4: Create indexes for efficient outcome queries
-- ==============================================================================

-- Index for filtering by outcome reason category
CREATE INDEX IF NOT EXISTS idx_deals_outcome_reason
  ON deals(organization_id, outcome_reason_category)
  WHERE status IN ('lost', 'disqualified')
  AND deleted_at IS NULL;

-- Index for outcome analytics by time
CREATE INDEX IF NOT EXISTS idx_deals_outcome_time
  ON deals(organization_id, outcome_recorded_at)
  WHERE status IN ('lost', 'disqualified')
  AND deleted_at IS NULL;

-- ==============================================================================
-- STEP 5: Add column documentation
-- ==============================================================================

COMMENT ON COLUMN deals.outcome_reason_category IS 'Unified reason category for lost/disqualified deals: competitor, budget, timing, no_fit, unresponsive, no_interest, other';
COMMENT ON COLUMN deals.outcome_notes IS 'Additional notes explaining the outcome';
COMMENT ON COLUMN deals.outcome_recorded_at IS 'When the outcome (lost/disqualified) was recorded';
COMMENT ON COLUMN deals.outcome_recorded_by IS 'User who recorded the outcome';

-- ==============================================================================
-- NOTE: Legacy columns are preserved for backward compatibility
-- ==============================================================================
-- The following columns still exist and can be used by older code:
--   - lost_reason (TEXT)
--   - lost_reason_notes (TEXT)
--   - disqualified_reason_category (TEXT)
--   - disqualified_reason_notes (TEXT)
--   - disqualified_at (TIMESTAMPTZ)
--   - disqualified_by (UUID)
--
-- New code should use the unified outcome_* columns.
-- A future migration may deprecate the legacy columns once all code is updated.
