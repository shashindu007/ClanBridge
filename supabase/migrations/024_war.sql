-- Phase 6 — everything the war module needs that does not exist yet.
--
-- Three separate holes, one migration, because none of them is useful alone and
-- T6.3 is blocked on all three.
--
--   1. war_members        the API's roster. THE 019 GAP, AGAIN.
--   2. war_lineups        the leader's intended lineup (T6.8, promised by the
--      war_lineup_members  012 stub, which was never written)
--   3. war_targets        had no write policy, so T6.4 could not assign anything
--
-- SUPERSEDES 012_war_lineups.sql, which is comment-only and was never applied
-- anywhere. Its number is retired the way 009's was — see the note in
-- test/pg-harness.ts. Keeping numeric order equal to apply order matters more
-- than keeping the number that was reserved a year earlier.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY war_members HAS TO EXIST, WHICH IS THE SAME ARGUMENT 019 MADE
--
-- 003 gave war wars, war_targets and war_attacks — the plan, and what happened.
-- It did not give a way to know WHO WAS IN THE WAR, and every question worth
-- asking after a war needs that:
--
--   "who did not attack"        roster MINUS war_attacks. The people on that
--                               list have no war_attacks row, so they cannot be
--                               found by querying it.
--   "attacks used out of 2"     needs a denominator, which is membership
--   "selected but did not play" needs the API roster to compare the plan against
--
-- 019's header says the missed-attack list "had no source at all" before it.
-- Identical here. A war is 15-50 members and each gets two attacks; without this
-- table the war module can report what happened and never what did not.
--
-- R11 — a GAME FACT. Written only by scripts/sync/war.ts. Never confused with
-- war_lineup_members below, which is a HUMAN DECISION and which no sync job may
-- ever touch. R12 — T6.10 shows the difference between them, which is only
-- possible while both still exist.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- war_members — who the API reported in the war.
-- ---------------------------------------------------------------------------
create table war_members (
  id            uuid primary key default gen_random_uuid(),
  war_id        uuid not null references wars (id) on delete restrict,
  player_id     uuid not null references players (id) on delete restrict,
  map_position  smallint,
  th_level      smallint,
  -- Regular war gives two attacks per member; CWL gives one, which is why
  -- cwl_war_members has no such column. Stored rather than assumed: the value
  -- comes from the war the API described, and a future game change that alters
  -- it must not silently rewrite what old wars meant.
  attacks_allowed smallint not null default 2,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- The idempotency key, exactly as 019's. Without it ON CONFLICT DO NOTHING
  -- matches nothing and every sync run duplicates the whole roster, silently.
  unique (war_id, player_id)
);

create index war_members_war_id_idx on war_members (war_id) where deleted_at is null;
create index war_members_player_id_idx on war_members (player_id) where deleted_at is null;

comment on table war_members is
  'Who the API reported in a war (a game fact, R11). Missed attacks are this '
  'minus war_attacks. Not to be confused with war_lineup_members, which is who '
  'the leader picked (R12).';

alter table war_members enable row level security;

-- One-level join: wars carries clan_id directly, unlike cwl_war_members which
-- has to reach through cwl_seasons. Simpler, and worth stating so nobody
-- "fixes" it later to match the CWL shape.
create policy "read own clan war members" on war_members
  for select to authenticated
  using (
    exists (
      select 1 from wars w
      where w.id = war_members.war_id
        and w.clan_id in (select auth_clan_ids())
    )
  );

grant select on war_members to anon, authenticated;
grant select, insert, update on war_members to service_role;


-- ---------------------------------------------------------------------------
-- T6.4 — war_targets could not be written.
--
-- 003 created the table and 006 granted select and nothing else, so "leadership
-- assigns targets" had no way to happen. This is the fourth table to arrive in
-- that state (announcements 021, cwl_bonuses 022, push_subscriptions 023).
--
-- A definer function, not an insert policy, for the reason 021 gives at length:
-- assigning a target must also write audit_log (R4), and a policy splits one
-- indivisible act into a permission check and a separate, forgettable insert.
--
-- R12 — this writes the PLAN. It never touches war_attacks, which is the
-- outcome. A single "reconcile" that wrote results back into war_targets would
-- destroy the exact comparison T6.5 and T6.10 exist to show.
-- ---------------------------------------------------------------------------
create or replace function assign_war_target(
  p_war      uuid,
  p_player   uuid,
  p_position smallint,
  p_note     text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_state  text;
  v_before jsonb;
begin
  if auth.uid() is null or p_war is null or p_player is null then
    return false;
  end if;

  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  -- R3 — the clan filter, and it is the authority check as well.
  if v_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may assign targets in this war';
  end if;

  -- A war that has ended cannot be planned. Refused here rather than in the
  -- form: editing the plan after the outcome is known is how a "plan versus
  -- reality" report gets quietly rewritten into agreement with itself (R12).
  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  -- The player must actually be in the war. Without this a leader can assign a
  -- target to somebody the API never put in the lineup, and the missed-attack
  -- list then contains a person who was never able to attack.
  if not exists (
    select 1 from public.war_members
    where war_id = p_war and player_id = p_player and deleted_at is null
  ) then
    raise exception 'that player is not in this war';
  end if;

  select to_jsonb(t) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = p_player;

  -- 003 made (war_id, player_id) unique and its comment says reassigning
  -- UPDATES the row, with the change recorded in audit_log rather than by
  -- inserting a second target. This is that behaviour.
  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, p_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id) do update
    set target_position = excluded.target_position,
        note            = excluded.note,
        assigned_by     = excluded.assigned_by,
        assigned_at     = now(),
        deleted_at      = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'assign-target', 'war_targets', p_player, v_before,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function assign_war_target(uuid, uuid, smallint, text) from public;
grant execute on function assign_war_target(uuid, uuid, smallint, text) to authenticated;


-- The mirror. Soft delete (R4): the row stays and the audit trail keeps both
-- states, so "who told me to hit base 7" has an answer after it is withdrawn.
create or replace function clear_war_target(p_war uuid, p_player uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan uuid;
  v_before jsonb;
begin
  if auth.uid() is null or p_war is null or p_player is null then
    return false;
  end if;

  select clan_id into v_clan from public.wars
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may clear targets in this war';
  end if;

  select to_jsonb(t) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = p_player and t.deleted_at is null;

  if v_before is null then
    return false;                      -- already gone; not an error, not audited twice
  end if;

  update public.war_targets
  set deleted_at = now()
  where war_id = p_war and player_id = p_player;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), v_clan, 'clear-target', 'war_targets', p_player, v_before);

  return true;
end;
$$;

revoke execute on function clear_war_target(uuid, uuid) from public;
grant execute on function clear_war_target(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- T6.8 — the lineup the leader intends, which the API can never tell you.
--
-- The API reports who IS in a war, never who WILL be. So this exists nowhere
-- but here (R11), and it is the entire reason the war module needs a backend
-- rather than a sync job.
--
-- Same shape as the CWL roster tables in 011, deliberately: a leader who has
-- learned one screen has learned the other.
--
-- NOT tied to a war row. A lineup is decided BEFORE the war is declared in
-- game, and until then no war exists to reference — that is the whole point.
-- It hangs off (clan_id, planned_for) instead, and T6.10 matches it to the war
-- that eventually appears.
-- ---------------------------------------------------------------------------
create table war_lineups (
  id           uuid primary key default gen_random_uuid(),
  clan_id      uuid not null references clans (id) on delete restrict,
  -- Roughly when this war is expected. Also what makes two drafts for two
  -- different wars distinguishable before either is declared.
  planned_for  timestamptz not null default now(),
  size         smallint not null check (size between 5 and 50),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  -- Filled in once the war appears in game, which is what turns an intention
  -- into something T6.10 can compare against reality.
  war_id       uuid references wars (id) on delete restrict,
  created_by   uuid not null references users (id) on delete restrict,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  deleted_at   timestamptz
);

create trigger war_lineups_set_updated_at
  before update on war_lineups
  for each row execute function set_updated_at();

create index war_lineups_clan_id_idx on war_lineups (clan_id) where deleted_at is null;

create table war_lineup_members (
  id         uuid primary key default gen_random_uuid(),
  lineup_id  uuid not null references war_lineups (id) on delete restrict,
  player_id  uuid not null references players (id) on delete restrict,
  position   smallint,
  added_by   uuid not null references users (id) on delete restrict,
  added_at   timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (lineup_id, player_id)
);

create index war_lineup_members_lineup_id_idx
  on war_lineup_members (lineup_id) where deleted_at is null;

comment on table war_lineup_members is
  'Who the leader picked for a war (a human decision, R11). Compared against '
  'war_members at T6.10, never replaced by it (R12). No sync job may write here.';

alter table war_lineups enable row level security;
alter table war_lineup_members enable row level security;

-- A DRAFT IS NOT VISIBLE TO MEMBERS, and the policy is what enforces that, not
-- the page. 011 makes the same argument for CWL rosters: a draft is the leader
-- thinking out loud, with people on it who will be cut, and showing it causes
-- exactly the arguments publishing is meant to prevent.
create policy "read published or own clan draft lineups" on war_lineups
  for select to authenticated
  using (
    clan_id in (select auth_clan_ids())
    and (status = 'published' or clan_id in (select auth_leadership_clan_ids()))
  );

create policy "leadership writes lineups" on war_lineups
  for insert to authenticated
  with check (clan_id in (select auth_leadership_clan_ids()));

create policy "leadership updates lineups" on war_lineups
  for update to authenticated
  using (clan_id in (select auth_leadership_clan_ids()))
  with check (clan_id in (select auth_leadership_clan_ids()));

create policy "read lineup members of readable lineups" on war_lineup_members
  for select to authenticated
  using (
    exists (
      select 1 from war_lineups l
      where l.id = war_lineup_members.lineup_id
        and l.clan_id in (select auth_clan_ids())
        and (l.status = 'published' or l.clan_id in (select auth_leadership_clan_ids()))
    )
  );

create policy "leadership writes lineup members" on war_lineup_members
  for insert to authenticated
  with check (
    exists (
      select 1 from war_lineups l
      where l.id = war_lineup_members.lineup_id
        and l.clan_id in (select auth_leadership_clan_ids())
    )
  );

create policy "leadership updates lineup members" on war_lineup_members
  for update to authenticated
  using (
    exists (
      select 1 from war_lineups l
      where l.id = war_lineup_members.lineup_id
        and l.clan_id in (select auth_leadership_clan_ids())
    )
  )
  with check (
    exists (
      select 1 from war_lineups l
      where l.id = war_lineup_members.lineup_id
        and l.clan_id in (select auth_leadership_clan_ids())
    )
  );

grant select, insert, update on war_lineups to authenticated;
grant select, insert, update on war_lineup_members to authenticated;
grant select on war_lineups, war_lineup_members to anon;

-- ---------------------------------------------------------------------------
-- R11 AS A PRIVILEGE, NOT A COMMENT.
--
-- These two tables hold the leader's decision. A sync job runs every fifteen
-- minutes and overwrites; if one could write here, a routine tick erases an
-- hour of their work, and R4 means there is no deleted row to recover.
--
-- The REVOKE is the operative line, and it is not redundant. 014 issued
--
--     alter default privileges in schema public
--       grant select, insert, update on tables to service_role;
--
-- so EVERY table created after it is born writable by the sync jobs. Granting
-- only select here changes nothing on its own — the default privilege has
-- already been applied by the time this statement runs. A test asserting the
-- sync role cannot write caught exactly that, having been written in the belief
-- that a narrow grant was a narrow permission.
--
-- Worth knowing more broadly: the same default privilege reaches cwl_rosters,
-- cwl_roster_members, polls and poll_responses. Nothing writes them today except
-- the application, and the boundary is documented at the top of
-- scripts/sync/shared.ts — but there it is discipline, and here it is enforced.
-- Tightening the others deserves its own migration and its own tests.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on war_lineups from service_role;
revoke insert, update, delete on war_lineup_members from service_role;

-- Still readable, so T6.10's comparison can be computed from a job if it ever
-- moves there.
grant select on war_lineups, war_lineup_members to service_role;

-- No delete grant, for anybody. R4.


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- as an ordinary member, a draft lineup must be invisible:
--   select count(*) from war_lineups where status = 'draft';        -- 0
--
--   -- as a member, assigning a target must RAISE:
--   select assign_war_target('<war>', '<player>', 3::smallint);
--
--   -- as a leader, it must succeed AND leave exactly one audit row:
--   select assign_war_target('<war>', '<player>', 3::smallint);
--   select count(*) from audit_log where entity = 'war_targets';    -- 1
--
--   -- reassigning updates rather than duplicating:
--   select assign_war_target('<war>', '<player>', 7::smallint);
--   select count(*) from war_targets where war_id = '<war>';        -- still 1
--
--   -- and a sync job may never write the leader's plan:
--   set role service_role;
--   insert into war_lineup_members (lineup_id, player_id, added_by)
--   values (...);                                                   -- denied
-- ---------------------------------------------------------------------------
