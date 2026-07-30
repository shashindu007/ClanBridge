-- Leader-managed clans, replacing T1.10's hardcoded seed.
--
-- The spec treats clan tags as configuration: seed.sql inserts three rows, and a
-- fourth clan needs a migration. This makes them data the leader owns — added
-- through the admin UI, validated by lib/tags.ts, with sync filling in name,
-- badge and level afterwards.
--
-- That split respects R11: the leader supplies the TAG (a human decision, and one
-- no sync job may invent), while everything else about a clan is a game fact.
--
-- The bootstrap problem it creates:
--
--   seeing anything -> needs a clan_roles row
--   clan_roles      -> needs a clan to exist
--   a clan          -> needs a leader to add it
--   a leader        -> needs to see something
--
-- Clan-scoped roles cannot express "may create the first clan", so exactly one
-- platform-level capability is introduced. Deliberately one flag and nothing more:
-- every other permission in this system stays per clan.

alter table users
  add column is_platform_admin boolean not null default false;

comment on column users.is_platform_admin is
  'May add clans and approve accounts that belong to no clan yet. Exists only to '
  'break the bootstrap cycle - every other permission is per clan (T3.5).';

-- At most one platform admin. Not a technical requirement; it makes the blast
-- radius of this flag explicit, and a second one should be a deliberate act.
create unique index users_single_platform_admin
  on users ((true))
  where is_platform_admin and deleted_at is null;


-- ---------------------------------------------------------------------------
-- security definer, and for the usual reason: the policies below sit ON users,
-- so a policy reading users directly would recurse. Running as definer bypasses
-- RLS inside the body and breaks the cycle.
-- ---------------------------------------------------------------------------
create or replace function auth_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_platform_admin
     from public.users
     where id = auth.uid() and deleted_at is null),
    false)
$$;

grant execute on function auth_is_platform_admin() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Ownership claim.
--
-- The bootstrap cannot be done from application code alone: promoting yourself
-- requires a write that no policy grants, and granting that policy would let
-- anyone promote themselves.
--
-- So it is a definer function with one condition that can only ever be true
-- once: it promotes the caller ONLY IF the platform currently has no admin. The
-- first person through the door can claim it; nobody after them can, and there
-- is no argument to tamper with.
--
-- The application adds a second, independent check — the caller's email must
-- match OWNER_EMAIL — so a stranger reaching the URL first still cannot claim it.
-- ---------------------------------------------------------------------------
create or replace function claim_platform_ownership()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  select count(*) into existing
  from public.users
  where is_platform_admin and deleted_at is null;

  if existing > 0 then
    return false;
  end if;

  -- Signal the guard trigger that this write is the sanctioned bootstrap.
  --
  -- The trigger is `security invoker`, so inside this definer function it still
  -- runs as the calling user and would otherwise block the very write it exists
  -- to protect. A transaction-local GUC is the signal: `true` scopes it to this
  -- transaction, so it cannot leak into any later statement, and no client can
  -- set it usefully because reaching the update at all requires this function.
  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set is_platform_admin = true,
      status = 'approved',
      approved_at = now()
  where id = auth.uid();

  insert into public.audit_log (user_id, action, entity, entity_id, after)
  values (auth.uid(), 'claim-ownership', 'users', auth.uid(),
          jsonb_build_object('is_platform_admin', true));

  return true;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, so granting to
-- `authenticated` alone would still leave anon able to call this. It would return
-- false for them (auth.uid() is null), but an unauthenticated caller should not
-- be able to reach the ownership claim at all.
revoke execute on function claim_platform_ownership() from public;
grant execute on function claim_platform_ownership() to authenticated;


-- ---------------------------------------------------------------------------
-- Privileges for the writes below.
--
-- A GRANT and a POLICY are different gates and both are required: the grant says
-- whether the role may attempt the statement at all, the policy says which rows
-- it may touch. 006 granted only SELECT to authenticated, so without this every
-- policy below would be unreachable behind "permission denied for table".
--
-- That is the same defect 014 fixed for service_role, in a different place. It
-- surfaced here only because these are the first write policies in the project.
--
-- Granted narrowly — three tables, no DELETE anywhere (R4). Each future feature
-- grants what it needs rather than inheriting a blanket permission.
-- ---------------------------------------------------------------------------
grant insert, update on clans      to authenticated;
grant insert, update on clan_roles to authenticated;
grant insert, update on users      to authenticated;


-- ---------------------------------------------------------------------------
-- Write policies.
--
-- 006 shipped select-only on purpose, so each feature adds its own writes scoped
-- to the role permitted to perform them. These are the first.
-- ---------------------------------------------------------------------------

-- Adding a clan. INSERT uses `with check`, not `using`.
create policy "platform admin adds clans" on clans
  for insert to authenticated
  with check (auth_is_platform_admin());

-- Renaming or deactivating a clan. Sync also updates clans, but it uses the
-- service key and bypasses RLS entirely.
create policy "platform admin updates clans" on clans
  for update to authenticated
  using (auth_is_platform_admin())
  with check (auth_is_platform_admin());

-- The platform admin must see every clan, including one just created before any
-- clan_roles row exists for it.
create policy "platform admin reads all clans" on clans
  for select to authenticated
  using (auth_is_platform_admin());

-- Granting a role: the platform admin, or a leader of that clan.
create policy "admin or leader grants roles" on clan_roles
  for insert to authenticated
  with check (
    auth_is_platform_admin()
    or clan_id in (select auth_leader_clan_ids())
  );

create policy "admin or leader changes roles" on clan_roles
  for update to authenticated
  using (
    auth_is_platform_admin()
    or clan_id in (select auth_leader_clan_ids())
  )
  with check (
    auth_is_platform_admin()
    or clan_id in (select auth_leader_clan_ids())
  );

create policy "platform admin reads all roles" on clan_roles
  for select to authenticated
  using (auth_is_platform_admin());

-- T3.8 — approving an account. A leader may approve applicants to their own clan;
-- the platform admin may approve anyone, including someone with no clan yet.
--
-- Note what this does NOT allow: promoting anyone to platform admin. That column
-- is only ever written by claim_platform_ownership(), which can fire once.
-- Approving an account is a FUNCTION, not a policy.
--
-- It was first written as an RLS update policy, and that was the wrong tool.
-- Approval is a privileged operation that must also write audit_log (R4), so
-- expressing it as "which rows may this role write" splits one indivisible act
-- into a permission check and a separate, forgettable audit insert.
--
-- As a definer function it is atomic, always audited, and the authority check
-- lives in one readable place instead of a WITH CHECK expression. It also
-- matches claim_platform_ownership() above, so every privileged write in this
-- schema works the same way.
--
-- Consequence: users has NO general update policy. A member may edit their own
-- row (below), and nothing else about a user is writable from a session.
create or replace function approve_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan   uuid;
  target_status text;
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

  allowed := public.auth_is_platform_admin()
    or (target_clan is not null
        and target_clan in (select public.auth_leader_clan_ids()));

  if not allowed then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status      = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = target;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), target_clan, 'approve', 'users', target,
          jsonb_build_object('status', 'approved'));

  return true;
end;
$$;

revoke execute on function approve_account(uuid) from public;
grant execute on function approve_account(uuid) to authenticated;

-- The mirror image, so a rejection is recorded rather than left pending forever.
create or replace function reject_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan uuid;
  allowed     boolean;
begin
  if auth.uid() is null or target is null or target = auth.uid() then
    return false;
  end if;

  select requested_clan_id into target_clan
  from public.users where id = target and deleted_at is null;

  if not found then
    return false;
  end if;

  allowed := public.auth_is_platform_admin()
    or (target_clan is not null
        and target_clan in (select public.auth_leader_clan_ids()));

  if not allowed then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users set status = 'rejected' where id = target;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), target_clan, 'reject', 'users', target,
          jsonb_build_object('status', 'rejected'));

  return true;
end;
$$;

revoke execute on function reject_account(uuid) from public;
grant execute on function reject_account(uuid) to authenticated;

create policy "platform admin reads all users" on users
  for select to authenticated
  using (auth_is_platform_admin());

-- Everyone may create and maintain their own profile row on first sign-in.
create policy "own profile insert" on users
  for insert to authenticated
  with check (id = auth.uid());

-- Own row only, for a display name. Status and is_platform_admin are blocked by
-- the trigger below, so this cannot become a route to privilege.
create policy "own profile update" on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- ---------------------------------------------------------------------------
-- Guard against the obvious escalation.
--
-- "own profile update" lets a member edit their own row, which would otherwise
-- let them set is_platform_admin or status themselves. A trigger blocks both
-- unless the write comes from a definer function or the service key.
-- ---------------------------------------------------------------------------
create or replace function guard_user_privilege_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Constrain END-USER SESSIONS only.
  --
  -- Deliberately an allow-list of the two untrusted roles rather than a
  -- deny-list of trusted ones. Everything else — service_role for sync jobs,
  -- postgres for migrations and admin tooling — is already privileged by other
  -- means, and an earlier version that tested `role = 'service_role'` blocked
  -- the migration runner itself.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The definer functions above set this transaction-locally before their
  -- update. Nothing else sets it, and each function checks the caller's
  -- authority before doing so.
  if current_setting('clanbridge.bootstrap', true) = 'on' then
    return new;
  end if;

  if new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'is_platform_admin cannot be set directly';
  end if;

  -- status is only ever changed by approve_account() / reject_account(), which
  -- set the bootstrap GUC above. A direct session write is always refused,
  -- including a member trying to approve themselves.
  if new.status is distinct from old.status then
    raise exception 'status is set by approve_account()/reject_account(), not directly';
  end if;

  return new;
end;
$$;

create trigger users_guard_privilege_columns
  before update on users
  for each row execute function guard_user_privilege_columns();
