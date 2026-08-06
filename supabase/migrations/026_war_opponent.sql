-- T6.3 — "War board page. BOTH ROSTERS, attack status per base."
--
-- Only one roster exists. 024 gave war_members, which references players and
-- therefore holds our side alone; the opponent arrives on the same API response
-- and is thrown away, exactly as 020 found the clan detail being thrown away
-- hourly since T2.4.
--
-- Without it the board can show base numbers and nothing else, and T6.4 — the
-- feature this whole phase is arranged around — becomes "assign your TH16 to
-- base 7" with no way to know what base 7 is. A leader who cannot see the
-- opposing lineup assigns targets by position and hope.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT war_members WITH A `side` COLUMN, AND NOT players ROWS
--
-- war_members.player_id is NOT NULL and references players. Widening it to hold
-- the opposition means either a nullable FK — after which every join in the war
-- module needs a filter nobody will remember on the first day — or creating
-- players rows for them.
--
-- Creating players rows is the one that looks convenient and is not. `players`
-- is the member directory (T3B.2), the donation report (T3B.3), the inactivity
-- list (T3B.5), the cross-clan search (T3B.6) and the roster pool (T4B.7).
-- Fifty strangers per war, permanently, in all of them — and R4 means the
-- correction is a deleted_at, never a delete. A separate table costs one join
-- and cannot leak into anything.
--
-- R11 — a GAME FACT, written only by scripts/sync/war.ts.
--
-- NO TAG FORMAT CONSTRAINT, unlike players. That check exists to catch a human
-- transcribing a tag wrongly (001_core.sql:95-98). Nothing here is typed by a
-- human; it comes from the API. A war whose opponent has a tag Supercell accepts
-- and this project's regex does not would fail the whole sync, which is a far
-- worse outcome than storing an odd-looking tag.
-- ─────────────────────────────────────────────────────────────────────────────

create table war_opponent_members (
  id           uuid primary key default gen_random_uuid(),
  war_id       uuid not null references wars (id) on delete restrict,
  tag          text not null,
  name         text,
  map_position smallint,
  th_level     smallint,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  -- The idempotency key. Without it ON CONFLICT DO NOTHING matches nothing and
  -- every sync run duplicates the entire opposing roster, silently — the same
  -- hole 019 and 024 each name in their headers.
  unique (war_id, tag)
);

create index war_opponent_members_war_id_idx
  on war_opponent_members (war_id) where deleted_at is null;

-- The lookup war_attacks.defender_position is resolved through, and the one the
-- board reads for every row.
create index war_opponent_members_position_idx
  on war_opponent_members (war_id, map_position) where deleted_at is null;

comment on table war_opponent_members is
  'The opposing lineup for one war (a game fact, R11). Deliberately NOT in '
  'players: they are not members of any of the three clans, and putting them '
  'there would place fifty strangers per war into the member directory, the '
  'donation report and the cross-clan search, permanently (R4).';

alter table war_opponent_members enable row level security;

-- One-level join, the same shape 024 uses for war_members: `wars` carries
-- clan_id directly.
create policy "read own clan war opponents" on war_opponent_members
  for select to authenticated
  using (
    exists (
      select 1 from wars w
      where w.id = war_opponent_members.war_id
        and w.clan_id in (select auth_clan_ids())
    )
  );

grant select on war_opponent_members to anon, authenticated;
grant select, insert, update on war_opponent_members to service_role;

-- No insert or update for `authenticated`, and no delete for anybody. This is
-- what the API said, not something a person edits (R11), and R4 forbids the
-- delete regardless.


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- as a member, the opposing lineup for your own war is visible:
--   select count(*) from war_opponent_members;         -- teamSize
--
--   -- and another clan's is not (R3):
--   select count(*) from war_opponent_members
--    where war_id = '<another clan's war>';            -- 0
--
--   -- a leader may not invent an opponent:
--   insert into war_opponent_members (war_id, tag) values ('<war>', '#X');
--                                                       -- denied
-- ---------------------------------------------------------------------------
