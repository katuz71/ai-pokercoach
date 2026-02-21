-- Extend coach_memory: new types for chat summarization + updated_at
-- Does not change embedding dimension (1536).

-- 1) Add updated_at column
alter table coach_memory
  add column if not exists updated_at timestamp with time zone default now();

-- 2) Drop existing type constraint and add extended one
alter table coach_memory
  drop constraint if exists coach_memory_type_check;

alter table coach_memory
  add constraint coach_memory_type_check check (type in (
    'hand_case',
    'leak_summary',
    'note',
    'chat_fact',
    'chat_preference',
    'chat_goal',
    'chat_leak'
  ));

-- 3) Trigger for updated_at (reuse existing function from 001)
drop trigger if exists update_coach_memory_updated_at on coach_memory;
create trigger update_coach_memory_updated_at
  before update on coach_memory
  for each row
  execute function update_updated_at_column();
