-- T3.8 — Account approval gate.
--
-- Magic-link signup means anyone with an email address can create an account.
-- Verification (T3.3) proves someone owns *a* Clash of Clans account, not that
-- they belong to *these three clans*. Those are different claims, and only the
-- second one should grant access.
--
-- Numbering: 009 is deliberately absent (it held cwl_signups from the superseded
-- T4.9), and 010-012 are taken by Phase 4B and T6.8. Hence 013.

alter table users
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  -- Which clan this person is asking to join.
  --
  -- Without this, T3.8's "a leader approves them manually" has no secure list to
  -- work from: a pending user has no clan_roles row, so there is no clan scope to
  -- filter on, and the only alternative is letting every leader read every
  -- pending account in the system. Set at verification time from the clan the
  -- verified player tag actually belongs to.
  add column requested_clan_id uuid references clans (id) on delete restrict,

  add column approved_by uuid references users (id) on delete restrict,
  add column approved_at timestamptz;

comment on column users.status is
  'pending until their verified player tag matches a current member of one of the '
  'three clans, or a leader approves them. Access is governed by clan_roles; this '
  'column is what the approval UI reads.';

create index users_pending_idx
  on users (requested_clan_id, created_at)
  where status = 'pending' and deleted_at is null;


-- ---------------------------------------------------------------------------
-- Leaders can see who is waiting for them — and only for their own clans.
--
-- The existing "read own profile" policy stays. This is additive: RLS combines
-- multiple SELECT policies with OR, so a user still reads their own row, and a
-- leader additionally reads pending applicants to clans they lead.
--
-- Scoped to auth_leader_clan_ids(), not auth_clan_ids(): an elder should not be
-- reading strangers' email addresses.
-- ---------------------------------------------------------------------------
create policy "leaders read pending applicants to their clans" on users
  for select to authenticated
  using (
    status = 'pending'
    and requested_clan_id in (select auth_leader_clan_ids())
  );


-- ---------------------------------------------------------------------------
-- Note on what is NOT here.
--
-- No UPDATE policy. Approval is a privileged write, and it happens through a
-- route handler that has already called requireRole(clanId, 'leader') and
-- written to audit_log (R4). Granting members a broad update on users would let
-- anyone approve themselves, which is the entire thing this migration prevents.
-- ---------------------------------------------------------------------------
