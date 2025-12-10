-- Revenue Agent System Tables
-- Migration: 20241210_revenue_agent_tables.sql
--
-- Creates two tables for the continuous AI Revenue Agent system:
-- 1. ai_usage_logs: Detailed logging of ALL AI interactions (background + interactive)
-- 2. revenue_projection_state: Deterministic revenue projection snapshots
--
-- @author StageFlow Engineering
-- @date 2025-12-10

-- ============================================================================
-- CLEANUP: Drop any partial state from failed migrations
-- ============================================================================
-- Drop tables first (cascades triggers/indexes), then functions
DROP TABLE IF EXISTS public.ai_usage_logs CASCADE;
DROP TABLE IF EXISTS public.revenue_projection_state CASCADE;
DROP FUNCTION IF EXISTS public.update_revenue_projection_timestamp();
DROP FUNCTION IF EXISTS public.get_ai_usage_count(uuid, timestamptz, timestamptz);

-- ============================================================================
-- TABLE 1: ai_usage_logs - Detailed AI Usage Logging
-- ============================================================================
-- Tracks every AI call for billing, analytics, and user value visibility

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Request classification
  request_type text not null, -- 'hourly_health' | 'daily_plan' | 'weekly_review' | 'monthly_forecast' | 'mission_control_query' | 'quick_action' | 'deal_insight'

  -- Provider details
  provider text, -- 'openai' | 'anthropic' | 'google'
  model text,

  -- Token usage (nullable for failed calls)
  tokens_in integer default 0,
  tokens_out integer default 0,

  -- Status
  success boolean not null default true,
  error_code text, -- Uses AI_ERROR_CODES if failed

  -- Flexible metadata for additional context
  metadata jsonb default '{}'::jsonb
);

-- Indexes for common query patterns
create index if not exists idx_ai_usage_logs_org_timestamp
  on public.ai_usage_logs (organization_id, created_at desc);

create index if not exists idx_ai_usage_logs_user_timestamp
  on public.ai_usage_logs (user_id, created_at desc);

create index if not exists idx_ai_usage_logs_request_type
  on public.ai_usage_logs (request_type);

-- Note: For monthly aggregation queries (billing), use idx_ai_usage_logs_org_timestamp
-- which covers (organization_id, created_at desc) - the query planner will use this
-- for date range filters. Expression indexes with date_trunc require IMMUTABLE functions.

-- RLS: Service role only (Netlify Functions manage this table)
alter table public.ai_usage_logs enable row level security;

-- Policy: Allow service role full access (backend)
-- No user-facing RLS policies = only service_role can access
-- This is intentional - AI usage logs are managed by backend

-- Comments for documentation
comment on table public.ai_usage_logs is 'Detailed log of all AI usage for billing, analytics, and user value visibility. Managed by Netlify Functions using service_role.';
comment on column public.ai_usage_logs.request_type is 'Type of AI request: hourly_health, daily_plan, weekly_review, monthly_forecast, mission_control_query, quick_action, deal_insight';
comment on column public.ai_usage_logs.provider is 'AI provider used: openai, anthropic, google';
comment on column public.ai_usage_logs.error_code is 'Error code from AI_ERROR_CODES if request failed';
comment on column public.ai_usage_logs.metadata is 'Flexible JSON for request context: risk_flags, projection summary, etc.';


-- ============================================================================
-- TABLE 2: revenue_projection_state - Deterministic Revenue Snapshots
-- ============================================================================
-- Stores the latest deterministic revenue projection for each user/org

create table if not exists public.revenue_projection_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_ts timestamptz not null default now(),

  -- Deterministic projection values (what deals project to)
  month_projected numeric not null default 0,
  quarter_projected numeric not null default 0,
  year_projected numeric not null default 0,

  -- Goals/targets (copied from org/user targets for snapshot integrity)
  month_goal numeric,
  quarter_goal numeric,
  year_goal numeric,

  -- Percent to goal calculations
  month_pct_to_goal numeric,
  quarter_pct_to_goal numeric,
  year_pct_to_goal numeric,

  -- Pace metrics (actual progress vs time elapsed in period)
  -- 1.0 = on pace, <1.0 = behind, >1.0 = ahead
  pace_month numeric,
  pace_quarter numeric,
  pace_year numeric,

  -- Closed revenue this period (for run-rate calculations)
  month_closed numeric default 0,
  quarter_closed numeric default 0,
  year_closed numeric default 0,

  -- Risk flags (array of issue identifiers)
  risk_flags text[] default '{}'::text[],

  -- AI Coach interpretation (cached)
  coach_tone text, -- 'encouraging' | 'urgent' | 'neutral'
  coach_summary text,
  coach_top_actions text[],
  coach_risk_level text, -- 'low' | 'medium' | 'high'
  coach_generated_at timestamptz,

  -- Versioning for future engine upgrades
  engine_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique constraint for upsert operations (one snapshot per user/org)
  unique (organization_id, user_id)
);

-- Index for org-wide queries
create index if not exists idx_revenue_projection_state_org
  on public.revenue_projection_state (organization_id, snapshot_ts desc);

-- RLS: Service role only (Netlify Functions manage this table)
alter table public.revenue_projection_state enable row level security;

-- Policy: Allow users to read their own projections
create policy "Users can read own revenue projections"
  on public.revenue_projection_state
  for select
  using (auth.uid() = user_id);

-- Comments for documentation
comment on table public.revenue_projection_state is 'Latest deterministic revenue projection snapshot per user/org. Updated hourly by Revenue Agent.';
comment on column public.revenue_projection_state.pace_month is 'Ratio of actual progress vs time elapsed. 1.0 = on pace, <1.0 = behind, >1.0 = ahead';
comment on column public.revenue_projection_state.risk_flags is 'Array of identified risks: lead_drought, stagnant_pipeline, off_pace_month, etc.';
comment on column public.revenue_projection_state.engine_version is 'Version of deterministic engine for migration compatibility';
comment on column public.revenue_projection_state.coach_summary is 'Cached AI coach interpretation of the projection data';


-- ============================================================================
-- FUNCTION: Get AI usage count for a period (for billing UI)
-- ============================================================================

create or replace function public.get_ai_usage_count(
  p_org_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz default now()
)
returns table (
  request_type text,
  total_count bigint,
  success_count bigint,
  tokens_in_total bigint,
  tokens_out_total bigint
)
language sql
stable
security definer
as $$
  select
    request_type,
    count(*) as total_count,
    count(*) filter (where success = true) as success_count,
    coalesce(sum(tokens_in), 0) as tokens_in_total,
    coalesce(sum(tokens_out), 0) as tokens_out_total
  from public.ai_usage_logs
  where organization_id = p_org_id
    and created_at >= p_start_date
    and created_at < p_end_date
  group by request_type
  order by total_count desc;
$$;

comment on function public.get_ai_usage_count is 'Returns AI usage counts grouped by request_type for billing and analytics UI';


-- ============================================================================
-- FUNCTION: Update timestamp trigger for revenue_projection_state
-- ============================================================================

create or replace function public.update_revenue_projection_timestamp()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

create trigger trigger_revenue_projection_updated
  before update on public.revenue_projection_state
  for each row
  execute function public.update_revenue_projection_timestamp();
