-- T11.4 — One profile picture per account.
--
-- The shell has always labelled a member by their username, and 030 added that
-- handle so somebody with two accounts could tell which one they were signed in
-- as. A picture is the same problem one step further: it is the thing a member
-- recognises before they have read anything.
--
-- PER ACCOUNT, NOT PER BASE, and that is a decision rather than a simplification.
-- A member with three villages is still one person, and a face repeated three
-- times down a list carries no information. What distinguishes the villages is
-- the label in 033; what distinguishes the ACCOUNT is this.
--
-- The column holds a PATH inside the `avatars` Storage bucket, never a URL. The
-- bucket is private, so a usable address is a signed URL minted per request and
-- valid for an hour — storing one would mean storing something that stops
-- working. 035 creates the bucket and its policies.
--
-- NAMED avatar_path, NOT avatar_url, on purpose. base_layouts.image_url holds a
-- path and is named url, and the consequence is that
-- [clanTag]/layouts/page.tsx has to open with a paragraph explaining that its
-- image_url is not a URL. Fixing forward means not repeating the name. If both
-- ever need to be read together, this is the one that is telling the truth.

alter table users
  add column avatar_path text
    check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

comment on column users.avatar_path is
  'Object path inside the private `avatars` bucket (035), NOT a URL - the bucket '
  'is private, so an address is a signed URL minted per request. Shaped '
  '<user_id>/<uuid>.jpg, and the leading segment is load-bearing: the storage '
  'policies check (storage.foldername(name))[1] against auth.uid(). One picture '
  'per account, never per base; the per-base label is player_nicknames (033).';


-- ---------------------------------------------------------------------------
-- No policy, and that is correct — the same answer 030 gives, for the same
-- reason, restated because the next reader will look for one and not find it.
--
-- 015 granted `insert, update on users to authenticated` and added "own profile
-- update" (using/with check id = auth.uid()). 016's guard trigger
-- (guard_user_privilege_columns) raises only for is_platform_admin, status and
-- requested_clan_id. So this column is writable by its owner and by nobody else,
-- which is exactly the rule wanted, and adding a policy for it would be adding a
-- second expression that has to agree with the first.
--
-- The SELECT side is not widened either. An avatar_path is visible to the member
-- themselves, the platform admin, and a leader reading their own pending
-- applicants — the three reads 006/013/015 already allow. Showing a member's
-- picture to their clanmates is a SEPARATE decision, and a bigger one than
-- showing a handle: it needs a storage read policy letting one member sign
-- another member's object, which is a real disclosure surface. 035 therefore
-- keeps the bucket owner-only. Recorded as a hole, not half-closed.
--
-- ONE DELIBERATE HOLE, in 030's exact shape. A member can write any
-- correctly-shaped string into their own avatar_path, including a path belonging
-- to another user. It buys them nothing: the signed URL is minted under THEIR
-- session, and 035's storage policy refuses to sign a path whose first segment
-- is not their own id. The only outcome is a broken image on their own page.
-- Adding the column to the guard trigger would block the action that
-- legitimately writes it, which is 030's identical argument about
-- password_set_at.
--
-- The check constraint is shape, not authorisation. It exists so a malformed
-- value fails at the write rather than becoming a broken image discovered later,
-- and because a column that can hold anything eventually holds a full URL. The
-- authorisation is the storage policy, and it is enforced where the bytes are.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Sanity check after applying:
--
--   select avatar_path from users where id = auth.uid();
--
--   -- refused by the constraint, all four:
--   update users set avatar_path = 'https://example.com/a.jpg' where id = auth.uid();
--   update users set avatar_path = 'a.jpg'                     where id = auth.uid();
--   update users set avatar_path = '../secrets/a.jpg'          where id = auth.uid();
--   update users set avatar_path = '<uuid>/<uuid>.png'         where id = auth.uid();
-- ---------------------------------------------------------------------------
