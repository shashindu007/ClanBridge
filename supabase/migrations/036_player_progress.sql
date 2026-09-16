-- T11B.4 — player_progress: how far along each village is, one row a day.
--
-- Written by scripts/sync/players.ts from /players/{tag}. A GAME FACT (R11):
-- only the sync job writes it and no person ever edits it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE ROW PER PLAYER PER DAY, WITH THE UNITS AS JSONB
--
-- A tall table — one row per unit per player per day — is rejected on
-- arithmetic: about 150 units x 150 players x 365 days is over 8 M rows a year
-- against a 500 MB tier. That is the same calculation 007 used to justify its
-- hourly bucket. Nothing queries a single unit across players, so the tall shape
-- buys nothing it would cost.
--
-- `captured_day` needs `at time zone 'UTC'` for the reason 007 records:
-- date_trunc() over a timestamptz depends on the session TimeZone, so it is not
-- immutable, and PostgreSQL refuses it in a generated column.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CAP IS STORED, NOT RECOMPUTED — THE NON-OBVIOUS PART
--
-- Each element of `units` is
--
--   { name, village, group, level, apiMax, cap, capKnown }
--
-- where `cap` is the Town Hall cap from src/data/game/ AT THE TIME OF CAPTURE.
-- Supercell raises caps with every update. Storing only levels would make every
-- historical row silently re-score itself against today's caps the moment the
-- game data is refreshed, so a base that was maxed for its Town Hall in March
-- would read as behind in June. Nothing would report it, because both numbers
-- look plausible. That is the same class of bug writeStart()'s ignoreDuplicates
-- note in scripts/sync/clan-games.ts describes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — TWO READ POLICIES, OR-ED
--
-- `clan_id` is the clan the village was in WHEN CAPTURED, and the clan policy
-- is 006's shape: a leader reads the progress of villages captured while they
-- were in the leader's clan.
--
-- The owner policy goes through 031's auth_owned_player_ids() and inherits 031's
-- R3 argument in full: it returns only rows about villages whose user_id is the
-- caller, which is strictly NARROWER than a clan filter, and permissive policies
-- only ever add rows. It is what lets a member see the details of a village that
-- sits in a clan they hold no role in, or in no platform clan at all — which is
-- why `clan_id` is nullable. players.ts snapshots owned villages that have left
-- every platform clan, so their owner's page keeps filling in.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R5 — APPEND-ONLY AS A PRIVILEGE, NOT A CONVENTION
--
-- The sync job inserts with ON CONFLICT DO NOTHING against the unique key. 014
-- set default privileges that give service_role INSERT and UPDATE on every table
-- created after it, so the REVOKE below is the line that makes a historical row
-- impossible to rewrite, rather than merely unusual. 024 and 033 record the same
-- finding.

create table player_progress (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references players (id) on delete restrict,
  clan_id          uuid references clans (id) on delete restrict,
  captured_at      timestamptz not null default now(),

  th_level         smallint,
  th_weapon_level  smallint,
  bh_level         smallint,
  units            jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  captured_day     timestamp generated always as
                     (date_trunc('day', captured_at at time zone 'UTC')) stored,

  constraint player_progress_units_array check (jsonb_typeof(units) = 'array'),

  unique (player_id, captured_day)
);

-- Every read is "this player, newest first" (latestProgress) or "this player
-- over a window" (progressHistory).
create index player_progress_player_idx
  on player_progress (player_id, captured_at desc)
  where deleted_at is null;

alter table player_progress enable row level security;

create policy "read own clan player progress" on player_progress
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own base progress" on player_progress
  for select to authenticated
  using (player_id in (select auth_owned_player_ids()));

grant select on player_progress to anon, authenticated;
grant select, insert on player_progress to service_role;
revoke update, delete on player_progress from service_role;

comment on table player_progress is
  'T11B.4 - one daily reading per village of its hero, equipment, pet, troop, '
  'siege and spell levels, each with the Town Hall cap applied at capture. A GAME '
  'FACT (R11): written only by scripts/sync/players.ts, append-only (R5).';


-- ---------------------------------------------------------------------------
-- sync_log learns the new job type (R9).
--
-- 005's check was declared inline and unnamed, so PostgreSQL named it
-- sync_log_job_type_check. Dropped and re-added in one migration, so there is
-- no window in which job_type is unconstrained.
-- ---------------------------------------------------------------------------
alter table sync_log drop constraint sync_log_job_type_check;
alter table sync_log add constraint sync_log_job_type_check
  check (job_type in ('clans', 'cwl', 'war', 'raids', 'clan-games', 'players', 'backup'));
