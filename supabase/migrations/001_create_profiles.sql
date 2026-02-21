-- Create profiles table
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  skill_level text,
  plays_for_money text,
  game_types text[],
  goals text[],
  weak_areas text[],
  coach_style text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table profiles enable row level security;

-- Create policy: Users can only manage their own profile
create policy "Users can manage their profile"
on profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

-- Create policy: Allow anonymous users to manage their profile
create policy "Anonymous users can manage their profile"
on profiles
for all
using (auth.jwt() ->> 'sub' = id::text)
with check (auth.jwt() ->> 'sub' = id::text);

-- Create index for faster lookups
create index profiles_id_idx on profiles(id);

-- Add updated_at trigger
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_profiles_updated_at
  before update on profiles
  for each row
  execute function update_updated_at_column();
