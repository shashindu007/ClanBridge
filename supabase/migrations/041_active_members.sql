-- T12.4 — who is here, by name, with when they were last around.
--
-- 040 added platform_presence(), which answers "how many" and deliberately
-- refuses to answer "who": it returns four integers and never a list, because
-- every approved member may call it and `users` holds email addresses.
--
-- "How many" turned out to be the less useful half. A number in the rail tells
-- you somebody is about; it does not tell you whether it is the co-leader you
-- need for a war lineup. So this adds the list — and the reason it is a second
-- function rather than a widening of the first is the rule 038 wrote down:
--
--     "Widen that function's output, not the tables' policies, if more is ever
--      needed."
--
-- WHAT IS RETURNED, and the omission is the design:
--
--   id, username, display_name, last_seen_at, is_online, clans
--
-- WHAT IS NOT: email, ever. Also not status, not is_platform_admin, not
-- requested_clan_id, not password_set_at, not avatar_path. The first is a
-- privacy line; the rest are administration, and administration is
-- admin_accounts() (039), which answers only to a leader.
--
-- avatar_path is left out for a mechanical reason as well: the avatars bucket is
-- private, so an address is a signed URL minted per request, and a roster of
-- thirty faces would be thirty Storage round trips on one page load. T11.10
-- made this argument about a single avatar in the shell. The page draws
-- initials.
--
-- ON SHOWING "LAST SEEN" AT ALL. It is a real disclosure — this is a clan of
-- people who know each other, not a social network, and the alternative is a
-- product where "is anyone around?" is asked in WhatsApp, which is the thing
-- this system exists to replace. It is deliberately COARSE: 040's
-- touch_last_seen() only writes every two minutes, so the value is approximate
-- by construction and cannot be used to watch somebody navigate.

create or replace function active_members()
returns table (
  id           uuid,
  username     text,
  display_name text,
  last_seen_at timestamptz,
  is_online    boolean,
  clans        jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.username,
    u.display_name,
    u.last_seen_at,
    -- The same five minutes platform_presence() counts with. Computed here
    -- rather than in the application so the list and the tally above it can
    -- never disagree about who is online — two definitions of "now" in two
    -- languages is a bug that only shows up at the boundary.
    --
    -- coalesce, and it is doing two jobs. `null > timestamp` is NULL, not
    -- false, so a member who has never loaded a page since 040 shipped would
    -- otherwise get a NULL here — which the page branches on as though it were
    -- a boolean, and which sorts FIRST under the `desc` below. Both bugs are
    -- the same missing word, and both put the people who have never once
    -- opened the app at the top of a list of who is around.
    coalesce(u.last_seen_at > now() - interval '5 minutes', false) as is_online,
    coalesce(c.clans, '[]'::jsonb)
  from public.users u

  left join lateral (
    select jsonb_agg(
             jsonb_build_object('clan', cl.name, 'tag', cl.tag, 'role', cr.role)
             order by cl.tag
           ) as clans
    from public.clan_roles cr
    join public.clans cl on cl.id = cr.clan_id
    where cr.user_id = u.id
      and cr.deleted_at is null
  ) c on true

  where u.deleted_at is null
    and u.status = 'approved'
    -- The guard 037, 038 and 040 all use, verbatim: a caller holding at least
    -- one live clan_roles row, or the service role. A pending account sees
    -- nobody, because it has no role yet.
    and (
      exists (
        select 1 from public.clan_roles cr2
        where cr2.user_id = auth.uid() and cr2.deleted_at is null
      )
      or current_setting('role', true) = 'service_role'
    )

  -- Online first, then most recently seen. `nulls last` is not decoration: a
  -- member who has never loaded a page since 040 shipped has a NULL here, and
  -- in Postgres NULLs sort FIRST on a descending order — so without it the
  -- people who have never been seen would head a list titled "who is around".
  order by
    is_online desc,
    u.last_seen_at desc nulls last,
    coalesce(u.username, u.display_name, '')
$$;

revoke execute on function active_members() from public;
grant execute on function active_members() to authenticated, service_role;

comment on function active_members() is
  'T12.4 — every approved account by name, with last_seen_at and an is_online '
  'flag on the same five-minute window platform_presence() counts. Never '
  'returns email: that is admin_accounts() (039), which answers to a leader.';


-- ---------------------------------------------------------------------------
-- Verify by hand.
--
-- As a member of any clan:
--
--   select count(*) from active_members();          -- every approved account
--   select * from active_members() limit 1;         -- no email column exists
--   select count(*) from users;                     -- still your own row alone
--
-- As a signed-in account holding no clan role at all:
--
--   select count(*) from active_members();          -- 0
--
-- The ordering, which is the part that breaks silently:
--
--   update users set last_seen_at = null where id = '<somebody>';
--   select username, is_online from active_members();
--     -- the NULL is LAST, not first
-- ---------------------------------------------------------------------------
