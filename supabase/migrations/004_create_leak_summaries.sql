-- Create leak_summaries table for aggregated leak analysis
create table leak_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary jsonb not null,
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table leak_summaries enable row level security;

-- Create policy: Users can manage their leak summaries
create policy "Users can manage their leak summaries"
on leak_summaries
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create index for efficient querying by user and period
create index leak_summaries_user_period_idx
on leak_summaries(user_id, period_start desc);

-- Create index for period end lookups
create index leak_summaries_period_end_idx
on leak_summaries(user_id, period_end desc);
