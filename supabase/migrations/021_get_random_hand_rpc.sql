-- RPC: возвращает одну случайную раздачу из hand_library для экрана тренировки.
create or replace function public.get_random_hand()
returns setof public.hand_library
language sql
stable
security definer
set search_path = public
as $$
  select * from public.hand_library order by random() limit 1;
$$;

comment on function public.get_random_hand() is 'Returns one random row from hand_library for table drill training.';
