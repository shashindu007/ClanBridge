-- T1.6 — Regular clan war tables.
--
-- R12 — war_targets is THE PLAN. war_attacks is WHAT HAPPENED.
-- They are separate tables and must stay that way. Never write a result into
-- war_targets: showing the gap between the two is the point (T6.5).

-- ---------------------------------------------------------------------------
-- wars — one row per war.
--
-- The API has no war id, so (clan_id, start_time) is the natural key: a clan
-- cannot be in two wars starting at the same instant.
-- ---------------------------------------------------------------------------
create table wars (
  id                 uuid primary key default gen_random_uuid(),
  clan_id            uuid not null references clans (id) on delete restrict,
  opponent_tag       text,
  opponent_name      text,
  team_size          smallint,
  state              text check (state in ('preparation', 'inWar', 'warEnded')),
  our_stars          smallint,
  their_stars        smallint,
  our_destruction    numeric(5, 2),
  their_destruction  numeric(5, 2),
  result             text check (result in ('win', 'lose', 'tie')),
  start_time         timestamptz not null,
  end_time           timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  deleted_at         timestamptz,

  unique (clan_id, start_time)
);

create trigger wars_set_updated_at
  before update on wars
  for each row execute function set_updated_at();

create index wars_clan_id_idx on wars (clan_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- war_targets — THE PLAN. Who was told to attack what.
--
-- R11: HUMAN DECISION DATA. scripts/sync/war.ts must never write here.
-- Leadership assigns targets; a member may claim an unassigned one (T6.4).
-- ---------------------------------------------------------------------------
create table war_targets (
  id               uuid primary key default gen_random_uuid(),
  war_id           uuid not null references wars (id) on delete restrict,
  player_id        uuid not null references players (id) on delete restrict,
  target_position  smallint not null,
  note             text,
  assigned_by      uuid references users (id) on delete restrict,
  assigned_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  deleted_at       timestamptz,

  -- One assignment per player per war. Reassigning updates this row; the change
  -- is recorded in audit_log rather than by inserting a second target.
  unique (war_id, player_id)
);

create trigger war_targets_set_updated_at
  before update on war_targets
  for each row execute function set_updated_at();

create index war_targets_war_id_idx on war_targets (war_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- war_attacks — WHAT HAPPENED. Written only by scripts/sync/war.ts (R11).
--
-- Same idempotency constraint as cwl_attacks. Here attack_order genuinely
-- varies: a regular war gives each player two attacks.
-- ---------------------------------------------------------------------------
create table war_attacks (
  id                 uuid primary key default gen_random_uuid(),
  war_id             uuid not null references wars (id) on delete restrict,
  player_id          uuid not null references players (id) on delete restrict,
  attack_order       smallint not null,
  stars              smallint not null check (stars between 0 and 3),
  destruction        numeric(5, 2) not null check (destruction between 0 and 100),
  defender_tag       text,
  defender_position  smallint,
  attacked_at        timestamptz,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  unique (war_id, player_id, attack_order)
);

create index war_attacks_war_id_idx on war_attacks (war_id) where deleted_at is null;
create index war_attacks_player_id_idx on war_attacks (player_id) where deleted_at is null;


-- QA: unindexed foreign key. The player profile (T3B.4) reads targets by player.
create index war_targets_player_id_idx on war_targets (player_id) where deleted_at is null;
