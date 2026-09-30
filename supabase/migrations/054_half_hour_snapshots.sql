-- 054 — member_snapshots every 30 minutes instead of every hour.
--
-- WHY. The clans sync moves to every 30 minutes (sync-clans.yml). The donation
-- counter is wiped when a member leaves a clan, so whatever they gave after our
-- last reading and before leaving is gone from that clan's figure (052).
-- Halving the gap between readings halves what a move can lose. Free now: the
-- repository is public, and public repositories do not pay Actions minutes.
--
-- WHY A MIGRATION AND NOT JUST A CRON LINE. 007's idempotency key is
-- unique (player_id, captured_hour). A second run inside the same hour would be
-- ON CONFLICT DO NOTHING — the half-hourly schedule would run, report success,
-- and write nothing, which no page would ever reveal. The key becomes a
-- 30-minute slot, derived the same way (UTC, generated, so it is immutable and
-- independent of the session timezone — 007 explains both).
--
-- R5 STILL HOLDS: a retry, a manual run or one of GitHub's duplicate firings
-- inside the same half hour writes nothing.
--
-- captured_hour stays. Dropping a column is not needed for anything, and 007's
-- tests still describe it truthfully.
--
-- SIZE. Twice the rows, ~4,000 a day for ~85 members. Kept in check by 053's
-- thinning: with three or four months kept in full, this table settles at
-- roughly 100-150 MB and stops growing.

alter table member_snapshots
  add column captured_slot timestamp generated always as
    (date_bin('30 minutes', captured_at at time zone 'UTC', timestamp '2000-01-01')) stored;

alter table member_snapshots
  add constraint member_snapshots_player_slot_key unique (player_id, captured_slot);

alter table member_snapshots
  drop constraint member_snapshots_player_id_captured_hour_key;
