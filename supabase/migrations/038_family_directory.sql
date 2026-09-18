-- T12.1 — the VISITOR tier: every platform clan's overview and its roster,
-- readable by anyone holding a role in any platform clan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — THE SECOND DELIBERATE EXCEPTION. 037 IS THE FIRST. READ BOTH.
--
-- The decision: an approved account may READ every platform clan's overview and
-- its member roster, and search that roster, even in a clan it holds no role in.
-- Everything else about another clan — war, CWL, raids, clan games, polls,
-- notices, layouts, donations, snapshots, audit — stays exactly as private as it
-- is today.
--
-- Made HERE, in two functions, and NOT by widening the SELECT policies on
-- `clans` and `players`. Three reasons, in order of weight:
--
--   1. Architecture.md §7.3 says so in as many words, about 037's exception:
--      "Widen that function's output, not the tables' policies, if more is ever
--      needed." This is the "more".
--
--   2. Widening `players` would hand every member every clan's `verified` flag
--      and `user_id` — the link between a village and a person — and would
--      silently widen everything that joins through players. These functions
--      return seven columns and six columns respectively, and nothing else.
--
--   3. test/authorisation.test.ts and test/migrations.test.ts both assert that a
--      bare `select from clans` and `select from players` return ONE clan's
--      rows. Those assertions ARE the T3.7 net. They stay green after this file,
--      and test/family-directory.test.ts asserts that fact beside the new
--      access, exactly as test/family-cwl-history.test.ts does for 037.
--
-- WHAT IS RETURNED:
--   family_clans()          id, tag, name, badge_url, level, war_league, member_count
--   family_clan_roster()    clan_id, player_id, tag, name, th_level, clan_role, left_at
--
-- WHAT IS NOT: donations, trophies, snapshots, verified, user_id, wars, CWL,
-- raids, clan games, polls, notices, layouts, and anything at all about a clan
-- that has been soft-deleted.
--
-- WHO IS ANSWERED — the same guard 037 uses, verbatim:
--   * a caller holding at least one live clan_roles row (a family member), or
--   * the service role.
-- Anyone else gets zero rows rather than an error, which is how every read in
-- this schema says no. A PENDING account therefore still sees nothing: it has no
-- clan_roles row, so T3.8's gate is enforced here by the same mechanism that
-- enforces it everywhere else, without this file knowing about `status`.
--
-- WHY ONE ROSTER FUNCTION AND NOT TWO. The member directory asks for one clan
-- with no term; /search asks for every clan with a term. Those are the same
-- question — searchPlayers() (repositories/members.ts) already treats a search
-- as the roster filtered — and splitting them would mean two places that must
-- agree about which six columns a visitor may see.
--
-- NOT ADDED HERE: auth_elder_clan_ids(). See the closing note.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- Every platform clan, as the clan directory and a visitor's overview need it.
--
-- `order by tag` matches visibleClans() (lib/clans.ts), so the two lists read in
-- the same order wherever they are shown near each other.
--
-- level and member_count are smallint on the table (020) and are cast to integer
-- so the declared result type cannot drift from the column type. A mismatch
-- there is a runtime "structure of query does not match function result type",
-- which is a 500 on a page rather than anything a build would catch.
--
-- `language sql` and not plpgsql: there is no input to cap and no branch. 037 is
-- plpgsql only because it needs RAISE.
-- ---------------------------------------------------------------------------
create or replace function family_clans()
returns table (
  id           uuid,
  tag          text,
  name         text,
  badge_url    text,
  level        integer,
  war_league   text,
  member_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.tag,
    c.name,
    c.badge_url,
    c.level::integer,
    c.war_league,
    c.member_count::integer
  from public.clans c
  where c.deleted_at is null
    and (
      exists (select 1 from public.auth_clan_ids())
      or current_setting('role', true) = 'service_role'
    )
  order by c.tag
$$;

revoke execute on function family_clans() from public;
grant execute on function family_clans() to authenticated, service_role;

comment on function family_clans() is
  'T12.1 - every platform clan''s overview (family-wide, a deliberate R3 '
  'exception alongside 037). Seven columns, no member data. Returns nothing to '
  'a caller holding no clan role anywhere. The clans table''s own policies are '
  'unchanged: a direct select still returns only the caller''s own clans.';


-- ---------------------------------------------------------------------------
-- The rosters of the named clans, optionally filtered by name or tag.
--
-- p_clan_ids IS REQUIRED AND HAS NO "null means every clan" SPELLING. R3 says
-- the query is the mechanism and the policy is the net, and a call with no clan
-- in it has no mechanism at all — the argument repositories/members.ts makes at
-- length about why searchPlayers() issues one query per clan rather than one
-- unscoped one. The caller gets its list from family_clans(), never from tags
-- written down somewhere.
--
-- plpgsql rather than sql, for the cardinality cap and the tag branch. Same
-- shape as 037.
-- ---------------------------------------------------------------------------
create or replace function family_clan_roster(
  p_clan_ids         uuid[],
  p_term             text    default null,
  p_include_departed boolean default false
)
returns table (
  clan_id   uuid,
  player_id uuid,
  tag       text,
  name      text,
  th_level  integer,
  clan_role text,
  left_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_term text := nullif(btrim(coalesce(p_term, '')), '');
  v_tag  text := null;
begin
  -- Far above the largest real caller — the family is a handful of clans — and
  -- it bounds a crafted call from a signed-in session. 037 caps the same way.
  if coalesce(cardinality(p_clan_ids), 0) > 20 then
    raise exception 'family_clan_roster: at most 20 clans per call, got %',
      cardinality(p_clan_ids)
      using errcode = '22023';
  end if;

  -- The guard, before any row is touched. Zero rows, not an error.
  if not (
    exists (select 1 from public.auth_clan_ids())
    or current_setting('role', true) = 'service_role'
  ) then
    return;
  end if;

  -- A TAG IS MATCHED EXACTLY AND NEVER BY PREFIX, and it matters more here than
  -- in searchPlayers(): this function answers for clans the caller holds no role
  -- in, so a prefix match would be a way to enumerate the family's player tags a
  -- page at a time. A partial tag is not a meaningful query in any case.
  if v_term like '#%' then
    v_tag := upper(v_term);
  end if;

  return query
  select
    p.clan_id,
    p.id,
    p.tag,
    p.name,
    p.th_level::integer,
    p.clan_role,
    p.left_at
  from public.players p
  where p.clan_id = any (coalesce(p_clan_ids, '{}'::uuid[]))
    and p.deleted_at is null
    -- R4 keeps a departed member's every row; the directory simply does not list
    -- them unless asked (T0.11).
    and (p_include_departed or p.left_at is null)
    -- A soft-deleted clan's roster must not reappear through this door.
    and exists (
      select 1 from public.clans c
      where c.id = p.clan_id and c.deleted_at is null
    )
    and (
      v_term is null
      or (v_tag is not null and p.tag = v_tag)
      -- %, _ and \ are LIKE metacharacters. Somebody searching for a name that
      -- contains one wants a literal match, and a bare '%' must not become
      -- "list the whole clan". Backslash is LIKE's default escape character, so
      -- escaping it first is what keeps the other two escapes intact.
      or (
        v_tag is null
        and p.name ilike
          '%' ||
          replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') ||
          '%'
      )
    )
  order by p.name
  -- A ceiling, not a page. The family is a few hundred players; this exists so a
  -- crafted call cannot ask for every row in the table at once.
  limit 2000;
end;
$$;

revoke execute on function family_clan_roster(uuid[], text, boolean) from public;
grant execute on function family_clan_roster(uuid[], text, boolean)
  to authenticated, service_role;

comment on function family_clan_roster(uuid[], text, boolean) is
  'T12.1 - name, tag, town hall and in-game role for the members of the named '
  'platform clans, optionally filtered (family-wide, a deliberate R3 exception '
  'alongside 037). No donations, snapshots, verified flag or user_id. Tags match '
  'exactly, never by prefix. Returns nothing to a caller holding no clan role.';


-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT IN THIS FILE: auth_elder_clan_ids().
--
-- Migrations 010 and 021 set the convention that a new tier gets a NEW helper
-- rather than a widened old one — widening auth_leader_clan_ids() would silently
-- hand co-leaders the audit log. By that convention an elder tier would get its
-- helper here. It does not, and the reason is not that it was forgotten.
--
--   The helper alone changes nothing. To have teeth it would have to REPLACE
--   auth_clan_ids() in the SELECT policies on cwl_seasons, cwl_wars,
--   cwl_attacks, cwl_bonuses, cwl_war_members, raid_seasons, raid_participants,
--   clan_games and clan_games_scores. That is a NARROWING, and permissive
--   policies are OR-ed together — so a stricter second policy grants nothing and
--   the existing one has to be dropped. No migration in this tree has ever
--   contained DROP POLICY or ALTER POLICY; all thirty-seven are additive. A
--   narrowing that fails OPEN when the drop is forgotten is the worst available
--   failure mode for a permission change.
--
--   And the narrowing would be wrong for this product's own pages.
--   repositories/player-report.ts reads clan_games_scores and raid_participants
--   to build the player profile, which the member tier is explicitly meant to
--   keep. An elder-only policy on those tables blanks two panels of a page every
--   member is supposed to see.
--
-- So elder is equal to member in SQL today, deliberately and on the record. The
-- elder tier is a routing and rendering decision in src/lib/visibility.ts, in the
-- same way "Worth a look" is: advice computed from rows the member may already
-- read. test/family-directory.test.ts asserts that equality, so that nobody
-- later assumes a net which is not there.
--
-- IF IT IS EVER WANTED, the order is: move the profile's raid and clan-games
-- reads behind definer functions first, then add the helper, then drop and
-- recreate those nine policies. Not the other way round.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Verify by hand, as a member of clan A:
--
--   select count(*) from family_clans();                          -- every clan
--   select count(*) from clans;                                   -- still ONLY A
--   select * from family_clan_roster(array['<clan B id>']::uuid[]);  -- B's roster
--   select count(*) from players;                                 -- still ONLY A's
--
-- As a signed-in account holding no clan role at all:
--
--   select count(*) from family_clans();                          -- 0
-- ---------------------------------------------------------------------------
