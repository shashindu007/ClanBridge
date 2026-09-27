-- 051 — latest_player_progress sees a village's newest reading wherever it
-- was taken, for anyone in the family.
--
-- 049 ran as the caller, so 036's policy — "readings whose clan_id is one of
-- mine" — decided which rows DISTINCT ON could pick from. player_progress.clan_id
-- is the clan at capture time, so for a member who moved between the family's
-- clans the newest VISIBLE reading could be months old, or missing: a lineup
-- card showing last spring's heroes as today's, which is worse than a blank.
--
-- It now follows 037's family_cwl_history, which has the same problem and the
-- same answer: SECURITY DEFINER, guarded so that anyone holding a role in some
-- platform clan sees every requested village, anyone else only their own, and
-- the service role everything. It returns the columns 049 did and nothing more.

create or replace function latest_player_progress(p_player_ids uuid[])
returns table (
  player_id    uuid,
  captured_at  timestamptz,
  th_level     smallint,
  units        jsonb
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
         pp.player_id, pp.captured_at, pp.th_level, pp.units
  from public.player_progress pp
  where pp.player_id in (select id from allowed)
    and pp.deleted_at is null
  order by pp.player_id, pp.captured_at desc;
end;
$$;

revoke execute on function latest_player_progress(uuid[]) from public;
grant execute on function latest_player_progress(uuid[]) to authenticated, service_role;
