-- T1.4 — Core tables: clans, users, players, clan_roles.
--
-- Apply in the Supabase SQL editor, in numeric order. Once applied, never edit
-- this file — fix forward with a new migration (section 4).
--
-- Conventions: snake_case, plural names, uuid primary keys, created_at on every
-- table, deleted_at on every table (R4 — nothing is ever deleted).

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at honest without relying on every caller.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- clans — the three clans. Seeded by supabase/seed.sql (T1.10).
-- ---------------------------------------------------------------------------
create table clans (
  id          uuid primary key default gen_random_uuid(),
  tag         text not null unique,
  name        text not null,
  badge_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  -- Section 4: tags are stored with the hash and uppercased on write.
  -- Enforced here so a bad write fails loudly instead of producing a 404 later.
  constraint clans_tag_format check (tag = upper(tag) and tag like '#%')
);

create trigger clans_set_updated_at
  before update on clans
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- users — application profile, one per Supabase auth user.
--
-- Architecture.md 7.1 puts the auth user above the profile, so id IS the auth
-- user id rather than a separate key. on delete restrict, never cascade: R4
-- means a row is never removed as a side effect of something else.
-- ---------------------------------------------------------------------------
create table users (
  id            uuid primary key references auth.users (id) on delete restrict,
  email         text not null,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- players — one row per Clash of Clans account.
--
-- Written by scripts/sync/clans.ts from the clan member list (R11: game fact).
-- user_id is NULLABLE and stays null until the player verifies at T3.3 — sync
-- creates these rows long before anyone claims them.
-- ---------------------------------------------------------------------------
create table players (
  id            uuid primary key default gen_random_uuid(),
  clan_id       uuid references clans (id) on delete restrict,
  user_id       uuid references users (id) on delete restrict,
  tag           text not null unique,          -- T1.4: the idempotency key for sync
  name          text not null,
  th_level      smallint,
  verified      boolean not null default false,
  current_role  text check (current_role in ('leader', 'co-leader', 'elder', 'member')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,

  constraint players_tag_format check (tag = upper(tag) and tag like '#%')
);

create trigger players_set_updated_at
  before update on players
  for each row execute function set_updated_at();

-- Partial indexes: every read filters deleted_at is null, so the dead rows are
-- not worth indexing.
create index players_clan_id_idx on players (clan_id) where deleted_at is null;
create index players_user_id_idx on players (user_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- clan_roles — a user's role within one clan.
--
-- Roles are PER CLAN, not global: co-leader of clan A is an ordinary member of
-- clan B. This table is also what auth_clan_ids() reads in 006_rls.sql, which
-- makes it the root of the whole authorisation model.
-- ---------------------------------------------------------------------------
create table clan_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete restrict,
  clan_id     uuid not null references clans (id) on delete restrict,
  role        text not null check (role in ('leader', 'co-leader', 'elder', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  unique (user_id, clan_id)
);

create trigger clan_roles_set_updated_at
  before update on clan_roles
  for each row execute function set_updated_at();

create index clan_roles_user_id_idx on clan_roles (user_id) where deleted_at is null;
create index clan_roles_clan_id_idx on clan_roles (clan_id) where deleted_at is null;
