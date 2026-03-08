-- RLS for public.drill_queue: client with user JWT saw count 0 despite rows in DB.
-- Fix: explicit SELECT and UPDATE policies for role "authenticated" (auth.uid() = user_id).

alter table public.drill_queue enable row level security;

-- Remove old policies (from 011) so only these apply for select/update
drop policy if exists "Users can select own drill_queue" on public.drill_queue;
drop policy if exists "drill_queue_select_own_anon" on public.drill_queue;
drop policy if exists "drill_queue_select_own" on public.drill_queue;
create policy "drill_queue_select_own"
on public.drill_queue
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own drill_queue" on public.drill_queue;
drop policy if exists "drill_queue_update_own_anon" on public.drill_queue;
drop policy if exists "drill_queue_update_own" on public.drill_queue;
create policy "drill_queue_update_own"
on public.drill_queue
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
