-- Create hand_analyses table
create table hand_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input jsonb not null,
  result jsonb not null,
  mistake_tags text[] default '{}',
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table hand_analyses enable row level security;

-- Create policy: Users can manage their hand analyses
create policy "Users can manage their hand analyses"
on hand_analyses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create index for faster lookups by user and date
create index hand_analyses_user_id_created_at_idx
on hand_analyses(user_id, created_at desc);
