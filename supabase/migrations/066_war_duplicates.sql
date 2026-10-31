-- 066 — Wars recorded twice, and two sync rows that never closed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ONE WAR, TWO ROWS.
--
-- The API moved a war's startTime by 20 to 36 minutes during preparation, and
-- `wars` has no identity but (clan_id, start_time), so the next sync inserted a
-- second row. The first kept its roster and no attacks. closeStaleWars() then
-- closed it with the real final score from the war log, so it looked like a
-- finished war: it showed twice in history, and everyone in it was charged for two
-- unused attacks. Four wars in October 2026, 110 member entries.
--
-- scripts/sync/war.ts now moves the row instead. This clears what is already there.
--
-- A row is removed only when ALL of these hold, so it cannot take a real war:
--   * another row has the same clan and opponent, starting within six hours. A
--     rematch cannot start that soon: the first war's battle day has to end.
--   * this row has no attacks at all, and the other row has some.
--   * no leader assigned anything on this row.
--
-- Soft deleted (R4). The roster rows stay, and nothing reads them once the war is
-- gone. The month's rating is derived, never stored, so it corrects itself.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TWO SYNC ROWS STILL 'running'.
--
-- Two cwl runs from 3 October died without closing their rows. Nothing is blocked
-- by them, since runningSince() ignores anything older than 15 minutes, but a row
-- that says a job is running a month later is a lie in the log the admin page shows.
-- finished_at is the start, not now, so they do not read as a run from today.

update public.wars stale
set deleted_at = now()
from public.wars live
where stale.clan_id = live.clan_id
  and stale.opponent_tag = live.opponent_tag
  and stale.id <> live.id
  and stale.deleted_at is null
  and live.deleted_at is null
  and abs(extract(epoch from (live.start_time - stale.start_time))) <= 6 * 60 * 60
  and not exists (select 1 from public.war_attacks a where a.war_id = stale.id)
  and exists (select 1 from public.war_attacks a where a.war_id = live.id)
  and not exists (
    select 1 from public.war_targets t
    where t.war_id = stale.id and t.deleted_at is null
  );

update public.sync_log
set status = 'failed',
    finished_at = started_at,
    error = 'Died without closing its row. Closed by migration 066.'
where status = 'running'
  and finished_at is null
  and started_at < now() - interval '1 day';
