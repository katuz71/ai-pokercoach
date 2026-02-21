-- Drill queue for Train v2 (spaced repetition)
create table drill_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  leak_tag text not null,
  status text not null default 'due' check (status in ('due', 'scheduled', 'done')),
  due_at timestamptz not null default now(),
  last_drill_id uuid null references training_events(id) on delete set null,
  last_score int null check (last_score is null or (last_score >= 0 and last_score <= 100)),
  repetition int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table drill_queue enable row level security;

create policy "Users can select own drill_queue"
on drill_queue for select
using (auth.uid() = user_id);

create policy "Users can insert own drill_queue"
on drill_queue for insert
with check (auth.uid() = user_id);

create policy "Users can update own drill_queue"
on drill_queue for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own drill_queue"
on drill_queue for delete
using (auth.uid() = user_id);

create index drill_queue_user_due_at_idx
on drill_queue(user_id, due_at asc)
where status in ('due', 'scheduled');

create index drill_queue_user_leak_tag_idx
on drill_queue(user_id, leak_tag);

create trigger update_drill_queue_updated_at
before update on drill_queue
for each row
execute function update_updated_at_column();

-- RPC: get due drills for current user
create or replace function rpc_get_due_drills(limit_n int default 5)
returns setof drill_queue
language sql
security definer
set search_path = public
as $$
  select *
  from drill_queue
  where user_id = auth.uid()
    and due_at <= now()
    and status in ('due', 'scheduled')
  order by due_at asc
  limit limit_n;
$$;
