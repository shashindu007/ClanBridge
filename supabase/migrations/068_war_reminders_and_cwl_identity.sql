-- 068 — One reminder per war and weekend, and a CWL war per season.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. reminded_at.
--
-- Settings has offered War reminders and Raid reminders since T5.9, and nothing
-- ever sent either. scripts/sync/attack-reminders.ts does now. A war sync runs
-- every 30 minutes, so without a record of having asked, one war would nag a
-- member eight times, and T5.6 is clear about what that teaches a clan.
--
-- A stamp on the row, not a row per person. It is sent once, to everyone who still
-- owes an attack at that moment, and it is a game-fact table only the sync writes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cwl_wars is one row per war PER SEASON ROW. First of two steps.
--
-- 002 made war_tag unique across the table. A season row belongs to one clan, and
-- two family clans can land in one CWL group (cwl-scout.ts allows for it), which
-- puts one war tag in two seasons. Each run's upsert then took the row from the
-- other clan's season, the sides flipped, and reconcileRoster retired the other
-- clan's members. 048 already got this right for cwl_group_wars. No clans in
-- production have shared a group yet, so nothing needs repairing.
--
-- This adds the new constraint and leaves the old one, because the live sync runs
-- from main and upserts on war_tag until this code is merged. 072 drops the old
-- one, and must wait for that.

alter table wars add column reminded_at timestamptz;
alter table raid_seasons add column reminded_at timestamptz;

comment on column wars.reminded_at is
  'When attack reminders went out for this war. Null until then; sent once.';
comment on column raid_seasons.reminded_at is
  'When attack reminders went out for this weekend. Null until then; sent once.';

alter table cwl_wars add constraint cwl_wars_season_war_tag_key unique (season_id, war_tag);
