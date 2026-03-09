-- Table for pre-generated poker drill scenarios (hand library).
-- Used by train.tsx: select one row and pass to normalizeScenario().
create table if not exists public.hand_library (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'NLH',
  hero_pos text not null,
  villain_pos text not null,
  effective_stack_bb numeric not null,
  hero_cards jsonb not null,
  board jsonb not null,
  pot_bb numeric not null,
  street text not null,
  action_to_hero jsonb not null,
  correct_action text,
  explanation text not null default '',
  drill_type text,
  options jsonb,
  correct_option text,
  rule_of_thumb text,
  leak_tag text,
  created_at timestamptz not null default now()
);

comment on table public.hand_library is 'Pre-generated table drill scenarios for training (e.g. 3000 hands).';

-- Allow anonymous read for app (train fetches one row per drill start).
alter table public.hand_library enable row level security;

create policy "Allow read hand_library"
  on public.hand_library for select
  using (true);

-- No insert policy: only service_role (e.g. scripts) can insert (RLS bypass).
