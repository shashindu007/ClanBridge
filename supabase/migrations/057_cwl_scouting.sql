-- 057 — Scouting the rest of the CWL group: who they are, who they field, and
-- how close their villages are to their Town Hall's max.
--
-- 048 kept the other seven clans' names and scores. Everything else the sync
-- already downloads was thrown away on the way past:
--
--   * the league group lists every clan's registered roster WITH Town Hall
--     levels — the "TH18 ×5, TH17 ×8" a leader asks about first;
--   * every group war carries both lineups (Town Hall, map position) and every
--     attack made in it — who actually fights, who misses, who gets 3-starred.
--
-- Neither costs an API call: both come back on requests the sync makes anyway,
-- and Supercell deletes both when the season ends.
--
-- The third table is the one thing that does cost calls: one /players/{tag}
-- per enemy, read by scripts/sync/cwl-scout.ts at most once a day. It is a
-- SUMMARY, deliberately not a copy of player_progress's units jsonb. That shape
-- is 10-20 KB a village; read daily for ~350 enemies across three clans it would
-- spend a free-tier database's 500 MB in a few months on people who are not
-- ours. One small row per enemy per season, refreshed in place, is ~0.5 KB.
--
-- All three are GAME FACTS (R11), written only by the sync jobs, read through
-- OUR season row exactly like 048: the enemy's data is no secret, but the season
-- it hangs off is ours, and that is the clan filter (R3).

create table cwl_group_members (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references cwl_seasons (id) on delete restrict,
  clan_tag    text not null,
  tag         text not null,
  name        text,
  th_level    smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (season_id, tag),
  constraint cwl_group_members_clan_tag_format check (clan_tag = upper(clan_tag) and clan_tag like '#%'),
  constraint cwl_group_members_tag_format check (tag = upper(tag) and tag like '#%')
);

create index cwl_group_members_season_idx on cwl_group_members (season_id) where deleted_at is null;

create trigger cwl_group_members_set_updated_at
  before update on cwl_group_members
  for each row execute function set_updated_at();


-- One row per player per group war: the lineup that was actually fielded, and
-- the attack that player made (CWL gives one, so it sits inline — null when
-- they did not attack). Defence is not stored: it is the other side's attacks
-- read by defender_tag, derived like missed attacks are (002).
create table cwl_group_war_members (
  id                   uuid primary key default gen_random_uuid(),
  season_id            uuid not null references cwl_seasons (id) on delete restrict,
  war_tag              text not null,
  clan_tag             text not null,
  tag                  text not null,
  name                 text,
  th_level             smallint,
  map_position         smallint,
  attack_stars         smallint check (attack_stars between 0 and 3),
  attack_destruction   numeric(5, 2),
  attack_defender_tag  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  deleted_at           timestamptz,

  unique (season_id, war_tag, tag),
  constraint cwl_group_war_members_war_tag_format check (war_tag = upper(war_tag) and war_tag like '#%'),
  constraint cwl_group_war_members_tag_format check (tag = upper(tag) and tag like '#%')
);

create index cwl_group_war_members_season_idx on cwl_group_war_members (season_id) where deleted_at is null;

create trigger cwl_group_war_members_set_updated_at
  before update on cwl_group_war_members
  for each row execute function set_updated_at();

-- Which group wars have had their lineups recorded. A war that ended before
-- this migration was stored with scores only and is never fetched again, so the
-- sync needs to know which ones to ask for once more while the API still has
-- them. A flag on the war, not a scan of the member rows: those run past
-- PostgREST's 1000-row page in a single season.
alter table cwl_group_wars add column members_captured_at timestamptz;


-- One reading per enemy village per season, scored against the Town Hall cap
-- at capture (src/data/game), like player_progress. `heroes` is a short array of
-- { short, name, level, cap } — the six numbers a lineup is decided on — not
-- the full unit list.
create table cwl_scout_players (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references cwl_seasons (id) on delete restrict,
  clan_tag       text not null,
  tag            text not null,
  name           text,
  th_level       smallint,
  heroes         jsonb not null default '[]'::jsonb,
  hero_pct       numeric(4, 1),
  pet_pct        numeric(4, 1),
  equipment_pct  numeric(4, 1),
  offence_pct    numeric(4, 1),
  max_pct        numeric(4, 1),
  war_stars      integer,
  captured_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  deleted_at     timestamptz,

  unique (season_id, tag),
  constraint cwl_scout_players_tag_format check (tag = upper(tag) and tag like '#%'),
  constraint cwl_scout_players_heroes_array check (jsonb_typeof(heroes) = 'array')
);

create index cwl_scout_players_season_idx on cwl_scout_players (season_id) where deleted_at is null;

create trigger cwl_scout_players_set_updated_at
  before update on cwl_scout_players
  for each row execute function set_updated_at();


-- RLS — through the season, to members of the season's clan, as 048.
alter table cwl_group_members     enable row level security;
alter table cwl_group_war_members enable row level security;
alter table cwl_scout_players     enable row level security;

create policy "read own clan cwl group members" on cwl_group_members
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_group_members.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan cwl group war members" on cwl_group_war_members
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_group_war_members.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan cwl scout players" on cwl_scout_players
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_scout_players.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

grant select on cwl_group_members, cwl_group_war_members, cwl_scout_players to anon, authenticated;
grant select, insert, update on cwl_group_members, cwl_group_war_members, cwl_scout_players to service_role;

-- No insert or update grant to authenticated: game facts, written only by the
-- sync. No delete grant for anybody (R4).


-- ---------------------------------------------------------------------------
-- sync_log learns the scouting job (R9). Dropped and re-added in one
-- migration, as 036 did, so job_type is never unconstrained.
-- ---------------------------------------------------------------------------
alter table sync_log drop constraint sync_log_job_type_check;
alter table sync_log add constraint sync_log_job_type_check
  check (job_type in ('clans', 'cwl', 'cwl-scout', 'war', 'raids', 'clan-games', 'players', 'backup'));
