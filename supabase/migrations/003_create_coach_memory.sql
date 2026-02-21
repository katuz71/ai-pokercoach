-- Enable pgvector extension
create extension if not exists vector;

-- Create coach_memory table for RAG
create table coach_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('hand_case', 'leak_summary', 'note')),
  content text not null,
  metadata jsonb default '{}',
  embedding vector(1536),
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table coach_memory enable row level security;

-- Create policy: Users can manage their coach memory
create policy "Users can manage their coach memory"
on coach_memory
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Create indexes
create index coach_memory_user_idx
on coach_memory(user_id);

-- IVFFlat index for vector similarity search
create index coach_memory_embedding_idx
on coach_memory
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

-- Create index for type filtering
create index coach_memory_type_idx
on coach_memory(user_id, type);

-- Create RPC function for similarity search
create or replace function match_coach_memory(
  query_embedding vector(1536),
  match_threshold float default 0.75,
  match_count int default 5,
  filter_user_id uuid default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    coach_memory.id,
    coach_memory.content,
    coach_memory.metadata,
    1 - (coach_memory.embedding <=> query_embedding) as similarity
  from coach_memory
  where 
    (filter_user_id is null or coach_memory.user_id = filter_user_id)
    and coach_memory.embedding is not null
    and 1 - (coach_memory.embedding <=> query_embedding) > match_threshold
  order by coach_memory.embedding <=> query_embedding
  limit match_count;
$$;
