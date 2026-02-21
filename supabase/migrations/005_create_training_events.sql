-- Create training_events table for drill practice events
create table training_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario jsonb not null,
  user_action text not null,
  correct_action text not null,
  mistake_tag text,
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table training_events enable row level security;

-- Create policy: Users can manage their training events
create policy "Users can manage their training events"
on training_events for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create index for efficient querying by user and created_at
create index training_events_user_created_at_idx
on training_events(user_id, created_at desc);
