-- 049 — The newest progress reading for many villages, in one round trip.
--
-- The CWL lineup builder now shows every candidate's hero levels and how close
-- to max their village is, for a pool of sixty to ninety players across the
-- family. player_progress keeps one reading a day per village, so a plain
-- `in (…)` read returns months of rows to use one per player; and one query per
-- player is ninety round trips on a page a leader reloads after every Add.
--
-- `distinct on (player_id)` over the (player_id, captured_at desc) index 036
-- already built is exactly "the newest row each", done where the data is.
--
-- SECURITY INVOKER, deliberately: this adds no access. The caller's own RLS on
-- player_progress (036 — their clans' villages, and their own) decides which
-- rows exist to be picked from, as it would for the plain select this replaces.

create or replace function latest_player_progress(p_player_ids uuid[])
returns table (
  player_id    uuid,
  captured_at  timestamptz,
  th_level     smallint,
  units        jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (pp.player_id)
         pp.player_id, pp.captured_at, pp.th_level, pp.units
  from public.player_progress pp
  where pp.player_id = any (p_player_ids)
    and pp.deleted_at is null
  order by pp.player_id, pp.captured_at desc;
$$;

revoke execute on function latest_player_progress(uuid[]) from public;
grant execute on function latest_player_progress(uuid[]) to authenticated, service_role;
