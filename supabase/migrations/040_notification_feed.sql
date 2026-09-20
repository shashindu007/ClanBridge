-- T12.3 — notifications that exist whether or not a push was delivered, and
-- presence, so the product can say how many people are actually here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG
--
-- A notification in this system was a Web Push and nothing else. Five places
-- send one — a notice posted (T5.1), a poll reminder (T4B.5), CWL and war
-- reminders (T5.8), a direct message (039) — and every one of them ended at
-- lib/push.ts, which is best-effort BY DESIGN:
--
--   * pushConfigured() is false wherever VAPID keys are unset, and sendPush()
--     logs a warning and returns {sent: 0}
--   * a member who never granted browser permission has no subscription row,
--     so push_targets() simply does not list them
--   * every delivery failure is swallowed, because a notification must never
--     fail the write it accompanies
--
-- All three are correct for a doorbell and catastrophic for a record. The
-- result was a product where "did anyone get told?" had no answer, and where
-- the bell icon in the shell led to the PREFERENCES page — a member could
-- configure notifications they could never actually read.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE RULE THIS ESTABLISHES, AND IT IS THE WHOLE POINT
--
--   THE FEED ALWAYS RECORDS.  THE PUSH IS WHAT RESPECTS THE TOGGLE.
--
-- notification_preferences (023) asks "what should we SEND you", and every
-- function below writes the row regardless of it. Muting war reminders means
-- your phone stops buzzing, not that the war reminder never happened. The
-- opposite — filtering the feed by the same toggle — rebuilds the original bug
-- one layer up: a member who muted a kind once, months ago, silently stops
-- being able to find out that anything of that kind ever occurred.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 039's account_messages IS SUPERSEDED HERE, one migration after shipping.
--
-- It was the right shape for the wrong scope: a durable row behind a
-- best-effort push, which is exactly what every OTHER notification needed too.
-- Keeping both would have given the shell two inboxes and two unread counts —
-- a Mail icon at 1 beside a bell at 3 — which is the same fragmentation this
-- migration exists to remove.
--
-- So its rows are copied into notifications below and the table is left in
-- place, written by nothing. R4: it is not dropped, and 012 is the precedent
-- for a file that survives as a tombstone. send_account_message() is replaced
-- rather than removed, so any caller still holding it keeps working.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- notifications — one row per RECIPIENT, not per event.
--
-- A single row per event with a join table would be smaller and is the wrong
-- shape: read state is per person, the preference that decided delivery is per
-- person, and the single most common query in the product is now "how many
-- unread does THIS member have". One row per recipient makes that a partial
-- index lookup; the normalised version makes it a join on every page load.
--
-- sender_id is NULLABLE and the null is meaningful: a war reminder has no
-- author. 006's argument against joining users for a name applies — the feed
-- carries the finished sentence rather than the parts to build one from.
--
-- url is a PATH within this site, never an absolute address. It is written into
-- a link and into a push payload, and an absolute URL from the database would
-- be an open redirect in both places.
-- ---------------------------------------------------------------------------
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users (id) on delete restrict,
  sender_id    uuid references users (id) on delete restrict,
  clan_id      uuid references clans (id) on delete restrict,

  -- The same vocabulary as notification_preferences' columns and lib/push.ts's
  -- NotificationKind. Not a foreign key and not an enum: 023 made the same call
  -- for push_targets(), and a CHECK here would mean a migration every time a
  -- kind is added to a table that is already append-only.
  kind         text not null,

  title        text not null,
  body         text not null,
  url          text not null default '/',
  read_at      timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  deleted_at   timestamptz,

  constraint notifications_title_length check (char_length(title) between 1 and 160),
  constraint notifications_body_length  check (char_length(body)  between 1 and 2000),
  -- Relative, so neither the link nor the push payload can be pointed off-site.
  -- '//evil.example' is a protocol-relative URL that a naive "starts with /"
  -- check would wave through, which is why the second condition is here.
  constraint notifications_url_relative check (url like '/%' and url not like '//%')
);

-- The feed itself.
create index notifications_recipient_idx
  on notifications (recipient_id, created_at desc)
  where deleted_at is null;

-- The bell count, which the app shell asks for on every navigation (T10.9).
create index notifications_unread_idx
  on notifications (recipient_id)
  where read_at is null and deleted_at is null;

create trigger notifications_set_updated_at
  before update on notifications
  for each row execute function set_updated_at();

alter table notifications enable row level security;

-- Both ends. The sender is included so /admin/members can show a leader what
-- they have already said to somebody, and whether it was read.
create policy "read own notifications" on notifications
  for select to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

-- SELECT only. Writes are the definer functions below; marking read is
-- mark_notification_read(), because an UPDATE policy scoped to the recipient
-- necessarily grants the whole row and a warning you can rewrite is not a
-- warning (039 made this argument first).
grant select on notifications to authenticated;
grant select on notifications to service_role;

comment on table notifications is
  'T12.3 — the durable record of every notification this system raises. Written '
  'regardless of notification_preferences; the preference governs the PUSH '
  'only. One row per recipient.';


-- ---------------------------------------------------------------------------
-- Carry 039's messages across.
--
-- Idempotent on purpose. `npm run migrations:apply` is re-runnable and a
-- half-applied bundle is re-pasted by hand more often than anyone would like,
-- so this must not duplicate anybody's inbox on a second run. The id is
-- reused, which makes the message its own natural key.
-- ---------------------------------------------------------------------------
insert into notifications (id, recipient_id, sender_id, clan_id, kind, title, body, url, read_at, created_at)
select
  am.id,
  am.recipient_id,
  am.sender_id,
  am.clan_id,
  'direct_messages',
  am.subject,
  am.body,
  '/notifications',
  am.read_at,
  am.created_at
from account_messages am
where am.deleted_at is null
on conflict (id) do nothing;

comment on table account_messages is
  'SUPERSEDED by notifications (040). Kept because R4 keeps rows, not because '
  'anything reads it. Nothing writes here any more.';


-- ---------------------------------------------------------------------------
-- raise_notification — the one write, used by everything.
--
-- Takes the RECIPIENTS rather than resolving them, so that "who should be told"
-- stays with the caller who knows the answer and this function stays the single
-- place that knows how a notification is stored. The two wrappers below resolve
-- an audience into a list and call this.
--
-- NOT AUDITED, and the reason is 023's: audit_log's read policy is
-- `clan_id in (select auth_leader_clan_ids())`, so rows land unreadable, and a
-- notification is a consequence of an audited act rather than an act of its
-- own. Posting the notice IS audited (021); telling forty people about it is
-- not forty more decisions.
-- ---------------------------------------------------------------------------
create or replace function raise_notification(
  p_recipients uuid[],
  p_clan       uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_url        text default '/'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then
    return 0;
  end if;

  -- AUTHORITY. Leadership of the clan being notified, the service role (the
  -- sync jobs, which bypass RLS anyway and call this so the rule lives in one
  -- place), or the platform admin for a notification with no clan at all.
  --
  -- The same three-way test push_targets() uses, extended with the admin arm
  -- because 018's clanless admin has somebody to notify and no clan to do it
  -- under. Without that, a platform admin messaging an applicant who has not
  -- joined anything yet would silently write nothing.
  if not (
    (p_clan is not null and p_clan in (select public.auth_leadership_clan_ids()))
    or current_setting('role', true) = 'service_role'
    or public.auth_is_platform_admin()
  ) then
    return 0;
  end if;

  -- NOTE THE ABSENCE OF A notification_preferences CHECK. See the header: the
  -- feed always records and the push is what respects the toggle. A filter here
  -- would mean a member who muted a kind can never discover it happened.
  --
  -- distinct, because a caller assembling recipients from two queries can
  -- legitimately arrive with the same person twice and nobody should get the
  -- same notice in their feed twice.
  -- public.notifications, not notifications. Every function in this schema runs
  -- with `set search_path = ''`, so an unqualified name here resolves to
  -- nothing at all and fails with "relation does not exist" at CALL time rather
  -- than at CREATE time — which is why it survives a migration that applies
  -- cleanly and is only found by a test that actually sends something.
  insert into public.notifications (recipient_id, sender_id, clan_id, kind, title, body, url)
  select distinct
    r,
    auth.uid(),
    p_clan,
    p_kind,
    btrim(p_title),
    btrim(p_body),
    coalesce(nullif(btrim(p_url), ''), '/')
  from unnest(p_recipients) as r
  -- A removed account (039) keeps its row, so without this it would keep
  -- accruing a feed it can never open.
  join public.users u on u.id = r and u.deleted_at is null;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function raise_notification(uuid[], uuid, text, text, text, text) from public;
grant execute on function raise_notification(uuid[], uuid, text, text, text, text)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- notify_clan_members — everyone holding a live role in one clan.
--
-- The audience for an announcement. Resolved HERE rather than in the
-- application for the same reason push_targets() resolves its own: a route that
-- forgets a filter must not be able to widen who gets told, and the clan filter
-- (R3) is not in the route.
-- ---------------------------------------------------------------------------
create or replace function notify_clan_members(
  p_clan  uuid,
  p_kind  text,
  p_title text,
  p_body  text,
  p_url   text default '/'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  select array_agg(distinct cr.user_id)
    into recipients
  from public.clan_roles cr
  join public.users u on u.id = cr.user_id and u.deleted_at is null
  where cr.clan_id = p_clan
    and cr.deleted_at is null
    -- The author does not need telling what they just posted. This was a real
    -- complaint about the push path, which notified the leader who wrote the
    -- notice a second after they wrote it.
    and cr.user_id is distinct from auth.uid();

  return public.raise_notification(recipients, p_clan, p_kind, p_title, p_body, p_url);
end;
$$;

revoke execute on function notify_clan_members(uuid, text, text, text, text) from public;
grant execute on function notify_clan_members(uuid, text, text, text, text)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Marking read.
--
-- Two functions rather than one taking a nullable id: "mark this one" and
-- "clear the lot" are different acts with different blast radii, and a null
-- argument that quietly means "all of them" is how a bug clears somebody's
-- whole feed.
-- ---------------------------------------------------------------------------
create or replace function mark_notification_read(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_id is null then
    return false;
  end if;

  update public.notifications
  set read_at = now()
  where id = p_id
    and recipient_id = auth.uid()
    and read_at is null
    and deleted_at is null;

  return found;
end;
$$;

revoke execute on function mark_notification_read(uuid) from public;
grant execute on function mark_notification_read(uuid) to authenticated;

create or replace function mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and deleted_at is null;

  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

revoke execute on function mark_all_notifications_read() from public;
grant execute on function mark_all_notifications_read() to authenticated;


-- ---------------------------------------------------------------------------
-- send_account_message, rewritten onto the feed.
--
-- Replaced rather than dropped: 039 granted it to `authenticated` and something
-- may still call it. Same signature, same authority check, same return — the
-- row now lands in notifications, and the audit entry is unchanged because a
-- direct message IS a leadership decision and always was.
-- ---------------------------------------------------------------------------
create or replace function send_account_message(
  p_target  uuid,
  p_subject text,
  p_body    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority uuid;
  new_id    uuid;
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then
    return null;
  end if;

  if not public.auth_may_administer_account(p_target) then
    return null;
  end if;

  select cr.clan_id into authority
  from public.clan_roles cr
  where cr.user_id = p_target
    and cr.deleted_at is null
    and cr.clan_id in (select public.auth_leader_clan_ids())
  order by cr.clan_id
  limit 1;

  -- Written directly rather than through raise_notification(), because that
  -- function returns a COUNT and this one has always returned the new id — the
  -- caller needs it for the push payload's collapse tag. The authority check
  -- above is the stricter of the two in any case.
  insert into public.notifications (recipient_id, sender_id, clan_id, kind, title, body, url)
  values (p_target, auth.uid(), authority, 'direct_messages',
          btrim(p_subject), btrim(p_body), '/notifications')
  returning id into new_id;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), authority, 'message', 'notifications', new_id,
          -- The subject, never the body (039). audit_log is read by every
          -- leader of the clan it is filed against.
          jsonb_build_object('recipient', p_target, 'subject', btrim(p_subject)));

  return new_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- admin_accounts(), repointed at the feed.
--
-- 039's version counts unread from account_messages. That table stopped being
-- written at the top of this file, so leaving it alone would have left the
-- "2 unread" badge on /admin/members reading zero for everybody, forever —
-- silently, because zero is a perfectly ordinary answer to that question.
--
-- Byte-for-byte 039 apart from the `msg` lateral, so the diff between the two
-- files is exactly the table that changed.
-- ---------------------------------------------------------------------------
create or replace function admin_accounts(p_search text default null)
returns table (
  id                uuid,
  email             text,
  username          text,
  display_name      text,
  status            text,
  is_platform_admin boolean,
  created_at        timestamptz,
  approved_at       timestamptz,
  removed_at        timestamptz,
  requested_clan    text,
  memberships       jsonb,
  players           jsonb,
  unread_messages   integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email,
    u.username,
    u.display_name,
    u.status,
    u.is_platform_admin,
    u.created_at,
    u.approved_at,
    u.deleted_at as removed_at,
    rc.name as requested_clan,
    coalesce(m.memberships, '[]'::jsonb),
    coalesce(p.players, '[]'::jsonb),
    coalesce(msg.unread, 0)
  from public.users u
  left join public.clans rc
    on rc.id = u.requested_clan_id

  left join lateral (
    select jsonb_agg(
             jsonb_build_object('clanId', c.id, 'clan', c.name, 'tag', c.tag, 'role', cr.role)
             order by c.tag
           ) as memberships
    from public.clan_roles cr
    join public.clans c on c.id = cr.clan_id
    where cr.user_id = u.id
      and cr.deleted_at is null
  ) m on true

  left join lateral (
    select jsonb_agg(
             jsonb_build_object('tag', pl.tag, 'name', pl.name, 'thLevel', pl.th_level)
             order by pl.tag
           ) as players
    from public.players pl
    where pl.user_id = u.id
      and pl.deleted_at is null
  ) p on true

  -- THE ONE CHANGE. Every unread notification, not only the direct messages:
  -- a leader deciding whether somebody has seen anything is better served by
  -- "eleven unread" than by "nought unread messages, and no idea about the
  -- rest".
  left join lateral (
    select count(*)::integer as unread
    from public.notifications n
    where n.recipient_id = u.id
      and n.read_at is null
      and n.deleted_at is null
  ) msg on true

  where public.auth_may_administer_account(u.id)
    and (
      p_search is null
      or btrim(p_search) = ''
      or u.email        ilike '%' || btrim(p_search) || '%'
      or u.username     ilike '%' || btrim(p_search) || '%'
      or u.display_name ilike '%' || btrim(p_search) || '%'
      or exists (
        select 1 from public.players pl
        where pl.user_id = u.id
          and pl.deleted_at is null
          and (pl.tag ilike '%' || btrim(p_search) || '%'
            or pl.name ilike '%' || btrim(p_search) || '%')
      )
    )

  order by
    case
      when u.deleted_at is not null then 2
      when u.status = 'pending'     then 0
      else 1
    end,
    u.created_at desc
$$;


-- ---------------------------------------------------------------------------
-- Presence.
--
-- last_seen_at is written by the app shell, which already runs on every
-- navigation and already reads this row (lib/auth.ts accountProfile). It is NOT
-- written on every request: touch_last_seen() below updates only when the
-- stored value is already stale, so a member clicking through ten pages in a
-- minute causes one write, not ten.
--
-- WHY NOT A REALTIME PRESENCE CHANNEL. Supabase has one, and it would be more
-- accurate. It also needs a websocket held open from every client, which is a
-- running cost on a free tier for a number displayed on a dashboard. "Active in
-- the last five minutes" is the honest version of online for a product people
-- open, read and close.
-- ---------------------------------------------------------------------------
alter table users
  add column last_seen_at timestamptz;

comment on column users.last_seen_at is
  'T12.3 — last page load, to the nearest couple of minutes. Written only by '
  'touch_last_seen(). Approximate by construction: see that function.';

-- Partial, and the predicate is what makes it small: the question is always
-- "who is online NOW", never "order everybody by last seen".
create index users_last_seen_idx
  on users (last_seen_at desc)
  where deleted_at is null;

/*
 * A definer function, for the reason 015 gives about `users`: there is no
 * general UPDATE policy on that table and there must not be one. "own profile
 * update" exists and would technically cover this, but routing a write that
 * happens on EVERY page load through the policy that also guards display_name
 * means one bug in that policy is a bug in the busiest write in the product.
 *
 * The staleness check is inside the function, so the throttle cannot be
 * forgotten by a caller, and the whole thing is one round trip.
 */
create or replace function touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  -- Two minutes. Short enough that the five-minute "online" window below is
  -- never wrong by more than its own granularity, long enough that a burst of
  -- navigation is a single write.
  --
  -- 015's guard trigger is not tripped: it refuses changes to status and
  -- is_platform_admin, and this touches neither, so no bootstrap GUC is needed
  -- here. Stated because every other definer write to `users` in this schema
  -- does set it, and the difference should not look like an omission.
  update public.users
  set last_seen_at = now()
  where id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '2 minutes');
end;
$$;

revoke execute on function touch_last_seen() from public;
grant execute on function touch_last_seen() to authenticated;


-- ---------------------------------------------------------------------------
-- platform_presence() — how many accounts, and how many are here now.
--
-- Counts only, never a list, and that is deliberate: this answers a question on
-- a dashboard that every approved member can see, and `users` holds email
-- addresses. 038 made the same distinction for clans — widen the FUNCTION's
-- output if more is ever needed, not the table's policy. The directory of
-- people remains /search, which reads players (in-game names) rather than
-- accounts.
--
-- WHO IS ANSWERED — the guard 037 and 038 use, verbatim: a caller holding at
-- least one live clan_roles row, or the service role. A pending account
-- therefore gets zeros, because it has no role yet.
-- ---------------------------------------------------------------------------
create or replace function platform_presence()
returns table (
  total_accounts   integer,
  active_accounts  integer,
  online_now       integer,
  pending_accounts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where u.deleted_at is null)::integer,
    count(*) filter (where u.deleted_at is null and u.status = 'approved')::integer,
    count(*) filter (
      where u.deleted_at is null
        and u.status = 'approved'
        -- Five minutes, against a value refreshed at most every two. Anything
        -- shorter reports somebody reading a long page as having left.
        and u.last_seen_at > now() - interval '5 minutes'
    )::integer,
    count(*) filter (where u.deleted_at is null and u.status = 'pending')::integer
  from public.users u
  where exists (
    select 1 from public.clan_roles cr
    where cr.user_id = auth.uid() and cr.deleted_at is null
  )
  or current_setting('role', true) = 'service_role'
$$;

revoke execute on function platform_presence() from public;
grant execute on function platform_presence() to authenticated, service_role;

comment on function platform_presence() is
  'T12.3 — account counts and who is active in the last five minutes. Counts '
  'only: every approved member can call this, and users holds email addresses.';


-- ---------------------------------------------------------------------------
-- Verify by hand.
--
-- As a LEADER of clan A, having posted a notice:
--
--   select notify_clan_members('<clan A>', 'announcements', 'Title', 'Body', '/x');
--     -- returns the number of OTHER members of A, never including you
--   select count(*) from notifications;            -- 0 — they are not yours
--
-- As a MEMBER of A, immediately afterwards:
--
--   select count(*) from notifications where read_at is null;   -- 1
--   select mark_notification_read('<its id>');                  -- true
--   select mark_notification_read('<its id>');                  -- false, already read
--
-- The rule this file exists for — muting does NOT empty the feed:
--
--   insert into notification_preferences (user_id, announcements)
--   values (auth.uid(), false);
--   -- as the leader again:
--   select notify_clan_members('<clan A>', 'announcements', 'Two', 'Body', '/x');
--   -- as the member: still arrives.
--   select count(*) from notifications;                         -- 2
--   -- but push_targets() no longer lists them:
--   select count(*) from push_targets('<clan A>', 'announcements');  -- one fewer
--
-- And nobody can notify a clan they do not run:
--
--   select notify_clan_members('<clan B>', 'announcements', 'x', 'y');  -- 0
--
-- Presence:
--
--   select touch_last_seen();
--   select online_now from platform_presence();                 -- at least 1
-- ---------------------------------------------------------------------------
