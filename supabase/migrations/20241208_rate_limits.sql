-- Rate Limits Table for Area 2 - Rate Limiting & Abuse Protection
--
-- Stores per-user, per-org rate limit counters for various buckets
-- Used by Netlify Functions to enforce AI call limits, Plan My Day limits, etc.

create table if not exists public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null, -- e.g. 'ai.generic', 'ai.plan_my_day'
  window_start timestamptz not null,
  window_seconds integer not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique constraint for upsert operations
  unique (user_id, organization_id, bucket, window_start, window_seconds)
);

-- Index for fast lookups by user + org + bucket
create index if not exists idx_rate_limits_lookup
  on public.rate_limits (user_id, organization_id, bucket, window_start);

-- Index for cleanup of old entries
create index if not exists idx_rate_limits_window_start
  on public.rate_limits (window_start);

-- RLS: Only service role can access this table (Netlify Functions)
-- Users should not be able to query or manipulate their own rate limits
alter table public.rate_limits enable row level security;

-- No RLS policies = only service_role can access
-- This is intentional - rate limits should only be managed by backend

-- Comment for documentation
comment on table public.rate_limits is 'Rate limiting counters for AI calls and other protected operations. Managed by Netlify Functions using service_role.';
comment on column public.rate_limits.bucket is 'Rate limit bucket name: ai.generic, ai.plan_my_day, ai.plan_my_day_org';
comment on column public.rate_limits.window_start is 'Start of the time window (floored to window_seconds boundary)';
comment on column public.rate_limits.window_seconds is 'Duration of the time window in seconds (60, 3600, 86400)';
comment on column public.rate_limits.count is 'Number of requests in this window';
