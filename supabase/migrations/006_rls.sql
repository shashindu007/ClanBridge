-- T1.9 — Row Level Security.
--
-- READ THIS FILE LINE BY LINE BEFORE APPLYING IT (section 8).
--
-- This is the single most important security control in the system. Three clans
-- share one database, and application code will sometimes forget the clan filter
-- (R3 calls that the most common AI-generated bug in this project). These
-- policies are what stops a forgotten filter becoming a data leak.
--
-- RLS is the safety net, NOT a substitute for filtering by clan in every query.
--
-- Done when: with the anon key and no session, every table returns zero rows.
--
-- A useful property falls out of this design for free: T3.8's approval gate is
-- already enforced. A newly signed-up user has no clan_roles row, so
-- auth_clan_ids() returns the empty set and every policy below matches nothing.
-- A stranger with a verified tag and a valid session sees an empty application,
-- not a populated one — before any application-level gate is written.


-- ---------------------------------------------------------------------------
-- Which clans does the current user belong to?
--
-- security definer is load-bearing. The function reads clan_roles, and
-- clan_roles itself has an RLS policy that calls this function. Running as the
-- definer bypasses RLS inside the function body, which is what stops that
-- becoming infinite recursion.
--
-- set search_path = '' with fully qualified names prevents a search_path
-- hijack, which a security definer function is otherwise exposed to.
-- ---------------------------------------------------------------------------
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
$$;

-- Same, restricted to clans where the user is the leader. Used by audit_log.
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
$$;


-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
--
-- Enabling RLS with no policy denies everything. Each table below then gets
-- exactly one select policy. That default-deny is deliberate: a table added in
-- a later migration and forgotten here is invisible rather than public.
-- ---------------------------------------------------------------------------
alter table clans              enable row level security;
alter table users              enable row level security;
alter table players            enable row level security;
alter table clan_roles         enable row level security;
alter table cwl_seasons        enable row level security;
alter table cwl_wars           enable row level security;
alter table cwl_attacks        enable row level security;
alter table cwl_bonuses        enable row level security;
alter table wars               enable row level security;
alter table war_targets        enable row level security;
alter table war_attacks        enable row level security;
alter table raid_seasons       enable row level security;
alter table raid_participants  enable row level security;
alter table clan_games         enable row level security;
alter table clan_games_scores  enable row level security;
alter table base_layouts       enable row level security;
alter table announcements      enable row level security;
alter table push_subscriptions enable row level security;
alter table sync_log           enable row level security;
alter table audit_log          enable row level security;


-- ---------------------------------------------------------------------------
-- Direct clan ownership — the table carries clan_id itself.
--
-- Every policy is `to authenticated`, so the anon role matches nothing at all.
-- ---------------------------------------------------------------------------
create policy "read own clans" on clans
  for select to authenticated
  using (id in (select auth_clan_ids()));

create policy "read own clan players" on players
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan roles" on clan_roles
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan cwl seasons" on cwl_seasons
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan wars" on wars
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan raid seasons" on raid_seasons
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan games" on clan_games
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan layouts" on base_layouts
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own clan announcements" on announcements
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));


-- ---------------------------------------------------------------------------
-- Own row only.
-- ---------------------------------------------------------------------------
-- Own row only, deliberately. Widening this to "anyone in my clan" would expose
-- every member's email address, which is a privacy decision for the clan leader
-- (T0.11), not a convenience for a query.
--
-- KNOWN CONSEQUENCE: pages that display who did something — the author of an
-- announcement (T5.1), who awarded a bonus (T4.7), who published a roster
-- (T4B.9) — cannot resolve that name through this table yet. Prefer joining to
-- players.name, which is the in-game name members recognise anyway and is
-- already readable clan-wide. If a users join really is needed, add a policy
-- exposing id and display_name only, never email.
create policy "read own profile" on users
  for select to authenticated
  using (id = auth.uid());

create policy "read own push subscriptions" on push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- Indirect ownership — clan_id is reached through a parent.
--
-- The exists-join pattern from Architecture.md 7.3. Deliberately NOT solved by
-- denormalising clan_id onto every child table: a denormalised copy can drift
-- out of step with its parent, and a policy reading the stale copy would grant
-- access the parent no longer allows.
-- ---------------------------------------------------------------------------
create policy "read own clan cwl wars" on cwl_wars
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_wars.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan cwl attacks" on cwl_attacks
  for select to authenticated
  using (
    exists (
      select 1 from cwl_wars w
      join cwl_seasons s on s.id = w.season_id
      where w.id = cwl_attacks.war_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan cwl bonuses" on cwl_bonuses
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_bonuses.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan war targets" on war_targets
  for select to authenticated
  using (
    exists (
      select 1 from wars w
      where w.id = war_targets.war_id
        and w.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan war attacks" on war_attacks
  for select to authenticated
  using (
    exists (
      select 1 from wars w
      where w.id = war_attacks.war_id
        and w.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan raid participants" on raid_participants
  for select to authenticated
  using (
    exists (
      select 1 from raid_seasons r
      where r.id = raid_participants.raid_season_id
        and r.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan games scores" on clan_games_scores
  for select to authenticated
  using (
    exists (
      select 1 from clan_games g
      where g.id = clan_games_scores.clan_games_id
        and g.clan_id in (select auth_clan_ids())
    )
  );


-- ---------------------------------------------------------------------------
-- Operational tables.
-- ---------------------------------------------------------------------------

-- Members need this for the freshness indicator on every page (T4.8).
-- clan_id is null for family-wide jobs, which every authenticated user may see.
create policy "read own clan sync log" on sync_log
  for select to authenticated
  using (clan_id is null or clan_id in (select auth_clan_ids()));

-- T9.6 — the audit log viewer is leader-only. Enforced here as well as in the
-- application, because "who changed what" includes entries about the people
-- reading it.
create policy "leaders read own clan audit log" on audit_log
  for select to authenticated
  using (clan_id in (select auth_leader_clan_ids()));


-- ---------------------------------------------------------------------------
-- No insert, update or delete policies exist, on purpose.
--
-- Every write today comes from scripts/sync/, which uses the service role key
-- and bypasses RLS by design — those jobs act for no user.
--
-- Human writes arrive later (T4.7 bonuses, T5.1 announcements, T8.3 layouts,
-- and all of Phase 4B). Each of those tasks adds its own write policy in its own
-- migration, scoped to the role that is allowed to perform it. Granting a broad
-- write policy here to "save a migration later" would hand every member the
-- ability to edit every human-decision table in their clan.
-- ---------------------------------------------------------------------------
