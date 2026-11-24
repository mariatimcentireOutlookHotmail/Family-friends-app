-- =============================================================================
-- Birthdays: day and month of living people the caller may see.
--
-- Runs with the caller's rights (security invoker), so the existing rules do
-- all the work: only trees they belong to, never hidden children, and the
-- day/month only where that person's birth-date privacy level allows it.
-- The app works out the next birthday, the age and the phone reminders.
-- Tests: tests/db/birthdays.test.ts
-- =============================================================================

create function public.my_birthdays()
returns table (person_id uuid, tree_id uuid, month smallint, day smallint, year smallint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.tree_id, d.month, d.day, e.year
  from public.events e
  join public.event_dates d on d.event_id = e.id
  join public.persons p on p.id = e.person_id
  where e.type = 'birth'
    and d.day is not null
    and p.living_status <> 'deceased';
$$;

revoke all on function public.my_birthdays() from public, anon;
grant execute on function public.my_birthdays() to authenticated;
