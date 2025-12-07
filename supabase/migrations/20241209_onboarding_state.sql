-- Onboarding State Table for Area 6 - First-Run Experience
--
-- Stores per-user, per-org onboarding progress for lightweight founder-friendly onboarding
-- Used by Netlify Functions to track checklist completion and dismissal state

create table if not exists public.onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checklist jsonb not null default '[]'::jsonb,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique constraint for one onboarding state per user/org combo
  unique (user_id, organization_id)
);

-- Index for fast lookups by user + org
create index if not exists idx_onboarding_state_lookup
  on public.onboarding_state (user_id, organization_id);

-- Index for finding incomplete onboarding states (for analytics)
create index if not exists idx_onboarding_state_dismissed
  on public.onboarding_state (dismissed) where dismissed = false;

-- RLS: Only service role can access this table (Netlify Functions)
-- Users should not be able to directly manipulate their onboarding state
alter table public.onboarding_state enable row level security;

-- No RLS policies = only service_role can access
-- This is intentional - onboarding state should only be managed by backend

-- Auto-update updated_at on changes
create or replace function update_onboarding_state_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger onboarding_state_updated_at
  before update on public.onboarding_state
  for each row execute function update_onboarding_state_updated_at();

-- Comments for documentation
comment on table public.onboarding_state is 'Onboarding progress tracking for first-run experience. Managed by Netlify Functions using service_role.';
comment on column public.onboarding_state.checklist is 'JSON array of checklist items with id, completed, completedAt fields';
comment on column public.onboarding_state.dismissed is 'Whether user has dismissed the onboarding UI (clicked "I''m all set")';
