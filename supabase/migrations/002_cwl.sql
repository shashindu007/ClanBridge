-- T1.5 — Clan War League tables.
--
-- This is the data the whole project exists to capture. Supercell deletes CWL
-- data when the season ends and it cannot ever be re-fetched, so every table
-- here is append-only in practice (R5) and never hard-deleted (R4).

-- ---------------------------------------------------------------------------
-- cwl_seasons — one row per clan per monthly league season.
-- ---------------------------------------------------------------------------
create table cwl_seasons (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references clans (id) on delete restrict,
  season      text not null,                  -- 'YYYY-MM', as the API reports it
  league      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  -- Natural key. Re-running the sync finds this row instead of making a second.
  unique (clan_id, season)
);

create trigger cwl_seasons_set_updated_at
  before update on cwl_seasons
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- cwl_wars — one war day within a season.
--
-- war_tag is Supercell's own identifier and the real idempotency key: the same
-- war appears under the same tag on every poll for the whole week.
-- ---------------------------------------------------------------------------
create table cwl_wars (
  id                  uuid primary key default gen_random_uuid(),
  season_id           uuid not null references cwl_seasons (id) on delete restrict,
  war_tag             text not null unique,
  day_number          smallint,
  opponent_tag        text,
  opponent_name       text,
  team_size           smallint,
  state               text check (state in ('preparation', 'inWar', 'warEnded')),
  our_stars           smallint,
  their_stars         smallint,
  our_destruction     numeric(5, 2),
  their_destruction   numeric(5, 2),
  result              text check (result in ('win', 'lose', 'tie')),
  start_time          timestamptz,
  end_time            timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  deleted_at          timestamptz,

  constraint cwl_wars_tag_format check (war_tag = upper(war_tag) and war_tag like '#%')
);

create trigger cwl_wars_set_updated_at
  before update on cwl_wars
  for each row execute function set_updated_at();

create index cwl_wars_season_id_idx on cwl_wars (season_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- cwl_attacks — the record everything else is built on.
--
-- THE UNIQUE CONSTRAINT BELOW IS THE MOST IMPORTANT LINE IN THIS FILE.
-- It is what makes ON CONFLICT DO NOTHING work (R5). Without it the clause
-- matches nothing, silently, and every sync run duplicates every attack — with
-- no error to notice.
--
-- CWL allows one attack per player per war, so attack_order is always 1 today.
-- It is kept anyway: T1.5 mandates it, and it keeps this table the same shape
-- as war_attacks, where multiple attacks are real.
--
-- Missed attacks are NOT stored. The API simply returns no attack for a player
-- who did not attack; the missed list is derived from roster minus attacks
-- (T4.3). Never insert a zero-star placeholder row to represent a miss.
-- ---------------------------------------------------------------------------
create table cwl_attacks (
  id                 uuid primary key default gen_random_uuid(),
  war_id             uuid not null references cwl_wars (id) on delete restrict,
  player_id          uuid not null references players (id) on delete restrict,
  attack_order       smallint not null default 1,
  stars              smallint not null check (stars between 0 and 3),
  destruction        numeric(5, 2) not null check (destruction between 0 and 100),
  defender_tag       text,
  defender_position  smallint,
  attacked_at        timestamptz,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  unique (war_id, player_id, attack_order)
);

create index cwl_attacks_war_id_idx on cwl_attacks (war_id) where deleted_at is null;
create index cwl_attacks_player_id_idx on cwl_attacks (player_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- cwl_bonuses — who received a bonus medal, and why.
--
-- R11: HUMAN DECISION DATA. No sync job may ever write here. The API does not
-- report bonus medal allocation at all — this exists nowhere but in our system,
-- which is exactly why it needs awarded_by and a note (T4.7).
-- ---------------------------------------------------------------------------
create table cwl_bonuses (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references cwl_seasons (id) on delete restrict,
  player_id   uuid not null references players (id) on delete restrict,
  awarded_by  uuid not null references users (id) on delete restrict,
  awarded_at  timestamptz not null default now(),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (season_id, player_id)
);

create trigger cwl_bonuses_set_updated_at
  before update on cwl_bonuses
  for each row execute function set_updated_at();
