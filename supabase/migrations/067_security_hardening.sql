-- 067 — Security findings from the QA audit of October 2026.
--
-- Six separate things, each small, none depending on the others. Replaces
-- remove_account (039), claim_push_subscription (056) and approve_account (046).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TRUNCATE, TRIGGER AND REFERENCES.
--
-- Supabase's default privileges grant everything on a new table, and 006 and its
-- successors only ever took back what they named. Production showed anon and
-- authenticated still holding all three on every table in public. TRUNCATE
-- matters most: RLS does not apply to it, and R4 is why 014 withholds DELETE even
-- from service_role. PostgREST exposes no TRUNCATE, so this was a latent hole
-- rather than an open door, but nothing in this project truncates anything, so
-- nothing should be able to. The default-privileges half covers tables to come.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated, service_role;

alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. remove_account — a leader's reach ends at their own clan.
--
-- auth_may_administer_account() answers "is this person in a clan I lead", and
-- 039 took that as enough to remove the whole account: status, every clan role,
-- everywhere. So the leader of clan A could remove a fellow leader of A, and could
-- strip someone's leadership of clan B by way of a membership in A. 044 says only
-- the platform admin removes a leader; this makes removal say the same.
--
-- Raised by name rather than returned as false, as 039 does for the platform
-- admin: reaching this line already required authority over the account, so
-- nothing leaks, and a silent false would read as a permissions fault.
--
-- The rest of the function is 039's, unchanged.

create or replace function remove_account(p_target uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority   uuid;
  target_row  record;
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then
    return false;
  end if;

  -- Authority first: see 039. A caller with none learns nothing except false.
  if not public.auth_may_administer_account(p_target) then
    return false;
  end if;

  select id, is_platform_admin, deleted_at
    into target_row
  from public.users
  where id = p_target;

  if not found or target_row.deleted_at is not null then
    return false;
  end if;

  if target_row.is_platform_admin then
    raise exception 'the platform admin account cannot be removed';
  end if;

  if not public.auth_is_platform_admin() then
    if exists (
      select 1 from public.clan_roles cr
      where cr.user_id = p_target and cr.deleted_at is null and cr.role = 'leader'
    ) then
      raise exception 'only the platform admin can remove a clan leader';
    end if;

    if exists (
      select 1 from public.clan_roles cr
      where cr.user_id = p_target
        and cr.deleted_at is null
        and cr.clan_id not in (select public.auth_leader_clan_ids())
    ) then
      raise exception 'this account also belongs to a clan you do not lead';
    end if;
  end if;

  -- Resolved BEFORE the roles are retired, or the audit row lands with no clan
  -- and becomes invisible to every leader of the clan it concerns.
  select cr.clan_id into authority
  from public.clan_roles cr
  where cr.user_id = p_target
    and cr.deleted_at is null
    and cr.clan_id in (select public.auth_leader_clan_ids())
  order by cr.clan_id
  limit 1;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status     = 'rejected',
      deleted_at = now()
  where id = p_target;

  update public.clan_roles
  set deleted_at = now()
  where user_id = p_target
    and deleted_at is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), authority, 'remove', 'users', p_target,
          jsonb_build_object(
            'status', 'rejected',
            'removed', true,
            'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return true;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. platform_has_owner — whether anyone holds the platform.
--
-- /admin asked by counting users where is_platform_admin. RLS hides that row from
-- everyone but the admin, so the count was always 0 for the people the check was
-- for: every account looked at an unclaimed platform and was shown the panel. One
-- boolean, definer because the answer depends on a row the caller cannot read.

create or replace function platform_has_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where is_platform_admin and deleted_at is null
  )
$$;

revoke execute on function platform_has_owner() from public, anon;
grant execute on function platform_has_owner() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PUSH ENDPOINTS GO TO PUSH SERVICES.
--
-- This server POSTs to every stored endpoint, so "any https URL" let a member
-- point it at anything: a blind request forger, and with no timeout a way to hang
-- every notice. The hosts below are the push services of Chrome and every browser
-- built on it, Firefox, Safari and Edge. Every endpoint in production is
-- fcm.googleapis.com.
--
-- The grants matter as much as the check: 023 left a direct insert open, which
-- went straight round this function. Registering now happens only here, and the
-- one direct write left is a member retiring their own row (R4).

create or replace function is_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/',
    false
  )
$$;

create or replace function claim_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.is_push_endpoint(p_endpoint) or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 16 and 256
     or coalesce(char_length(p_auth), 0)   not between 8 and 256 then
    return false;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        deleted_at = null;

  return true;
end;
$$;

revoke insert, update on push_subscriptions from authenticated;
grant update (deleted_at) on push_subscriptions to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. base_layouts — what the upload form promises, in the database.
--
-- isCopyLink() and the vote functions were the only limits, and a member calling
-- PostgREST directly meets neither: any URL as a "copy link" under the clan's
-- name, which a member taps expecting the game, and any vote count. The column
-- grants are the ones the application uses and no more. Votes change only through
-- 028's definer functions, and the one update the app makes is the soft delete.

alter table base_layouts
  add constraint base_layouts_copy_link_is_the_game
  check (copy_link ~* '^https://link\.clashofclans\.com/') not valid;
alter table base_layouts validate constraint base_layouts_copy_link_is_the_game;

revoke insert, update on base_layouts from authenticated;
grant insert (clan_id, uploaded_by, th_level, layout_type, copy_link, image_url, description)
  on base_layouts to authenticated;
grant update (deleted_at) on base_layouts to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. approve_account — a restored account gets its seat back.
--
-- clan_roles is unique on (user_id, clan_id), and removal retires the row rather
-- than deleting it. So after remove, restore and approve, 046's `on conflict do
-- nothing` hit the retired row: approved, with no live role, and gone from the
-- leader's directory. Reviving it as 'member' keeps the rule that approval never
-- grants more, and a row that is still live is left alone, so a re-approval still
-- cannot downgrade a leader.
--
-- The rest of the function is 046's, unchanged.

create or replace function approve_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan   uuid;
  target_status text;
  is_admin      boolean;
  allowed       boolean;
begin
  if auth.uid() is null or target is null then
    return false;
  end if;

  select requested_clan_id, status into target_clan, target_status
  from public.users
  where id = target and deleted_at is null;

  if not found or target_status <> 'pending' then
    return false;
  end if;

  -- Nobody approves themselves, regardless of rank.
  if target = auth.uid() then
    raise exception 'accounts cannot approve themselves';
  end if;

  is_admin := public.auth_is_platform_admin();

  allowed := is_admin
    or (target_clan is not null
        and target_clan in (select public.auth_leader_clan_ids()));

  if not allowed then
    return false;
  end if;

  -- 017's guarantee, narrowed to the case it was actually about. A leader
  -- approving a clanless account would leave them past the /pending redirect
  -- with nothing to see and no role the leader could grant.
  if target_clan is null and not is_admin then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status      = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = target;

  -- 'member' always, never the player's in-game rank (R11).
  if target_clan is not null then
    insert into public.clan_roles (user_id, clan_id, role)
    values (target, target_clan, 'member')
    on conflict (user_id, clan_id) do update
      set role = 'member', deleted_at = null
      where public.clan_roles.deleted_at is not null;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), target_clan, 'approve', 'users', target,
          jsonb_build_object(
            'status', 'approved',
            'role', case when target_clan is null then null else 'member' end));

  return true;
end;
$$;
