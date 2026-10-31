-- 072 — The second half of 068: a war tag may now repeat across seasons.
--
-- APPLY THIS ONLY AFTER THE CODE THAT USES 068 IS ON main.
--
-- The sync jobs run from main, and until that code arrives there they upsert on
-- war_tag alone, which needs this constraint. Dropping it first would fail every
-- CWL sync, and a season missed is a season gone. So the change is in two steps:
-- 068 added the per-season constraint beside this one, and both old and new code
-- work with both in place. This removes the old one, which is what actually lets
-- two family clans in one group each keep their own row.
--
-- `npm run migrations:apply -- --until=071` stops before this file.

alter table cwl_wars drop constraint cwl_wars_war_tag_key;
