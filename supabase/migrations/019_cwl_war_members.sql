-- T4.1/T4.3 — cwl_war_members: the roster the API reported for one CWL war.
--
-- WHY THIS TABLE HAS TO EXIST
--
-- 002_cwl.sql:76-78 forbids storing a miss:
--
--     "Missed attacks are NOT stored. The API simply returns no attack for a
--      player who did not attack; the missed list is derived from roster minus
--      attacks (T4.3). Never insert a zero-star placeholder row."
--
-- That rule is right — a placeholder row is indistinguishable from a real zero
-- star attack once it is in the table. But "roster minus attacks" needs a
-- roster, and until now nothing stored one. cwl_wars has 18 columns and not one
-- of them holds who was in the war, so T4.5's central feature ("a clear list of
-- who has not attacked") had no source at all.
--
-- The alternative considered was a jsonb column on cwl_wars. Rejected: every
-- missed-attack query would have to unpack JSON, and T4B.11's plan-versus-
-- reality comparison (leader's roster vs who actually played) becomes a join
-- against a real table or an unpleasant mess against a document.
--
--
-- R11 — THIS IS A GAME FACT, NOT A HUMAN DECISION.
--
-- This is who the API said was in the war. It is NOT cwl_rosters, which is who
-- the leader picked (T4B.6, still a stub). R12 exists precisely to keep those
-- two apart: showing the difference between them is the most useful thing this
-- system does, and it is destroyed the moment a sync job writes to the leader's
-- table or a form writes to this one.
--
-- Written only by scripts/sync/cwl.ts.


-- ---------------------------------------------------------------------------
-- Append-only, deliberately shaped like cwl_attacks rather than like cwl_wars:
-- no updated_at and no set_updated_at trigger.
--
-- A war roster is fixed once the war starts. If the API ever reports a
-- different roster for a war we have already recorded, that is a fact worth
-- noticing, not silently overwriting (R5). The unique constraint below makes
-- the re-insert a no-op instead.
-- ---------------------------------------------------------------------------
create table cwl_war_members (
  id            uuid primary key default gen_random_uuid(),
  war_id        uuid not null references cwl_wars (id) on delete restrict,
  player_id     uuid not null references players (id) on delete restrict,
  map_position  smallint,
  th_level      smallint,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- The idempotency key. Same role as cwl_attacks' three-column constraint:
  -- without it ON CONFLICT DO NOTHING matches nothing and every run duplicates
  -- the entire roster, silently.
  unique (war_id, player_id)
);

create index cwl_war_members_war_id_idx
  on cwl_war_members (war_id) where deleted_at is null;
create index cwl_war_members_player_id_idx
  on cwl_war_members (player_id) where deleted_at is null;

comment on table cwl_war_members is
  'Who the API reported in a CWL war (a game fact, R11). Missed attacks are '
  'this minus cwl_attacks. Not to be confused with cwl_rosters, which is who '
  'the leader selected (R12).';


-- ---------------------------------------------------------------------------
-- RLS — the same two-level join cwl_attacks uses.
--
-- There is no clan_id on this table, exactly as there is none on cwl_wars or
-- cwl_attacks. Scoping runs cwl_war_members -> cwl_wars -> cwl_seasons.clan_id.
-- test/migrations.test.ts:308 calls the two-level join "the policy most likely
-- to be written wrongly", so this one is a deliberate copy of the shape already
-- proven there rather than a fresh attempt.
-- ---------------------------------------------------------------------------
alter table cwl_war_members enable row level security;

create policy "read own clan cwl war members" on cwl_war_members
  for select to authenticated
  using (
    exists (
      select 1
      from cwl_wars w
      join cwl_seasons s on s.id = w.season_id
      where w.id = cwl_war_members.war_id
        and s.clan_id in (select auth_clan_ids())
    )
  );

-- 006 grants select to anon/authenticated on all tables that existed then, and
-- 014's alter default privileges covers tables created afterwards. Granted
-- explicitly anyway: relying on a default privilege that was set in a different
-- migration is how 014 came to exist in the first place (every sync job failed
-- with 42501 because 006 forgot service_role).
grant select on cwl_war_members to anon, authenticated;
grant select, insert, update on cwl_war_members to service_role;

-- No delete grant, for anybody. R4.


-- ---------------------------------------------------------------------------
-- Verify:
--
--   select has_table_privilege('service_role', 'cwl_war_members', 'delete');
--     -- expect FALSE (R4)
--
--   select count(*) from pg_policies where tablename = 'cwl_war_members';
--     -- expect 1
-- ---------------------------------------------------------------------------
