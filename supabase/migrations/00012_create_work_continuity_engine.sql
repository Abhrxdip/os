-- ============================================================================
-- SELFOS WORK CONTINUITY ENGINE — MIGRATION 00012
-- Tracks tasks, state transitions, versioned artifacts, checkpoints,
-- and enforces application storage budgets.
-- ============================================================================

-- 1. Tasks Table
create table if not exists public.continuity_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id text not null default 'default',
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  objective text not null,
  plan jsonb not null default '{"steps":[]}',
  current_state text not null default 'queued' check (
    current_state in (
      'queued',
      'in_progress',
      'checkpointing',
      'paused',
      'interrupted',
      'waiting_for_agent',
      'resuming',
      'validating',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  source_platform text default 'chatgpt',
  source_agent text default 'twin',
  session_id text,
  latest_checkpoint_id uuid,
  budget_bytes bigint not null default 52428800, -- 50 MB default budget per project
  used_bytes bigint not null default 0,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_continuity_tasks_user on public.continuity_tasks(user_id);
create index if not exists idx_continuity_tasks_project on public.continuity_tasks(user_id, project_id);
create index if not exists idx_continuity_tasks_state on public.continuity_tasks(current_state);

-- 2. State Transitions Table (Immutable Audit Ledger)
create table if not exists public.continuity_state_transitions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.continuity_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  from_state text not null,
  to_state text not null,
  trigger text not null,
  platform text,
  agent text,
  session_id text,
  checkpoint_id uuid,
  error_details jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_continuity_transitions_task on public.continuity_state_transitions(task_id, created_at desc);

-- 3. Versioned Recoverable Artifacts Table
create table if not exists public.continuity_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.continuity_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  path text not null,
  version integer not null default 1,
  content_hash text not null, -- SHA-256
  content text not null,
  diff text,
  status text not null default 'persisted' check (
    status in (
      'planned',
      'partially_generated',
      'persisted',
      'applied',
      'validated',
      'completed'
    )
  ),
  size_bytes integer not null,
  parent_version integer,
  source_platform text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_continuity_artifacts_task_path on public.continuity_artifacts(task_id, path, version desc);
create index if not exists idx_continuity_artifacts_hash on public.continuity_artifacts(content_hash);

-- 4. Checkpoints Table
create table if not exists public.continuity_checkpoints (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.continuity_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  summary text not null,
  completed_steps jsonb not null default '[]',
  pending_steps jsonb not null default '[]',
  next_recommended_action text not null,
  artifact_snapshots jsonb not null default '[]',
  git_ref text,
  errors jsonb default '[]',
  dependencies jsonb default '[]',
  created_at timestamptz default now()
);

create index if not exists idx_continuity_checkpoints_task on public.continuity_checkpoints(task_id, created_at desc);

-- 5. Storage Budget Tracking Table
create table if not exists public.continuity_storage_budgets (
  user_id uuid primary key references public.users(id) on delete cascade,
  allocated_bytes bigint not null default 52428800, -- 50 MB
  used_bytes bigint not null default 0,
  warning_threshold_percent integer not null default 70,
  critical_threshold_percent integer not null default 85,
  exhausted_threshold_percent integer not null default 95,
  status text not null default 'normal' check (
    status in ('normal', 'warning', 'critical', 'exhausted')
  ),
  updated_at timestamptz default now()
);

-- Row Level Security (RLS)
alter table public.continuity_tasks enable row level security;
alter table public.continuity_state_transitions enable row level security;
alter table public.continuity_artifacts enable row level security;
alter table public.continuity_checkpoints enable row level security;
alter table public.continuity_storage_budgets enable row level security;

-- Policies
create policy "Users can CRUD own continuity_tasks" on public.continuity_tasks
  for all using (auth.uid() = user_id);

create policy "Users can CRUD own continuity_state_transitions" on public.continuity_state_transitions
  for all using (auth.uid() = user_id);

create policy "Users can CRUD own continuity_artifacts" on public.continuity_artifacts
  for all using (auth.uid() = user_id);

create policy "Users can CRUD own continuity_checkpoints" on public.continuity_checkpoints
  for all using (auth.uid() = user_id);

create policy "Users can CRUD own continuity_storage_budgets" on public.continuity_storage_budgets
  for all using (auth.uid() = user_id);
