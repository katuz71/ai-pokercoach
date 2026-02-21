-- Soft delete support for hand_analyses (undo delete UX)
alter table hand_analyses
  add column if not exists is_deleted boolean not null default false;

-- Partial index: list non-deleted by user, created_at desc (RLS unchanged)
create index if not exists hand_analyses_user_created_not_deleted_idx
  on hand_analyses (user_id, created_at desc)
  where is_deleted = false;
