-- 071 — The rest of what the API sends and nothing kept.
--
-- 065 took the first pass at this. The October 2026 audit compared the live API
-- with what is stored, and three things were worth more than they looked:
--
--   * enemy_districts_destroyed. The raid page labelled raids_completed "districts
--     cleared". They are different numbers: a live weekend reported 3 raids and 25
--     districts. The page was showing the wrong one because the right one was
--     never read.
--
--   * league_tier. Ranked battles replaced the old leagues, and `league` now says
--     "Unranked" for 46 of 50 members in a real clan, with 14 of them on 0
--     trophies. A member's actual rank ("Electro League 33") is in leagueTier,
--     which nothing parsed, so the directory's trophy column showed almost nothing.
--     league_tier_id keeps the order: the higher the id, the higher the rank, and
--     names do not sort.
--
--   * the clan's own card: description, points, how often it wars, what it takes
--     to join. A member can see all of it in game, and none of it here.
--
-- All of it is a game fact (R11), written only by scripts/sync/. These columns
-- join tables whose policies already say who may read them, so no policy changes.

alter table raid_seasons add column enemy_districts_destroyed integer;

alter table players
  add column league_tier text,
  add column league_tier_id integer;

alter table clan_profiles
  add column description text,
  add column clan_points integer,
  add column clan_builder_base_points integer,
  add column clan_capital_points integer,
  add column war_frequency text,
  add column required_townhall_level smallint,
  add column required_trophies integer,
  add column location text,
  add column labels jsonb not null default '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- latest_player_progress also returns the Town Hall weapon.
--
-- Scouting shows it for every enemy village and showed nothing for our own,
-- because this function did not return the column. 051's function otherwise,
-- unchanged. Dropped first: a change of return type cannot be replaced in place.

drop function latest_player_progress(uuid[]);

create function latest_player_progress(p_player_ids uuid[])
returns table (
  player_id        uuid,
  captured_at      timestamptz,
  th_level         smallint,
  th_weapon_level  smallint,
  units            jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(cardinality(p_player_ids), 0) > 500 then
    raise exception 'latest_player_progress: at most 500 players per call, got %',
      cardinality(p_player_ids)
      using errcode = '22023';
  end if;

  return query
  with allowed as (
    select requested.id
    from unnest(coalesce(p_player_ids, '{}'::uuid[])) as requested(id)
    where exists (select 1 from public.auth_clan_ids())
       or current_setting('role', true) = 'service_role'
       or requested.id in (select public.auth_owned_player_ids())
  )
  select distinct on (pp.player_id)
         pp.player_id, pp.captured_at, pp.th_level, pp.th_weapon_level, pp.units
  from public.player_progress pp
  where pp.player_id in (select id from allowed)
    and pp.deleted_at is null
  order by pp.player_id, pp.captured_at desc;
end;
$$;

revoke execute on function latest_player_progress(uuid[]) from public;
grant execute on function latest_player_progress(uuid[]) to authenticated, service_role;
