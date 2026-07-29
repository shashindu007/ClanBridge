-- T1.7 — Remaining feature tables: raids, clan games, layouts, announcements,
-- push subscriptions.

-- ---------------------------------------------------------------------------
-- raid_seasons / raid_participants — Clan Capital raid weekends.
--
-- Game facts (R11), written by scripts/sync/raids.ts. The API keeps recent
-- raid history, so unlike CWL a missed run here can still be backfilled.
-- ---------------------------------------------------------------------------
create table raid_seasons (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references clans (id) on delete restrict,
  start_time  timestamptz not null,
  end_time    timestamptz,
  total_loot  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (clan_id, start_time)
);

create trigger raid_seasons_set_updated_at
  before update on raid_seasons
  for each row execute function set_updated_at();

create table raid_participants (
  id               uuid primary key default gen_random_uuid(),
  raid_season_id   uuid not null references raid_seasons (id) on delete restrict,
  player_id        uuid not null references players (id) on delete restrict,
  attacks_used     smallint,
  loot             integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  deleted_at       timestamptz,

  unique (raid_season_id, player_id)
);

create trigger raid_participants_set_updated_at
  before update on raid_participants
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- clan_games / clan_games_scores — Clan Games participation.
--
-- The API exposes NO per-season score. points is derived at T7.4 by snapshotting
-- each player's "Games Champion" achievement value at the start and end of the
-- period and taking the difference. Miss the start snapshot and that season's
-- score cannot be reconstructed.
-- ---------------------------------------------------------------------------
create table clan_games (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references clans (id) on delete restrict,
  season      text not null,                  -- 'YYYY-MM'
  start_time  timestamptz,
  end_time    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (clan_id, season)
);

create trigger clan_games_set_updated_at
  before update on clan_games
  for each row execute function set_updated_at();

create table clan_games_scores (
  id             uuid primary key default gen_random_uuid(),
  clan_games_id  uuid not null references clan_games (id) on delete restrict,
  player_id      uuid not null references players (id) on delete restrict,
  points         integer,
  start_value    integer,                     -- achievement total at period start
  end_value      integer,                     -- and at period end; points is the difference
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  deleted_at     timestamptz,

  unique (clan_games_id, player_id)
);

create trigger clan_games_scores_set_updated_at
  before update on clan_games_scores
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- base_layouts — the layout library (M7).
--
-- R11: human data. The API provides no layout information of any kind, so every
-- row here is member-supplied. image_url points at Supabase Storage; the file is
-- compressed in the browser before upload (T8.2) to stay inside the 1 GB tier.
-- ---------------------------------------------------------------------------
create table base_layouts (
  id           uuid primary key default gen_random_uuid(),
  clan_id      uuid not null references clans (id) on delete restrict,
  uploaded_by  uuid not null references users (id) on delete restrict,
  th_level     smallint not null,
  layout_type  text not null check (layout_type in ('war', 'farming', 'trophy')),
  copy_link    text not null,
  image_url    text,
  description  text,
  votes        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  deleted_at   timestamptz
);

create trigger base_layouts_set_updated_at
  before update on base_layouts
  for each row execute function set_updated_at();

create index base_layouts_clan_id_idx on base_layouts (clan_id) where deleted_at is null;
create index base_layouts_filter_idx on base_layouts (clan_id, th_level, layout_type)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- announcements — the notice board (M8).
--
-- body is stored as plain text or restricted markdown and rendered safely.
-- Raw HTML is never rendered (T5.2) — anyone with posting rights would
-- otherwise be able to inject script into every member's browser.
-- ---------------------------------------------------------------------------
create table announcements (
  id          uuid primary key default gen_random_uuid(),
  clan_id     uuid not null references clans (id) on delete restrict,
  author_id   uuid not null references users (id) on delete restrict,
  title       text not null,
  body        text not null,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz
);

create trigger announcements_set_updated_at
  before update on announcements
  for each row execute function set_updated_at();

create index announcements_clan_id_idx on announcements (clan_id, pinned, created_at desc)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- push_subscriptions — Web Push endpoints (T5.5).
--
-- endpoint is unique: the browser issues one per installed app per device.
-- When the push service later returns 410 Gone the row is SOFT deleted (R4),
-- never removed.
-- ---------------------------------------------------------------------------
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete restrict,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz
);

create trigger push_subscriptions_set_updated_at
  before update on push_subscriptions
  for each row execute function set_updated_at();

create index push_subscriptions_user_id_idx on push_subscriptions (user_id)
  where deleted_at is null;
