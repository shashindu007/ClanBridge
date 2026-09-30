-- 053 — Thinning old readings, so the free tier's 500 MB lasts.
--
-- WHY. member_snapshots takes ~2,000 rows a day (every member, every hour) and
-- player_progress one fat JSONB row per village per day. Left alone they are
-- most of the database within a year or two, and the free tier is 500 MB.
--
-- WHY THIN AND NOT DELETE. Hourly detail matters while it is recent — last
-- activity, the running season, the Participation page's 75-day window. Older
-- than a few months, nothing reads it hour by hour. What IS still read is:
--
--   * each stay's LAST reading, which is that stay's donation total (a season's
--     figures, the profile's six months of seasons, season donations);
--   * each stay's FIRST reading, which is when the player arrived (clan
--     movement on the profile);
--   * roughly one reading a day, for "last seen" on an old profile.
--
-- So old snapshots keep exactly those — the last of each day, and the first and
-- last of every stay (a stay ends at a clan change or a counter drop, the same
-- cut 052's donation_segments() makes). Everything between goes: about 95% of
-- the rows, with every season total unchanged. player_progress keeps one
-- reading a week; nothing reads old progress day by day. sync_log keeps the
-- newest run of each job, so freshness never falls back to "never run".
-- donation_counters is left alone: one row a day is already small, and old
-- seasons need it.
--
-- WHO. Platform admin only, and enforced here rather than by the page: it
-- deletes across every clan and cannot be undone. Never below three months —
-- the Participation page reads 75 days of hourly stays and would silently lose
-- its season boundaries.
--
-- R4 AND R5 SAY NOTHING IS DELETED, AND THIS IS THE DELIBERATE EXCEPTION. The
-- rows removed are redundant readings between two that are kept, not facts
-- that exist nowhere else. It runs as the owner, which is how it reaches past
-- the REVOKE DELETE 036 put on the sync role; that REVOKE still stops the sync
-- jobs, which is what it was for. Every run is written to audit_log.
--
-- ONE MONTH PER CALL. A session request is cut off after a few seconds, and a
-- first run over a year of history would be killed halfway. So each call thins
-- the oldest 31 days not yet thinned, records how far it got, and reports
-- whether there is more. The page offers "run again" until there is not.
--
-- THE FILE DOES NOT SHRINK STRAIGHT AWAY. Postgres keeps the freed space and
-- reuses it for new rows, so the database stops growing rather than getting
-- smaller. VACUUM FULL shrinks it, but it cannot run inside a function; it is a
-- one-line job for the Supabase SQL editor, and the admin page says so.

create table data_retention (
  -- A single row. The check makes a second one impossible.
  id             boolean primary key default true check (id),
  -- Everything captured before this has been thinned.
  thinned_until  timestamptz,
  keep_months    smallint,
  last_run_at    timestamptz,
  last_removed   jsonb,
  updated_by     uuid references users (id) on delete restrict
);

insert into data_retention (id) values (true);

alter table data_retention enable row level security;

create policy "platform admin reads data retention" on data_retention
  for select to authenticated
  using ((select auth_is_platform_admin()));

-- anon as well, like every table: the policy returns it nothing, and a missing
-- grant would turn "no rows" into a permission error.
grant select on data_retention to anon, authenticated, service_role;

comment on table data_retention is
  '053 - how far back old readings have been thinned, and what the last run '
  'removed. One row. Written only by thin_old_data().';


-- ---------------------------------------------------------------------------
-- What is taking the space. Platform admin only; anyone else gets no rows.
-- ---------------------------------------------------------------------------
create or replace function storage_usage()
returns table (name text, bytes bigint, row_estimate bigint)
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
    select '(database)'::text, pg_database_size(current_database()), null::bigint
    union all
    (select c.relname::text,
            pg_total_relation_size(c.oid),
            -- -1 until the table has been analysed once.
            greatest(c.reltuples, 0)::bigint
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 2 desc);
end;
$$;

revoke execute on function storage_usage() from public;
grant execute on function storage_usage() to authenticated;


-- ---------------------------------------------------------------------------
-- Thin the oldest month not yet thinned. See the header for what is kept.
-- ---------------------------------------------------------------------------
create or replace function thin_old_data(p_keep_months integer)
returns table (
  snapshots_removed  integer,
  progress_removed   integer,
  sync_runs_removed  integer,
  window_start       timestamptz,
  window_end         timestamptz,
  more               boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_from   timestamptz;
  v_to     timestamptz;
  v_snap   integer := 0;
  v_prog   integer := 0;
  v_sync   integer := 0;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'thin_old_data: platform admin only' using errcode = '42501';
  end if;
  if p_keep_months is null or p_keep_months < 3 or p_keep_months > 24 then
    raise exception 'thin_old_data: keep between 3 and 24 months' using errcode = '22023';
  end if;

  v_cutoff := date_trunc('day', now() - make_interval(months => p_keep_months));

  -- FOR UPDATE: two admins pressing the button at once take turns rather than
  -- thinning the same month twice from the same starting point.
  select r.thinned_until into v_from from public.data_retention r where r.id for update;

  if v_from is null then
    v_from := least(
      (select min(s.captured_at) from public.member_snapshots s),
      (select min(p.captured_at) from public.player_progress p)
    );
  end if;
  v_from := date_trunc('day', coalesce(v_from, v_cutoff));

  if v_from >= v_cutoff then
    return query select 0, 0, 0, v_from, v_from, false;
    return;
  end if;

  v_to := least(v_from + interval '31 days', v_cutoff);

  -- Snapshots. Read a day either side of the window so the first and last
  -- reading inside it can see their neighbours; delete only inside it. Any
  -- comparison with a null is unknown, and unknown keeps the row.
  with readings as (
    select s.id, s.clan_id, s.captured_at, s.donations, s.donations_received,
           lag(s.clan_id)             over w as prev_clan,
           lead(s.clan_id)            over w as next_clan,
           lag(s.donations)           over w as prev_given,
           lead(s.donations)          over w as next_given,
           lag(s.donations_received)  over w as prev_received,
           lead(s.donations_received) over w as next_received,
           row_number() over (
             partition by s.player_id, date_trunc('day', s.captured_at at time zone 'UTC')
             order by s.captured_at desc
           ) as nth_of_day
    from public.member_snapshots s
    where s.captured_at >= v_from - interval '1 day'
      and s.captured_at <  v_to + interval '1 day'
      and s.deleted_at is null
    window w as (partition by s.player_id order by s.captured_at)
  ),
  redundant as (
    select r.id
    from readings r
    where r.captured_at >= v_from
      and r.captured_at <  v_to
      and r.nth_of_day > 1                                  -- not the day's last
      and r.prev_clan = r.clan_id                           -- not a stay's first
      and r.next_clan = r.clan_id                           -- not a stay's last
      and r.donations >= r.prev_given                       -- not the first after a drop
      and r.donations_received >= r.prev_received
      and r.next_given >= r.donations                       -- not the last before a drop
      and r.next_received >= r.donations_received
  )
  delete from public.member_snapshots m using redundant d where m.id = d.id;
  get diagnostics v_snap = row_count;

  -- Progress: the last reading of each week.
  with ranked as (
    select p.id,
           row_number() over (
             partition by p.player_id, date_trunc('week', p.captured_at at time zone 'UTC')
             order by p.captured_at desc
           ) as nth_of_week
    from public.player_progress p
    where p.captured_at >= v_from and p.captured_at < v_to
  )
  delete from public.player_progress p using ranked r where p.id = r.id and r.nth_of_week > 1;
  get diagnostics v_prog = row_count;

  -- Sync history: old runs go, except each job's newest, which is what the
  -- freshness check and "last sync" read.
  delete from public.sync_log l
  where l.started_at < v_to
    and l.id not in (
      select distinct on (k.job_type, k.clan_id) k.id
      from public.sync_log k
      order by k.job_type, k.clan_id, k.started_at desc
    );
  get diagnostics v_sync = row_count;

  update public.data_retention r
  set thinned_until = v_to,
      keep_months   = p_keep_months,
      last_run_at   = now(),
      last_removed  = jsonb_build_object(
                        'snapshots', v_snap, 'progress', v_prog, 'syncRuns', v_sync,
                        'from', v_from, 'to', v_to),
      updated_by    = auth.uid()
  where r.id;

  insert into public.audit_log (user_id, action, entity, after)
  values (auth.uid(), 'delete', 'data_retention', jsonb_build_object(
    'keepMonths', p_keep_months, 'from', v_from, 'to', v_to,
    'snapshots', v_snap, 'progress', v_prog, 'syncRuns', v_sync));

  return query select v_snap, v_prog, v_sync, v_from, v_to, v_to < v_cutoff;
end;
$$;

revoke execute on function thin_old_data(integer) from public;
grant execute on function thin_old_data(integer) to authenticated;
