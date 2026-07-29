-- T1.10 — Seed the three clans.
--
-- Run this ONCE, in the Supabase SQL editor, after 001–006 have been applied.
--
-- ==========================================================================
-- FILL IN THE REAL VALUES BELOW BEFORE RUNNING (T0.2).
--
-- Tags must be UPPERCASE and keep the leading hash: '#2PP0JCCL'.
-- The check constraint in 001_core.sql rejects anything else, so a lowercase
-- tag fails here rather than silently 404-ing against the API three weeks later.
--
-- Clash of Clans tags never contain the letter O — if you see one, it is a zero.
-- ==========================================================================

insert into clans (tag, name) values
  ('#REPLACE1', 'Replace with clan 1 name'),
  ('#REPLACE2', 'Replace with clan 2 name'),
  ('#REPLACE3', 'Replace with clan 3 name')
on conflict (tag) do nothing;

-- on conflict do nothing makes this safe to re-run (R5). It will not overwrite a
-- clan's name if you have already corrected it in the database.

-- badge_url, and any other clan detail, is filled in by scripts/sync/clans.ts on
-- its first run (T2.6). Do not type it by hand — it is a game fact (R11).

-- Verify:
--   select tag, name from clans order by tag;
-- Expect exactly three rows, each tag uppercase and starting with '#'.
