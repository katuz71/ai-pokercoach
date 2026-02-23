-- Add is_correct and leak_tag to training_events for skill_ratings and 7d/30d counts
alter table training_events
  add column if not exists is_correct boolean not null default false,
  add column if not exists leak_tag text;

comment on column training_events.is_correct is 'True when user_action = correct_action';
comment on column training_events.leak_tag is 'Leak tag this drill was for (from drill_queue)';

-- Index for rpc_update_skill_rating 7d/30d counts: filter by user_id, leak_tag, created_at
create index if not exists training_events_user_leak_created_idx
  on training_events(user_id, leak_tag, created_at desc);
