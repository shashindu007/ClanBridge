-- T2.9 — member_snapshots.
--
-- Supercell reports donations, trophies and war stars as CUMULATIVE totals that
-- reset monthly. A single reading is therefore meaningless on its own. Taking a
-- snapshot on every sync run and differencing across the season is the only way
-- to derive per-season figures (T3B.3) or to detect inactivity (T3B.5).
--
-- Without this table, the whole of Phase 3B has nothing to display.

create table member_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  clan_id             uuid not null references clans (id) on delete restrict,
  player_id           uuid not null references players (id) on delete restrict,
  captured_at         timestamptz not null default now(),

  donations           integer,
  donations_received  integer,
  trophies            integer,
  war_stars           integer,
  th_level            smallint,
  role                text check (role in ('leader', 'co-leader', 'elder', 'member')),

  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  -- ---------------------------------------------------------------------
  -- Resolving a conflict the spec leaves open.
  --
  -- T2.9 says "one row per player per run". R5 says running a job five times
  -- must change nothing after the first. Taken literally those disagree: with
  -- captured_at defaulting to now(), a re-run always inserts a second row.
  --
  -- Bucketing to the hour settles it. The hourly clans sync is idempotent
  -- within its hour, so a manual re-run, a retry, or one of GitHub's duplicate
  -- firings costs nothing.
  --
  -- It also bounds growth: at most 24 rows per player per day, roughly 1.3 M
  -- rows a year for 150 players, which is what keeps this inside the 500 MB
  -- free tier. Without the bucket, a 15-minute cadence would quadruple that.
  --
  -- The `at time zone 'UTC'` is required, not decorative. date_trunc() over a
  -- timestamptz depends on the session TimeZone, so it is not immutable and
  -- PostgreSQL rejects it outright in a generated column. Anchoring to UTC makes
  -- it immutable and gives a bucket that is stable no matter which timezone the
  -- connection happens to be in — which is also what section 4 asks for: stored
  -- UTC, converted only for display.
  -- ---------------------------------------------------------------------
  captured_hour       timestamp generated always as
                        (date_trunc('hour', captured_at at time zone 'UTC')) stored,

  unique (player_id, captured_hour)
);

-- Every profile and trend query is "this player, most recent first" (T3B.4).
create index member_snapshots_player_idx
  on member_snapshots (player_id, captured_at desc)
  where deleted_at is null;

-- The directory reads a whole clan at one point in time (T3B.2).
create index member_snapshots_clan_idx
  on member_snapshots (clan_id, captured_at desc)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- RLS. A table added without this is invisible in the catalogue check but wide
-- open in production, so it goes in the same migration as the table itself.
-- ---------------------------------------------------------------------------
alter table member_snapshots enable row level security;

create policy "read own clan member snapshots" on member_snapshots
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

grant select on member_snapshots to anon, authenticated;
