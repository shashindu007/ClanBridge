-- 017 was too strict, and broke a capability 015 deliberately created.
--
-- 015 documents is_platform_admin as: "May add clans and approve accounts that
-- belong to no clan yet. Exists only to break the bootstrap cycle."
--
-- 017 then refused every approval where requested_clan_id is null, to stop a
-- member being approved into an application with no clans in it. That reasoning
-- is right for a LEADER — a leader approving someone with no clan has nothing to
-- approve them into, and no way to give them a role afterwards.
--
-- It is wrong for the platform admin, who has both. Refusing them removes the
-- exact escape hatch that exists for when the normal path is unavailable: a
-- member whose tag has not synced yet, or an account that must be let in before
-- the clan it belongs to has been added.
--
-- So the rule becomes conditional on who is asking:
--
--   leader, no requested clan  -> refused. Nothing to approve into.
--   leader, requested clan     -> approved + granted member of that clan.
--   platform admin, no clan    -> approved, no role granted. Deliberate act by
--                                 the one person who can then grant one.
--   platform admin, with clan  -> approved + granted member of that clan.
--
-- The guarantee 017 was protecting survives where it matters: nobody reaches the
-- approved state with no clan role by accident. It now takes the platform admin
-- choosing to do it.
--
-- Section 4 — 017 is applied and is not edited. Fixed forward.

create or replace function approve_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_clan   uuid;
  target_status text;
  is_admin      boolean;
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

  is_admin := public.auth_is_platform_admin();

  allowed := is_admin
    or (target_clan is not null
        and target_clan in (select public.auth_leader_clan_ids()));

  if not allowed then
    return false;
  end if;

  -- 017's guarantee, narrowed to the case it was actually about. A leader
  -- approving a clanless account would leave them past the /pending redirect
  -- with nothing to see and no role the leader could grant.
  if target_clan is null and not is_admin then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set status      = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = target;

  -- 'member' always, never the player's in-game rank. R11 — clan_roles is an
  -- application permission and the in-game role is a game fact that sync owns.
  -- Copying one into the other would mean a promotion in game silently granted
  -- someone the ability to publish rosters and award bonuses here.
  --
  -- on conflict do nothing because unique (user_id, clan_id) already exists: a
  -- re-approval must not fail, and must not DOWNGRADE an existing leader back to
  -- member either, which an upsert would.
  if target_clan is not null then
    insert into public.clan_roles (user_id, clan_id, role)
    values (target, target_clan, 'member')
    on conflict (user_id, clan_id) do nothing;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), target_clan, 'approve', 'users', target,
          jsonb_build_object(
            'status', 'approved',
            'role', case when target_clan is null then null else 'member' end));

  return true;
end;
$$;

revoke execute on function approve_account(uuid) from public;
grant execute on function approve_account(uuid) to authenticated;

comment on function approve_account(uuid) is
  'T3.8 - lifts the pending gate, and grants member of the requested clan when '
  'there is one. A leader cannot approve a clanless account (nothing to approve '
  'into); the platform admin can, as 015 intends (017, 018).';
