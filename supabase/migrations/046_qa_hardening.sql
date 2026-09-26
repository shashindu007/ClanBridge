-- 046 — QA hardening: privilege holes, one mis-resolved village, and poll and
-- roster rules that only held when nobody raced them.
--
-- Every item below was found by reading the schema as an attacker or as a
-- member with two villages, not by a report from use. Each was a place where
-- the app's forms behaved but a direct PostgREST call, a second village or a
-- second leader did not.
--
--   1. users INSERT had no guard. 015's trigger is BEFORE UPDATE only, so a
--      session could create its own row already approved, already platform
--      admin, already "requesting" any clan.
--   2. users UPDATE let an account clear its own deleted_at (undoing a removal)
--      and rewrite the email and approval stamps leaders read.
--   3. clan_roles still had 015's direct-write grant and policies, so a leader
--      could bypass set_clan_role()'s rules (044) with a plain INSERT/UPDATE.
--   4. auth_clan_ids() and its siblings never looked at the account, so a
--      removed, rejected or pending account holding a live role kept reading.
--   5. reject_account() rejected ANY account that had once asked for the
--      leader's clan — including an approved leader of another clan.
--   6. claim/release_war_target picked `limit 1` of the caller's villages with
--      no ordering and no war filter: two villages, and the claim landed on the
--      wrong one or failed with "you are not in this war".
--   7. poll answers could name an option from a different poll, an UPDATE
--      could move an answer onto a closed poll, and a village from clan B
--      could answer clan A's poll.
--   8. the roster double-booking guard ran as the caller, under RLS, and so
--      could not see the other clans' rosters it exists to check.
--   9. nothing told a leader that a member had left the clan in game while
--      still holding a role — admin_accounts now carries what shows it.


-- ---------------------------------------------------------------------------
-- 1. users INSERT — coerce, do not trust.
--
-- Coerced rather than refused: the only legitimate session insert is the
-- `{ id, email }` upsert in auth/callback and api/auth/sign-in, which sets none
-- of these columns, so coercion changes nothing for it — and refusing would
-- turn a harmless extra field from some future caller into a failed sign-in.
--
-- The email is taken from the verified JWT when it carries one, so the address
-- a leader reads in the approval queue is the one the person signed in with.
-- ---------------------------------------------------------------------------
create or replace function guard_user_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if current_setting('clanbridge.bootstrap', true) = 'on' then
    return new;
  end if;

  new.is_platform_admin := false;
  new.status            := 'pending';
  new.requested_clan_id := null;
  new.approved_by       := null;
  new.approved_at       := null;
  new.deleted_at        := null;
  new.last_seen_at      := null;

  claimed := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email';
  if claimed is not null and claimed <> '' then
    new.email := claimed;
  end if;

  return new;
end;
$$;

create trigger users_guard_insert
  before insert on users
  for each row execute function guard_user_insert();


-- ---------------------------------------------------------------------------
-- 2. users UPDATE — the columns 016 did not cover.
--
-- A `create or replace` of 016's function; the trigger stays attached. Every
-- legitimate writer of these columns is a definer function (approve, reject,
-- remove, restore), which either runs as the owner or sets the bootstrap GUC.
-- The session writes that remain are username, avatar_path and password_set_at.
-- ---------------------------------------------------------------------------
create or replace function guard_user_privilege_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if current_setting('clanbridge.bootstrap', true) = 'on' then
    return new;
  end if;

  if new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'is_platform_admin cannot be set directly';
  end if;

  if new.status is distinct from old.status then
    raise exception 'status is set by approve_account()/reject_account(), not directly';
  end if;

  if new.requested_clan_id is distinct from old.requested_clan_id then
    raise exception 'requested_clan_id is set by link_verified_player(), not directly';
  end if;

  -- New in 046. A removed account clearing its own deleted_at was an undo of
  -- the removal that also hid it from restore_account() and from the leader.
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'deleted_at is set by remove_account()/restore_account(), not directly';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email follows the sign-in address and cannot be set directly';
  end if;

  if new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'approval is recorded by approve_account(), not directly';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. clan_roles — one writer, the functions.
--
-- 044 moved every role change into set_clan_role() so the rules (only the admin
-- makes leaders, never your own row, always audited) hold. 015's direct grant
-- and its two write policies were never removed, so the rules held only for
-- callers polite enough to use the function.
--
-- The one direct write the app still made — the platform admin granting
-- themselves leadership of a new clan — gets its own function below, because
-- set_clan_role() refuses your own row on purpose.
-- ---------------------------------------------------------------------------
drop policy if exists "admin or leader grants roles" on clan_roles;
drop policy if exists "admin or leader changes roles" on clan_roles;
revoke insert, update on clan_roles from authenticated;

create or replace function grant_self_leader(p_clan uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id      uuid;
  row_role    text;
  row_deleted timestamptz;
begin
  if auth.uid() is null or p_clan is null then
    return false;
  end if;

  if not public.auth_is_platform_admin() then
    return false;
  end if;

  if not exists (select 1 from public.clans where id = p_clan and deleted_at is null) then
    return false;
  end if;

  select id, role, deleted_at into row_id, row_role, row_deleted
  from public.clan_roles
  where user_id = auth.uid() and clan_id = p_clan;

  if row_id is not null and row_deleted is null and row_role = 'leader' then
    return true;
  end if;

  if row_id is null then
    insert into public.clan_roles (user_id, clan_id, role)
    values (auth.uid(), p_clan, 'leader');
  else
    update public.clan_roles set role = 'leader', deleted_at = null where id = row_id;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_clan, 'role', 'clan_roles', auth.uid(),
          jsonb_build_object('role', case when row_deleted is null then row_role end),
          jsonb_build_object('role', 'leader'));

  return true;
end;
$$;

revoke execute on function grant_self_leader(uuid) from public;
grant execute on function grant_self_leader(uuid) to authenticated;

comment on function grant_self_leader(uuid) is
  '046 — the platform admin makes themselves leader of a clan (usually one they '
  'just added). The only self-grant there is; audited as action ''role''.';


-- ---------------------------------------------------------------------------
-- 4. Membership requires a live, approved account.
--
-- Access was decided by clan_roles alone. remove_account() retires the roles,
-- so removal worked — but a rejected account, an account whose removal was
-- undone by hand, or a role granted to a pending account all kept reading
-- every table in the clan. The account's own state now has to agree.
-- ---------------------------------------------------------------------------
create or replace function auth_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and status = 'approved' and deleted_at is null
  )
$$;

revoke execute on function auth_account_active() from public;
grant execute on function auth_account_active() to anon, authenticated;

create or replace function auth_clan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id
  from public.clan_roles
  where user_id = auth.uid()
    and deleted_at is null
    and public.auth_account_active()
$$;

create or replace function auth_leader_clan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id
  from public.clan_roles
  where user_id = auth.uid()
    and role = 'leader'
    and deleted_at is null
    and public.auth_account_active()
$$;

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
    and public.auth_account_active()
$$;


-- ---------------------------------------------------------------------------
-- 5. reject_account — applicants only.
--
-- Rejection is the answer to an application. It had no status check, so a
-- leader of clan A could "reject" an approved member — or a leader of clan B —
-- who had once applied to A, and with (4) that now locks the account out of
-- everything. Only pending accounts, and never the platform admin.
-- ---------------------------------------------------------------------------
create or replace function reject_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan  uuid;
  target_admin boolean;
  allowed      boolean;
begin
  if auth.uid() is null or target is null or target = auth.uid() then
    return false;
  end if;

  select requested_clan_id, is_platform_admin into target_clan, target_admin
  from public.users
  where id = target and deleted_at is null and status = 'pending';

  if not found or target_admin then
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


-- ---------------------------------------------------------------------------
-- 6. claim/release_war_target — the village that is actually in this war.
--
-- p_player names the village the member pressed the button under. When it is
-- null (an older client), the caller's village IN THIS WAR is used — never an
-- arbitrary one of their villages. Either way it must be theirs and in the war.
-- The old signatures are dropped so no stale overload keeps the old lookup.
-- ---------------------------------------------------------------------------
drop function if exists claim_war_target(uuid, smallint, text);
drop function if exists release_war_target(uuid);

create or replace function claim_war_target(
  p_war      uuid,
  p_position smallint,
  p_note     text default null,
  p_player   uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_state  text;
  v_player uuid;
  v_before jsonb;
  v_holder uuid;
  v_by     uuid;
begin
  if auth.uid() is null or p_war is null or p_position is null then
    return false;
  end if;

  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'you are not in this clan';
  end if;

  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  if not exists (
    select 1 from public.players
    where user_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'no verified player is linked to your account; verify first';
  end if;

  select p.id into v_player
  from public.players p
  join public.war_members wm
    on wm.player_id = p.id and wm.war_id = p_war and wm.deleted_at is null
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and (p_player is null or p.id = p_player)
  order by p.id
  limit 1;

  if v_player is null then
    raise exception 'you are not in this war';
  end if;

  select player_id into v_holder
  from public.war_targets
  where war_id = p_war
    and target_position = p_position
    and player_id <> v_player
    and deleted_at is null
  limit 1;

  if v_holder is not null then
    raise exception 'base % is already taken', p_position;
  end if;

  select to_jsonb(t), t.assigned_by into v_before, v_by
  from public.war_targets t
  where t.war_id = p_war and t.player_id = v_player and t.deleted_at is null;

  if v_by is not null and v_by <> auth.uid() then
    raise exception
      'leadership has already assigned you a target; ask them to change it';
  end if;

  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, v_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id) do update
    set target_position = excluded.target_position,
        note            = excluded.note,
        assigned_by     = excluded.assigned_by,
        assigned_at     = now(),
        deleted_at      = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'claim-target', 'war_targets', v_player, v_before,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function claim_war_target(uuid, smallint, text, uuid) from public;
grant execute on function claim_war_target(uuid, smallint, text, uuid) to authenticated;


create or replace function release_war_target(p_war uuid, p_player uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_state  text;
  v_player uuid;
  v_before jsonb;
  v_by     uuid;
begin
  if auth.uid() is null or p_war is null then
    return false;
  end if;

  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'you are not in this clan';
  end if;

  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  -- The caller's village that holds a live target in this war — the one there
  -- is something to give back for.
  select p.id into v_player
  from public.players p
  join public.war_targets t
    on t.player_id = p.id and t.war_id = p_war and t.deleted_at is null
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and (p_player is null or p.id = p_player)
  order by p.id
  limit 1;

  if v_player is null then
    return false;                      -- nothing held; not an error, not audited
  end if;

  select to_jsonb(t), t.assigned_by into v_before, v_by
  from public.war_targets t
  where t.war_id = p_war and t.player_id = v_player and t.deleted_at is null;

  if v_by is distinct from auth.uid() then
    raise exception
      'leadership assigned this target; ask them to clear it';
  end if;

  update public.war_targets
  set deleted_at = now()
  where war_id = p_war and player_id = v_player;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), v_clan, 'release-target', 'war_targets', v_player, v_before);

  return true;
end;
$$;

revoke execute on function release_war_target(uuid, uuid) from public;
grant execute on function release_war_target(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. poll_responses — the option must belong to the poll, the poll must be
--    open, and a CLAN poll is answered only by that clan's villages — on
--    insert AND on the row an update produces.
--
-- poll_option_counts() counts by option_id alone, so an answer to open poll X
-- carrying an option of poll Y (even a closed one) moved Y's tally. The update
-- policy re-checked ownership but not the poll, so an answer could be moved
-- onto a closed poll after the fact. And any village the member owned could
-- answer any clan's poll, so a clan B village counted toward clan A's "In" —
-- the number A's war lineup is sized from.
-- ---------------------------------------------------------------------------
drop policy if exists "answer for your own player" on poll_responses;
drop policy if exists "change your own answer" on poll_responses;

create policy "answer for your own player" on poll_responses
  for insert to authenticated
  with check (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
    and exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and p.status = 'open'
        and (p.closes_at is null or p.closes_at > now())
        and (p.scope = 'family'
             or p.clan_id = (select pl.clan_id from players pl
                             where pl.id = poll_responses.player_id))
    )
    and exists (
      select 1 from poll_options o
      where o.id = poll_responses.option_id
        and o.poll_id = poll_responses.poll_id
        and o.deleted_at is null
    )
  );

create policy "change your own answer" on poll_responses
  for update to authenticated
  using (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
    and exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and p.status = 'open'
        and (p.closes_at is null or p.closes_at > now())
    )
  )
  with check (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
    and exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and p.status = 'open'
        and (p.closes_at is null or p.closes_at > now())
        and (p.scope = 'family'
             or p.clan_id = (select pl.clan_id from players pl
                             where pl.id = poll_responses.player_id))
    )
    and exists (
      select 1 from poll_options o
      where o.id = poll_responses.option_id
        and o.poll_id = poll_responses.poll_id
        and o.deleted_at is null
    )
  );


-- ---------------------------------------------------------------------------
-- 8. One roster per player per season — checked across every clan.
--
-- The trigger ran as the caller, so RLS hid the other clans' draft rosters
-- (and their published ones, from a leader not in that clan) from the very
-- query that looks for a clash. Definer, so it sees every roster; and an
-- advisory lock per (season, player) so two leaders adding the same player at
-- the same moment cannot both pass the check before either row exists.
-- ---------------------------------------------------------------------------
create or replace function guard_one_roster_per_season()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season   text;
  v_clash    text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select season into v_season
  from public.cwl_rosters
  where id = new.roster_id;

  perform pg_advisory_xact_lock(hashtext('cwl-roster:' || v_season || ':' || new.player_id::text));

  select c.name into v_clash
  from public.cwl_roster_members m
  join public.cwl_rosters r on r.id = m.roster_id
  join public.clans c on c.id = r.clan_id
  where m.player_id = new.player_id
    and m.deleted_at is null
    and r.deleted_at is null
    and r.season = v_season
    and m.roster_id <> new.roster_id
  limit 1;

  if v_clash is not null then
    raise exception
      'player is already in the % roster for season %', v_clash, v_season
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. admin_accounts — show who has left the clan in game.
--
-- A member who leaves (or moves to an enemy clan) keeps reading the clan's war
-- plans, targets and base layouts until someone retires their role — and
-- nothing told anyone to. Revoking automatically is wrong for this family:
-- players are moved between the three clans for CWL all the time, and R11
-- keeps the sync away from clan_roles on purpose. So the fact is surfaced
-- where the decision is made instead: each village now carries its current
-- clan and left_at, and /admin/members flags an account none of whose villages
-- are in a clan it holds a role in.
--
-- 040's definition, unchanged except for the two new keys in `players`.
-- ---------------------------------------------------------------------------
create or replace function admin_accounts(p_search text default null)
returns table (
  id                uuid,
  email             text,
  username          text,
  display_name      text,
  status            text,
  is_platform_admin boolean,
  created_at        timestamptz,
  approved_at       timestamptz,
  removed_at        timestamptz,
  requested_clan    text,
  memberships       jsonb,
  players           jsonb,
  unread_messages   integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email,
    u.username,
    u.display_name,
    u.status,
    u.is_platform_admin,
    u.created_at,
    u.approved_at,
    u.deleted_at as removed_at,
    rc.name as requested_clan,
    coalesce(m.memberships, '[]'::jsonb),
    coalesce(p.players, '[]'::jsonb),
    coalesce(msg.unread, 0)
  from public.users u
  left join public.clans rc
    on rc.id = u.requested_clan_id

  left join lateral (
    select jsonb_agg(
             jsonb_build_object('clanId', c.id, 'clan', c.name, 'tag', c.tag, 'role', cr.role)
             order by c.tag
           ) as memberships
    from public.clan_roles cr
    join public.clans c on c.id = cr.clan_id
    where cr.user_id = u.id
      and cr.deleted_at is null
  ) m on true

  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'tag', pl.tag, 'name', pl.name, 'thLevel', pl.th_level,
               'clanId', pl.clan_id, 'leftAt', pl.left_at)
             order by pl.tag
           ) as players
    from public.players pl
    where pl.user_id = u.id
      and pl.deleted_at is null
  ) p on true

  left join lateral (
    select count(*)::integer as unread
    from public.notifications n
    where n.recipient_id = u.id
      and n.read_at is null
      and n.deleted_at is null
  ) msg on true

  where public.auth_may_administer_account(u.id)
    and (
      p_search is null
      or btrim(p_search) = ''
      or u.email        ilike '%' || btrim(p_search) || '%'
      or u.username     ilike '%' || btrim(p_search) || '%'
      or u.display_name ilike '%' || btrim(p_search) || '%'
      or exists (
        select 1 from public.players pl
        where pl.user_id = u.id
          and pl.deleted_at is null
          and (pl.tag ilike '%' || btrim(p_search) || '%'
            or pl.name ilike '%' || btrim(p_search) || '%')
      )
    )

  order by
    case
      when u.deleted_at is not null then 2
      when u.status = 'pending'     then 0
      else 1
    end,
    u.created_at desc
$$;
