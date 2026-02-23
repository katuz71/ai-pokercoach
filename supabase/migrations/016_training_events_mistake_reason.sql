-- Add mistake_reason to training_events (only set when is_correct = false)
alter table training_events
  add column if not exists mistake_reason text;

comment on column training_events.mistake_reason is 'range|sizing|position|board|stack|unknown';
