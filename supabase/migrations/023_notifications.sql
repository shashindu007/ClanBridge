-- T5.5 / T5.9 / T5.6 — making push actually possible.
--
-- push_subscriptions has existed since 004 and has never been writable. 006 gave
-- it RLS and exactly one policy — "read own push subscriptions", for select — so
-- the table that exists to hold a member's device registration could not accept
-- one. This is the same hole 022 found in cwl_bonuses, and it is worth naming the
-- pattern: 006 enabled RLS everywhere and shipped select policies only, on the
-- stated plan that each write would add its own policy scoped to the role allowed
-- to perform it. Every table written since has had to pay that debt on arrival.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY PLAIN POLICIES HERE, WHEN 021 AND 022 ARGUED FOR DEFINER FUNCTIONS
--
-- Those two write clan data — an announcement, a bonus medal — and R4 says every
-- write is recorded in audit_log. A definer function is how the write and its
-- audit row become one indivisible act.
--
-- A push subscription is not clan data. It is one member's own browser telling
-- the server where to reach it, and it has no clan_id to record against. That is
-- not a detail: audit_log's read policy is
--
--     using (clan_id in (select auth_leader_clan_ids()))
--
-- and `null in (...)` is NULL, never true. An audit row with no clan would be
-- invisible to every reader forever. Writing rows nobody can read is worse than
-- not writing them — it grows the table, and it makes the audit log look more
-- complete than it is.
--
-- So these are ordinary owner-scoped policies. The subject and the actor are the
-- same person, the row affects nobody else, and there is no decision to justify
-- to anyone later. Same reasoning for notification_preferences below.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- push_subscriptions — a member registers and de-registers their own devices.
-- ---------------------------------------------------------------------------

-- with check, not using: the row does not exist yet, so this constrains what may
-- be written rather than what may be read. Pinning user_id to auth.uid() is what
-- stops a member registering a device against somebody else's account and
-- receiving their notifications.
create policy "insert own push subscription" on push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

-- UPDATE covers three ordinary cases, all of which look like a rewrite:
--
--   * the browser rotates its keys and re-subscribes on the same endpoint —
--     004 made `endpoint` unique, so this arrives as an upsert, not an insert
--   * the member turns notifications off, which is a soft delete (R4)
--   * a subscription the push service reported as 410 Gone is revived when the
--     member re-subscribes later, by clearing deleted_at
--
-- Both clauses are needed: `using` decides which rows may be targeted, `with
-- check` decides what they may become. Without the second, a member could
-- reassign their own row's user_id to someone else.
create policy "update own push subscription" on push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A POLICY IS NOT A GRANT, and this is the third time this project has paid for
-- the difference. 006 granted `select on all tables` and nothing more; 014 had to
-- restore service_role's grants after every sync job failed with 42501 on first
-- contact with real Supabase.
--
-- Without these two lines the policies above are unreachable: Postgres checks the
-- table privilege first, so the insert fails with "permission denied for table
-- push_subscriptions" and the policy is never evaluated at all. That error looks
-- like a bug in the route rather than a missing grant, which is what makes it
-- expensive to find.
--
-- No DELETE, ever. R4, and the "grants no DELETE privilege" test in
-- migrations.test.ts enforces it.
grant insert, update on push_subscriptions to authenticated;


-- ---------------------------------------------------------------------------
-- T5.9 — notification_preferences.
--
-- Without these a member who finds the notifications annoying disables them at
-- the browser level, which is a decision they make once and never revisit. They
-- then stop receiving the CWL reminder too, which is the one that mattered. A
-- per-kind toggle is the difference between "too noisy" and "off".
--
-- ONE COLUMN PER KIND, not one row per (user, kind). The set of kinds is fixed
-- by what this system actually sends, adding one is a migration either way (a
-- row-per-kind table still needs its check constraint widened), and this shape
-- lets the default live in the column where it is impossible to overlook.
--
-- EVERY DEFAULT IS TRUE, and the absence of a row means the same thing. A member
-- who never opens the settings page must still get the CWL reminder, so the send
-- path left-joins this table and coalesces to true — see push_targets() below.
-- The opposite default is the version where the feature silently does nothing
-- for everyone who has not opted in, which is indistinguishable from broken.
-- ---------------------------------------------------------------------------
create table notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete restrict,
  announcements   boolean not null default true,
  cwl_reminders   boolean not null default true,
  war_reminders   boolean not null default true,
  raid_reminders  boolean not null default true,
  poll_reminders  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);

-- One live preference row per member. Partial, so a soft-deleted row does not
-- block writing a fresh one (R4 keeps the old one).
create unique index notification_preferences_user_idx
  on notification_preferences (user_id)
  where deleted_at is null;

create trigger notification_preferences_set_updated_at
  before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;

create policy "read own notification preferences" on notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy "insert own notification preferences" on notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "update own notification preferences" on notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- As above: the policies decide which rows, these decide who may ask at all.
-- service_role is stated explicitly rather than left to 014's default privileges,
-- because those apply only to tables created by the role that ran the ALTER, and
-- relying on that is how 006's omission survived unnoticed for twelve migrations.
grant select, insert, update on notification_preferences to authenticated;
grant select, insert, update on notification_preferences to service_role;

comment on table notification_preferences is
  'T5.9 — per-member notification toggles. Absence of a row means every kind is '
  'enabled; the send path coalesces to true so a member who never visited the '
  'settings page still receives the reminder that matters.';


-- ---------------------------------------------------------------------------
-- T5.6 — push_targets(clan, kind)
--
-- Who should receive a notification of this kind, in this clan, right now.
--
-- WHY THIS IS A DEFINER FUNCTION AND NOT A QUERY IN THE APPLICATION
--
-- Sending requires reading OTHER members' subscriptions, and "read own push
-- subscriptions" forbids exactly that — correctly, because a push endpoint is a
-- capability URL: anyone holding it can push to that device until it expires.
--
-- The service key could read them, but R6 keeps it out of Vercel, and an
-- announcement is posted from the web app. So the read is expressed once, here,
-- with the authority check attached to it: leadership of the clan being notified.
-- Members cannot call it usefully, and no route can widen it by forgetting a
-- filter, because the filter is not in the route.
--
-- R3 — the clan filter is the first thing this does, and it is not optional.
--
-- Sync jobs (T5.8, CWL reminders) run with the service key and bypass RLS, so
-- they may read the tables directly; they call this anyway, so that preference
-- handling and the clan filter have exactly one implementation.
-- ---------------------------------------------------------------------------
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
  -- The subscription belongs to a member of this clan. clan_roles is the only
  -- statement of who is in a clan (R3); a leader who left keeps neither.
  join public.clan_roles cr
    on cr.user_id = ps.user_id
   and cr.clan_id = p_clan
   and cr.deleted_at is null
  -- Absent row = every kind enabled, which is why this is a LEFT join and every
  -- branch coalesces to true.
  left join public.notification_preferences np
    on np.user_id = ps.user_id
   and np.deleted_at is null
  where ps.deleted_at is null
    and case p_kind
          when 'announcements'  then coalesce(np.announcements,  true)
          when 'cwl_reminders'  then coalesce(np.cwl_reminders,  true)
          when 'war_reminders'  then coalesce(np.war_reminders,  true)
          when 'raid_reminders' then coalesce(np.raid_reminders, true)
          when 'poll_reminders' then coalesce(np.poll_reminders, true)
          -- An unrecognised kind sends to nobody. A typo in a call site should
          -- deliver nothing, not deliver to everyone.
          else false
        end
    -- Leadership of the clan being notified, or the service role, which is the
    -- sync jobs (T5.8) and bypasses RLS in any case.
    and (
      p_clan in (select public.auth_leadership_clan_ids())
      or current_setting('role', true) = 'service_role'
    )
$$;

revoke execute on function push_targets(uuid, text) from public;
grant execute on function push_targets(uuid, text) to authenticated, service_role;

comment on function push_targets(uuid, text) is
  'T5.6 — subscriptions to notify for one clan and one kind, with T5.9 '
  'preferences applied. Returns nothing unless the caller is leadership of that '
  'clan or the service role.';


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- as an ordinary member of the clan, this must return ZERO rows even
--   -- though their own subscription is in the table:
--   select count(*) from push_targets('<clan>', 'announcements');   -- 0
--
--   -- as a leader of that clan, it must return one row per subscribed member:
--   select count(*) from push_targets('<clan>', 'announcements');   -- n
--
--   -- opting out removes only that kind:
--   insert into notification_preferences (user_id, announcements)
--   values (auth.uid(), false);
--   select count(*) from push_targets('<clan>', 'announcements');   -- n - 1
--   select count(*) from push_targets('<clan>', 'cwl_reminders');   -- n
--
--   -- and a member may never register a device against another account:
--   insert into push_subscriptions (user_id, endpoint, p256dh, auth)
--   values ('<someone else>', 'x', 'y', 'z');   -- violates row level security
-- ---------------------------------------------------------------------------
