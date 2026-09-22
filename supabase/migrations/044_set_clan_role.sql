-- T12.9 — choosing what a member may do in a clan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP
--
-- Roles have been per clan since T3.5 — member, elder, co-leader, leader — and
-- every permission in the product reads them. But the only way a role was ever
-- WRITTEN was approve_account() granting 'member' (017), and the platform
-- admin's "make me leader" button. /admin/members told leaders that promoting
-- someone "is separate and deliberate" and there was nothing to do it with.
-- Every account on the platform was therefore a member, forever.
--
-- 015 did add "admin or leader changes roles" as an RLS UPDATE policy on
-- clan_roles, and nothing ever used it. It is the wrong tool for the reason
-- 015 itself gives about approvals: a role change is a privileged decision that
-- R4 says must be recorded, and a policy splits it into a write and a separate,
-- forgettable audit insert. So this is a definer function that writes both or
-- neither, like every other privileged write in the schema.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE RULES, and why each exists:
--
--   * Platform admin, or a LEADER of that clan. Not a co-leader: a co-leader
--     who could promote themselves a peer could promote a friend to co-leader,
--     who could promote them back.
--
--   * Never your own role. A leader demoting themselves by mistake loses the
--     screen they did it from; a leader promoting themselves is the escalation.
--
--   * Only the platform admin grants or removes LEADER. A leader may shape the
--     rest of their clan, but two leaders able to demote each other is a clan
--     with two leaders fighting over a dropdown.
--
--   * Nobody but the platform admin touches the platform admin's roles.
--
--   * Approved, not-removed accounts only. A pending account gets its first
--     role from approve_account(), which is the approval decision; a removed
--     one (039) gets its access back through restore_account() and approval,
--     never through a side door here.
--
--   * p_role NULL means "take them out of this clan" — a soft delete (R4), so
--     putting them back later revives the same row. clan_roles has a plain
--     unique (user_id, clan_id), so a second INSERT would collide rather than
--     start a fresh history.

create or replace function set_clan_role(p_user uuid, p_clan uuid, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin       boolean;
  current     text;
  row_id      uuid;
  row_deleted timestamptz;
  target_admin boolean;
begin
  if auth.uid() is null or p_user is null or p_clan is null then
    return false;
  end if;

  if p_role is not null and p_role not in ('member', 'elder', 'co-leader', 'leader') then
    return false;
  end if;

  if p_user = auth.uid() then
    return false;
  end if;

  admin := public.auth_is_platform_admin();

  -- AUTHORITY FIRST, before anything that describes the target — 039 learned
  -- that a check order which reveals facts about an account to a caller with
  -- no authority over it is an oracle.
  if not admin and p_clan not in (select public.auth_leader_clan_ids()) then
    return false;
  end if;

  if not exists (select 1 from public.clans where id = p_clan and deleted_at is null) then
    return false;
  end if;

  select is_platform_admin into target_admin
  from public.users
  where id = p_user and status = 'approved' and deleted_at is null;

  if not found then
    return false;
  end if;

  if target_admin and not admin then
    return false;
  end if;

  select id, role, deleted_at into row_id, current, row_deleted
  from public.clan_roles
  where user_id = p_user and clan_id = p_clan;

  -- What the caller can see right now; a retired row is "not in this clan".
  if row_deleted is not null then
    current := null;
  end if;

  if not admin and (p_role = 'leader' or current = 'leader') then
    return false;
  end if;

  -- Nothing to change is a success, not an error — pressing Save twice
  -- should not report that the first press failed.
  if current is not distinct from p_role then
    return true;
  end if;

  if p_role is null then
    update public.clan_roles set deleted_at = now() where id = row_id;
  elsif row_id is null then
    insert into public.clan_roles (user_id, clan_id, role) values (p_user, p_clan, p_role);
  else
    update public.clan_roles set role = p_role, deleted_at = null where id = row_id;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_clan, 'role', 'clan_roles', p_user,
          jsonb_build_object('role', current),
          jsonb_build_object('role', p_role));

  return true;
end;
$$;

revoke execute on function set_clan_role(uuid, uuid, text) from public;
grant execute on function set_clan_role(uuid, uuid, text) to authenticated;

comment on function set_clan_role(uuid, uuid, text) is
  'T12.9 — set, change or (with NULL) remove one member''s role in one clan. '
  'Platform admin or a leader of that clan; never your own; only the admin '
  'grants or removes leader. Audited as action ''role'' with before and after.';


-- ---------------------------------------------------------------------------
-- Verify by hand, as a LEADER of clan A:
--
--   select set_clan_role('<member of A>', '<A>', 'elder');       -- true
--   select set_clan_role('<member of A>', '<A>', 'leader');      -- false: admin only
--   select set_clan_role('<member of A>', '<B>', 'member');      -- false: not your clan
--   select set_clan_role(auth.uid(),      '<A>', 'co-leader');   -- false: yourself
--   select set_clan_role('<member of A>', '<A>', null);          -- true: out of A
--   select action, before, after from audit_log where action = 'role';
-- ---------------------------------------------------------------------------
