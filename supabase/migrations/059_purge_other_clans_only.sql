-- 059 — Clearing scouting touches the OTHER clans only, and says which.
--
-- 058 cleared every scouting row of a finished season. Two of its tables hold
-- our side as well: a group war's lineup has both clans in it, and the group's
-- roster lists all eight. Those rows were copies — our wars, rosters and
-- attacks are in cwl_wars / cwl_war_members / cwl_attacks — but an admin
-- reading "clear other clans' scouting" must be able to trust it literally.
-- So now a row whose clan is one of ours is never cleared, whatever the season.
--
-- "Ours" is every clan in the clans table, active or not: a clan the family
-- has stopped syncing is still the family's history.
--
-- And a preview, so the page can name what goes before the press: for each
-- finished season, our clan, the month, and the other clans by name.

-- Finished seasons with something of another clan's left to clear. Not
-- granted: only the two functions below call it.
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
      or exists (select 1 from public.cwl_group_war_members x
                 where x.season_id = s.id and x.clan_tag not in (select c.tag from public.clans c))
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
              where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours))),
             (select count(*)::integer from public.cwl_group_members x
              where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours)));
    return;
  end if;

  delete from public.cwl_scout_players x
  where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours));
  get diagnostics v_villages = row_count;
  delete from public.cwl_group_war_members x
  where x.season_id = any (v_seasons) and not (x.clan_tag = any (v_ours));
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


-- What a press would clear, season by season: our clan, the month, and the
-- other clans by name. Platform admin only; anyone else gets no rows.
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
            where x.season_id = s.id and x.clan_tag not in (select o.tag from public.clans o)),
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
