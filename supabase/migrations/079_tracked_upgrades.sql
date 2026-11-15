-- 079 — The upgrade tracker: timers a member starts here, on top of their export.
--
--
-- WHAT THIS ADDS
--
-- 076 saved the member's village export, so Base details could show buildings,
-- walls and the timers that were running when the game took it. Those timers
-- run out, and then the page went quiet until the next paste. This is the part
-- clash.ninja is used for: the member taps "Start" on an upgrade they have just
-- started in the game, the page counts it down, and when it ends the level goes
-- up on its own.
--
--
-- THE SAME TWO RULES AS 076, AND HOW THIS KEEPS THEM
--
--   1. R11. A tracked upgrade is a PERSON saying "I started this". So it has its
--      own owner-written table, like the export, and no sync job writes it — with
--      one exception the grants spell out: the sync may stamp notified_at, the
--      moment it sent the "upgrade finished" push. That records what the sync
--      did, never what the member has.
--
--   2. Owner-only. Not clanmates, not leaders, through 031's
--      auth_owned_player_ids(), exactly as 076.
--
--
-- HOW A FINISHED UPGRADE REACHES THE EXPORT: FOLDED, BY THE OWNER, ATOMICALLY
--
-- The page applies finished timers when it reads (src/services/village-overlay.ts),
-- so a level goes up the moment its timer ends without anything being written.
-- To keep this table small, the owner's next write FOLDS those rows into the
-- export: apply_tracked_upgrades() writes the levelled-up village and stamps the
-- rows folded_at in one transaction. Two statements from the application could
-- be interrupted between them, and a row applied to the export but not marked
-- folded would level the building up a SECOND time on the next read.
--
-- The fold is guarded by village_exports.revision, which the trigger below
-- bumps whenever the village changes. Two open tabs that both fold the same
-- timer would otherwise both write; the second now finds the revision moved and
-- writes nothing, and its page re-reads the first one's result.
--
--
-- BOUNDED, FOR THE 500 MB FREE TIER
--
-- A base has at most eleven things that can be upgrading at once (six builders,
-- the lab and the pet house; the Builder Base's two builders and Star Lab), so a
-- trigger refuses a seventeenth live row. Signed-in sessions can reach PostgREST
-- directly, so this is a database rule, not an application one.
--
-- Folded and cancelled rows are kept for 30 days and then HARD-deleted by
-- prune_tracked_upgrades(), which the sync calls. That is a deliberate exception
-- to R4, as 058's purge was: these rows are a member's own reminders, they are
-- already reflected in the export, and keeping every one forever is the only
-- way this table could ever matter to the database's size.


-- ---------------------------------------------------------------------------
-- village_exports.revision — the fold's optimistic lock.
-- ---------------------------------------------------------------------------
alter table village_exports add column revision integer not null default 0;

create or replace function village_exports_bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.village is distinct from old.village then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger village_exports_bump_revision
  before update on village_exports
  for each row execute function village_exports_bump_revision();


-- ---------------------------------------------------------------------------
-- tracked_upgrades
--
-- One row per upgrade the member started here. `subject` is the game's name
-- ("Cannon", "Archer Queen"), the key the saved export already uses; to_level is
-- not stored because it is always from_level + 1.
--
-- ends_at is worked out ON THE SERVER from the game data and the boost, or from
-- the time left the member typed for an upgrade they started earlier. The
-- 45-day ceiling is longer than any upgrade in the game.
-- ---------------------------------------------------------------------------
create table tracked_upgrades (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players (id) on delete restrict,
  created_by    uuid not null references users (id) on delete restrict,
  village       text not null,
  subject_type  text not null,
  subject       text not null,
  from_level    smallint not null,
  workshop      text not null,
  boost_pct     smallint not null default 0,
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  notified_at   timestamptz,
  folded_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,

  constraint tracked_upgrades_village check (village in ('home', 'builder')),
  constraint tracked_upgrades_subject_type check (subject_type in ('building', 'unit', 'weapon')),
  constraint tracked_upgrades_subject check (char_length(subject) between 1 and 64),
  constraint tracked_upgrades_from_level check (from_level between 0 and 200),
  constraint tracked_upgrades_workshop check (workshop in ('builders', 'lab', 'pets')),
  constraint tracked_upgrades_boost check (boost_pct between 0 and 50),
  constraint tracked_upgrades_window check (
    ends_at >= started_at and ends_at <= started_at + interval '45 days'
  )
);

-- The page's read: this base's live rows.
create index tracked_upgrades_live_idx
  on tracked_upgrades (player_id)
  where deleted_at is null and folded_at is null;

-- The push job's read: ended and not yet announced.
create index tracked_upgrades_due_idx
  on tracked_upgrades (ends_at)
  where notified_at is null and deleted_at is null;

create trigger tracked_upgrades_set_updated_at
  before update on tracked_upgrades
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- The live-row ceiling. Definer, so the count sees every row of the base, not
-- only the ones the caller's policies happen to admit.
-- ---------------------------------------------------------------------------
create or replace function tracked_upgrades_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.tracked_upgrades t
     where t.player_id = new.player_id
       and t.deleted_at is null
       and t.folded_at is null
  ) >= 16 then
    raise exception 'tracked_upgrades: too many running upgrades on one base'
      using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger tracked_upgrades_cap
  before insert on tracked_upgrades
  for each row execute function tracked_upgrades_cap();


-- ---------------------------------------------------------------------------
-- RLS — 076's three policies, word for word in substance.
-- ---------------------------------------------------------------------------
alter table tracked_upgrades enable row level security;

create policy "read own tracked upgrades" on tracked_upgrades
  for select to authenticated
  using (player_id in (select auth_owned_player_ids()));

create policy "track your own upgrade" on tracked_upgrades
  for insert to authenticated
  with check (
    player_id in (select auth_owned_player_ids())
    and created_by = auth.uid()
  );

create policy "change your own tracked upgrade" on tracked_upgrades
  for update to authenticated
  using (player_id in (select auth_owned_player_ids()))
  with check (
    player_id in (select auth_owned_player_ids())
    and created_by = auth.uid()
  );

-- No delete policy (R4). Cancelling sets deleted_at; only the prune removes rows.


-- ---------------------------------------------------------------------------
-- Grants. The sync reads, and may stamp notified_at — nothing else (R11).
-- ---------------------------------------------------------------------------
grant select, insert, update on tracked_upgrades to authenticated;  -- never delete (R4)
grant select on tracked_upgrades to service_role;
revoke insert, update, delete on tracked_upgrades from service_role;
grant update (notified_at) on tracked_upgrades to service_role;

comment on table tracked_upgrades is
  'Upgrade timers a member started on Base details, layered over their saved '
  'village export. HUMAN-SUPPLIED (R11): written only by the owner; the sync may '
  'only stamp notified_at. Owner-only. Folded into village_exports by '
  'apply_tracked_upgrades() and hard-deleted 30 days later by '
  'prune_tracked_upgrades() - a deliberate R4 exception, see 079.';


-- ---------------------------------------------------------------------------
-- apply_tracked_upgrades — fold finished rows into the export, atomically.
--
-- INVOKER, not definer: it gives the caller nothing their policies do not
-- already allow. The owner may update their export and their rows; anyone else
-- updates nothing, and gets false.
-- ---------------------------------------------------------------------------
create or replace function apply_tracked_upgrades(
  p_player   uuid,
  p_revision integer,
  p_village  jsonb,
  p_ids      uuid[]
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_village) is distinct from 'object' then
    raise exception 'apply_tracked_upgrades: village must be an object' using errcode = '22023';
  end if;

  update public.village_exports
     set village = p_village
   where player_id = p_player
     and revision = p_revision
     and deleted_at is null;
  if not found then
    return false;
  end if;

  update public.tracked_upgrades
     set folded_at = now()
   where player_id = p_player
     and id = any (p_ids)
     and folded_at is null
     and deleted_at is null;
  return true;
end;
$$;

revoke execute on function apply_tracked_upgrades(uuid, integer, jsonb, uuid[]) from public, anon;
grant execute on function apply_tracked_upgrades(uuid, integer, jsonb, uuid[]) to authenticated;


-- ---------------------------------------------------------------------------
-- prune_tracked_upgrades — the 30-day hard delete. Service role only.
-- ---------------------------------------------------------------------------
create or replace function prune_tracked_upgrades()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from public.tracked_upgrades t
   where coalesce(t.deleted_at, t.folded_at) < now() - interval '30 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function prune_tracked_upgrades() from public, anon, authenticated;
grant execute on function prune_tracked_upgrades() to service_role;


-- ---------------------------------------------------------------------------
-- The "upgrade finished" push, on by default like every other kind (023).
-- ---------------------------------------------------------------------------
alter table notification_preferences
  add column upgrade_reminders boolean not null default true;
