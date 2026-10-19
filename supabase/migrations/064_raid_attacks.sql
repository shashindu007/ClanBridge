-- 064 — Every raid attack, and the league of every clan raided.
--
-- 004 and 027 keep a weekend's totals and each member's totals: attacks used,
-- the limit, the loot. What each ATTACK did — which district it hit, how far
-- it took it, and whether it was the one that finished it — arrives on the same
-- `/capitalraidseasons` response as `attackLog` and has been thrown away since
-- the first sync.
--
-- The raid rating (services/raid-rating.ts) is marked attack by attack, and
-- needs both things this adds:
--
--   * THE ATTACKS. The API gives each district's attacks with the district's
--     destruction AFTER each one, newest first. One attack's own share is that
--     number minus the one before it, so the order is the whole of the data.
--     attack_number is it: 1 for the first attack on the district.
--
--   * THE ENEMY'S LEAGUE. Not on the raid response at all — the defender there
--     is a tag, a name, a level and a badge. It is read from `/clans/{tag}` the
--     first time the sync sees the clan raided, and kept from then on: leagues
--     move when the weekend closes, and the league that counts is the one the
--     clan had while it was being raided.
--
-- THE DETAIL IS ONLY ON THE LATEST WEEKEND. Older weekends on the same response
-- have their districts' totals but no attacks and no members, so these tables
-- are filled while a weekend is the newest one, and never after.
-- attacks_captured_at says which weekends that happened for: "captured, and no
-- attacks" and "never captured" are both zero rows below, and the rating rates
-- the first and not the second — the same shape as 063's
-- opponent_attacks_captured_at.
--
-- All of it is a GAME FACT (R11), written only by scripts/sync/raids.ts.

alter table raid_seasons add column attacks_captured_at timestamptz;

comment on column raid_seasons.attacks_captured_at is
  'When raid_attacks and raid_opponents were last written for this weekend. '
  'Null means the attack detail was never captured, and the weekend cannot be '
  'rated — not that nobody attacked.';


-- ---------------------------------------------------------------------------
-- raid_opponents — each enemy capital raided in a weekend.
--
-- raid_number is the raid's place in the weekend, 1 for the first: the API
-- lists attackLog oldest first, and a raid stays where it is as the weekend
-- adds more after it. Keyed by it rather than by the defender's tag, which can
-- in principle come round twice.
--
-- Written once (R5). capital_league_id is the API's id (85000001 = Bronze
-- League III, up to 85000022 = Legend League), and null when the clan could
-- not be read — the rating gives that raid no league marks rather than a
-- guessed league.
-- ---------------------------------------------------------------------------
create table raid_opponents (
  id                 uuid primary key default gen_random_uuid(),
  raid_season_id     uuid not null references raid_seasons (id) on delete restrict,
  raid_number        smallint not null check (raid_number > 0),
  defender_tag       text not null,
  defender_name      text,
  capital_league_id  integer,
  capital_league     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  deleted_at         timestamptz,

  unique (raid_season_id, raid_number)
);

create trigger raid_opponents_set_updated_at
  before update on raid_opponents
  for each row execute function set_updated_at();

comment on table raid_opponents is
  'The enemy capitals one clan raided in one weekend, with each one''s capital '
  'league as it stood during the weekend (a game fact, R11).';


-- ---------------------------------------------------------------------------
-- raid_attacks — one row per attack by one of our members.
--
-- destruction and stars are the DISTRICT's after this attack, exactly as the
-- API sends them, not this attack's share of it. The share is derived (the
-- rating subtracts the attack before), never stored: a stored share is a
-- second number that could disagree with the first.
--
-- Append-only: an attack does not change once made, and the unique key makes
-- every later run a no-op (R5).
-- ---------------------------------------------------------------------------
create table raid_attacks (
  id                   uuid primary key default gen_random_uuid(),
  raid_season_id       uuid not null references raid_seasons (id) on delete restrict,
  raid_number          smallint not null check (raid_number > 0),
  district_id          integer not null,
  district_name        text,
  district_hall_level  smallint,
  -- 1 for the first attack on this district in this raid.
  attack_number        smallint not null check (attack_number > 0),
  player_id            uuid not null references players (id) on delete restrict,
  destruction          smallint not null check (destruction between 0 and 100),
  stars                smallint not null check (stars between 0 and 3),
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  unique (raid_season_id, raid_number, district_id, attack_number)
);

create index raid_attacks_season_idx
  on raid_attacks (raid_season_id) where deleted_at is null;
create index raid_attacks_player_id_idx
  on raid_attacks (player_id) where deleted_at is null;

comment on table raid_attacks is
  'Our members'' raid attacks, district by district. destruction and stars are '
  'the district''s after the attack; one attack''s share is derived.';


-- ---------------------------------------------------------------------------
-- RLS — one-level join to raid_seasons, the shape 006 gives raid_participants.
-- ---------------------------------------------------------------------------
alter table raid_opponents enable row level security;
alter table raid_attacks enable row level security;

create policy "read own clan raid opponents" on raid_opponents
  for select to authenticated
  using (
    exists (
      select 1 from raid_seasons s
      where s.id = raid_opponents.raid_season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

create policy "read own clan raid attacks" on raid_attacks
  for select to authenticated
  using (
    exists (
      select 1 from raid_seasons s
      where s.id = raid_attacks.raid_season_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

grant select on raid_opponents, raid_attacks to anon, authenticated;
grant select, insert, update on raid_opponents, raid_attacks to service_role;

-- No insert or update for `authenticated`, and no delete for anybody (R4, R11).


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- a member reads their own clan's attacks and no other clan's (R3):
--   select count(*) from raid_attacks;
--
--   -- and cannot invent one (R11 — no insert policy):
--   insert into raid_attacks (raid_season_id, raid_number, district_id,
--     attack_number, player_id, destruction, stars)
--     values ('<a season>', 1, 70000000, 1, '<a player>', 100, 3);  -- denied
-- ---------------------------------------------------------------------------
