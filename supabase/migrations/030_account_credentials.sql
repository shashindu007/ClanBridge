-- T10.1 — A username, and the flag that says a password exists.
--
-- Until now the only way in was a magic link, and the only way out was waiting
-- for the cookie to expire. That made a second account unreachable: sign in as
-- one member and you are that member until the session dies. T10 adds a real
-- sign-out and a password, so switching accounts is two clicks instead of an
-- inbox.
--
-- WHAT IS NOT HERE, AND MUST NEVER BE. There is no password column, no salt, no
-- hash. Passwords live in auth.users.encrypted_password, written only by
-- supabase.auth.updateUser({ password }) and read only by Supabase's own
-- sign-in. This project stores no credential material and adds no hashing
-- dependency; a password column here would be the single worst thing this
-- schema could grow.
--
-- The two columns below are the parts Supabase cannot hold for us: a display
-- handle, and a flag the setup gate can read (a session cannot see into
-- auth.users to ask "does this account have a password yet?").

alter table users
  add column username text
    check (username is null or username ~ '^[a-z0-9_]{3,20}$'),

  add column password_set_at timestamptz;

comment on column users.username is
  'Display handle, lowercase. NOT the sign-in identifier - Supabase Auth is keyed '
  'on email and signInWithPassword takes an email, so resolving a username to one '
  'would mean an endpoint mapping a handle to a real email address, callable by '
  'anyone holding the public anon key. Set at /account/setup (T10.5).';

comment on column users.password_set_at is
  'When the member set a password via auth.updateUser. The setup gate in '
  '(app)/layout.tsx reads this; it cannot read auth.users.encrypted_password, '
  'which is where the password itself actually lives.';

-- Case-insensitive, and only among live rows — the same shape as every other
-- uniqueness constraint in this schema, so a soft-deleted account does not hold
-- its handle hostage forever (R4: nothing is ever hard deleted).
create unique index users_username_key
  on users (lower(username))
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- No policy, and that is correct.
--
-- The next person to read this will look for a "member sets their own username"
-- policy and not find one. It already exists: 015's "own profile update" grants
-- update on users where id = auth.uid(), and 015's guard trigger
-- (guard_user_privilege_columns) blocks only is_platform_admin, status and
-- requested_clan_id. Both new columns therefore fall through as writable by
-- their owner and by nobody else, which is exactly the rule wanted.
--
-- Nor is the SELECT side widened. Usernames stay visible only to the member
-- themselves, the platform admin, and a leader reading their own pending
-- applicants — the three reads 006/013/015 already allow. Showing handles to
-- other members is a separate decision with a real disclosure surface, and
-- nothing in T10 needs it.
--
-- ONE DELIBERATE HOLE. password_set_at is writable by its owner, so a member
-- could set it without ever setting a password and skip /account/setup. That
-- harms nobody but them: the Sign in button then fails for their account and
-- they are back on the magic link. Adding it to the guard trigger would block
-- the setup action itself, which is the only thing that legitimately writes it.
-- ---------------------------------------------------------------------------
