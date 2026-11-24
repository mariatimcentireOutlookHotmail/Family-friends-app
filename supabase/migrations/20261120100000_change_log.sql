-- =============================================================================
-- Change log ("History") and undo.
--
--   * Triggers record every change to people, names, life dates, contacts and
--     links: before/after as JSON, who did it and when. One database
--     transaction (one save in the app) = one group (txid), shown as one
--     entry and undone together.
--   * Deleting a person or a life date also snapshots what is deleted with it
--     (names, dates, contacts, links), so undo can bring it all back.
--     Rows removed by such a cascade aren't logged separately.
--   * Nobody reads the table directly. tree_history() returns what the viewer
--     may see: no hidden minors, and contacts / day-and-month only for those
--     allowed to see them.
--   * undo_change() is for tree owners. It refuses when the rows have changed
--     since (so it never overwrites newer work) and on profiles claimed by
--     someone else (their claim lock). An undo is itself logged, so it can be
--     undone too.
-- Tests: tests/db/changeLog.test.ts
-- =============================================================================

create table public.change_log (
  id         bigint generated always as identity primary key,
  tree_id    uuid not null references public.trees (id) on delete cascade,
  -- The group: the database transaction. (Tests, which run everything in one
  -- transaction, set myorbit.change_group to tell their steps apart.)
  txid       bigint not null
             default coalesce(nullif(current_setting('myorbit.change_group', true), '')::bigint, txid_current()),
  -- The person the change is about (null for links between two people).
  person_id  uuid,
  table_name text not null,
  op         text not null check (op in ('insert', 'update', 'delete')),
  row_id     uuid not null,
  before     jsonb,
  after      jsonb,
  actor      uuid references auth.users (id) on delete set null,
  at         timestamptz not null default now(),
  -- Set on the entries of a group that was undone, and on the undo's entries.
  undone_at  timestamptz,
  undone_by  uuid references auth.users (id) on delete set null,
  undo_of    bigint
);
create index change_log_tree_idx on public.change_log (tree_id, txid desc);
create index change_log_person_idx on public.change_log (person_id);

alter table public.change_log enable row level security;
revoke all on public.change_log from anon, authenticated;
-- No policies: only the functions below (security definer) read and write it.


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Primary key column of each logged table.
create function private.log_pk(p_table text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_table
    when 'event_dates' then 'event_id'
    when 'person_contacts' then 'person_id'
    else 'id'
  end;
$$;

-- A row without its timestamps, for comparing.
create function private.log_strip(p jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select p - 'created_at' - 'updated_at';
$$;

-- What a deleted life date takes with it.
create function private.event_snapshot(p_event uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(e) || jsonb_build_object(
    'dates', (select to_jsonb(d) from public.event_dates d where d.event_id = e.id))
  from public.events e where e.id = p_event;
$$;

-- What a deleted person takes with them.
create function private.person_snapshot(p_person uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(p) || jsonb_build_object(
    'names', coalesce((select jsonb_agg(to_jsonb(n)) from public.person_names n where n.person_id = p.id), '[]'),
    'events', coalesce((select jsonb_agg(private.event_snapshot(e.id)) from public.events e where e.person_id = p.id), '[]'),
    'contacts', (select to_jsonb(c) from public.person_contacts c where c.person_id = p.id),
    'relationships', coalesce((select jsonb_agg(to_jsonb(r)) from public.relationships r
                               where r.person_a = p.id or r.person_b = p.id), '[]')
  )
  from public.persons p where p.id = p_person;
$$;


-- -----------------------------------------------------------------------------
-- The logging trigger (one function for all logged tables)
-- -----------------------------------------------------------------------------
-- Records one row change. Called by the triggers below.
create function private.record_change(p_table text, p_op text, p_old jsonb, p_new jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_old    jsonb := p_old;
  v_row    jsonb := coalesce(p_new, p_old);
  v_person uuid;
  v_tree   uuid;
  v_event  uuid;
begin
  -- Saving without changing anything isn't a change.
  if p_op = 'update' and private.log_strip(p_old) = private.log_strip(p_new) then
    return;
  end if;

  case p_table
    when 'persons' then
      v_person := (v_row ->> 'id')::uuid;
      v_tree := (v_row ->> 'tree_id')::uuid;
      if p_op = 'delete' then
        v_old := private.person_snapshot(v_person); -- (BEFORE trigger: still there)
      end if;
    when 'relationships' then
      v_tree := (v_row ->> 'tree_id')::uuid;
      -- Removed because one of the two people was deleted: part of that snapshot.
      if p_op = 'delete' and (
        not exists (select 1 from public.persons p where p.id = (v_row ->> 'person_a')::uuid)
        or not exists (select 1 from public.persons p where p.id = (v_row ->> 'person_b')::uuid)) then
        return;
      end if;
    when 'event_dates' then
      v_event := (v_row ->> 'event_id')::uuid;
      select e.person_id into v_person from public.events e where e.id = v_event;
    else -- person_names, events, person_contacts
      v_person := (v_row ->> 'person_id')::uuid;
      if p_table = 'events' and p_op = 'delete' then
        v_old := private.event_snapshot((v_row ->> 'id')::uuid); -- (BEFORE trigger)
      end if;
  end case;

  if v_tree is null then
    select p.tree_id into v_tree from public.persons p where p.id = v_person;
  end if;
  -- Parent already gone: this row went with it and is in its snapshot.
  -- (Also skips everything when a whole tree is being deleted.)
  if v_tree is null or not exists (select 1 from public.trees t where t.id = v_tree) then
    return;
  end if;

  insert into public.change_log (tree_id, person_id, table_name, op, row_id, before, after, actor, undo_of)
  values (
    v_tree, v_person, p_table, p_op,
    (v_row ->> private.log_pk(p_table))::uuid,
    v_old, p_new, (select auth.uid()),
    nullif(current_setting('myorbit.undo_of', true), '')::bigint
  );
end;
$$;

create function private.log_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.record_change(
    tg_table_name, lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;

-- For deletes logged BEFORE the row goes (must return it, or nothing is deleted).
create function private.log_delete_before()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.record_change(tg_table_name, 'delete', to_jsonb(old), null);
  return old;
end;
$$;

-- Deleting a person or a life date is logged BEFORE the delete, so the
-- snapshot can still read what goes with it.
create trigger persons_log_change after insert or update on public.persons
  for each row execute function private.log_change();
create trigger persons_log_delete before delete on public.persons
  for each row execute function private.log_delete_before();
create trigger person_names_log_change after insert or update or delete on public.person_names
  for each row execute function private.log_change();
create trigger events_log_change after insert or update on public.events
  for each row execute function private.log_change();
create trigger events_log_delete before delete on public.events
  for each row execute function private.log_delete_before();
create trigger event_dates_log_change after insert or update or delete on public.event_dates
  for each row execute function private.log_change();
create trigger person_contacts_log_change after insert or update or delete on public.person_contacts
  for each row execute function private.log_change();
create trigger relationships_log_change after insert or update or delete on public.relationships
  for each row execute function private.log_change();

-- -----------------------------------------------------------------------------
-- Undo helpers
-- -----------------------------------------------------------------------------

-- The current row, without timestamps, or null if it doesn't exist.
create function private.current_row(p_table text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, private.log_pk(p_table))
    into v using p_id;
  return private.log_strip(v);
end;
$$;

-- Insert a row from its JSON (columns missing from the JSON get defaults).
create function private.restore_insert(p_table text, p_row jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and p_row ? c.column_name;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                 p_table, v_cols, v_cols, p_table)
    using p_row;
end;
$$;

-- Put a row's values back (not its key, owner, tree or claim).
create function private.restore_update(p_table text, p_row jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_pk   text := private.log_pk(p_table);
  v_cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and p_row ? c.column_name
    and c.column_name not in (v_pk, 'created_at', 'updated_at', 'created_by', 'tree_id',
                              'claimed_by_user_id', 'person_id', 'person_a', 'person_b', 'event_id');
  if v_cols is null then
    return;
  end if;
  execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.%I = $2',
                 p_table, v_cols, v_cols, p_table, v_pk)
    using p_row, (p_row ->> v_pk)::uuid;
end;
$$;

-- Bring back a deleted life date with its day and month.
create function private.restore_event(p_snapshot jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.restore_insert('events', p_snapshot - 'dates');
  if jsonb_typeof(p_snapshot -> 'dates') = 'object' then
    perform private.restore_insert('event_dates', p_snapshot -> 'dates');
  end if;
end;
$$;

-- Bring back a deleted person with everything that went with them. Links to
-- people who no longer exist are skipped.
create function private.restore_person(p_snapshot jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.restore_insert('persons',
    p_snapshot - 'names' - 'events' - 'contacts' - 'relationships' - 'claimed_by_user_id');
  for v in select value from jsonb_array_elements(p_snapshot -> 'names') loop
    perform private.restore_insert('person_names', v);
  end loop;
  for v in select value from jsonb_array_elements(p_snapshot -> 'events') loop
    perform private.restore_event(v);
  end loop;
  if jsonb_typeof(p_snapshot -> 'contacts') = 'object' then
    perform private.restore_insert('person_contacts', p_snapshot -> 'contacts');
  end if;
  for v in select value from jsonb_array_elements(p_snapshot -> 'relationships') loop
    if exists (select 1 from public.persons p where p.id = (v ->> 'person_a')::uuid)
       and exists (select 1 from public.persons p where p.id = (v ->> 'person_b')::uuid)
       and not exists (select 1 from public.relationships r where r.id = (v ->> 'id')::uuid) then
      perform private.restore_insert('relationships', v);
    end if;
  end loop;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- undo_change: undo one group (one save). Owners only.
-- -----------------------------------------------------------------------------
create function public.undo_change(p_tree uuid, p_txid bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e        public.change_log;
  v_user   uuid := (select auth.uid());
  v_now    jsonb;
  v_count  int := 0;
begin
  if not private.is_tree_owner(p_tree) then
    raise exception 'Only tree owners can undo changes'
      using errcode = 'insufficient_privilege', hint = 'history_not_allowed';
  end if;

  -- Check everything first, then change anything.
  for e in select * from public.change_log l
           where l.tree_id = p_tree and l.txid = p_txid order by l.id desc
  loop
    v_count := v_count + 1;
    if e.undone_at is not null then
      raise exception 'Already undone' using errcode = 'P0001', hint = 'history_already_undone';
    end if;
    -- The claim lock: a claimed profile is only changed by its owner.
    if e.person_id is not null and exists (
         select 1 from public.persons p
         where p.id = e.person_id and p.claimed_by_user_id is not null and p.claimed_by_user_id <> v_user) then
      raise exception 'This profile belongs to someone else' using errcode = 'P0001', hint = 'history_claimed';
    end if;

    v_now := private.current_row(e.table_name, e.row_id);
    if e.op = 'delete' then
      if v_now is not null then
        raise exception 'Changed since' using errcode = 'P0001', hint = 'history_conflict';
      end if;
    elsif v_now is distinct from private.log_strip(e.after) then
      raise exception 'Changed since' using errcode = 'P0001', hint = 'history_conflict';
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'Change not found' using errcode = 'no_data_found';
  end if;

  -- The undo's own entries point back to this group.
  perform set_config('myorbit.undo_of', p_txid::text, true);

  for e in select * from public.change_log l
           where l.tree_id = p_tree and l.txid = p_txid order by l.id desc
  loop
    if e.op = 'insert' then
      execute format('delete from public.%I t where t.%I = $1', e.table_name, private.log_pk(e.table_name))
        using e.row_id;
    elsif e.op = 'update' then
      perform private.restore_update(e.table_name, e.before);
    elsif e.table_name = 'persons' then
      perform private.restore_person(e.before);
    elsif e.table_name = 'events' then
      perform private.restore_event(e.before);
    else
      perform private.restore_insert(e.table_name, e.before);
    end if;
  end loop;

  perform set_config('myorbit.undo_of', '', true);

  update public.change_log
  set undone_at = now(), undone_by = v_user
  where tree_id = p_tree and txid = p_txid;
end;
$$;


-- -----------------------------------------------------------------------------
-- tree_history: recent changes the viewer may see, newest first, grouped.
-- p_person: only changes about this person (and their links).
-- p_before: for "show more", the txid of the oldest group already shown.
-- -----------------------------------------------------------------------------
create function public.tree_history(
  p_tree   uuid,
  p_person uuid default null,
  p_before bigint default null,
  p_limit  int default 30
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_owner boolean := private.is_tree_owner(p_tree);
  v_out   jsonb;
begin
  if not private.is_tree_member(p_tree) then
    raise exception 'Not a member of this tree' using errcode = 'insufficient_privilege';
  end if;

  with visible as (
    select l.*,
      -- Deleted people: leave out contacts and day/month from the snapshot.
      case when l.table_name = 'persons' and l.op = 'delete'
        then l.before - 'contacts' || jsonb_build_object('events',
               coalesce((select jsonb_agg(ev - 'dates') from jsonb_array_elements(l.before -> 'events') ev), '[]'))
        when l.table_name = 'events' and l.op = 'delete' and not private.can_see_field(l.person_id,
               case when l.before ->> 'type' = 'death' then 'death_date' else 'birth_date' end::public.privacy_field)
        then l.before - 'dates'
        else l.before end as shown_before
    from public.change_log l
    where l.tree_id = p_tree
      and (p_before is null or l.txid < p_before)
      and (p_person is null
           or l.person_id = p_person
           or (l.table_name = 'relationships'
               and p_person::text in (coalesce(l.after, l.before) ->> 'person_a',
                                      coalesce(l.after, l.before) ->> 'person_b')))
      -- Hidden minors: nothing about them.
      and not (l.person_id is not null
               and exists (select 1 from public.persons p where p.id = l.person_id)
               and private.is_hidden_minor(l.person_id))
      -- Contacts: only for those who may see them (and not for deleted people).
      and not (l.table_name = 'person_contacts'
               and (not exists (select 1 from public.persons p where p.id = l.person_id)
                    or not private.can_see_field(l.person_id, 'contact')))
      -- Day and month: only for those who may see them.
      and not (l.table_name = 'event_dates'
               and not exists (
                 select 1 from public.events ev
                 where ev.id = l.row_id
                   and private.can_see_field(ev.person_id,
                         case when ev.type = 'death' then 'death_date' else 'birth_date' end::public.privacy_field)))
  ),
  groups as (
    select v.txid,
           min(v.at) as at,
           (array_agg(v.actor order by v.id))[1] as actor,
           max(v.undone_at) as undone_at,
           max(v.undo_of) as undo_of,
           jsonb_agg(jsonb_build_object(
             'id', v.id, 'table', v.table_name, 'op', v.op, 'personId', v.person_id,
             'rowId', v.row_id, 'before', v.shown_before, 'after', v.after) order by v.id) as entries
    from visible v
    group by v.txid
    order by v.txid desc
    limit greatest(1, least(p_limit, 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'txid', g.txid,
           'at', g.at,
           'actorId', g.actor,
           'actorName', (select n.full_display from public.persons p
                         join public.person_names n on n.person_id = p.id and n.is_primary
                         where p.tree_id = p_tree and p.claimed_by_user_id = g.actor),
           'undoneAt', g.undone_at,
           'undoOf', g.undo_of,
           'canUndo', v_owner and g.undone_at is null,
           'entries', g.entries) order by g.txid desc), '[]')
  into v_out
  from groups g;

  return v_out;
end;
$$;

revoke all on function public.undo_change(uuid, bigint) from public, anon;
revoke all on function public.tree_history(uuid, uuid, bigint, int) from public, anon;
grant execute on function public.undo_change(uuid, bigint) to authenticated;
grant execute on function public.tree_history(uuid, uuid, bigint, int) to authenticated;
