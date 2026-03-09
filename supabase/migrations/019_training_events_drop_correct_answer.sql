-- Drop wrong column correct_answer if it was added by a previous version of 014 (table already has correct_action from 005)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'training_events' and column_name = 'correct_answer'
  ) then
    alter table training_events drop column correct_answer;
  end if;
end $$;
