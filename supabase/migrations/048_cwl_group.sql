-- 048 — The rest of the CWL group: the other seven clans and their wars.
--
-- Until now the sync kept only OUR war in each round (cwl_wars) and threw the
-- other three away. That was the right call for missed attacks, which only ever
-- concern our own roster, and the wrong one for everything a leader asks next:
-- where do we stand in the group, and so how many medals does this week pay?
-- The final position is decided by all 28 wars, not our 7, and the API deletes
-- the group when the season ends — a standings table not captured during the
-- week can never be rebuilt.
--
-- So two tables of GAME FACTS, written only by scripts/sync/cwl.ts (R11 allow-
-- list in scripts/sync/shared.ts):
--
--   cwl_group_clans   the eight clans in the group, once per season
--   cwl_group_wars    every war in the group, ours included, one row per war
--
-- STANDINGS ARE NOT STORED. services/cwl-standings.ts derives them from the
-- wars, like missed attacks are derived from rosters (002). A stored ranking is
-- a second source that can disagree with the wars it summarises, and a war
-- still running changes the ranking every hour.
--
-- Scoped to OUR season row (season_id), not to a group id the API does not
-- give: if two of the family's clans ever land in one group, each keeps its own
-- copy under its own season — which is why war_tag is unique per season rather
-- than globally, unlike cwl_wars.

create table cwl_group_clans (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references cwl_seasons (id) on delete restrict,
  clan_tag    text not null,
  name        text,
  badge_url   text,
  clan_level  smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (season_id, clan_tag),
  constraint cwl_group_clans_tag_format check (clan_tag = upper(clan_tag) and clan_tag like '#%')
);

create trigger cwl_group_clans_set_updated_at
  before update on cwl_group_clans
  for each row execute function set_updated_at();


-- One row per war in the group. `clan` and `opponent` are the API's two sides
-- in the API's order — neither is "us"; ours is found by tag like any other.
create table cwl_group_wars (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references cwl_seasons (id) on delete restrict,
  war_tag               text not null,
  day_number            smallint,
  state                 text check (state in ('preparation', 'inWar', 'warEnded')),
  team_size             smallint,
  clan_tag              text not null,
  opponent_tag          text not null,
  clan_stars            smallint,
  opponent_stars        smallint,
  clan_destruction      numeric(5, 2),
  opponent_destruction  numeric(5, 2),
  clan_attacks          smallint,
  opponent_attacks      smallint,
  start_time            timestamptz,
  end_time              timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  deleted_at            timestamptz,

  unique (season_id, war_tag),
  constraint cwl_group_wars_tag_format check (war_tag = upper(war_tag) and war_tag like '#%')
);

create index cwl_group_wars_season_idx on cwl_group_wars (season_id) where deleted_at is null;

create trigger cwl_group_wars_set_updated_at
  before update on cwl_group_wars
  for each row execute function set_updated_at();


-- RLS — read like cwl_wars: through the season, to members of the season's
-- clan. The other clans' names and scores are no secret (the game shows them to
-- anyone in the group), but the season they hang off is ours, and that is the
-- clan filter (R3).
alter table cwl_group_clans enable row level security;
alter table cwl_group_wars  enable row level security;

create policy "read own clan cwl group clans" on cwl_group_clans
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_group_clans.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan cwl group wars" on cwl_group_wars
  for select to authenticated
  using (
    exists (
      select 1 from cwl_seasons s
      where s.id = cwl_group_wars.season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

grant select on cwl_group_clans, cwl_group_wars to anon, authenticated;
grant select, insert, update on cwl_group_clans, cwl_group_wars to service_role;

-- No insert or update grant to authenticated: these are game facts, and only
-- the sync writes them. No delete grant for anybody (R4).
