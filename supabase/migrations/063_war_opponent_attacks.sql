-- 063 — The other half of a regular war: the enemy's attacks, and the order of
-- every attack.
--
-- 003 and 024 keep what OUR players did in a war. 026 added the opposing
-- lineup, for the board. What the enemy did to us — which of our bases they
-- attacked, and how each held up — arrives on the same API response every hour
-- and has been thrown away since the first sync.
--
-- The war rating (services/war-rating.ts) is the CWL rating applied to regular
-- wars, and it needs both things this adds:
--
--   * DEFENCE. A base held to one star, or 3-starred by a base far below it,
--     is half of a player's war. It is the enemy's attacks read by the tag they
--     hit — derived, like missed attacks, never stored as a verdict.
--
--   * ORDER. In a regular war a base is hit by several of our players as a
--     matter of course: 7 to 25 bases a war. An attack that adds a star earned
--     its marks; one that adds none did not, and only the order says which is
--     which. war_attacks.attack_order is the player's own first or second
--     attack (003), deliberately — it cannot tell two players apart.
--
-- NOT BACKFILLED, and it cannot be: the API serves the current war only. The
-- wars already stored are rated on their attacks alone, and the rating says so.
--
-- All of it is a GAME FACT (R11), written only by scripts/sync/war.ts.

-- ---------------------------------------------------------------------------
-- The order of OUR attacks within the war — the API's `order`, 1 for the first
-- attack of the war by either side. Null for a row written before this.
-- ---------------------------------------------------------------------------
alter table war_attacks add column war_order smallint;

comment on column war_attacks.war_order is
  'The API''s order of this attack within the war, both sides counted (1 = first). '
  'Not attack_order, which is the player''s own first or second. Null before 063.';


-- ---------------------------------------------------------------------------
-- When the enemy's attacks were last written for this war. "Recorded, and they
-- made none" and "never recorded" are both zero rows below; only this tells
-- them apart, and the rating treats them very differently — a base nobody
-- attacked earns marks, a war nobody recorded earns none.
-- ---------------------------------------------------------------------------
alter table wars add column opponent_attacks_captured_at timestamptz;


-- ---------------------------------------------------------------------------
-- war_opponent_attacks — what the other side did.
--
-- Shaped like war_attacks, keyed like war_opponent_members: by the attacker's
-- TAG, because the opposition are not in `players` and must not be (026). No
-- FK to war_opponent_members either — an attack is a fact about the war, and a
-- lineup row missing for any reason must not make it unstorable.
--
-- Append-only, like war_attacks: an attack does not change once made, and the
-- unique key makes every later run a no-op (R5).
-- ---------------------------------------------------------------------------
create table war_opponent_attacks (
  id            uuid primary key default gen_random_uuid(),
  war_id        uuid not null references wars (id) on delete restrict,
  attacker_tag  text not null,
  -- The attacker's own first or second attack, as war_attacks.attack_order.
  attack_order  smallint not null,
  defender_tag  text,
  stars         smallint not null check (stars between 0 and 3),
  destruction   numeric(5, 2) not null check (destruction between 0 and 100),
  -- The API's order within the war, as war_attacks.war_order.
  war_order     smallint,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  unique (war_id, attacker_tag, attack_order)
);

create index war_opponent_attacks_war_id_idx
  on war_opponent_attacks (war_id) where deleted_at is null;

comment on table war_opponent_attacks is
  'The opposing side''s attacks in one war (a game fact, R11). Our defence is '
  'these read by defender_tag; it is derived, never stored.';

alter table war_opponent_attacks enable row level security;

-- One-level join, the shape 026 uses for the opposing lineup.
create policy "read own clan war opponent attacks" on war_opponent_attacks
  for select to authenticated
  using (
    exists (
      select 1 from wars w
      where w.id = war_opponent_attacks.war_id
        and w.clan_id in (select auth_clan_ids())
    )
  );

grant select on war_opponent_attacks to anon, authenticated;
grant select, insert, update on war_opponent_attacks to service_role;

-- No insert or update for `authenticated`, and no delete for anybody (R4, R11).
