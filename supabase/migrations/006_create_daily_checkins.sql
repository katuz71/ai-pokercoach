-- Create daily_checkins table
create table daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  message jsonb not null,
  created_at timestamp with time zone default now(),
  unique (user_id, checkin_date)
);

-- Enable Row Level Security
alter table daily_checkins enable row level security;

-- Create policy: Users can only manage their own daily checkins
create policy "Users can manage their daily checkins"
on daily_checkins
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create index for faster lookups (user + date desc for streak calculation)
create index daily_checkins_user_date_idx
on daily_checkins(user_id, checkin_date desc);
