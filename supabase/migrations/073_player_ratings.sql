-- T13.10 — the combined Player rating, stored per month, one number per player.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS STORED, WHEN NO OTHER RATING IS.
--
-- The war, CWL, raid and Clan Games ratings are derived on read, and a stored
-- copy of them would be a second source that could disagree. This one cannot be
-- derived on read. Its percentages are of the WHOLE FAMILY, so working one out
-- takes every clan's rows, and a viewer may only read their own clans (R3). The
-- key that could read them all never reaches Vercel (R6). So
-- scripts/sync/ratings.ts works it out on GitHub Actions and writes it here, and
-- src/services/player-rating.ts stays the only place the sums are written down.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — THE THIRD DELIBERATE EXCEPTION, AFTER 037 AND 038. READ ALL THREE.
--
-- The decision: anyone holding a role in any platform clan may read every
-- family player's rating, so that one player has one number whoever is looking.
--
-- Made in family_player_ratings(), NOT by widening a policy, for the reason
-- Architecture.md §7.3 gives. The table's own policy is clan-scoped like any
-- other, so `select from player_ratings` still returns one clan's rows.
--
-- WHAT IS RETURNED: marks and % per section, the rating, and the name, tag, Town
-- Hall and current clan a roster already shows (038).
--
-- WHAT IS NOT: raw donation counts, attacks, war or raid detail, verified,
-- user_id. Marks can be worked backwards only as far as the one number they are.
--
-- WHO IS ANSWERED — 037's guard, verbatim: a caller holding at least one live
-- clan_roles row, or the service role. Anyone else gets zero rows, which also
-- covers a pending account.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R4 — NOTHING HERE IS EVER DELETED, SO A DEPARTED MEMBER'S ROW STAYS.
--
-- Every row of a run shares its computed_at, and a month is written in one
-- statement. The read takes only the month's newest computed_at, which is what
-- drops a player who left before the last run without deleting anything. A month
-- no longer recalculated keeps the ranking of its last run.

create table player_ratings (
  id              uuid primary key default gen_random_uuid(),
  -- 'YYYY-MM', UTC, as cwl_seasons.season and clan_games.season.
  month           text not null check (month ~ '^\d{4}-\d{2}$'),
  player_id       uuid not null references players (id) on delete restrict,
  -- The clan they were in when this was worked out.
  clan_id         uuid not null references clans (id) on delete restrict,

  donation_marks  numeric(10, 2) not null,
  war_marks       numeric(10, 2) not null,
  cwl_marks       numeric(10, 2) not null,
  games_marks     numeric(10, 2) not null,
  raid_marks      numeric(10, 2) not null,

  donation_share  numeric(8, 3) not null,
  war_share       numeric(8, 3) not null,
  cwl_share       numeric(8, 3) not null,
  games_share     numeric(8, 3) not null,
  raid_share      numeric(8, 3) not null,

  rating          numeric(8, 3) not null,
  computed_at     timestamptz not null,

  unique (month, player_id)
);

create index player_ratings_clan_idx on player_ratings (clan_id);

alter table player_ratings enable row level security;

create policy "read own clan ratings" on player_ratings
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

-- Stated rather than left to defaults: on Supabase a new table starts with every
-- privilege granted, and 014 withholds DELETE from service_role (R4). PGlite
-- cannot catch a missing revoke here.
grant select on player_ratings to anon, authenticated;
grant select, insert, update on player_ratings to service_role;
revoke insert, update, delete, truncate on player_ratings from anon, authenticated;
revoke delete, truncate on player_ratings from service_role;

comment on table player_ratings is
  'T13.10 - one row per player per month: marks and % of the family per section, '
  'and the weighted rating. Derived, written only by scripts/sync/ratings.ts, and '
  'read family-wide through family_player_ratings(). A month''s live rows are its '
  'newest computed_at; older rows are departed players, kept by R4.';


-- ---------------------------------------------------------------------------
-- One month's ranking from its newest run.
--
-- A departed or soft-deleted player, or a soft-deleted clan, must not come back
-- through this door. `limit` is a ceiling, not a page: the family is a few
-- hundred players.
-- ---------------------------------------------------------------------------
create or replace function family_player_ratings(p_month text)
returns table (
  player_id       uuid,
  clan_id         uuid,
  clan_tag        text,
  clan_name       text,
  tag             text,
  name            text,
  th_level        integer,
  donation_marks  numeric,
  war_marks       numeric,
  cwl_marks       numeric,
  games_marks     numeric,
  raid_marks      numeric,
  donation_share  numeric,
  war_share       numeric,
  cwl_share       numeric,
  games_share     numeric,
  raid_share      numeric,
  rating          numeric,
  computed_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.player_id,
    r.clan_id,
    c.tag,
    c.name,
    p.tag,
    p.name,
    p.th_level::integer,
    r.donation_marks,
    r.war_marks,
    r.cwl_marks,
    r.games_marks,
    r.raid_marks,
    r.donation_share,
    r.war_share,
    r.cwl_share,
    r.games_share,
    r.raid_share,
    r.rating,
    r.computed_at
  from public.player_ratings r
  join public.players p on p.id = r.player_id and p.deleted_at is null
  join public.clans c on c.id = r.clan_id and c.deleted_at is null
  where r.month = p_month
    and r.computed_at = (
      select max(l.computed_at) from public.player_ratings l where l.month = p_month
    )
    and (
      exists (select 1 from public.auth_clan_ids())
      or current_setting('role', true) = 'service_role'
    )
  order by r.rating desc, p.name
  limit 2000
$$;

revoke execute on function family_player_ratings(text) from public, anon;
grant execute on function family_player_ratings(text) to authenticated, service_role;

comment on function family_player_ratings(text) is
  'T13.10 - every family player''s rating for one month (family-wide, a deliberate '
  'R3 exception alongside 037 and 038). Marks and shares only, no raw donations or '
  'attacks. Returns nothing to a caller holding no clan role.';


-- ---------------------------------------------------------------------------
-- Every month with a ranking, newest first. Same guard.
-- ---------------------------------------------------------------------------
create or replace function family_rating_months()
returns table (month text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.month
  from public.player_ratings r
  where exists (select 1 from public.auth_clan_ids())
     or current_setting('role', true) = 'service_role'
  order by r.month desc
$$;

revoke execute on function family_rating_months() from public, anon;
grant execute on function family_rating_months() to authenticated, service_role;

comment on function family_rating_months() is
  'T13.10 - the months family_player_ratings() has a ranking for, newest first.';


-- ---------------------------------------------------------------------------
-- sync_log learns the ratings job (R9). Dropped and re-added in one migration,
-- as 036 and 057 did, so job_type is never unconstrained.
-- ---------------------------------------------------------------------------
alter table sync_log drop constraint sync_log_job_type_check;
alter table sync_log add constraint sync_log_job_type_check
  check (job_type in ('clans', 'cwl', 'cwl-scout', 'war', 'raids', 'clan-games', 'players', 'ratings', 'backup'));


-- ---------------------------------------------------------------------------
-- Verify by hand, as a member of clan A:
--
--   select count(*) from family_player_ratings('2026-10');   -- the whole family
--   select count(*) from player_ratings;                     -- still ONLY A's
--
-- As a signed-in account holding no clan role at all:
--
--   select count(*) from family_player_ratings('2026-10');   -- 0
-- ---------------------------------------------------------------------------
