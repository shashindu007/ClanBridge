-- T12.7 — smaller avatars, and a way to stop storing the old ones.
--
-- LIVE-ONLY, like 029 and 035: it configures Supabase Storage, and the
-- `storage` schema does not exist in the PGlite harness. Listed in
-- LIVE_ONLY_MIGRATIONS (test/pg-harness.ts) so `migrations:apply` cannot
-- silently skip it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE CEILING: 100 KB -> 15 KB.
--
-- src/lib/avatar-image.ts now stores a 128px JPEG at about 5 KB, and REFUSES
-- anything over 15 KB rather than uploading whatever its lowest quality
-- produced. The bucket enforces the same number, because uploads go straight
-- from the browser to Storage — the compressor is the one step a modified
-- browser can skip, and this is the one it cannot. test/avatar-image.test.ts
-- pins AVATAR_MAX_BYTES to 15360 so the two cannot drift.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A DELETE POLICY, and a deliberate, narrow exception to R4.
--
-- 035 defined no delete policy and called the orphaned object per picture
-- change an accepted cost. On a small storage plan it is not: every change a
-- member makes leaves a file nobody will ever read, forever.
--
-- R4 exists because history cannot be re-fetched — a deleted CWL season is gone
-- from the game too. An avatar is the opposite: a replaceable picture the member
-- still holds on their own phone, which the product has already stopped
-- pointing at. Deleting it loses no fact about anything. R4's guarantee is
-- untouched where it matters: users.avatar_path is still only ever changed by a
-- write the member made, and the application deletes the OLD object only after
-- that write has succeeded (saveAvatar in src/app/(app)/account/page.tsx).
--
-- Own folder only — the same `(storage.foldername(name))[1] = auth.uid()` rule
-- 035's read and upload policies use — so a member can delete their own
-- pictures and nobody else's.
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
set file_size_limit = 15360
where id = 'avatars';

create policy "delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Verify:
--
--   select file_size_limit from storage.buckets where id = 'avatars';   -- 15360
--   select policyname from pg_policies
--    where schemaname = 'storage' and policyname = 'delete own avatar';  -- 1 row
--
-- Existing avatars keep their old size until the member uploads again.
-- `npm run avatars:cleanup` (dry run by default) lists the files no account
-- points to any more.
-- ---------------------------------------------------------------------------
