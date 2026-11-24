-- =============================================================================
-- Invites: a relative claims the profile someone else made for them.
--
--   * Owners and editors invite someone to an unclaimed profile. They get a
--     12-character code (e.g. K7QM-3XPA-9HTD) to share; the database stores
--     only its SHA-256 hash, so a leaked database doesn't leak working codes.
--   * A code works once, expires after 14 days and can be cancelled. Creating
--     a new invite for the same person cancels the old one.
--   * Deceased people, children below their country's age limit and profiles
--     that are already claimed can't be invited.
--   * Accepting (signed in): the profile becomes theirs (claim lock: from then
--     on only they edit its core details) and they join the tree as an editor.
--     Someone who is already an owner or editor keeps their role.
--   * Wrong codes are rate-limited: 10 failed tries per hour per user.
--
-- Everything goes through the functions below; the app can only read invites
-- (owners and editors of the tree, to list and cancel them).
-- Tests: tests/db/invites.test.ts
-- =============================================================================

create type public.invite_status as enum ('pending', 'accepted', 'revoked');

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references public.trees (id) on delete cascade,
  person_id   uuid not null references public.persons (id) on delete cascade,
  inviter_id  uuid references auth.users (id) on delete set null,
  token_hash  text not null unique,
  -- Language of the shared message (the invite screen follows the device).
  lang        text not null default 'en' check (lang in ('en', 'id', 'zh-Hans')),
  status      public.invite_status not null default 'pending',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz
);

create index invites_person_idx on public.invites (person_id);
create index invites_tree_idx on public.invites (tree_id);

alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

create policy "Owners and editors can see their tree's invites"
  on public.invites for select to authenticated
  using (private.can_edit_tree(tree_id));

-- Failed code attempts, for rate limiting. Not reachable from the app.
create table private.invite_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index invite_attempts_user_idx on private.invite_attempts (user_id, at);
revoke all on private.invite_attempts from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- "k7qm 3xpa-9htd" → "K7QM3XPA9HTD"
create function private.normalize_invite_code(p_code text)
returns text
language sql immutable set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function private.hash_invite_code(p_code text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(private.normalize_invite_code(p_code), 'UTF8')), 'hex');
$$;

-- 12 random characters from an alphabet without look-alikes (no 0/O, 1/I/L),
-- about 59 bits. gen_random_uuid() uses the system's secure random source.
create function private.new_invite_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  v_code  text := '';
  i int;
begin
  -- Skip the uuid version/variant bytes (6 and 8), which aren't random.
  for i in 0..13 loop
    continue when i in (6, 8);
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;

-- Why a person can't be invited, or null if they can.
create function private.invite_blocker(p_person_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p.id is null then 'not_found'
    when p.claimed_by_user_id is not null then 'claimed'
    when p.living_status = 'deceased' then 'deceased'
    when private.is_minor(p.id) then 'minor'
  end
  from (select 1) one
  left join public.persons p on p.id = p_person_id;
$$;

-- Stops after 10 wrong codes in an hour.
create function private.check_invite_attempts()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if (select count(*) from private.invite_attempts a
      where a.user_id = v_user and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes; try again later'
      using errcode = 'P0001', hint = 'invite_too_many_tries';
  end if;
end;
$$;

-- The pending, unexpired invite for a code, locked for this transaction.
-- A code that matches nothing returns null (not an error, so the failed
-- attempt is kept for rate limiting). Used, cancelled or expired codes raise.
create function private.find_invite(p_code text)
returns public.invites
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.invites;
begin
  select * into v_invite from public.invites i
  where i.token_hash = private.hash_invite_code(p_code)
  for update;

  if v_invite.id is null then
    insert into private.invite_attempts (user_id) values ((select auth.uid()));
    return null;
  elsif v_invite.status = 'accepted' then
    raise exception 'This invite has already been used'
      using errcode = 'P0001', hint = 'invite_used';
  elsif v_invite.status = 'revoked' then
    raise exception 'This invite was cancelled'
      using errcode = 'P0001', hint = 'invite_revoked';
  elsif v_invite.expires_at <= now() then
    raise exception 'This invite has expired'
      using errcode = 'P0001', hint = 'invite_expired';
  end if;
  return v_invite;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;


-- -----------------------------------------------------------------------------
-- create_invite: returns the code to share (the only time it's visible).
-- -----------------------------------------------------------------------------
create function public.create_invite(p_person uuid, p_lang text default 'en')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_tree    uuid;
  v_blocker text;
  v_code    text;
begin
  select p.tree_id into v_tree from public.persons p where p.id = p_person;
  if v_tree is null or not private.can_edit_tree(v_tree) or private.is_hidden_minor(p_person) then
    raise exception 'Only owners and editors of the tree can invite'
      using errcode = 'insufficient_privilege', hint = 'invite_not_allowed';
  end if;

  v_blocker := private.invite_blocker(p_person);
  if v_blocker is not null then
    raise exception 'This person can''t be invited (%)', v_blocker
      using errcode = 'P0001', hint = 'invite_blocked_' || v_blocker;
  end if;

  -- One open invite per person.
  update public.invites set status = 'revoked'
  where person_id = p_person and status = 'pending';

  v_code := private.new_invite_code();
  insert into public.invites (tree_id, person_id, inviter_id, token_hash, lang)
  values (v_tree, p_person, (select auth.uid()), private.hash_invite_code(v_code),
          coalesce(p_lang, 'en'));
  return v_code;
end;
$$;


-- -----------------------------------------------------------------------------
-- invite_preview: what the invitee sees before tapping "This is me".
-- -----------------------------------------------------------------------------
create function public.invite_preview(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_invite public.invites;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_invite_attempts();
  v_invite := private.find_invite(p_code);
  if v_invite.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'treeName', (select t.name from public.trees t where t.id = v_invite.tree_id),
    'personName', (select n.full_display from public.person_names n
                   where n.person_id = v_invite.person_id and n.is_primary),
    'inviterName', (select n.full_display from public.persons p
                    join public.person_names n on n.person_id = p.id and n.is_primary
                    where p.tree_id = v_invite.tree_id and p.claimed_by_user_id = v_invite.inviter_id),
    'expiresAt', v_invite.expires_at,
    'alreadyInTree', exists (select 1 from public.persons p
                             where p.tree_id = v_invite.tree_id
                               and p.claimed_by_user_id = (select auth.uid()))
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- accept_invite: claims the profile. Returns the person's id, or null for a
-- code that matches no invite.
-- -----------------------------------------------------------------------------
create function public.accept_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_invite  public.invites;
  v_blocker text;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_invite_attempts();
  v_invite := private.find_invite(p_code);
  if v_invite.id is null then
    return null; -- wrong code
  end if;

  -- Things may have changed since the invite was sent.
  v_blocker := private.invite_blocker(v_invite.person_id);
  if v_blocker is not null then
    raise exception 'This profile can''t be claimed (%)', v_blocker
      using errcode = 'P0001', hint = 'invite_blocked_' || v_blocker;
  end if;
  if exists (select 1 from public.persons p
             where p.tree_id = v_invite.tree_id and p.claimed_by_user_id = v_user) then
    raise exception 'You already have a profile in this tree'
      using errcode = 'P0001', hint = 'invite_already_in_tree';
  end if;

  update public.persons set claimed_by_user_id = v_user where id = v_invite.person_id;

  insert into public.tree_members (tree_id, user_id, role)
  values (v_invite.tree_id, v_user, 'editor')
  on conflict (tree_id, user_id) do update
    set role = 'editor'
    where public.tree_members.role = 'viewer';

  update public.invites
  set status = 'accepted', accepted_by = v_user, accepted_at = now()
  where id = v_invite.id;

  return v_invite.person_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- revoke_invite: owners and editors can cancel an open invite.
-- -----------------------------------------------------------------------------
create function public.revoke_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.invites i set status = 'revoked'
  where i.id = p_invite and i.status = 'pending' and private.can_edit_tree(i.tree_id);
  if not found then
    raise exception 'Invite not found' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.create_invite(uuid, text) from public, anon;
revoke all on function public.invite_preview(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
