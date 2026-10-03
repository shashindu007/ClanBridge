-- 058 — Clearing other clans' scouting once their CWL week is over.
--
-- 057's scouting is for preparing a war: who the enemy fields, how far along
-- their villages are, where they are weak. Once the week is over none of that
-- is read again — the next month is a new group, new rosters, new readings.
-- Only OUR data matters after the week, and none of it is here: our wars,
-- rosters and attacks live in cwl_wars / cwl_war_members / cwl_attacks, and the
-- standings and medals history in cwl_group_clans / cwl_group_wars. Those are
-- not touched.
--
-- What goes, for finished seasons only:
--
--   cwl_scout_players       every enemy village reading
--   cwl_group_war_members   every lineup and attack of the group's wars
--   cwl_group_members       every clan's registered roster
--
-- FINISHED means an earlier month than the current one, or day 7 has ended and
-- no war of the group is still open. A season still being played is never
-- touched, however the button is pressed.
--
-- R4 SAYS NOTHING IS DELETED, AND THIS IS THE SECOND DELIBERATE EXCEPTION,
-- after 053. These rows are not our history: they are a week's notes about
-- other people's villages, kept only while they could be used. It runs as the
-- owner, which is how it reaches past the missing DELETE grant; the sync jobs
-- still cannot delete anything. Platform admin only, enforced here, and every
-- run is written to audit_log.
--
-- p_dry_run = true counts what would go without removing anything, so the
-- admin page can say "3 finished seasons, 2,340 rows" before the press.

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
  v_villages integer := 0;
  v_lineups  integer := 0;
  v_rosters  integer := 0;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'purge_cwl_scouting: platform admin only' using errcode = '42501';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_seasons
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
    -- Only seasons with something to clear count as "cleared".
    and (
      exists (select 1 from public.cwl_scout_players x where x.season_id = s.id)
      or exists (select 1 from public.cwl_group_war_members x where x.season_id = s.id)
      or exists (select 1 from public.cwl_group_members x where x.season_id = s.id)
    );

  if p_dry_run then
    return query
      select cardinality(v_seasons),
             (select count(*)::integer from public.cwl_scout_players x where x.season_id = any (v_seasons)),
             (select count(*)::integer from public.cwl_group_war_members x where x.season_id = any (v_seasons)),
             (select count(*)::integer from public.cwl_group_members x where x.season_id = any (v_seasons));
    return;
  end if;

  delete from public.cwl_scout_players x where x.season_id = any (v_seasons);
  get diagnostics v_villages = row_count;
  delete from public.cwl_group_war_members x where x.season_id = any (v_seasons);
  get diagnostics v_lineups = row_count;
  delete from public.cwl_group_members x where x.season_id = any (v_seasons);
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
