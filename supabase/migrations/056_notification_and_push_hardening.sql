-- 056 — QA hardening, 2026-10: notifications and push devices.
--
-- Four findings from a whole-system QA pass, each a gap between what a function
-- promised and what it checked.
--
--   1. raise_notification() checked that a LEADER was calling, and never who
--      the recipients were. Leadership of any one clan was enough to write into
--      any account's feed on the platform, under any title.
--
--   2. notifications_url_relative let '/\evil.example' through. Browsers read a
--      backslash as a slash in a URL, so that is '//evil.example' — exactly the
--      protocol-relative address 040's second condition was written to stop —
--      and it reached both the "Go to it" link and the push click target.
--
--   3. A browser has ONE push endpoint, and push_subscriptions.endpoint is
--      unique. When a second account signed in on the same device and turned
--      notifications on, the upsert met the first account's row, RLS refused to
--      hand it over, and the member got "Could not save that subscription" —
--      while the device kept receiving the FIRST account's notifications.
--
--   4. Retiring expired endpoints ran under the caller's RLS. From a leader's
--      session (a notice, a poll reminder) it could only touch the leader's own
--      rows, so every other member's dead endpoint was retried forever.


-- ---------------------------------------------------------------------------
-- 1 + 2. raise_notification — recipients must belong to the clan.
--
-- 040's body, restated with one filter added. When the authority is clan
-- leadership and nothing more, the recipients are cut down to accounts holding
-- a live role in that clan. The service role (sync jobs) and the platform admin
-- keep the unfiltered form: the admin's whole reason to exist (018) is writing
-- to accounts that belong to no clan yet.
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
  written   integer;
  unscoped  boolean;
begin
  if p_recipients is null or array_length(p_recipients, 1) is null then
    return 0;
  end if;

  unscoped :=
    current_setting('role', true) = 'service_role'
    or public.auth_is_platform_admin();

  if not (
    unscoped
    or (p_clan is not null and p_clan in (select public.auth_leadership_clan_ids()))
  ) then
    return 0;
  end if;

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
  join public.users u on u.id = r and u.deleted_at is null
  where unscoped
     or exists (
       select 1 from public.clan_roles cr
       where cr.user_id = r
         and cr.clan_id = p_clan
         and cr.deleted_at is null
     );

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function raise_notification(uuid[], uuid, text, text, text, text) from public;
grant execute on function raise_notification(uuid[], uuid, text, text, text, text)
  to authenticated, service_role;

-- No backslash anywhere in a notification's path. NOT VALID then VALIDATE, so
-- an existing bad row fails this migration loudly rather than being skipped.
alter table notifications drop constraint notifications_url_relative;
alter table notifications add constraint notifications_url_relative
  check (url like '/%' and url not like '//%' and strpos(url, chr(92)) = 0) not valid;
alter table notifications validate constraint notifications_url_relative;


-- ---------------------------------------------------------------------------
-- 3. claim_push_subscription — this browser's endpoint is now this account's.
--
-- Whoever holds the browser's push subscription is the person the device
-- belongs to right now; the endpoint is a capability URL nobody else can
-- obtain. Taking it over from the previous account is therefore the correct
-- outcome, not a privilege: the previous account stops buzzing a device it is
-- no longer signed in on.
-- ---------------------------------------------------------------------------
create or replace function claim_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 16 and 256
     or coalesce(char_length(p_auth), 0)   not between 8 and 256 then
    return false;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        deleted_at = null;

  return true;
end;
$$;

revoke execute on function claim_push_subscription(text, text, text) from public;
grant execute on function claim_push_subscription(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. retire_push_endpoints — soft-delete endpoints the push service rejected.
--
-- Scoped to the endpoints the caller could have sent to: their own, those of
-- members of a clan they lead (push_targets() hands them exactly those), or any
-- endpoint for the service role. SOFT delete (R4), as before.
-- ---------------------------------------------------------------------------
create or replace function retire_push_endpoints(p_endpoints text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  retired integer;
begin
  if p_endpoints is null or array_length(p_endpoints, 1) is null then
    return 0;
  end if;

  update public.push_subscriptions ps
     set deleted_at = now()
   where ps.endpoint = any (p_endpoints)
     and ps.deleted_at is null
     and (
       current_setting('role', true) = 'service_role'
       or ps.user_id = auth.uid()
       or ps.user_id in (
         select cr.user_id from public.clan_roles cr
         where cr.clan_id in (select public.auth_leadership_clan_ids())
           and cr.deleted_at is null
       )
     );

  get diagnostics retired = row_count;
  return retired;
end;
$$;

revoke execute on function retire_push_endpoints(text[]) from public;
grant execute on function retire_push_endpoints(text[]) to authenticated, service_role;
