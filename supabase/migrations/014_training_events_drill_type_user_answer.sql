-- Add drill_type, user_answer to training_events for raise_sizing and analytics (correct_action already exists in 005)
alter table training_events
  add column if not exists drill_type text,
  add column if not exists user_answer text;

comment on column training_events.drill_type is 'action_decision | raise_sizing';
comment on column training_events.user_answer is 'User choice: fold/call/raise or 2.5x/3x/overbet';

create index if not exists training_events_user_drill_type_created_idx
  on training_events(user_id, drill_type, created_at desc);
