-- T3B.0 — clan detail columns, for the dashboard at T3B.1.
--
-- These four values are NOT new data. The clan endpoint has returned them since
-- T2.3, clanSchema has parsed them since T2.2, and mapClan() has produced them
-- since T2.4 — Clan in types/domain.ts carries level, warLeague, memberCount and
-- isWarLogPublic. syncClanRecord() then writes name and badge_url and discards
-- the rest, because 001_core.sql has nowhere to put them.
--
-- So this migration does not add a fetch. It stops an hourly one being wasted.
--
-- All nullable, deliberately. A clan added through /admin (migration 015) exists
-- before any sync has seen it, and a NOT NULL here would make adding a clan fail
-- until the next run. Null means "not synced yet", which is exactly what T4.8's
-- freshness indicator is for.

alter table clans
  add column level             smallint,
  add column war_league        text,
  add column member_count      smallint,
  add column is_war_log_public boolean;

comment on column clans.level is
  'In-game clan level. Null until the first sync:clans run sees this clan.';

comment on column clans.war_league is
  'War league NAME, e.g. "Crystal League I" - not the numeric id. The id is '
  'Supercell''s and means nothing outside their API; the name is what a member '
  'recognises and what the dashboard shows.';

comment on column clans.member_count is
  'Members the API reports, which is authoritative over counting players rows: '
  'a player row can lag by up to an hour, and can also be a former member whose '
  'left_at has not been set yet (T3.9).';

-- ---------------------------------------------------------------------------
-- T0.1, finally persisted.
--
-- "Confirm war logs are public" is written in the spec as a manual in-game check,
-- but the clan endpoint reports it and sync:clans already reads and warns on it
-- (5e42f07). Until now that warning went only to a job log nobody reads.
--
-- It matters because a private war log is a HARD blocker for phase 6, not a
-- degradation: the API returns 403 for that clan's wars and the war module
-- cannot collect anything at all. Storing it means /admin can show the answer
-- for all three clans at a glance rather than it being discovered in phase 6.
-- ---------------------------------------------------------------------------
comment on column clans.is_war_log_public is
  'T0.1. False means the war module (phase 6) can collect nothing for this clan '
  '- the API returns 403 for its wars. Re-read on every sync rather than trusted '
  'once, because a leader can change it in game at any time.';

-- No RLS changes. The clans policies from 006 ("read own clans") and 015
-- ("platform admin adds clans") are row-level and already cover these columns;
-- Postgres has no column-level component to them. A new policy here would be
-- redundant at best and a second, divergent definition of the same rule at worst.
