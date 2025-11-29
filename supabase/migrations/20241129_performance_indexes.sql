-- Phase 18 Performance Indexes
-- Safe SQL-only changes: indexes only, no schema modifications
-- These indexes optimize the most frequent dashboard and API queries

-- Index for deals query by organization (Dashboard, KanbanBoard)
-- Covers: organization_id filter + stage/status for grouping
CREATE INDEX IF NOT EXISTS idx_deals_org_stage_status
ON deals(organization_id, stage, status);

-- Index for team_members by organization (TeamDashboard)
CREATE INDEX IF NOT EXISTS idx_team_members_org
ON team_members(organization_id);

-- Index for ai_providers by organization + active flag (AI feature checks)
CREATE INDEX IF NOT EXISTS idx_ai_providers_org_active
ON ai_providers(organization_id, active);

-- Index for onboarding_progress by user (Welcome modal checks)
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user
ON onboarding_progress(user_id);

-- Index for user_targets by organization (Revenue targets widget)
CREATE INDEX IF NOT EXISTS idx_user_targets_org
ON user_targets(organization_id);

-- Index for deals created_at for time-based queries (weekly trends, forecasts)
CREATE INDEX IF NOT EXISTS idx_deals_org_created
ON deals(organization_id, created_at);

-- Composite index for deal filtering in Dashboard (status + stage combination)
CREATE INDEX IF NOT EXISTS idx_deals_status_stage
ON deals(status, stage) WHERE status = 'active';
