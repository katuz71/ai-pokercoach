-- Persistent Coach Chat: threads and messages

-- chat_threads: one per conversation
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  coach_style text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table chat_threads enable row level security;

create policy "Users can manage their chat threads"
on chat_threads
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index chat_threads_user_updated_idx
on chat_threads(user_id, updated_at desc);

create trigger update_chat_threads_updated_at
  before update on chat_threads
  for each row
  execute function update_updated_at_column();

-- chat_messages: messages in a thread
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table chat_messages enable row level security;

create policy "Users can manage their chat messages"
on chat_messages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index chat_messages_thread_created_idx
on chat_messages(thread_id, created_at asc);

create index chat_messages_user_created_idx
on chat_messages(user_id, created_at desc);
