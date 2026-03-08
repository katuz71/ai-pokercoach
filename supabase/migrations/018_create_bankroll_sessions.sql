create table if not exists public.bankroll_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date timestamptz not null default now(),
  game_type text not null, -- 'Cash', 'MTT', 'Spin'
  buy_in numeric not null default 0,
  cash_out numeric not null default 0,
  profit numeric generated always as (cash_out - buy_in) stored,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.bankroll_sessions enable row level security;

create policy "Users can manage their bankroll" on public.bankroll_sessions
  for all using (auth.uid() = user_id);
