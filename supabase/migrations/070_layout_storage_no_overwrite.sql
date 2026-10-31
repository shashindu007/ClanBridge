-- 070 — Nobody overwrites a layout screenshot.
--
-- LIVE-ONLY, like 029: it touches storage.objects, which does not exist in the
-- PGlite harness. Listed in LIVE_ONLY_MIGRATIONS (test/pg-harness.ts).
--
-- 029's update policy let any member of a clan replace any image in that clan's
-- folder, including one a leader uploaded. The app never does this: every upload
-- has a fresh uuid name and `upsert: false` (upload-form.tsx), so the policy only
-- ever served a request the product does not make. Removing it is the whole fix.

drop policy if exists "replace layout images in own clans" on storage.objects;
