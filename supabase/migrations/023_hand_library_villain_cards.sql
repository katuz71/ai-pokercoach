-- Add villain_cards column (array of card strings, stored as jsonb).
alter table public.hand_library
  add column if not exists villain_cards jsonb default '[]'::jsonb;

comment on column public.hand_library.villain_cards is 'Villain hole cards as array of strings, e.g. ["As", "Kh"].';
