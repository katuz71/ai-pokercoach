-- Add drill_type to drill_queue for UI variety (action_decision | raise_sizing)
alter table drill_queue
  add column if not exists drill_type text not null default 'action_decision';

comment on column drill_queue.drill_type is 'action_decision | raise_sizing';

-- Optional index for filtering by type when fetching due drills
create index if not exists drill_queue_user_drill_type_due_at_idx
  on drill_queue(user_id, drill_type, due_at asc)
  where status in ('due', 'scheduled');
