-- =============================================================================
-- Linked trees: the same person in two families' trees.
--
--   * Both owners agree. An owner of tree A makes a link code for one of their
--     people (12 characters, hashed, single-use, 14 days, like invite codes).
--     An owner of tree B enters it and picks the same person in their tree.
--   * Each family keeps its own tree. Members of either tree see, on that
--     person's page, the other family's version of them and their close
--     family: parents, partners, children and siblings. Names and years only;
--     never contacts or full dates, and never children under the age limit.
--   * An owner of either tree can unlink at any time. Linking and unlinking
--     appear in both trees' History (not undoable: a link needs both sides).
--   * Minors and deceased-only rules: a child below the age limit can't be
--     linked.
-- Tests: tests/db/treeLinks.test.ts
-- =============================================================================

create type public.link_request_status as enum ('pending', 'accepted', 'revoked');

create table public.link_requests (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.trees (id) on delete cascade,
  person_id   uuid not null references public.persons (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  token_hash  text not null unique,
  lang        text not null default 'en' check (lang in ('en', 'id', 'zh-Hans')),
  status      public.link_request_status not null default 'pending',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days'
);
create index link_requests_person_idx on public.link_requests (person_id);

create table public.tree_links (
  id          uuid primary key default gen_random_uuid(),
  person_a    uuid not null references public.persons (id) on delete cascade,
  tree_a      uuid not null references public.trees (id) on delete cascade,
  person_b    uuid not null references public.persons (id) on delete cascade,
  tree_b      uuid not null references public.trees (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null, -- made the code
  accepted_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint tree_links_two_trees check (tree_a <> tree_b),
  -- One link per person per other tree.
  unique (person_a, tree_b),
  unique (person_b, tree_a)
);
create index tree_links_a_idx on public.tree_links (person_a);
create index tree_links_b_idx on public.tree_links (person_b);

-- Everything goes through the functions below.
alter table public.link_requests enable row level security;
alter table public.tree_links enable row level security;
revoke all on public.link_requests, public.tree_links from anon, authenticated;


-- -----------------------------------------------------------------------------
-- What the other family sees
-- -----------------------------------------------------------------------------

-- Name, nickname, sex and years of one person, or null for a minor.
create function private.person_card(p_person uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when private.is_minor(p.id) then null else jsonb_build_object(
    'id', p.id,
    'sex', p.sex,
    'living', p.living_status,
    'name', (select n.full_display from public.person_names n where n.person_id = p.id and n.is_primary),
    'nickname', (select n.full_display from public.person_names n
                 where n.person_id = p.id and n.type = 'nickname' and not n.is_primary
                 order by n.created_at limit 1),
    'birthYear', (select e.year from public.events e where e.person_id = p.id and e.type = 'birth'),
    'deathYear', (select e.year from public.events e where e.person_id = p.id and e.type = 'death')
  ) end
  from public.persons p where p.id = p_person;
$$;

-- Parents, partners, children and siblings (also via a shared parent).
create function private.close_family(p_person uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with fam as (
    select r.person_a as id, 'parent' as relation from public.relationships r
      where r.type = 'parent' and r.person_b = p_person
    union
    select r.person_b, 'child' from public.relationships r
      where r.type = 'parent' and r.person_a = p_person
    union
    select case when r.person_a = p_person then r.person_b else r.person_a end, 'partner'
      from public.relationships r
      where r.type = 'partner' and p_person in (r.person_a, r.person_b)
    union
    select case when r.person_a = p_person then r.person_b else r.person_a end, 'sibling'
      from public.relationships r
      where r.type = 'sibling' and p_person in (r.person_a, r.person_b)
    union
    select r2.person_b, 'sibling' from public.relationships r1
      join public.relationships r2 on r2.person_a = r1.person_a and r2.type = 'parent'
      where r1.type = 'parent' and r1.person_b = p_person and r2.person_b <> p_person
  )
  select coalesce(jsonb_agg(card || jsonb_build_object('relation', f.relation)
                            order by f.relation, card ->> 'birthYear'), '[]')
  from (select distinct on (id) id, relation from fam order by id, relation) f
  cross join lateral private.person_card(f.id) card
  where card is not null;
$$;


-- -----------------------------------------------------------------------------
-- create_link_code: an owner asks to link one of their people.
-- -----------------------------------------------------------------------------
create function public.create_link_code(p_person uuid, p_lang text default 'en')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_tree uuid;
  v_code text;
begin
  select p.tree_id into v_tree from public.persons p where p.id = p_person;
  if v_tree is null or not private.is_tree_owner(v_tree) then
    raise exception 'Only tree owners can link trees'
      using errcode = 'insufficient_privilege', hint = 'link_not_allowed';
  end if;
  if private.is_minor(p_person) then
    raise exception 'Children below the age limit can''t be linked'
      using errcode = 'P0001', hint = 'link_minor';
  end if;

  update public.link_requests set status = 'revoked'
  where person_id = p_person and status = 'pending';

  v_code := private.new_invite_code();
  insert into public.link_requests (tree_id, person_id, created_by, token_hash, lang)
  values (v_tree, p_person, (select auth.uid()), private.hash_invite_code(v_code), coalesce(p_lang, 'en'));
  return v_code;
end;
$$;

-- The pending link request for a code (locked), or null after recording a
-- failed attempt. Used, cancelled or expired codes raise.
create function private.find_link_request(p_code text)
returns public.link_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v public.link_requests;
begin
  select * into v from public.link_requests r
  where r.token_hash = private.hash_invite_code(p_code)
  for update;
  if v.id is null then
    return null;
  elsif v.status = 'accepted' then
    raise exception 'Already used' using errcode = 'P0001', hint = 'invite_used';
  elsif v.status = 'revoked' then
    raise exception 'Cancelled' using errcode = 'P0001', hint = 'invite_revoked';
  elsif v.expires_at <= now() then
    raise exception 'Expired' using errcode = 'P0001', hint = 'invite_expired';
  end if;
  return v;
end;
$$;


-- -----------------------------------------------------------------------------
-- code_preview: what a typed code is (an invite or a link request).
-- One wrong code = one failed attempt (rate limit shared with invites).
-- -----------------------------------------------------------------------------
create function public.code_preview(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text := private.hash_invite_code(p_code);
  v_req  public.link_requests;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_invite_attempts();

  if exists (select 1 from public.invites i where i.token_hash = v_hash) then
    return jsonb_build_object('kind', 'invite') || public.invite_preview(p_code);
  end if;

  v_req := private.find_link_request(p_code);
  if v_req.id is null then
    insert into private.invite_attempts (user_id) values (v_user);
    return jsonb_build_object('kind', 'invalid', 'status', 'invalid');
  end if;

  return jsonb_build_object(
    'kind', 'link',
    'status', 'ok',
    'treeId', v_req.tree_id,
    'treeName', (select t.name from public.trees t where t.id = v_req.tree_id),
    'person', private.person_card(v_req.person_id),
    'requesterName', (select n.full_display from public.persons p
                      join public.person_names n on n.person_id = p.id and n.is_primary
                      where p.tree_id = v_req.tree_id and p.claimed_by_user_id = v_req.created_by),
    -- Trees the caller owns where the other side of the link could be.
    'myTrees', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.created_at)
                         from public.trees t
                         join public.tree_members m on m.tree_id = t.id and m.user_id = v_user and m.role = 'owner'
                         where t.id <> v_req.tree_id), '[]')
  );
end;
$$;


-- Writes a linking/unlinking entry into a tree's History.
create function private.log_tree_link(p_tree uuid, p_person uuid, p_link uuid, p_op text,
                                      p_other_tree uuid, p_other_person uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.change_log (tree_id, person_id, table_name, op, row_id, before, after, actor)
  select p_tree, p_person, 'tree_links', p_op, p_link,
         case when p_op = 'delete' then x end,
         case when p_op = 'insert' then x end,
         (select auth.uid())
  from (select jsonb_build_object(
          'otherTree', (select t.name from public.trees t where t.id = p_other_tree),
          'otherPerson', (select n.full_display from public.person_names n
                          where n.person_id = p_other_person and n.is_primary)) as x) s;
$$;


-- -----------------------------------------------------------------------------
-- accept_link: the other tree's owner says which of their people it is.
-- Returns the link id, or null for a code that matches nothing.
-- -----------------------------------------------------------------------------
create function public.accept_link(p_code text, p_person uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_req  public.link_requests;
  v_tree uuid;
  v_link uuid;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_invite_attempts();
  v_req := private.find_link_request(p_code);
  if v_req.id is null then
    insert into private.invite_attempts (user_id) values (v_user);
    return null;
  end if;

  select p.tree_id into v_tree from public.persons p where p.id = p_person;
  if v_tree is null or not private.is_tree_owner(v_tree) then
    raise exception 'Only an owner of the other tree can accept'
      using errcode = 'insufficient_privilege', hint = 'link_not_allowed';
  end if;
  if v_tree = v_req.tree_id then
    raise exception 'Pick someone in a different tree' using errcode = 'P0001', hint = 'link_same_tree';
  end if;
  if private.is_minor(p_person) or private.is_minor(v_req.person_id) then
    raise exception 'Children below the age limit can''t be linked' using errcode = 'P0001', hint = 'link_minor';
  end if;
  if exists (select 1 from public.tree_links l
             where (l.person_a = v_req.person_id and l.tree_b = v_tree)
                or (l.person_b = p_person and l.tree_a = v_req.tree_id)
                or (l.person_a = p_person and l.tree_b = v_req.tree_id)
                or (l.person_b = v_req.person_id and l.tree_a = v_tree)) then
    raise exception 'Already linked' using errcode = 'P0001', hint = 'link_exists';
  end if;

  insert into public.tree_links (person_a, tree_a, person_b, tree_b, created_by, accepted_by)
  values (v_req.person_id, v_req.tree_id, p_person, v_tree, v_req.created_by, v_user)
  returning id into v_link;

  update public.link_requests set status = 'accepted' where id = v_req.id;

  perform private.log_tree_link(v_req.tree_id, v_req.person_id, v_link, 'insert', v_tree, p_person);
  perform private.log_tree_link(v_tree, p_person, v_link, 'insert', v_req.tree_id, v_req.person_id);
  return v_link;
end;
$$;


-- -----------------------------------------------------------------------------
-- unlink_trees: an owner of either tree removes a link.
-- -----------------------------------------------------------------------------
create function public.unlink_trees(p_link uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.tree_links;
begin
  select * into l from public.tree_links where id = p_link;
  if l.id is null or not (private.is_tree_owner(l.tree_a) or private.is_tree_owner(l.tree_b)) then
    raise exception 'Only an owner of either tree can unlink'
      using errcode = 'insufficient_privilege', hint = 'link_not_allowed';
  end if;
  perform private.log_tree_link(l.tree_a, l.person_a, l.id, 'delete', l.tree_b, l.person_b);
  perform private.log_tree_link(l.tree_b, l.person_b, l.id, 'delete', l.tree_a, l.person_a);
  delete from public.tree_links where id = p_link;
end;
$$;


-- -----------------------------------------------------------------------------
-- person_links: the other families' version of a person, with close family.
-- -----------------------------------------------------------------------------
create function public.person_links(p_person uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tree uuid;
begin
  select p.tree_id into v_tree from public.persons p where p.id = p_person;
  if v_tree is null or not private.can_view_person(p_person) or private.is_hidden_minor(p_person) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'linkId', x.id,
             'treeName', (select t.name from public.trees t where t.id = x.other_tree),
             'person', private.person_card(x.other_person),
             'family', private.close_family(x.other_person),
             'canUnlink', private.is_tree_owner(v_tree)
           ) order by x.created_at)
    from (
      select l.id, l.created_at, l.tree_b as other_tree, l.person_b as other_person
        from public.tree_links l where l.person_a = p_person
      union all
      select l.id, l.created_at, l.tree_a, l.person_a
        from public.tree_links l where l.person_b = p_person
    ) x
  ), '[]'::jsonb);
end;
$$;

-- An open link code for a person (for "code sent, cancel?").
create function public.pending_link_code(p_person uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'expiresAt', r.expires_at)
  from public.link_requests r
  join public.persons p on p.id = r.person_id
  where r.person_id = p_person and r.status = 'pending' and r.expires_at > now()
    and private.is_tree_owner(p.tree_id)
  order by r.created_at desc limit 1;
$$;

create function public.revoke_link_code(p_request uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.link_requests r set status = 'revoked'
  where r.id = p_request and r.status = 'pending' and private.is_tree_owner(r.tree_id);
  if not found then
    raise exception 'Not found' using errcode = 'no_data_found';
  end if;
end;
$$;


-- Linking and unlinking need both families, so History can't undo them.
create or replace function private.group_has_tree_link(p_tree uuid, p_txid bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.change_log l
                 where l.tree_id = p_tree and l.txid = p_txid and l.table_name = 'tree_links');
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- Same as in the change-log migration, plus: groups that link or unlink trees
-- can't be undone (they need both families).
create or replace function public.undo_change(p_tree uuid, p_txid bigint)
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

  if private.group_has_tree_link(p_tree, p_txid) then
    raise exception 'Linking trees can''t be undone here'
      using errcode = 'P0001', hint = 'history_not_undoable';
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

create or replace function public.tree_history(
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
           'canUndo', v_owner and g.undone_at is null and not private.group_has_tree_link(p_tree, g.txid),
           'entries', g.entries) order by g.txid desc), '[]')
  into v_out
  from groups g;

  return v_out;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_link_code(uuid, text)', 'code_preview(text)', 'accept_link(text, uuid)',
    'unlink_trees(uuid)', 'person_links(uuid)', 'pending_link_code(uuid)', 'revoke_link_code(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
