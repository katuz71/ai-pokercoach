-- Add hero_hand_rank column for storing Claude's or solver's hand rank description.
alter table public.hand_library
  add column if not exists hero_hand_rank text;

comment on column public.hand_library.hero_hand_rank is 'Best hand rank on current street (e.g. from Claude or pokersolver).';
