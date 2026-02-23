-- chat_threads: optional leak tag for filtering and display
alter table chat_threads
  add column if not exists leak_tag text;

comment on column chat_threads.leak_tag is 'Optional leak tag associated with this thread';

create index if not exists chat_threads_user_leak_idx
  on chat_threads(user_id, leak_tag);
