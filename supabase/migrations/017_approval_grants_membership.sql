-- T3.8 — Approving an account must also grant membership of the clan.
--
-- THE DEFECT
--
-- 015's approve_account() sets users.status = 'approved' and stops. But status is
-- only half of the gate. The other half is clan_roles: auth_clan_ids() reads it,
-- every clan-scoped policy in 006 filters on it, and visibleClans() builds the
-- switcher from it.
--
-- So an approved account with no clan_roles row is approved and still sees
-- nothing — past the /pending redirect, into an application with no clans in it.
-- The leader has clicked Approve, the applicant has been told they are in, and
-- the screen is empty. Nothing reports an error, because nothing failed.
--
-- 006 (lines 272-283) describes the empty-clan_roles state as the thing that
-- protects a stranger from seeing data, which is right. It is not a state an
-- APPROVED member should ever be left in.
--
-- WHY THIS REPLACES THE FUNCTION RATHER THAN ADDING A SECOND STEP
--
-- The alternative is for the admin page to call approve_account() and then insert
-- clan_roles itself — two round trips, no transaction. A failure between them
-- leaves exactly the half-approved state described above, and the leader has no
-- way to tell it happened.
--
-- 015 argued this same point when it made approval a function instead of a
-- policy: one indivisible act, always audited, authority checked in one readable
-- place. Granting the role is part of that act.
--
-- Section 4 — 015 is applied and is not edited. This fixes forward by replacing
-- the function; every check in the original is preserved verbatim below.


create or replace function approve_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan   uuid;
  target_status text;
  allowed       boolean;
begin
  if auth.uid() is null or target is null then
    return false;
  end if;

  select requested_clan_id, status into target_clan, target_status
  from public.users
  where id = target and deleted_at is null;

  if not found or target_status <> 'pending' then
    return false;
  end if;

  -- Nobody approves themselves, regardless of rank.
  if target = auth.uid() then
    raise exception 'accounts cannot approve themselves';
  end if;

  allowed := public.auth_is_platform_admin()
    or (target_clan is not null
        and target_clan in (select public.auth_leader_clan_ids()));

  if not allowed then
    return false;
  end if;

  -- New in 017. An account with no clan to be approved INTO cannot be approved:
  -- there is no membership to grant, and letting it through produces the empty
  -- application described above. The applicant must verify a player tag first,
  -- which is what sets requested_clan_id (016).
  if target_clan is null then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status      = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = target;

  -- The membership itself.
  --
  -- 'member' always, never the player's in-game rank. R11 — clan_roles is an
  -- application permission, and the in-game role is a game fact that sync owns.
  -- Copying one into the other would mean a promotion in game silently granted
  -- someone the ability to publish rosters and award bonuses here.
  --
  -- on conflict do nothing because unique (user_id, clan_id) already exists and a
  -- re-approval must not fail — and must not silently DOWNGRADE a leader back to
  -- member either, which an upsert would.
  insert into public.clan_roles (user_id, clan_id, role)
  values (target, target_clan, 'member')
  on conflict (user_id, clan_id) do nothing;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), target_clan, 'approve', 'users', target,
          jsonb_build_object('status', 'approved', 'role', 'member'));

  return true;
end;
$$;

revoke execute on function approve_account(uuid) from public;
grant execute on function approve_account(uuid) to authenticated;

comment on function approve_account(uuid) is
  'T3.8 - lifts the pending gate AND grants member of the requested clan, in one '
  'transaction. Approving without the clan_roles row leaves the account past the '
  '/pending redirect with no clans visible (017).';


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- after approving, the applicant must have BOTH
--   select status from users where id = '<applicant>';          -- 'approved'
--   select role from clan_roles where user_id = '<applicant>';  -- 'member'
--
-- If the second is empty, this migration did not take effect and the member is
-- looking at an empty application right now.
-- ---------------------------------------------------------------------------
