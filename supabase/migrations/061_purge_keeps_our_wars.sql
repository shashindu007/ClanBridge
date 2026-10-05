-- 061 — Clearing scouting keeps the enemy lineups of OUR wars.
--
-- 059 clears every lineup row of a finished season whose clan is not one of
-- ours. That was right while those rows were only scouting. They are now also
-- the other half of our own wars:
--
--   * the day page's defence — who attacked each of our bases, and with what
--     result — is the enemy's attacks read by the tag they hit (057: "Defence
--     is not stored");
--   * the enemy's base numbers and Town Halls are what an attack of ours is
--     measured against;
--   * the CWL player rating (services/cwl-rating.ts) is worked out from both,
--     and is derived, never stored.
--
-- So one press of the button turned a finished month's defence record blank
-- and its rating into nothing, and neither can be fetched again — Supercell
-- deletes the group when the season ends.
--
-- Now a lineup row is cleared only when its WAR is not one of ours. A group is
-- 28 wars, 7 of them ours: the 21 between other clans still go, which is nearly
-- all of the space the button exists to free. What stays is the enemy's side
-- of our seven wars — fifteen to thirty small rows a day.
--
-- "Our war" is a row in cwl_wars for the same season: that table only ever
-- holds wars this clan fought (scripts/sync/cwl.ts, chooseSides). Two family
-- clans in one group each have their own season, so each keeps its own seven.
--
-- cwl_scout_players and cwl_group_members are untouched by this: village
-- levels and registered rosters are scouting and nothing else, and clear as
-- before. Same three functions as 059, same signatures, same grants.

create or replace function cwl_scouting_finished_seasons()
returns table (season_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.cwl_seasons s
  where s.deleted_at is null
    and (
      s.season < to_char(now() at time zone 'UTC', 'YYYY-MM')
      or (
        exists (
          select 1 from public.cwl_group_wars w
          where w.season_id = s.id and w.deleted_at is null
            and w.day_number = 7 and w.state = 'warEnded'
        )
        and not exists (
          select 1 from public.cwl_group_wars w
          where w.season_id = s.id and w.deleted_at is null
            and w.state is distinct from 'warEnded'
        )
      )
    )
    and (
      exists (select 1 from public.cwl_scout_players x
              where x.season_id = s.id and x.clan_tag not in (select c.tag from public.clans c))
      -- Only a lineup row that would actually be cleared: without the war
      -- check a season holding nothing but our own wars' enemies would be
      -- listed for ever with nothing to delete.
      or exists (select 1 from public.cwl_group_war_members x
                 where x.season_id = s.id and x.clan_tag not in (select c.tag from public.clans c)
                   and not exists (select 1 from public.cwl_wars w
                                   where w.season_id = x.season_id and w.war_tag = x.war_tag
                                     and w.deleted_at is null))
      or exists (select 1 from public.cwl_group_members x
                 where x.season_id = s.id and x.clan_tag not in (select c.tag from public.clans c))
    );
$$;

revoke execute on function cwl_scouting_finished_seasons() from public, anon, authenticated;


create or replace function purge_cwl_scouting(p_dry_run boolean default false)
returns table (
  seasons_cleared   integer,
  villages_removed  integer,
  lineups_removed   integer,
  rosters_removed   integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_seasons  uuid[];
  v_ours     text[];
  v_villages integer := 0;
  v_lineups  integer := 0;
  v_rosters  integer := 0;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'purge_cwl_scouting: platform admin only' using errcode = '42501';
  end if;

  select coalesce(array_agg(f.season_id), '{}') into v_seasons
  from public.cwl_scouting_finished_seasons() f;
  select coalesce(array_agg(c.tag), '{}') into v_ours from public.clans c;

  if p_dry_run then
    return query
      select cardinality(v_seasons),
             (select count(*)::integer from public.cwl_scout_players x
              where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours))),
             (select count(*)::integer from public.cwl_group_war_members x
              where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours))
                and not exists (select 1 from public.cwl_wars w
                                where w.season_id = x.season_id and w.war_tag = x.war_tag
                                  and w.deleted_at is null)),
             (select count(*)::integer from public.cwl_group_members x
              where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours)));
    return;
  end if;

  delete from public.cwl_scout_players x
  where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours));
  get diagnostics v_villages = row_count;
  delete from public.cwl_group_war_members x
  where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours))
    and not exists (select 1 from public.cwl_wars w
                    where w.season_id = x.season_id and w.war_tag = x.war_tag
                      and w.deleted_at is null);
  get diagnostics v_lineups = row_count;
  delete from public.cwl_group_members x
  where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours));
  get diagnostics v_rosters = row_count;

  if cardinality(v_seasons) > 0 then
    insert into public.audit_log (user_id, action, entity, after)
    values (auth.uid(), 'delete', 'cwl_scouting', jsonb_build_object(
      'seasons', cardinality(v_seasons), 'villages', v_villages,
      'lineups', v_lineups, 'rosters', v_rosters));
  end if;

  return query select cardinality(v_seasons), v_villages, v_lineups, v_rosters;
end;
$$;

revoke execute on function purge_cwl_scouting(boolean) from public;
grant execute on function purge_cwl_scouting(boolean) to authenticated;


create or replace function cwl_scouting_purge_preview()
returns table (
  clan_name    text,
  season       text,
  other_clans  text[],
  villages     integer,
  lineups      integer,
  rosters      integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.auth_is_platform_admin() then
    return;
  end if;

  return query
    select c.name::text,
           s.season::text,
           coalesce((
             select array_agg(coalesce(g.name, g.clan_tag) order by coalesce(g.name, g.clan_tag))
             from public.cwl_group_clans g
             where g.season_id = s.id and g.deleted_at is null
               and g.clan_tag not in (select o.tag from public.clans o)
           ), '{}'),
           (select count(*)::integer from public.cwl_scout_players x
            where x.season_id = s.id and x.clan_tag not in (select o.tag from public.clans o)),
           (select count(*)::integer from public.cwl_group_war_members x
            where x.season_id = s.id and x.clan_tag not in (select o.tag from public.clans o)
              and not exists (select 1 from public.cwl_wars w
                              where w.season_id = x.season_id and w.war_tag = x.war_tag
                                and w.deleted_at is null)),
           (select count(*)::integer from public.cwl_group_members x
            where x.season_id = s.id and x.clan_tag not in (select o.tag from public.clans o))
    from public.cwl_scouting_finished_seasons() f
    join public.cwl_seasons s on s.id = f.season_id
    join public.clans c on c.id = s.clan_id
    order by s.season desc, c.name;
end;
$$;

revoke execute on function cwl_scouting_purge_preview() from public;
grant execute on function cwl_scouting_purge_preview() to authenticated;
