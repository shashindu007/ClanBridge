-- T12.2 — administering the accounts that already got in.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES
--
-- /admin/members reads `status = 'pending'` and nothing else, so an account
-- disappears from the only screen that ever showed it at the exact moment it is
-- approved. From then on there is no list of who holds an account, no way to
-- open one, no way to contact the person behind it, and no way to take access
-- away again. Approval was a one-way door with no handle on the other side.
--
-- Three capabilities, therefore, and they are deliberately the same three:
--
--   SEE    admin_accounts()        every account the caller may administer
--   SAY    send_account_message()  a message to one of them, kept, not just pushed
--   STOP   remove_account()        take access away — and restore_account() to undo
--
-- WHO MAY DO ANY OF IT — the platform admin, or a LEADER of a clan the target
-- holds a role in. Leader and not co-leader, because every one of these reads or
-- writes an email address and 013 already drew that line for exactly this data:
--
--     "Scoped to auth_leader_clan_ids(), not auth_clan_ids(): an elder should
--      not be reading strangers' email addresses."
--
-- WHY FUNCTIONS RATHER THAN A WIDER POLICY ON `users`
--
-- A policy would have to grant a leader SELECT on other people's `users` rows,
-- and `users` carries email, username, password_set_at and is_platform_admin.
-- Every future join through that table would silently inherit the widening —
-- which is 038's argument about `players`, restated for the one table where it
-- matters most. These functions return the eleven columns the admin screen
-- needs and nothing else, and RLS on `users` is left exactly as 006, 013 and 015
-- left it.
--
-- The writes are definer functions for the older reason: R4 says every write is
-- recorded, and an audit row the application appends afterwards is one it can
-- forget or forge (021). Row and audit entry, or neither.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- account_messages — leadership to one member, kept rather than only pushed.
--
-- WHY A TABLE AND NOT JUST A PUSH NOTIFICATION. push is best-effort by nature:
-- pushConfigured() is false in every environment with no VAPID keys, a member
-- who never granted permission has no subscription row, and lib/push.ts treats
-- every one of those as a no-op rather than an error. That is right for "the
-- roster is published" and wrong for "stop doing this or you lose your account"
-- — a warning nobody can prove was delivered is not a warning.
--
-- So the row is the message and the push is the doorbell. Same reasoning 021
-- used for announcements; this is the one-recipient case.
--
-- clan_id is the AUTHORITY the message was sent under, not a recipient filter:
-- the clan whose leadership the sender used. null means the platform admin sent
-- it platform-wide. It is here so the audit row below has a clan to be filed
-- against — see the read-policy widening at the end of this file for the case
-- where it is null.
-- ---------------------------------------------------------------------------
create table account_messages (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users (id) on delete restrict,
  sender_id    uuid not null references users (id) on delete restrict,
  clan_id      uuid references clans (id) on delete restrict,
  subject      text not null,
  body         text not null,
  -- When the recipient opened it. Null is unread, and that is the whole state
  -- machine — a message is not a conversation and has no reply.
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  deleted_at   timestamptz,

  -- Bounded here rather than only in the form. A Server Action is independently
  -- addressable, so the length that actually holds is the one the database
  -- enforces; the form's maxLength is the courtesy on top of it.
  constraint account_messages_subject_length check (char_length(subject) between 1 and 120),
  constraint account_messages_body_length    check (char_length(body) between 1 and 2000)
);

-- The inbox read: one member's messages, newest first.
create index account_messages_recipient_idx
  on account_messages (recipient_id, created_at desc)
  where deleted_at is null;

-- The badge count in the app shell, which runs on every navigation (T10.9) and
-- must therefore be an index-only answer rather than a scan.
create index account_messages_unread_idx
  on account_messages (recipient_id)
  where read_at is null and deleted_at is null;

create trigger account_messages_set_updated_at
  before update on account_messages
  for each row execute function set_updated_at();

alter table account_messages enable row level security;

-- Both ends of the message, and nobody else. The sender is included so the
-- admin screen can show what was already said to this person before saying it
-- again — without it, the only record of a warning is invisible to the person
-- who issued it.
create policy "read own account messages" on account_messages
  for select to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

-- SELECT only. No insert policy, because send_account_message() below writes the
-- row and its audit entry together; no update policy, because a recipient with
-- UPDATE on this table could rewrite the subject and body of a warning they
-- received and then produce it as evidence of something else. Marking one read
-- is mark_message_read() for that reason alone.
grant select on account_messages to authenticated;

comment on table account_messages is
  'T12.2 — a message from leadership to one account. Written only by '
  'send_account_message(); read by its two ends. The row is the message and the '
  'push notification is the doorbell, because push is best-effort.';


-- ---------------------------------------------------------------------------
-- May the caller administer this account?
--
-- One place, called by all four functions below, so "who may do this" cannot
-- drift between seeing an account and removing one.
--
-- THE SECOND ARM OF THE clan_roles CHECK IS NOT REDUNDANT. remove_account()
-- retires the target's clan_roles rows, which is what actually takes access
-- away. If this function required a LIVE role, removing someone would put them
-- beyond the reach of the leader who just removed them — they would vanish from
-- that leader's list and only the platform admin could ever restore them. So a
-- retired role still counts, but only while the account itself is removed.
-- ---------------------------------------------------------------------------
create or replace function auth_may_administer_account(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_target is not null
    and auth.uid() is not null
    and (
      public.auth_is_platform_admin()

      -- A member of a clan this caller leads.
      or exists (
        select 1
        from public.clan_roles cr
        join public.users u on u.id = cr.user_id
        where cr.user_id = p_target
          and cr.clan_id in (select public.auth_leader_clan_ids())
          and (cr.deleted_at is null or u.deleted_at is not null)
      )

      -- An applicant who verified into one. The same audience 013's policy
      -- already shows this caller, restated here so the admin screen and the
      -- approval queue answer to one rule.
      or exists (
        select 1
        from public.users u
        where u.id = p_target
          and u.status = 'pending'
          and u.requested_clan_id in (select public.auth_leader_clan_ids())
      )
    )
$$;

revoke execute on function auth_may_administer_account(uuid) from public;
grant execute on function auth_may_administer_account(uuid) to authenticated;

comment on function auth_may_administer_account(uuid) is
  'T12.2 — platform admin, or LEADER of a clan the target belongs to. Leader '
  'and not co-leader because everything gated by this reads an email (013).';


-- ---------------------------------------------------------------------------
-- admin_accounts(search) — the directory.
--
-- Every account the caller may administer, in every status, including the ones
-- already removed. Showing removed accounts is the point of restore_account()
-- existing at all: R4 keeps the row, so the screen has to keep the row too or
-- the undo is unreachable.
--
-- memberships and players are jsonb rather than parallel text[] columns. Two
-- arrays that must line up by index is a shape that breaks silently the first
-- time one of them is filtered, and both of these are genuinely nested.
--
-- auth_may_administer_account() is called per row. That is a handful of index
-- lookups against a table this deployment measures in dozens of rows — three
-- clans, one account each — and stating the rule once is worth more here than
-- inlining it would save. Revisit if `users` ever reaches five figures.
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
    -- Named removed_at, not deleted_at. R4 means the row is never gone, and a
    -- column called deleted_at on a screen that also offers Restore reads as a
    -- contradiction to everyone who did not write this file.
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

  left join lateral (
    select count(*)::integer as unread
    from public.account_messages am
    where am.recipient_id = u.id
      and am.read_at is null
      and am.deleted_at is null
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

  -- Waiting first, removed last. The approval queue is the thing with a
  -- deadline attached, so widening this screen from "pending only" must not
  -- push the pending accounts below a hundred approved ones.
  order by
    case
      when u.deleted_at is not null then 2
      when u.status = 'pending'     then 0
      else 1
    end,
    u.created_at desc
$$;

revoke execute on function admin_accounts(text) from public;
grant execute on function admin_accounts(text) to authenticated;

comment on function admin_accounts(text) is
  'T12.2 — every account the caller may administer, in every status. Returns '
  'zero rows rather than an error to a caller with no authority, which is how '
  'every read in this schema says no.';


-- ---------------------------------------------------------------------------
-- send_account_message — say something to one account, and keep it.
--
-- Returns the new id, or null when the caller has no authority over the target.
-- Null rather than an exception, matching approve_account(): the page turns it
-- into "the database refused that", and a raised message would name the
-- function and its checks to whoever is probing.
--
-- The PUSH is not sent here. A notification is an HTTPS round trip to a third
-- party and this is a transaction holding a write — lib/push.ts sends it after
-- this returns, and a push that fails must never roll back the message it was
-- announcing.
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
  if auth.uid() is null or p_target is null then
    return null;
  end if;

  -- Messaging yourself is not a feature, and allowing it would put a row in the
  -- inbox that the admin screen would then offer to warn you about.
  if p_target = auth.uid() then
    return null;
  end if;

  if not public.auth_may_administer_account(p_target) then
    return null;
  end if;

  -- Which clan's leadership this was sent under. The first clan the caller
  -- leads that the target belongs to; null for a platform admin acting with no
  -- clan authority, which is a real state rather than a missing value.
  select cr.clan_id into authority
  from public.clan_roles cr
  where cr.user_id = p_target
    and cr.deleted_at is null
    and cr.clan_id in (select public.auth_leader_clan_ids())
  order by cr.clan_id
  limit 1;

  insert into public.account_messages (recipient_id, sender_id, clan_id, subject, body)
  values (p_target, auth.uid(), authority, btrim(p_subject), btrim(p_body))
  returning id into new_id;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), authority, 'message', 'account_messages', new_id,
          -- The subject, never the body. audit_log is read by every leader of
          -- the clan it is filed against, and a private warning to one member
          -- should not become clan-wide reading because it was recorded.
          jsonb_build_object('recipient', p_target, 'subject', btrim(p_subject)));

  return new_id;
end;
$$;

revoke execute on function send_account_message(uuid, text, text) from public;
grant execute on function send_account_message(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- mark_message_read — the recipient opened it.
--
-- A function rather than an UPDATE policy, and this is the one place in the
-- schema where that choice is NOT about the audit log. An update policy on
-- account_messages is necessarily `using (recipient_id = auth.uid())`, and that
-- grants the whole row: a member who received "final warning about your
-- attacks" could rewrite it to say anything and the table would keep no trace.
-- One column, changed one way, by the one person entitled to.
--
-- Not audited, for 023's reason: the subject and the actor are the same person
-- and there is no decision to justify to anyone later.
-- ---------------------------------------------------------------------------
create or replace function mark_message_read(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_message is null then
    return false;
  end if;

  update public.account_messages
  set read_at = now()
  where id = p_message
    and recipient_id = auth.uid()
    and read_at is null
    and deleted_at is null;

  return found;
end;
$$;

revoke execute on function mark_message_read(uuid) from public;
grant execute on function mark_message_read(uuid) to authenticated;

-- set_updated_at fires on this update as it does on every other, and the
-- trigger is `security invoker` — but account_messages has no privilege guard
-- of its own to trip, so nothing here needs the bootstrap GUC. Stated because
-- the next function does need it, and the difference is not obvious.


-- ---------------------------------------------------------------------------
-- remove_account — take access away, reversibly.
--
-- WHAT "DELETE THIS ACCOUNT" MEANS HERE, since R4 says nothing ever is:
--
--   users.deleted_at   set          the account is removed
--   users.status       'rejected'   so the gate explains itself (T3.8)
--   clan_roles         retired      this is what actually revokes access —
--                                   auth_clan_ids() reads clan_roles, and every
--                                   RLS policy in the system reads that
--   audit_log          'remove'     with the reason the leader typed
--
-- What is NOT touched: players.user_id. The verified village stays claimed by
-- this account, so somebody removed for cause cannot simply sign up again on a
-- fresh email address and re-verify the same tag. That is the entire point of
-- removing them, and it is why this is not the mirror image of restore.
--
-- TWO ACCOUNTS CAN NEVER BE REMOVED: your own, and the platform admin's.
-- Removing your own is how a leader locks themselves out of the screen they did
-- it from; removing the admin's is how a clan leader takes the platform. 015
-- made the same argument about approve_account() refusing self-approval.
-- ---------------------------------------------------------------------------
create or replace function remove_account(p_target uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority   uuid;
  target_row  record;
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then
    return false;
  end if;

  -- AUTHORITY FIRST, and the order is the point. Every check below this line
  -- tells the caller something about an account — that it exists, that it is
  -- already removed, that it belongs to the platform admin. An earlier draft
  -- raised the platform-admin exception before this, which turned the function
  -- into an oracle: any signed-in member could ask "is this uuid the owner?"
  -- and read the answer off the error. A caller with no authority now learns
  -- nothing except false.
  if not public.auth_may_administer_account(p_target) then
    return false;
  end if;

  select id, is_platform_admin, deleted_at
    into target_row
  from public.users
  where id = p_target;

  if not found or target_row.deleted_at is not null then
    return false;
  end if;

  -- Raised by name rather than returned as false: this one is not "you lack
  -- authority", it is "this account is structurally not removable", and a
  -- silent false would read to the leader as a permissions problem they could
  -- ask someone to fix. Safe to raise here, because reaching this line already
  -- required authority over the account.
  if target_row.is_platform_admin then
    raise exception 'the platform admin account cannot be removed';
  end if;

  -- Resolved BEFORE the roles are retired, or the audit row lands with no clan
  -- and becomes invisible to every leader of the clan it concerns.
  select cr.clan_id into authority
  from public.clan_roles cr
  where cr.user_id = p_target
    and cr.deleted_at is null
    and cr.clan_id in (select public.auth_leader_clan_ids())
  order by cr.clan_id
  limit 1;

  -- 015's guard trigger refuses a session write to `status`. This is the
  -- sanctioned path, and the GUC is transaction-local so it cannot leak.
  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status     = 'rejected',
      deleted_at = now()
  where id = p_target;

  update public.clan_roles
  set deleted_at = now()
  where user_id = p_target
    and deleted_at is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), authority, 'remove', 'users', p_target,
          jsonb_build_object(
            'status', 'rejected',
            'removed', true,
            'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return true;
end;
$$;

revoke execute on function remove_account(uuid, text) from public;
grant execute on function remove_account(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- restore_account — the undo.
--
-- Clears deleted_at and puts the account back to 'pending'. NOT back to
-- 'approved', and not by reviving the clan_roles rows: approve_account() (017)
-- is the one thing that grants membership, and a restore that re-granted it
-- directly would be a second, quieter way into a clan that writes a different
-- audit trail. So a restored account lands exactly where a new one does — in
-- the approval queue, in front of a leader, one deliberate click from access.
--
-- That also makes the round trip honest: removing someone is reversible, but
-- letting them back in is still a decision somebody has to make on the record.
-- ---------------------------------------------------------------------------
create or replace function restore_account(p_target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority uuid;
begin
  if auth.uid() is null or p_target is null then
    return false;
  end if;

  if not public.auth_may_administer_account(p_target) then
    return false;
  end if;

  -- Retired roles, so the removing leader can still find them — the second arm
  -- of auth_may_administer_account()'s clan_roles check is what makes this
  -- readable at all, and this is its one caller that depends on it.
  select cr.clan_id into authority
  from public.clan_roles cr
  where cr.user_id = p_target
    and cr.clan_id in (select public.auth_leader_clan_ids())
  order by cr.clan_id
  limit 1;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status      = 'pending',
      deleted_at  = null,
      approved_by = null,
      approved_at = null
  where id = p_target
    and deleted_at is not null;

  if not found then
    return false;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), authority, 'restore', 'users', p_target,
          jsonb_build_object('status', 'pending', 'removed', false));

  return true;
end;
$$;

revoke execute on function restore_account(uuid) from public;
grant execute on function restore_account(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- A message to one person is its own notification kind.
--
-- The alternative was to ring the doorbell as 'announcements', and that is
-- wrong in a way that only shows up when it matters: a member who muted clan
-- notices because they were noisy would silently stop being told that their
-- leader had written to them personally. The one notification in this system
-- that is ABOUT them would be the one they never saw.
--
-- Default true, like every other column in 023, and absence of a row still
-- means every kind is enabled — push_targets() below coalesces, unchanged.
-- ---------------------------------------------------------------------------
alter table notification_preferences
  add column direct_messages boolean not null default true;

-- 023's function, restated with one branch added. `create or replace` rather
-- than an ALTER because a plpgsql body cannot be patched in place; the rest of
-- it is byte-for-byte 023 and must stay that way, so the diff between the two
-- files is exactly the line that changed.
create or replace function push_targets(p_clan uuid, p_kind text)
returns table (
  user_id  uuid,
  endpoint text,
  p256dh   text,
  auth_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ps.user_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth
  from public.push_subscriptions ps
  join public.clan_roles cr
    on cr.user_id = ps.user_id
   and cr.clan_id = p_clan
   and cr.deleted_at is null
  left join public.notification_preferences np
    on np.user_id = ps.user_id
   and np.deleted_at is null
  where ps.deleted_at is null
    and case p_kind
          when 'announcements'   then coalesce(np.announcements,   true)
          when 'cwl_reminders'   then coalesce(np.cwl_reminders,   true)
          when 'war_reminders'   then coalesce(np.war_reminders,   true)
          when 'raid_reminders'  then coalesce(np.raid_reminders,  true)
          when 'poll_reminders'  then coalesce(np.poll_reminders,  true)
          when 'direct_messages' then coalesce(np.direct_messages, true)
          else false
        end
    and (
      p_clan in (select public.auth_leadership_clan_ids())
      or current_setting('role', true) = 'service_role'
    )
$$;


-- ---------------------------------------------------------------------------
-- The platform admin may read the audit log.
--
-- 006 gave audit_log exactly one read policy — `clan_id in (select
-- auth_leader_clan_ids())` — and 023 spelled out the consequence: `null in
-- (...)` is NULL, never true, so a row filed against no clan is invisible to
-- everybody, forever.
--
-- Every function above can legitimately write such a row. A platform admin
-- messaging or removing an account that belongs to no clan yet — which is
-- precisely 018's reason for the admin existing — has no clan to file it
-- against. Before this policy those were the only audited acts in the system
-- that nobody could ever read back.
--
-- 033 named this fix in advance: "if it matters, the fix is widening
-- audit_log's read policy — not a clan_id here." It matters now.
--
-- Still SELECT only. audit_log has no insert policy and must never get one.
-- ---------------------------------------------------------------------------
create policy "platform admin reads all audit log" on audit_log
  for select to authenticated
  using (auth_is_platform_admin());


-- ---------------------------------------------------------------------------
-- Verify by hand.
--
-- As a LEADER of clan A:
--
--   select count(*) from admin_accounts();          -- clan A's accounts only
--   select email from users;                        -- still your own row alone
--   select remove_account('<a member of clan B>');  -- false
--
-- As an ORDINARY member:
--
--   select count(*) from admin_accounts();          -- 0
--   select send_account_message('<anyone>', 'x', 'y');  -- null
--
-- The round trip, as the leader:
--
--   select remove_account('<member of A>', 'kept skipping war attacks');  -- true
--   select count(*) from clan_roles
--    where user_id = '<member>' and deleted_at is null;                   -- 0
--   select removed_at from admin_accounts() where id = '<member>';        -- set
--   select restore_account('<member>');                                   -- true
--   select status from admin_accounts() where id = '<member>';            -- pending
--
-- And the two that must always refuse:
--
--   select remove_account(auth.uid());              -- false
--   select remove_account('<the platform admin>');  -- raises
-- ---------------------------------------------------------------------------
