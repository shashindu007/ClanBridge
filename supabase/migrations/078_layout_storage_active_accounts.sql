-- 078 — Layout images follow the same "active, approved account" rule as the
-- tables.
--
-- LIVE-ONLY, like 029 and 070: it touches storage.objects, which does not exist
-- in the PGlite harness. Listed in LIVE_ONLY_MIGRATIONS (test/pg-harness.ts).
--
-- 029's policies read clan_roles directly. 046 moved every table policy onto
-- auth_clan_ids(), which also requires auth_account_active() — so a removed or
-- not-yet-approved account that still had a clan_roles row lost the layouts
-- table but kept reading, and uploading to, the layout images. Same check here
-- now, so the two cannot disagree.
--
-- Avatars need nothing: their policies (035, 043) are the caller's own folder.

drop policy if exists "read layout images for own clans" on storage.objects;
create policy "read layout images for own clans" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'layouts'
    and (storage.foldername(name))[1] in (
      select clan_id::text from public.auth_clan_ids() as clan_id
    )
  );

drop policy if exists "upload layout images to own clans" on storage.objects;
create policy "upload layout images to own clans" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'layouts'
    and (storage.foldername(name))[1] in (
      select clan_id::text from public.auth_clan_ids() as clan_id
    )
  );
