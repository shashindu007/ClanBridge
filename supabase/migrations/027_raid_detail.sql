-- T7.1/T7.3/T7.4 — the raid and Clan Games detail 004 had nowhere to put.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS IS THE FOURTH TIME, AND THE FIRST TIME IT WAS SEEN COMING
--
-- 019 found the CWL roster being fetched and dropped. 020 found the clan detail.
-- 026 found the opposing war lineup. Each time the API had already sent the data
-- and the sync had nowhere to put it, and each time the feature that needed it
-- could not be built until a table existed.
--
-- IMPLEMENTATION.md §0 then wrote the prediction down by name: "the raid and
-- Clan Games responses in Phase 7 carry more than their tables hold. Worth
-- suspecting on every remaining endpoint." It was right. This migration lands
-- BEFORE scripts/sync/raids.ts is written rather than after, which is the only
-- difference between this one and the three before it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- R11 — everything added here is a GAME FACT, written only by
-- scripts/sync/raids.ts and scripts/sync/clan-games.ts. No new policies and no
-- new grants: 006 already grants select on all four tables and 014 already
-- grants select/insert/update to service_role, so the sync can write the new
-- columns the moment they exist. A column is not a table; the existing row
-- policies cover it.


-- ---------------------------------------------------------------------------
-- raid_seasons — what the weekend actually was
--
-- 004 stored start_time, end_time and total_loot. raidSeasonSchema
-- (coc-schemas.ts:198) carries five more fields on the same response.
-- ---------------------------------------------------------------------------

alter table raid_seasons
  -- 'ongoing' | 'ended', per the API. Without it a page cannot tell a weekend
  -- still being played from one that finished, and R10's "an ongoing raid is
  -- not a failure" has nothing to read.
  add column state text,

  -- How many of the offered raids the clan actually completed, and how many
  -- attacks the whole clan spent. The denominators for T7.3's participation
  -- view — a numerator on its own is a number nobody can act on.
  add column raids_completed smallint,
  add column total_attacks smallint,

  -- RAID MEDALS. Offensive is the payout every member receives and is the one
  -- number members actually argue about after a weekend; defensive is the
  -- smaller payout from being raided. Dropping these means the page can show
  -- loot — which buys nothing — and not the reward, which buys everything.
  add column offensive_reward integer,
  add column defensive_reward integer;

comment on column raid_seasons.offensive_reward is
  'Raid medals awarded for attacking. The number members compare weekends by.';


-- ---------------------------------------------------------------------------
-- raid_participants — the denominator
--
-- 004 stored attacks_used and loot. T7.3 asks for "attacks used", and
-- "5" alone does not answer it: a member with 5 of 5 did everything asked and a
-- member with 5 of 6 did not. The limit is per-member and it VARIES — a
-- bonus attack is awarded to some members and not others — so it cannot be
-- inferred from a constant the way a regular war's two attacks can.
--
-- Same shape of mistake as CWL's boolean `missed` being wrong for a war that
-- gives two attacks (T6.9). The unit has to carry its own denominator.
-- ---------------------------------------------------------------------------

alter table raid_participants
  add column attack_limit smallint,
  add column bonus_attack_limit smallint;

comment on column raid_participants.attack_limit is
  'Attacks this member was offered, excluding the bonus. attacks_used without '
  'it is a numerator with no denominator: 5 of 5 and 5 of 6 are different '
  'answers to "did they do what was asked".';


-- ---------------------------------------------------------------------------
-- clan_games — the window, and when the season stops moving
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `settled_at` EXISTS
--
-- T7.4 has no API to read a score from. It snapshots each player's "Games
-- Champion" achievement at the start of the period into start_value, and again
-- at the end into end_value, and the difference is that season's points.
--
-- That end pass must UPDATE a row the start pass inserted. R5 says a historical
-- row is never rewritten, and without a marker there is no way to tell "this
-- season is still running, the end value may still move" from "this season
-- finished in March and must never be touched again". A job re-run in April
-- would happily write April's achievement total into March's end_value and
-- silently turn a real score into a wrong one — with no error, because
-- overwriting is exactly what the job does the rest of the time.
--
-- scripts/sync/war.ts:104-110 established the resolution: a live row may move
-- until it settles, and after that it is closed. This is the same rule with a
-- column behind it rather than a comment.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- start_time and end_time were already here and nullable. They stay nullable
-- because the API supplies NEITHER — the window is derived from the calendar
-- (lib/coc-time.ts), never typed in by a leader. A leader-entered date in a
-- game-fact table is exactly the R11 mixing that makes a table's provenance
-- unanswerable six months later.

alter table clan_games
  add column settled_at timestamptz;

comment on column clan_games.settled_at is
  'Set once the end-of-period snapshot has been taken. After this the season is '
  'closed and no sync may write its scores again (R5). Null means the period is '
  'still open and end_value is expected to move.';

create index clan_games_open_idx
  on clan_games (clan_id) where settled_at is null and deleted_at is null;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- the new columns exist and are readable by a member of that clan (R3):
--   select state, raids_completed, offensive_reward from raid_seasons;
--
--   -- a member still cannot invent a raid (R11 — no insert policy was added):
--   insert into raid_seasons (clan_id, start_time)
--     values ('<your clan>', now());                     -- denied
--
--   -- and the open-season index is the one T7.4 looks a season up by:
--   explain select * from clan_games
--    where clan_id = '<your clan>' and settled_at is null;
-- ---------------------------------------------------------------------------
