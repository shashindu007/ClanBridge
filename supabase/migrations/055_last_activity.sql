-- 055 — Each member's last activity, worked out where the readings are.
--
-- THE BUG THIS FIXES. "Last seen" on the member directory and the "no activity
-- for 14 days" flag on Worth a look were computed in TypeScript from
-- recentSnapshots(), which read a clan's newest readings up to a row cap — and
-- PostgREST returns at most 1,000 rows. For a 49-member clan that was about 20
-- hours of history when the sync was hourly, and 10 hours at every 30 minutes
-- (054). A member quiet for two days was simply absent from the window, so the
-- 14-day flag could never fire, and "last seen" said "more than 0 days" for
-- anyone quiet since yesterday. Nothing looked wrong; the page was just blind.
--
-- THE RULE IS UNCHANGED, and it is services/members.ts lastActivityAt()'s: the
-- most recent reading at which donations ROSE, donations received ROSE, or
-- trophies MOVED, compared with the reading before it. A fall is a monthly reset
-- or a clan move, which nobody did anything to cause, so it is not activity.
-- A comparison involving a missing value is unknown, and unknown is not
-- activity — `max(...) filter (where null)` counts nothing, as rose() does.
--
-- Done here because the answer is one row per member however long the window,
-- and the window can be weeks. first_reading_at says how far back this player's
-- readings reach, so the page can say "more than N days" honestly.
--
-- SECURITY INVOKER: no new access. RLS on member_snapshots decides which rows
-- exist; p_clan_ids is the explicit filter R3 asks for on top.

create or replace function last_activity(p_clan_ids uuid[], p_since timestamptz)
returns table (
  player_id         uuid,
  last_activity_at  timestamptz,
  first_reading_at  timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with points as (
    select s.player_id,
           s.captured_at,
           s.donations          > lag(s.donations)          over w as gave,
           s.donations_received > lag(s.donations_received) over w as got,
           s.trophies          <> lag(s.trophies)           over w as moved
    from public.member_snapshots s
    where s.clan_id = any (p_clan_ids)
      and s.captured_at >= p_since
      and s.deleted_at is null
    window w as (partition by s.player_id order by s.captured_at)
  )
  select p.player_id,
         max(p.captured_at) filter (where p.gave or p.got or p.moved),
         min(p.captured_at)
  from points p
  group by p.player_id;
$$;

revoke execute on function last_activity(uuid[], timestamptz) from public;
grant execute on function last_activity(uuid[], timestamptz) to authenticated, service_role;
