-- T1.10 — Seed the three clans.
--
-- Run this ONCE, in the Supabase SQL editor, after 001–006 have been applied.
--
-- ==========================================================================
-- THIS FILE FAILS ON PURPOSE UNTIL YOU REPLACE THE PLACEHOLDERS (T0.2).
--
-- '#REPLACE1' is not a possible Clash of Clans tag, so the clans_tag_format
-- check constraint in 001_core.sql rejects it and the insert aborts. That is
-- deliberate: the alternative is three fake clans sitting in the database
-- looking real, which you would discover when the first sync 404s against them.
--
-- Expect: ERROR: new row for relation "clans" violates check constraint
--         "clans_tag_format"
-- That means the guard works. Put the real tags in and run it again.
--
-- Tags must be UPPERCASE with the leading hash: '#2PP0JCCL'.
-- Clash of Clans tags never contain the letter O — if you see one, it is a zero.
-- The full alphabet is: 0 2 8 9 P Y L Q G R J C U V
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
