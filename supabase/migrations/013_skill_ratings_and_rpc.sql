-- Skill ratings per user per leak_tag (updated after each table-drill result)
create table skill_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  leak_tag text not null,
  rating int not null default 50 check (rating >= 0 and rating <= 100),
  streak_correct int not null default 0,
  last_practice_at timestamptz,
  last_mistake_at timestamptz,
  total_attempts int not null default 0,
  total_correct int not null default 0,
  attempts_7d int not null default 0,
  correct_7d int not null default 0,
  attempts_30d int not null default 0,
  correct_30d int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, leak_tag)
);

create index skill_ratings_user_id_idx on skill_ratings(user_id);
create index skill_ratings_user_leak_idx on skill_ratings(user_id, leak_tag);

alter table skill_ratings enable row level security;

create policy "Users can select own skill_ratings"
  on skill_ratings for select
  using (auth.uid() = user_id);

create policy "Users can insert own skill_ratings"
  on skill_ratings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own skill_ratings"
  on skill_ratings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own skill_ratings"
  on skill_ratings for delete
  using (auth.uid() = user_id);

-- RPC: update skill rating after a table-drill result (called from Edge with user-scoped client)
create or replace function rpc_update_skill_rating(
  p_leak_tag text,
  p_is_correct boolean,
  p_practiced_at timestamptz default now()
)
returns skill_ratings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row skill_ratings;
  v_attempts_7d int;
  v_correct_7d int;
  v_attempts_30d int;
  v_correct_30d int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Count 7d / 30d from training_events (uses is_correct and leak_tag)
  select
    count(*)::int,
    count(*) filter (where is_correct)::int
  into v_attempts_7d, v_correct_7d
  from training_events
  where user_id = v_user
    and leak_tag = p_leak_tag
    and created_at >= now() - interval '7 days';

  select
    count(*)::int,
    count(*) filter (where is_correct)::int
  into v_attempts_30d, v_correct_30d
  from training_events
  where user_id = v_user
    and leak_tag = p_leak_tag
    and created_at >= now() - interval '30 days';

  -- Upsert: insert (first attempt) or update
  insert into skill_ratings (
    user_id, leak_tag, rating, streak_correct, last_practice_at, last_mistake_at,
    total_attempts, total_correct, attempts_7d, correct_7d, attempts_30d, correct_30d, updated_at, created_at
  )
  values (
    v_user, p_leak_tag,
    greatest(0, least(100, 50 + case when p_is_correct then 4 else -6 end)),
    case when p_is_correct then 1 else 0 end,
    p_practiced_at,
    case when not p_is_correct then p_practiced_at else null end,
    1,
    case when p_is_correct then 1 else 0 end,
    coalesce(v_attempts_7d, 0), coalesce(v_correct_7d, 0), coalesce(v_attempts_30d, 0), coalesce(v_correct_30d, 0),
    now(), now()
  )
  on conflict (user_id, leak_tag) do update set
    rating = greatest(0, least(100,
      skill_ratings.rating + case when p_is_correct then 4 else -6 end
    )),
    streak_correct = case when p_is_correct then skill_ratings.streak_correct + 1 else 0 end,
    last_practice_at = p_practiced_at,
    last_mistake_at = case when not p_is_correct then p_practiced_at else skill_ratings.last_mistake_at end,
    total_attempts = skill_ratings.total_attempts + 1,
    total_correct = skill_ratings.total_correct + case when p_is_correct then 1 else 0 end,
    attempts_7d = coalesce(v_attempts_7d, 0),
    correct_7d = coalesce(v_correct_7d, 0),
    attempts_30d = coalesce(v_attempts_30d, 0),
    correct_30d = coalesce(v_correct_30d, 0),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
