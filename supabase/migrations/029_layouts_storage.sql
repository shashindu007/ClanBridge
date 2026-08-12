-- T8.1 — the Supabase Storage bucket that holds layout screenshots.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS A SEPARATE MIGRATION FROM 028
--
-- Everything here touches the `storage` schema, which is created by Supabase and
-- does not exist in a plain Postgres. test/pg-harness.ts boots PGlite with only
-- the scaffolding this project's own migrations need, so 029 is deliberately
-- LEFT OUT of PHASE1_MIGRATIONS — it would fail there, and adding a storage
-- schema stub to the harness would mean testing a mock of Supabase rather than
-- Supabase.
--
-- The consequence is stated plainly rather than hidden: THE POLICIES BELOW ARE
-- NOT COVERED BY THE TEST SUITE. They are the only part of Phase 8 in that
-- position, which is why the verification block at the end is written out in
-- full and why 028 keeps every rule it can in the public schema where PGlite
-- can reach it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PRIVATE, NOT PUBLIC. A public bucket serves every object to anyone holding the
-- URL, and layout screenshots are clan material — a war base is something the
-- opponent would like to see. Reads go through a signed URL minted server-side
-- for a member who passes the same clan check everything else does.
--
-- The 1 GB free tier is the other constraint, and T8.2 is what keeps this inside
-- it: images are resized and re-encoded in the browser before upload. The size
-- limit here is the backstop for when that is bypassed, not the plan.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'layouts',
  'layouts',
  false,
  -- 600 KB. T8.2 targets under 300 KB, so anything arriving at twice that has
  -- skipped the compression path and should be refused rather than quietly
  -- eating the tier. Enforced by the storage service itself, so a caller that
  -- talks to it directly is bound by the same number as the upload form.
  614400,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- Object paths are `<clan_id>/<layout_id>.<ext>`.
--
-- The clan id being the FIRST path segment is what makes these policies
-- possible: storage.foldername(name) splits the path, and [1] is therefore the
-- owning clan, checkable against auth_clan_ids() exactly like every other table
-- in this project (R3). A flat bucket of `<layout_id>.jpg` would leave nothing
-- to filter on and force the check into the application, where forgetting it
-- fails open.
-- ---------------------------------------------------------------------------

create policy "read layout images for own clans" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'layouts'
    and (storage.foldername(name))[1] in (
      select clan_id::text from public.clan_roles
      where user_id = auth.uid() and deleted_at is null
    )
  );

create policy "upload layout images to own clans" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'layouts'
    and (storage.foldername(name))[1] in (
      select clan_id::text from public.clan_roles
      where user_id = auth.uid() and deleted_at is null
    )
  );

-- Replacing an image is an UPDATE on the object. Same clan test; the owner
-- check lives on base_layouts (028), because that is where "who uploaded this"
-- is recorded — storage.objects.owner is the auth uid and would disagree the
-- moment a leader tidies up somebody else's entry.
create policy "replace layout images in own clans" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'layouts'
    and (storage.foldername(name))[1] in (
      select clan_id::text from public.clan_roles
      where user_id = auth.uid() and deleted_at is null
    )
  );

-- NO DELETE POLICY, and that is R4 rather than an omission. Removing a layout
-- sets base_layouts.deleted_at; the image stays. An orphaned image costs a few
-- hundred kilobytes, and a deleted one costs a screenshot nobody can get back
-- because the member who took it has since rebuilt the base.


-- ---------------------------------------------------------------------------
-- Verify (in the SQL editor, signed in as a member):
--
--   -- the bucket exists and is private:
--   select id, public, file_size_limit from storage.buckets where id = 'layouts';
--
--   -- a member sees only their own clans' objects:
--   select name from storage.objects where bucket_id = 'layouts';
--
--   -- and uploading outside their clan is refused:
--   -- (from the client) upload to '<some other clan id>/x.jpg'
--   --   -> new row violates row-level security policy
-- ---------------------------------------------------------------------------
