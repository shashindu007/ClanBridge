-- T11.3 — A member names their own base.
--
-- A member with two villages sees two rows that differ only by tag and town hall
-- level. The in-game names are often near-identical ("Shashi" and "Shashi2"),
-- and the tag is the thing nobody remembers. So the member gets to write a label
-- on each: "main", "alt", "the rushed one".
--
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON `players`
--
-- R11. `players` holds GAME FACTS, written only by scripts/sync/, and a session
-- has SELECT on it and nothing else — 016's header explains why at length, and
-- 016 ships a verification query asserting that
-- has_table_privilege('authenticated', 'players', 'update') is FALSE. A nickname
-- is the opposite kind of data: a HUMAN DECISION, written only through the
-- application, never touched by a job. The two kinds live in separate tables
-- with exactly one writer each, which is the whole of R11.
--
-- The rejected version is a `nickname` column on `players` plus an update policy
-- with a WITH CHECK narrowing it to one column. That hands a session write
-- access to the game-fact table and then relies on an expression to keep it away
-- from name, clan_id and th_level. 016 already refused that trade for
-- verification, which needed two columns rather than one.
--
--
-- WHY PLAIN POLICIES AND NOT A DEFINER FUNCTION
--
-- The audited-write convention in src/repositories/README.md is for writes with
-- a clan. This one has no clan, and the recorded exception applies: rows a
-- member owns, with no clan, use plain policies, because audit_log's read policy
-- is `clan_id in (select auth_leader_clan_ids())` and `null in (...)` is never
-- true. Writing rows nobody can read is worse than not writing them. 023's
-- notification_preferences is the precedent and this table follows it exactly.
--
-- WOULD A DENORMALISED clan_id MAKE THE AUDIT ROW READABLE? Yes, and it is still
-- the wrong trade, for three reasons in descending order of weight:
--
--   1. A base's clan CHANGES. That is what players.clan_id and left_at exist
--      for. A clan_id copied onto a human-decision row is either stale, or kept
--      fresh by a sync job writing a human-decision table — which is precisely
--      the R11 bug. There is no third option.
--   2. audit_log earns its value by being short. Its other entries are
--      approvals, bonus awards and target assignments. "A member renamed their
--      own base from main to alt" is noise in that log.
--   3. The base may sit in a clan with NO leader on this platform — the
--      cross-clan case this whole feature exists for (031) — so the audit row
--      would be unreadable anyway.
--
-- RECORDED HOLE: nickname changes are not audited. Nobody but the owner can read
-- or write one, so the blast radius is a label on their own village. If it ever
-- matters, the fix is widening audit_log's read policy — not a clan_id here.


-- ---------------------------------------------------------------------------
-- player_nicknames
--
-- set_by, NOT user_id, and the distinction is load-bearing. Ownership lives on
-- players.user_id and is the single source of truth; this column records who
-- wrote the label. A second copy of ownership is a second thing that can be
-- wrong, and 016 raises rather than reassigning a linked base, so the copy could
-- only ever drift away from the truth.
--
-- The check constraint pairs with nicknameProblem() in src/lib/nickname.ts. The
-- constraint is the one that is actually enforced; the TypeScript is the one
-- that produces a sentence a member can act on. src/lib/account.ts's header
-- states that division and this follows it.
--
-- 24 characters because it sits beside an in-game name in a list, and the game
-- itself caps a player name at 15. Anything longer is a sentence, not a label.
-- ---------------------------------------------------------------------------
create table player_nicknames (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players (id) on delete restrict,
  nickname   text not null,
  set_by     uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,

  constraint player_nicknames_shape check (
    nickname = btrim(nickname)
    and char_length(nickname) between 1 and 24
    and nickname !~ '[\n\r\t]'
  )
);

-- ---------------------------------------------------------------------------
-- ONE NICKNAME PER BASE, AND THE INDEX IS FULL RATHER THAN PARTIAL.
--
-- This is the opposite of base_layout_votes (028) and notification_preferences
-- (023), which both use `where deleted_at is null`, so it needs justifying.
--
-- A partial unique index cannot be inferred by ON CONFLICT unless the statement
-- names the predicate, and an INSERT has no WHERE to name it with. 028 hit
-- exactly this and worked around it with two statements inside a definer
-- function, saying so at its lines 173-175. There is no definer function here to
-- hide two statements inside, and two statements issued from a Server Action is
-- a race that the unique index would then reject — the member sees a constraint
-- violation for pressing Save twice.
--
-- With a FULL index, setting a nickname is one idempotent statement that also
-- revives a cleared one:
--
--     upsert({ player_id, nickname, set_by, deleted_at: null },
--            { onConflict: "player_id" })
--
-- and clearing it is `update ... set deleted_at = now()` (R4 — the row stays).
-- The cost is that the tombstone occupies the slot, which is exactly what makes
-- the revival possible. There is one row per base for the life of the base and
-- its history is the row's own updated_at, not a pile of superseded rows.
-- ---------------------------------------------------------------------------
create unique index player_nicknames_player_key on player_nicknames (player_id);

create trigger player_nicknames_set_updated_at
  before update on player_nicknames
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS. Owner-scoped through 031's auth_owned_player_ids(), never by clan.
--
-- A nickname is private to the member who wrote it. Clanmates do not see it, and
-- that is deliberate rather than unfinished: showing one member's label for
-- their own village to the rest of the clan is a separate decision with its own
-- disclosure question, and 030 makes the identical argument about not widening
-- username visibility. Recorded as a hole, not half-closed.
--
-- `set_by = auth.uid()` on both write policies, so a member cannot attribute a
-- label to somebody else. The player_id clause already restricts which base;
-- this restricts who the row claims wrote it.
-- ---------------------------------------------------------------------------
alter table player_nicknames enable row level security;

create policy "read own base nicknames" on player_nicknames
  for select to authenticated
  using (player_id in (select auth_owned_player_ids()));

create policy "name your own base" on player_nicknames
  for insert to authenticated
  with check (
    player_id in (select auth_owned_player_ids())
    and set_by = auth.uid()
  );

create policy "rename your own base" on player_nicknames
  for update to authenticated
  using (player_id in (select auth_owned_player_ids()))
  with check (
    player_id in (select auth_owned_player_ids())
    and set_by = auth.uid()
  );

-- No delete policy. R4, and migrations.test.ts asserts globally that no table
-- anywhere has one.


-- ---------------------------------------------------------------------------
-- R11 AS A PRIVILEGE, NOT A COMMENT.
--
-- THE REVOKE BELOW IS THE OPERATIVE LINE AND IT IS NOT REDUNDANT. 014 issued
--
--     alter default privileges in schema public
--       grant select, insert, update on tables to service_role;
--
-- so every table created after it is BORN WRITABLE by the sync jobs. Granting
-- only select here would change nothing at all — the default privilege has
-- already been applied by the time this statement runs. 024 records the same
-- finding in its own words, having been written in the belief that a narrow
-- grant was a narrow permission; a test caught it.
--
-- Still readable by service_role, deliberately: a future job that needs to know
-- what a member called their base (a notification addressed to "your alt", say)
-- can read it, and the read grant is also what keeps migrations.test.ts's "can
-- read every table" assertion true.
-- ---------------------------------------------------------------------------
grant select, insert, update on player_nicknames to authenticated;  -- never delete (R4)
grant select on player_nicknames to service_role;
revoke insert, update on player_nicknames from service_role;

comment on table player_nicknames is
  'T11.3 - the member''s own label for one of their villages, so an account with '
  'two bases can tell them apart. A HUMAN DECISION (R11): written only through '
  'the application by the owner, never by a sync job. Defaults to nothing, and '
  'the UI falls back to players.name.';
