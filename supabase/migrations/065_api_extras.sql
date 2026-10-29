-- 065 — What the API already sends and the syncs were throwing away.
--
-- Five things, each a GAME FACT (R11) written only by scripts/sync/ and read
-- by members of the clan it belongs to. None of it is private: every number
-- here is on a public in-game profile or clan screen. What still matters is
-- WHO may read it here (the clan's own members, and a village's owner) and
-- that nobody but the sync can write it.
--
--   clan_profiles      the clan's war record and its Clan Capital
--                      (/clans/{tag}: warWins, warTies, warLosses,
--                      warWinStreak, capitalLeague, clanCapital)
--   player_profiles    a village's war preference, career numbers and
--                      achievements (/players/{tag})
--   war_attacks        + duration_seconds: how long each attack took
--   raid_defenses      how enemy clans attacked our capital (`defenseLog`)
--   raid_seasons       + defenses_captured_at, the same stamp 064 gives attacks
--
-- ─────────────────────────────────────────────────────────────────────────────
-- TWO OF THESE ARE THE LATEST READING, NOT A HISTORY
--
-- clan_profiles and player_profiles hold one row per clan and per village, and
-- the sync overwrites it. That is the shape `clans` and `players` already
-- have, and it is chosen for size: a daily history of 54 achievements for
-- every village would be about a million rows a year on a 500 MB database, to
-- answer a question nobody has asked. R5's append-only rule is about
-- snapshots — the history tables (member_snapshots, player_progress,
-- donation_counters) stay exactly as they are.
--
-- WHY clan_profiles IS NOT MORE COLUMNS ON clans. 015 gave sessions UPDATE on
-- clans so a platform admin can manage the clan list. Columns added there
-- would be editable by that session too. A table of its own is written by the
-- service role and by nothing else.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- clan_profiles — one row per clan, refreshed by sync:clans every half hour.
--
-- The war counts are null when the API leaves them out (a private war log
-- sends warWins and nothing else). capital_districts is
-- [{ "id": 70000000, "name": "Capital Peak", "level": 10 }, ...], the order
-- the API sends them in.
-- ---------------------------------------------------------------------------
create table clan_profiles (
  id                  uuid primary key default gen_random_uuid(),
  clan_id             uuid not null unique references clans (id) on delete restrict,
  war_wins            integer check (war_wins >= 0),
  war_ties            integer check (war_ties >= 0),
  war_losses          integer check (war_losses >= 0),
  war_win_streak      integer check (war_win_streak >= 0),
  capital_league      text,
  capital_hall_level  smallint,
  capital_districts   jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  deleted_at          timestamptz
);

create trigger clan_profiles_set_updated_at
  before update on clan_profiles
  for each row execute function set_updated_at();

comment on table clan_profiles is
  'The latest war record and Clan Capital of one clan, as the API reported it '
  '(a game fact, R11). Overwritten by sync:clans; not a history.';


-- ---------------------------------------------------------------------------
-- player_profiles — one row per village, refreshed by sync:players daily.
--
-- clan_id follows 036 exactly: the clan the village is filed under for this
-- reading, and null once it has left every platform clan, so a clan it USED to
-- be in stops receiving its new numbers. Its owner still sees them.
--
-- war_preference is 'in' or 'out' — the player's own setting in game, which
-- is what decides whether matchmaking can put them in a war at all. Not a
-- CHECK: an unexpected word from the API is stored as null by the mapper
-- rather than failing the whole daily run.
--
-- achievements is [{ "name", "stars", "value", "target", "info", "village" }].
-- ---------------------------------------------------------------------------
create table player_profiles (
  id                          uuid primary key default gen_random_uuid(),
  player_id                   uuid not null unique references players (id) on delete restrict,
  clan_id                     uuid references clans (id) on delete restrict,
  war_preference              text,
  exp_level                   smallint,
  best_trophies               integer,
  attack_wins                 integer,
  defense_wins                integer,
  war_stars                   integer,
  capital_contributions       bigint,
  builder_base_trophies       integer,
  best_builder_base_trophies  integer,
  achievements                jsonb not null default '[]'::jsonb,
  captured_at                 timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  deleted_at                  timestamptz
);

create index player_profiles_clan_id_idx
  on player_profiles (clan_id) where deleted_at is null;

create trigger player_profiles_set_updated_at
  before update on player_profiles
  for each row execute function set_updated_at();

comment on table player_profiles is
  'The latest /players reading of one village beyond its unit levels: war '
  'preference, career numbers, achievements (a game fact, R11). Overwritten '
  'by sync:players; not a history.';


-- ---------------------------------------------------------------------------
-- war_attacks.duration_seconds — how long the attack ran, from the API.
--
-- Null for every attack written before 065: those rows are insert-once (R5)
-- and are not revisited to fill it in.
-- ---------------------------------------------------------------------------
alter table war_attacks
  add column duration_seconds smallint check (duration_seconds >= 0);

comment on column war_attacks.duration_seconds is
  'How long the attack lasted, in seconds, as the API reported it. Null before 065.';


-- ---------------------------------------------------------------------------
-- raid_defenses — one row per district of ours, per enemy clan that raided us.
--
-- Written ONCE, after the weekend has ended. During the weekend an enemy's
-- raid on us is still moving, and an insert-once row written then would keep
-- the half-way numbers for good. The API sends `defenseLog` on every weekend
-- it returns, finished ones included, so waiting costs nothing.
--
-- raid_number is the raid's place in the weekend's defenseLog, 1 for the first.
-- defenses_captured_at on raid_seasons says the log was read, so "nobody
-- raided us" (zero rows, stamped) and "never read" (zero rows, null) are told
-- apart — the shape 063 and 064 use.
-- ---------------------------------------------------------------------------
alter table raid_seasons add column defenses_captured_at timestamptz;

comment on column raid_seasons.defenses_captured_at is
  'When raid_defenses was written for this weekend. Null means the defence '
  'log was never captured, not that nobody raided the clan.';

create table raid_defenses (
  id                   uuid primary key default gen_random_uuid(),
  raid_season_id       uuid not null references raid_seasons (id) on delete restrict,
  raid_number          smallint not null check (raid_number > 0),
  attacker_tag         text not null,
  attacker_name        text,
  attacker_level       smallint,
  district_id          integer not null,
  district_name        text,
  district_hall_level  smallint,
  attack_count         smallint not null check (attack_count >= 0),
  destruction          smallint not null check (destruction between 0 and 100),
  stars                smallint not null check (stars between 0 and 3),
  total_looted         integer,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  unique (raid_season_id, raid_number, district_id)
);

create index raid_defenses_season_idx
  on raid_defenses (raid_season_id) where deleted_at is null;

comment on table raid_defenses is
  'How each enemy clan''s raid on our capital went, district by district '
  '(a game fact, R11). Written once, after the weekend ended.';


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table clan_profiles enable row level security;
alter table player_profiles enable row level security;
alter table raid_defenses enable row level security;

create policy "read own clan profile" on clan_profiles
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

-- The two policies 036 gives player_progress, for the same two readers: a
-- member of the clan the reading is filed under, and the village's owner.
create policy "read own clan player profiles" on player_profiles
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

create policy "read own player profiles" on player_profiles
  for select to authenticated
  using (player_id in (select auth_owned_player_ids()));

-- One-level join to raid_seasons, as 064's raid_attacks.
create policy "read own clan raid defenses" on raid_defenses
  for select to authenticated
  using (
    exists (
      select 1 from raid_seasons s
      where s.id = raid_defenses.raid_season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

grant select on clan_profiles, player_profiles, raid_defenses to anon, authenticated;
grant select, insert, update on clan_profiles, player_profiles, raid_defenses to service_role;

-- No insert or update for `authenticated`, and no delete for anybody (R4, R11).


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- a member reads their own clan's profile and no other clan's (R3):
--   select count(*) from clan_profiles;   -- 1 per clan they belong to
--
--   -- and cannot change one (R11 — no update policy, no grant):
--   update clan_profiles set war_wins = 9999;   -- denied
-- ---------------------------------------------------------------------------
