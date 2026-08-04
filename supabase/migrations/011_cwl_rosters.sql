-- T4B.6 — CWL roster tables. THE PLAN.
--
-- R12 — this is who the LEADER CHOSE. cwl_war_members (019) is who the API said
-- actually played. Both are kept, and the difference between them is T4B.11:
-- selected and played / selected but absent / played but never selected.
--
-- Never overwrite one with the other. The tempting "cleanup" — reconciling the
-- roster against what the API reported so there is one list instead of two —
-- deletes the only record of who was picked and did not show up, and R4 means
-- there is no deleted row to recover.
--
-- R11 — HUMAN DECISION DATA. scripts/sync/shared.ts lists both tables in its
-- "MUST NEVER WRITE" block. A sync job that touches these erases the leader's
-- work at 2 AM.


-- ---------------------------------------------------------------------------
-- cwl_rosters — one per clan per season.
--
-- Saved continuously as 'draft'. The leader will not finish this in one sitting:
-- they are cross-referencing poll answers, hero levels and last season's
-- performance for thirty-odd players, and an unsaved form that loses that to a
-- closed tab is a form nobody uses twice.
-- ---------------------------------------------------------------------------
create table cwl_rosters (
  id            uuid primary key default gen_random_uuid(),
  season        text not null,
  clan_id       uuid not null references clans (id) on delete restrict,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  slot_count    smallint not null default 15 check (slot_count in (15, 30)),
  created_by    uuid not null references users (id) on delete restrict,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,

  unique (clan_id, season)
);

create index cwl_rosters_season_idx on cwl_rosters (season) where deleted_at is null;

create trigger cwl_rosters_set_updated_at
  before update on cwl_rosters
  for each row execute function set_updated_at();


create table cwl_roster_members (
  id         uuid primary key default gen_random_uuid(),
  roster_id  uuid not null references cwl_rosters (id) on delete restrict,
  player_id  uuid not null references players (id) on delete restrict,
  position   smallint,
  added_by   uuid not null references users (id) on delete restrict,
  added_at   timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (roster_id, player_id)
);

create index cwl_roster_members_roster_id_idx on cwl_roster_members (roster_id)
  where deleted_at is null;
create index cwl_roster_members_player_id_idx on cwl_roster_members (player_id)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- THE CONSTRAINT THAT MATTERS: no player in two clans' rosters in one season.
--
-- The spec is explicit that this belongs in the database and not only in the
-- form: "otherwise the leader double-books someone and does not find out until
-- CWL has already started." By then the roster is locked in game and one of the
-- two clans is a player short for the whole week.
--
-- A unique constraint cannot express it, because the season lives on the parent
-- table — so it is a trigger. Deliberately NOT a unique index on a denormalised
-- season column copied onto the child: that column would then need keeping in
-- step with the parent forever, and the first UPDATE that forgot would silently
-- switch the guard off.
--
-- Soft-deleted rows are ignored, so removing a player from clan A's roster and
-- adding them to clan B's works exactly as the leader expects.
-- ---------------------------------------------------------------------------
create or replace function guard_one_roster_per_season()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_season   text;
  v_clash    text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select season into v_season
  from public.cwl_rosters
  where id = new.roster_id;

  select c.name into v_clash
  from public.cwl_roster_members m
  join public.cwl_rosters r on r.id = m.roster_id
  join public.clans c on c.id = r.clan_id
  where m.player_id = new.player_id
    and m.deleted_at is null
    and r.deleted_at is null
    and r.season = v_season
    and m.roster_id <> new.roster_id
  limit 1;

  if v_clash is not null then
    raise exception
      'player is already in the % roster for season %', v_clash, v_season
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger cwl_roster_members_one_per_season
  before insert or update on cwl_roster_members
  for each row execute function guard_one_roster_per_season();


-- ---------------------------------------------------------------------------
-- RLS
--
-- Members may read a PUBLISHED roster (T4B.10) and nothing else. A draft is the
-- leader thinking out loud — half-built, with people on it who will be cut — and
-- showing that to the clan causes exactly the arguments publishing exists to
-- prevent.
-- ---------------------------------------------------------------------------
alter table cwl_rosters        enable row level security;
alter table cwl_roster_members enable row level security;

create policy "read published rosters, or drafts if leadership" on cwl_rosters
  for select to authenticated
  using (
    (status = 'published' and clan_id in (select auth_clan_ids()))
    or clan_id in (select auth_leadership_clan_ids())
  );

-- Cross-clan by design (T4B.7): the leader assigns players across all three
-- clans in one sitting, so leadership of ANY clan may build a roster for a clan
-- they lead. A leader of clan A cannot build clan B's roster unless they also
-- lead clan B.
create policy "leadership creates rosters" on cwl_rosters
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and clan_id in (select auth_leadership_clan_ids())
  );

create policy "leadership updates rosters" on cwl_rosters
  for update to authenticated
  using (clan_id in (select auth_leadership_clan_ids()))
  with check (clan_id in (select auth_leadership_clan_ids()));

create policy "read members of visible rosters" on cwl_roster_members
  for select to authenticated
  using (exists (select 1 from cwl_rosters r where r.id = cwl_roster_members.roster_id));

create policy "leadership adds roster members" on cwl_roster_members
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from cwl_rosters r
      where r.id = cwl_roster_members.roster_id
        and r.clan_id in (select auth_leadership_clan_ids())
    )
  );

-- Update rather than delete: dropping someone sets deleted_at (R4), so the fact
-- that they were once selected survives. Members ask when they were dropped, and
-- the answer should not depend on anyone's memory.
create policy "leadership changes roster members" on cwl_roster_members
  for update to authenticated
  using (
    exists (
      select 1 from cwl_rosters r
      where r.id = cwl_roster_members.roster_id
        and r.clan_id in (select auth_leadership_clan_ids())
    )
  );


grant select on cwl_rosters, cwl_roster_members to anon, authenticated;
grant insert, update on cwl_rosters, cwl_roster_members to authenticated;
grant select, insert, update on cwl_rosters, cwl_roster_members to service_role;

-- No delete grant, for anybody. R4.


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- the double-booking guard, which is the point of this file
--   insert into cwl_roster_members (roster_id, player_id, added_by)
--   values ('<clan B roster, same season>', '<player already in clan A>', '<you>');
--     -- expect: ERROR  player is already in the <Clan A> roster for season 2026-08
-- ---------------------------------------------------------------------------
