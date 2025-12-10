-- Migration: Ensure lost_reason_notes exists on deals
-- Purpose: keep DB schema aligned with update-deal.mts expectations
-- Safe: additive, IF NOT EXISTS guard

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS lost_reason_notes TEXT;
