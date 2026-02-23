-- Add drill_type, user_answer, correct_answer to training_events for raise_sizing and analytics
alter table training_events
  add column if not exists drill_type text,
  add column if not exists user_answer text,
  add column if not exists correct_answer text;

comment on column training_events.drill_type is 'action_decision | raise_sizing';
comment on column training_events.user_answer is 'User choice: fold/call/raise or 2.5x/3x/overbet';
comment on column training_events.correct_answer is 'Correct option from scenario';

create index if not exists training_events_user_drill_type_created_idx
  on training_events(user_id, drill_type, created_at desc);
