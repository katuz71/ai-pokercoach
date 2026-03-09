-- Add pot_size, villain_bet, hero_stack to hand_library for full scenario data.
alter table public.hand_library
  add column if not exists pot_size numeric,
  add column if not exists villain_bet numeric,
  add column if not exists hero_stack numeric;

comment on column public.hand_library.pot_size is 'Pot size in BB (from task.pot_size or task.pot_bb).';
comment on column public.hand_library.villain_bet is 'Villain bet size in BB.';
comment on column public.hand_library.hero_stack is 'Hero stack in BB.';
