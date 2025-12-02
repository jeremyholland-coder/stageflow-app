-- Migration: Deal Assignment & Disqualify Support
-- Date: 2024-12-01
-- Purpose:
--   1. Add disqualified_reason_category and disqualified_reason_notes columns
--   2. Add 'disqualified' to status values
--   3. Add stage_at_disqualification to track which stage deal was in when disqualified
--   4. One-time cleanup: assign unowned deals to org admin

-- ==============================================================================
-- STEP 1: Add disqualify-related columns to deals table
-- ==============================================================================

-- Add disqualified reason category column
-- Stores the selected reason from predefined options
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS disqualified_reason_category TEXT;

-- Add disqualified notes column
-- Stores optional additional details (required when reason = 'Other')
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS disqualified_reason_notes TEXT;

-- Add stage at disqualification column
-- Tracks which stage the deal was in when disqualified (for reopening)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS stage_at_disqualification TEXT;

-- Add disqualified_at timestamp
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS disqualified_at TIMESTAMPTZ;

-- Add disqualified_by to track who disqualified
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS disqualified_by UUID REFERENCES auth.users(id);

-- ==============================================================================
-- STEP 2: Create index for filtering disqualified deals efficiently
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_deals_status_org
  ON deals(organization_id, status)
  WHERE deleted_at IS NULL;

-- ==============================================================================
-- STEP 3: One-time cleanup - Assign orphan deals to org admin
-- This fixes the "Unknown Member" issue in Team Performance
-- ==============================================================================

-- For each organization, find deals with NULL assigned_to and assign to org owner/admin
DO $$
DECLARE
  org RECORD;
  admin_id UUID;
BEGIN
  -- Loop through each organization
  FOR org IN SELECT DISTINCT organization_id FROM deals WHERE organization_id IS NOT NULL
  LOOP
    -- Find the org owner (role = 'owner') or earliest admin
    SELECT tm.user_id INTO admin_id
    FROM team_members tm
    WHERE tm.organization_id = org.organization_id
      AND tm.role IN ('owner', 'admin')
    ORDER BY
      CASE WHEN tm.role = 'owner' THEN 0 ELSE 1 END,
      tm.created_at ASC
    LIMIT 1;

    -- If we found an admin, update orphan deals
    IF admin_id IS NOT NULL THEN
      UPDATE deals
      SET
        assigned_to = admin_id,
        assigned_at = COALESCE(assigned_at, NOW())
      WHERE organization_id = org.organization_id
        AND (assigned_to IS NULL OR assigned_to NOT IN (
          SELECT user_id FROM team_members
          WHERE organization_id = org.organization_id
        ))
        AND deleted_at IS NULL;

      RAISE NOTICE 'Assigned orphan deals to admin % for org %', admin_id, org.organization_id;
    END IF;
  END LOOP;
END $$;

-- ==============================================================================
-- STEP 4: Add comment documentation
-- ==============================================================================

COMMENT ON COLUMN deals.disqualified_reason_category IS 'Predefined reason category: no_budget, not_a_fit, wrong_timing, went_with_competitor, unresponsive, other';
COMMENT ON COLUMN deals.disqualified_reason_notes IS 'Additional notes for disqualification (required when reason is "other")';
COMMENT ON COLUMN deals.stage_at_disqualification IS 'The stage deal was in when disqualified (for reopening to correct stage)';
COMMENT ON COLUMN deals.disqualified_at IS 'Timestamp when deal was disqualified';
COMMENT ON COLUMN deals.disqualified_by IS 'User ID of who disqualified the deal';
