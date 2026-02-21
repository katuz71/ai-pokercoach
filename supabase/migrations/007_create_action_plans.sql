-- Create action_plans table for 7-day action plan tracker
create table action_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  focus_tag text,
  items jsonb not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique (user_id, period_start, period_end)
);

-- Enable Row Level Security
alter table action_plans enable row level security;

-- Create policy: Users can manage their action plans
create policy "Users can manage their action plans"
on action_plans
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create index for efficient querying by user and period
create index action_plans_user_period_idx
on action_plans(user_id, period_start desc);

-- Create trigger for updated_at
create or replace function update_action_plan_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger action_plans_updated_at
before update on action_plans
for each row
execute function update_action_plan_updated_at();
