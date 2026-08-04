-- T5.1 — Announcements: post, pin, edit, soft delete.
--
-- The first HUMAN write in the system that is not an account decision (R11).
-- 006 deliberately shipped no insert/update policies and said each write would
-- add its own, scoped to the role allowed to perform it. This is that migration
-- for announcements.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY FUNCTIONS RATHER THAN INSERT/UPDATE POLICIES
--
-- A write policy would let the page insert an announcement directly and then
-- insert its own audit_log row. Two statements, no transaction, and the audit
-- row is written by the same client that could simply not write it.
--
-- R4 says every write is recorded. An audit trail the application can forget to
-- append to — or, with an insert policy on audit_log, forge entries into — is
-- not an audit trail. 015 made this argument for approvals and 017 restated it:
-- one indivisible act, always audited, authority checked in one readable place.
--
-- So audit_log gets NO insert policy here, and never should. Every audited write
-- in this system runs inside a definer function that writes both rows or
-- neither.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- Who may post: leader and co-leader.
--
-- auth_leader_clan_ids() (006) is leader-only and is used by the audit_log
-- policy, where that strictness is right. Announcements are ordinary clan
-- business and co-leaders run those day to day, so this is a separate helper
-- rather than a loosening of the existing one — widening auth_leader_clan_ids()
-- would silently hand co-leaders the audit log too.
-- ---------------------------------------------------------------------------
create or replace function auth_leadership_clan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id
  from public.clan_roles
  where user_id = auth.uid()
    and role in ('leader', 'co-leader')
    and deleted_at is null
$$;

revoke execute on function auth_leadership_clan_ids() from public;
grant execute on function auth_leadership_clan_ids() to authenticated;

comment on function auth_leadership_clan_ids() is
  'Clans where the caller is leader OR co-leader. Distinct from '
  'auth_leader_clan_ids(), which is leader-only and gates the audit log (T9.6).';


-- ---------------------------------------------------------------------------
-- post_announcement — create, and record it.
-- ---------------------------------------------------------------------------
create or replace function post_announcement(
  p_clan   uuid,
  p_title  text,
  p_body   text,
  p_pinned boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null or p_clan is null then
    raise exception 'not signed in';
  end if;

  if p_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may post to this clan';
  end if;

  -- Validated here as well as in the form. A route added later that forgets to
  -- check gets the same answer as one that remembers.
  if p_title is null or btrim(p_title) = '' then
    raise exception 'an announcement needs a title';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'an announcement needs a body';
  end if;
  if length(p_title) > 200 then
    raise exception 'title is too long (200 characters maximum)';
  end if;
  if length(p_body) > 5000 then
    raise exception 'body is too long (5000 characters maximum)';
  end if;

  insert into public.announcements (clan_id, author_id, title, body, pinned)
  values (p_clan, auth.uid(), btrim(p_title), btrim(p_body), coalesce(p_pinned, false))
  returning id into new_id;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), p_clan, 'create', 'announcements', new_id,
          jsonb_build_object('title', btrim(p_title), 'pinned', coalesce(p_pinned, false)));

  return new_id;
end;
$$;

revoke execute on function post_announcement(uuid, text, text, boolean) from public;
grant execute on function post_announcement(uuid, text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- edit_announcement — change it, and record what it was.
--
-- `before` carries the old title and pinned flag, not the old body. The audit
-- table's own comment asks for the changed fields rather than whole entities,
-- and a 5,000-character body copied on every edit would grow audit_log faster
-- than the table it describes. The title is what identifies the post to a
-- reader; that is what a leader needs to see changed.
-- ---------------------------------------------------------------------------
create or replace function edit_announcement(
  p_id     uuid,
  p_title  text,
  p_body   text,
  p_pinned boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_clan   uuid;
  old_title  text;
  old_pinned boolean;
begin
  if auth.uid() is null or p_id is null then
    return false;
  end if;

  select clan_id, title, pinned into row_clan, old_title, old_pinned
  from public.announcements
  where id = p_id and deleted_at is null;

  if not found then
    return false;
  end if;

  if row_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may edit this announcement';
  end if;

  if p_title is null or btrim(p_title) = '' or p_body is null or btrim(p_body) = '' then
    raise exception 'an announcement needs a title and a body';
  end if;
  if length(p_title) > 200 or length(p_body) > 5000 then
    raise exception 'announcement is too long';
  end if;

  update public.announcements
  set title  = btrim(p_title),
      body   = btrim(p_body),
      pinned = coalesce(p_pinned, false)
  where id = p_id;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), row_clan, 'update', 'announcements', p_id,
          jsonb_build_object('title', old_title, 'pinned', old_pinned),
          jsonb_build_object('title', btrim(p_title), 'pinned', coalesce(p_pinned, false)));

  return true;
end;
$$;

revoke execute on function edit_announcement(uuid, text, text, boolean) from public;
grant execute on function edit_announcement(uuid, text, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- remove_announcement — SOFT delete (R4).
--
-- Sets deleted_at. There is no statement anywhere in this project that removes
-- an announcement row, and the audit entry records who hid it. A member asking
-- "what happened to the message about CWL" gets an answer.
-- ---------------------------------------------------------------------------
create or replace function remove_announcement(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_clan  uuid;
  row_title text;
begin
  if auth.uid() is null or p_id is null then
    return false;
  end if;

  select clan_id, title into row_clan, row_title
  from public.announcements
  where id = p_id and deleted_at is null;

  if not found then
    return false;               -- already gone; not an error, and not audited twice
  end if;

  if row_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may remove this announcement';
  end if;

  update public.announcements
  set deleted_at = now()
  where id = p_id;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), row_clan, 'delete', 'announcements', p_id,
          jsonb_build_object('title', row_title));

  return true;
end;
$$;

revoke execute on function remove_announcement(uuid) from public;
grant execute on function remove_announcement(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- as an ordinary member, this must RAISE rather than insert:
--   select post_announcement('<clan>', 'test', 'body');
--
--   -- as a leader, this must return an id AND leave exactly one audit row:
--   select post_announcement('<clan>', 'test', 'body');
--   select count(*) from audit_log where entity = 'announcements';   -- 1
--
--   -- and nothing may write audit_log directly:
--   insert into audit_log (action, entity) values ('x', 'y');  -- permission denied
-- ---------------------------------------------------------------------------
