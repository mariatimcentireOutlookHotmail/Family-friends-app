-- =============================================================================
-- Social links (Instagram, LinkedIn, Facebook, WhatsApp, WeChat, LINE, ...).
--
-- Stored with the other contact details in person_contacts, so they follow the
-- same "contact" privacy level (private by default) and the same edit rules.
-- Shape: {"instagram": "meitan", "whatsapp": "+62 811 1234", ...}
-- Only known platforms; each value 1–200 characters.
-- Tests: tests/db/socialLinks.test.ts
-- =============================================================================

create function private.valid_social_links(p jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) <= 12
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key not in ('instagram', 'facebook', 'linkedin', 'whatsapp', 'wechat',
                           'line', 'telegram', 'x', 'tiktok', 'website')
          or jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') not between 1 and 200
     );
$$;

alter table public.person_contacts
  add column social jsonb not null default '{}'::jsonb
  constraint person_contacts_social_valid check (private.valid_social_links(social));

-- Same as before, plus social links. Empty values are dropped.
create or replace function private.set_contacts(p_person uuid, p_contacts jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone   text := nullif(trim(p_contacts ->> 'phone'), '');
  v_email   text := nullif(trim(p_contacts ->> 'email'), '');
  v_address text := nullif(trim(p_contacts ->> 'address'), '');
  v_social  jsonb;
begin
  if not private.can_edit_person(p_person) then
    raise exception 'You can''t edit this person' using errcode = 'insufficient_privilege';
  end if;
  if not private.can_see_field(p_person, 'contact') then
    return; -- can't see them, so leave them as they are
  end if;

  select coalesce(jsonb_object_agg(e.key, trim(e.value #>> '{}')), '{}'::jsonb) into v_social
  from jsonb_each(coalesce(p_contacts -> 'social', '{}'::jsonb)) e
  where jsonb_typeof(e.value) = 'string' and trim(e.value #>> '{}') <> '';

  if not private.valid_social_links(v_social) then
    raise exception 'Unknown or too long social link' using errcode = 'check_violation';
  end if;

  if v_phone is null and v_email is null and v_address is null and v_social = '{}'::jsonb then
    delete from public.person_contacts where person_id = p_person;
  else
    insert into public.person_contacts (person_id, phone, email, address, social)
    values (p_person, v_phone, v_email, v_address, v_social)
    on conflict (person_id) do update
      set phone = excluded.phone, email = excluded.email, address = excluded.address,
          social = excluded.social, updated_at = now();
  end if;
end;
$$;

revoke all on function private.valid_social_links(jsonb) from public;
grant execute on function private.valid_social_links(jsonb) to authenticated;
revoke all on function private.set_contacts(uuid, jsonb) from public;
grant execute on function private.set_contacts(uuid, jsonb) to authenticated;
