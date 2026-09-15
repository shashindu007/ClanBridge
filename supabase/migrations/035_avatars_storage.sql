-- T11.5 — the Supabase Storage bucket that holds profile pictures.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS A SEPARATE MIGRATION FROM 034
--
-- Everything here touches the `storage` schema, which Supabase creates and a
-- plain Postgres does not have. So this file is deliberately LEFT OUT of
-- PHASE1_MIGRATIONS and listed in LIVE_ONLY_MIGRATIONS instead, exactly as 029
-- is, for the reason 029 gives: adding a storage stub to the harness would mean
-- testing a mock of Supabase rather than Supabase.
--
-- Stated plainly rather than hidden: THE POLICIES BELOW ARE NOT COVERED BY THE
-- TEST SUITE. That is why 034 keeps every rule it can in the public schema where
-- PGlite can reach it (the avatar_path shape constraint is tested), and why the
-- verification block at the end of this file is written out in full.
--
-- IT IS ALSO ABSENT FROM supabase/apply-all.sql. That bundle is built from
-- PHASE1_MIGRATIONS only, so anyone applying the schema by pasting it must run
-- this file separately — `npm run migrations:apply` covers both lists and is the
-- path that does not need remembering.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PRIVATE, NOT PUBLIC, and the argument is stronger here than it was for
-- layouts. A public bucket serves every object to anyone holding the URL, and
-- these are photographs of people. A base screenshot leaking costs a war; a face
-- leaking is a different kind of thing and is not ours to risk on a convenience.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  -- 100 KB, where 029 allows 600. src/lib/avatar-image.ts (T11.7) targets 40 KB
  -- for a 256px square, so anything arriving at two and a half times that has
  -- skipped the compression path. The number is derived from that target, the
  -- same way 029's 600 KB is derived from the layout pipeline's 300 KB.
  102400,
  -- image/jpeg ONLY, where 029 allows three types. NOT an oversight: compressAvatar()
  -- always re-encodes to JPEG, so there is no legitimate path by which a PNG or a
  -- WebP arrives here, and an allow-list should say what is actually expected
  -- rather than what the browser could produce. The input side still ACCEPTS all
  -- three — sniffImageType() is shared with the layout pipeline, so a member can
  -- pick a PNG; it is the stored object that is always JPEG.
  array['image/jpeg']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- Object paths are `<user_id>/<uuid>.jpg`.
--
-- The user id being the FIRST path segment is what makes these policies
-- possible: storage.foldername(name) splits the path and [1] is therefore the
-- owning account, checkable against auth.uid(). 029 uses the identical mechanism
-- with a clan id and gives the identical argument — a flat bucket of
-- `<uuid>.jpg` leaves nothing to filter on and forces the check into the
-- application, where forgetting it fails open.
--
-- The second segment is a FRESH uuid on every upload, never the user id again and
-- never a fixed name. See the note on the absent UPDATE policy below.
--
-- OWNER-ONLY READS. A member can sign their own picture and nobody else's. This
-- is a deliberate limit, not an unfinished feature: showing avatars to clanmates
-- needs a policy permitting one member to sign another member's object, which is
-- a real disclosure surface and its own decision. 030 makes the identical
-- argument about not widening username visibility, and 034's header records this
-- as a hole rather than half-closing it. The consequence today is that the
-- picture appears in the member's own shell and on their own /account page.
-- ---------------------------------------------------------------------------

create policy "read own avatar" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- NO UPDATE POLICY, unlike 029 — and that is the interesting difference.
--
-- 029 needs one because a layout's image is named after the layout, so replacing
-- the picture means overwriting the same object. Here the object name is a fresh
-- uuid every time, so changing a picture is an INSERT of a new object followed by
-- moving users.avatar_path to point at it. No object is ever modified in place,
-- so no UPDATE privilege is needed.
--
-- REJECTED ALTERNATIVE: a fixed `<user_id>/avatar.jpg` with upsert: true. It
-- needs an UPDATE policy, and worse, it can serve a stale body — a signed URL
-- already handed to a browser keeps working after the overwrite and the CDN edge
-- may hold the old bytes for the life of the signature. A member who changes
-- their picture and still sees the old one has no way to tell that from a failed
-- upload.
--
-- NO DELETE POLICY, which is R4 rather than an omission. Clearing a picture sets
-- users.avatar_path to null; the object stays. The cost is one orphaned object
-- of ~40 KB per change, which is the trade 029 already accepted in writing, and
-- at 100 KB a head it takes ten thousand changes to threaten the free tier.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Verify (in the SQL editor, and from the client, signed in as a member):
--
--   -- the bucket exists, is private, and takes JPEG only:
--   select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'avatars';
--
--   -- a member sees only their own object, and exactly one per picture set:
--   select name from storage.objects where bucket_id = 'avatars';
--
--   -- and there are exactly two policies, select and insert, no update, no delete:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like '%avatar%';
--
-- From the client, as a signed-in member:
--
--   upload to '<your own user id>/<uuid>.jpg'      -> succeeds
--   upload to '<another user id>/<uuid>.jpg'       -> new row violates row-level
--                                                     security policy
--   createSignedUrl('<another user id>/<uuid>.jpg') -> error, not a working URL
--   upload a 300 KB file                            -> refused by the size limit
--   upload a PNG with contentType image/png         -> refused by the mime list
-- ---------------------------------------------------------------------------
