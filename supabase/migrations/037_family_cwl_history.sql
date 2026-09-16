-- T11C.1 — family_cwl_history(): a village's CWL record from EVERY platform clan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM, AS FOUND
--
-- SK FLASH (#GJUUGRVCU) played 14 CWL wars across 2026-08 and 2026-09 in DH CWL
-- ONLY, the family's CWL clan, then returned to Dark Hell. Its report said "No
-- CWL record for this member in Dark Hell yet", for two independent reasons:
--
--   1. The report asked only the CURRENT clan. seasonHistoryForClan() walked
--      one clan's cwl_seasons, so a season played anywhere else was never read.
--      The data was intact: players.tag is unique, so cwl_war_members.player_id
--      still points at the same row after a move.
--
--   2. RLS would have hidden it anyway. 006's and 019's CWL policies admit a
--      season only to a viewer holding a role in the clan that OWNS it, and the
--      owner's only clan_roles row was Dark Hell.
--
-- Members moving between the family's clans is the ordinary case here, not an
-- edge: DH CWL ONLY exists to play CWL for the others. A CWL record that
-- disappears when a member goes home is wrong on every page that shows one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — A DELIBERATE, NARROW EXCEPTION. READ THIS BEFORE TOUCHING IT.
--
-- The decision (Phase 11C) is FAMILY-WIDE visibility: anyone holding a role in
-- any platform clan may see any village's CWL season totals from every platform
-- clan. That is a loosening of R3, and it is made here, in one function, rather
-- than by widening four tables' policies, because of what each would expose.
--
-- Widening the policies on cwl_seasons, cwl_wars, cwl_war_members and
-- cwl_attacks would hand every member every clan's entire CWL tree: opponents,
-- results, destruction, every attack by every player. None of the pages need it.
--
-- THIS RETURNS, per requested player, per clan, per season:
--   clan id, tag and name (public in game), the season, wars rostered, attacks
--   used, stars.
--
-- IT DOES NOT RETURN: opponents, war results, destruction, map positions, attack
-- order, defenders, or anything about any player who was not asked for. The four
-- tables' own policies are untouched, so a direct select of another clan's
-- cwl_attacks still returns zero rows — test/family-cwl-history.test.ts asserts
-- exactly that, beside the totals it asserts are visible.
--
-- WHO IS ANSWERED:
--   - a caller holding at least one live clan_roles row — a family member;
--   - for their OWN villages, a caller with no role at all, through 031's
--     auth_owned_player_ids() (a pending member linking a base);
--   - the service role, so a sync job or an operator can check it.
-- Anyone else — anon, a signed-in account with no role and no village — gets
-- zero rows, not an error, which is how every read in this project says no.
--
-- Precedents: 031, which widened `players` by owner, and clanMovement() in
-- repositories/members.ts, the other read deliberately not confined to one clan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SEMANTICS MATCH THE FUNCTION IT REPLACES
--
-- seasonHistoryForClan() in repositories/cwl.ts, pinned by
-- test/cwl-history-repo.test.ts:
--   - driven from the ROSTER (cwl_war_members), never from the attacks — a player
--     who was in a war and did nothing is exactly who a leader is looking for;
--   - an attack by somebody not on that war's roster is not counted;
--   - soft-deleted rows at every level are ignored (R4);
--   - newest season first.
--
-- plpgsql rather than sql only for the input cap, which needs RAISE. 500 is far
-- above the largest real caller (the roster builder's pool) and bounds a crafted
-- call from a signed-in session.

create or replace function family_cwl_history(p_player_ids uuid[])
returns table (
  player_id     uuid,
  clan_id       uuid,
  clan_tag      text,
  clan_name     text,
  season        text,
  wars_rostered integer,
  attacks_used  integer,
  stars         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(cardinality(p_player_ids), 0) > 500 then
    raise exception 'family_cwl_history: at most 500 players per call, got %',
      cardinality(p_player_ids)
      using errcode = '22023';
  end if;

  return query
  with allowed as (
    -- The guard. Family members see every requested player; anyone else only
    -- their own villages; the service role sees all.
    select requested.id
    from unnest(coalesce(p_player_ids, '{}'::uuid[])) as requested(id)
    where exists (select 1 from public.auth_clan_ids())
       or current_setting('role', true) = 'service_role'
       or requested.id in (select public.auth_owned_player_ids())
  ),
  rostered as (
    select m.player_id, m.war_id, s.clan_id, s.season
    from public.cwl_war_members m
    join public.cwl_wars w
      on w.id = m.war_id and w.deleted_at is null
    join public.cwl_seasons s
      on s.id = w.season_id and s.deleted_at is null
    where m.deleted_at is null
      and m.player_id in (select id from allowed)
    group by m.player_id, m.war_id, s.clan_id, s.season
  ),
  per_war as (
    select
      r.player_id,
      r.clan_id,
      r.season,
      r.war_id,
      count(a.id)                 as attacks,
      coalesce(sum(a.stars), 0)   as stars
    from rostered r
    left join public.cwl_attacks a
      on a.war_id = r.war_id
     and a.player_id = r.player_id
     and a.deleted_at is null
    group by r.player_id, r.clan_id, r.season, r.war_id
  )
  select
    pw.player_id,
    pw.clan_id,
    c.tag,
    c.name,
    pw.season,
    count(*)::integer            as wars_rostered,
    sum(pw.attacks)::integer     as attacks_used,
    sum(pw.stars)::integer       as stars
  from per_war pw
  join public.clans c on c.id = pw.clan_id
  group by pw.player_id, pw.clan_id, c.tag, c.name, pw.season
  order by pw.season desc, c.name;
end;
$$;

revoke execute on function family_cwl_history(uuid[]) from public;
grant execute on function family_cwl_history(uuid[]) to authenticated, service_role;

comment on function family_cwl_history(uuid[]) is
  'T11C.1 - per-player CWL season totals from every platform clan (family-wide, '
  'a deliberate R3 exception). Totals and clan name only; the CWL tables'' own '
  'policies are unchanged. Returns nothing to a caller with no clan role, except '
  'for their own villages.';


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- as a member of clan A, for a village that played CWL in clan B:
--   select * from family_cwl_history(array['<player>']::uuid[]);  -- clan B rows
--   select count(*) from cwl_attacks;  -- still ONLY clan A's attacks
--
--   -- as a signed-in account with no clan role and no village:
--   select count(*) from family_cwl_history(array['<player>']::uuid[]);  -- 0
-- ---------------------------------------------------------------------------
