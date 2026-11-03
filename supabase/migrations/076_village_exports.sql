-- A member's saved in-game village export, so Home and Base details can track
-- buildings, walls and upgrade timers between visits.
--
--
-- THIS REVERSES A RECORDED DECISION, AND SAYS WHY
--
-- T11B.11/12 parsed the export in the browser and stored nothing. Its header
-- gave two reasons. Both still hold, and this table is shaped around them rather
-- than over them:
--
--   1. R11. The export is a game fact that a PERSON supplies. Written into
--      player_progress it could not be told apart from a sync reading. So it is
--      NOT written there: it lives in its own table with one writer, the owner,
--      through the application. No sync job reads or writes it, and nothing
--      merges it into player_progress. The UI always labels it "from your game
--      export" with the date the game exported it.
--
--   2. The export carries base coordinates and a full defensive inventory. So
--      the RAW text is never stored. The server parses it and keeps only the
--      mapped village (src/types/village.ts): per building, how many are at each
--      level, plus unit levels and running timers. There are no positions in
--      that shape. And only the owner can read it — not clanmates, not leaders.
--
-- The member asked for this: Home exists to track their own bases, and pasting
-- the export again on every visit was the thing they kept having to do.
--
--
-- PLAIN POLICIES, NOT A DEFINER FUNCTION — 033's argument, unchanged. The row
-- belongs to its owner, has no clan, and affects nobody else, so there is no
-- readable audit entry to write. Same owner function, same full unique index,
-- same R11 grants.


-- ---------------------------------------------------------------------------
-- village_exports
--
-- uploaded_by, NOT user_id: ownership lives on players.user_id, and this column
-- records who saved the row, as player_nicknames.set_by does.
--
-- exported_at is the game's own timestamp, not ours. Upgrade timers count from
-- it, and "exported 3 days ago" is what tells a member it needs refreshing.
--
-- `village` is ExportedVillage as JSON. th_level and bh_level are copied out of
-- it so a row reads at a glance in the SQL editor; the jsonb is the source.
-- ---------------------------------------------------------------------------
create table village_exports (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players (id) on delete restrict,
  uploaded_by uuid not null references users (id) on delete restrict,
  exported_at timestamptz not null,
  th_level    integer,
  bh_level    integer,
  village     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  constraint village_exports_village_shape check (jsonb_typeof(village) = 'object')
);

-- One saved export per base. FULL, not partial, for 033's reason: a re-upload is
-- one upsert on player_id that also revives a removed export (R4).
create unique index village_exports_player_key on village_exports (player_id);

create trigger village_exports_set_updated_at
  before update on village_exports
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS. Owner-scoped through 031's auth_owned_player_ids(), never by clan.
-- ---------------------------------------------------------------------------
alter table village_exports enable row level security;

create policy "read own village exports" on village_exports
  for select to authenticated
  using (player_id in (select auth_owned_player_ids()));

create policy "save your own village export" on village_exports
  for insert to authenticated
  with check (
    player_id in (select auth_owned_player_ids())
    and uploaded_by = auth.uid()
  );

create policy "replace your own village export" on village_exports
  for update to authenticated
  using (player_id in (select auth_owned_player_ids()))
  with check (
    player_id in (select auth_owned_player_ids())
    and uploaded_by = auth.uid()
  );

-- No delete policy (R4). Removing an export sets deleted_at.


-- ---------------------------------------------------------------------------
-- R11 as a privilege. The REVOKE is the operative line: 014's default privilege
-- made this table writable by service_role the moment it was created. See 033.
-- ---------------------------------------------------------------------------
grant select, insert, update on village_exports to authenticated;  -- never delete (R4)
grant select on village_exports to service_role;
revoke insert, update on village_exports from service_role;

comment on table village_exports is
  'The member''s own in-game village export for one of their bases, parsed and '
  'saved so Home can track buildings, walls and upgrade timers. A HUMAN-SUPPLIED '
  'copy (R11): written only by the owner through the application, never by a sync '
  'job, and never merged into player_progress. Only the mapped village is kept - '
  'no raw export, no base coordinates. Owner-only.';
