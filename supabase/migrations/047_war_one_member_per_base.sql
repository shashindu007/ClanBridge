-- 047 — One member per enemy base, for leadership as well as members.
--
-- 025 left leadership free to put two members on one base, on the reasoning
-- that "double-hitting a base is a legitimate thing for a leader to order".
-- The clan's leaders have since said the opposite: a base holds ONE assignment,
-- and a leader who wants a second hit reassigns it once the first attack is in.
-- Two names on one base read, on the board, as a mistake nobody noticed — which
-- is what it usually was.
--
-- So assign_war_target now refuses a base another member already holds, and
-- names them, exactly as claim_war_target has since 025. Reassigning the SAME
-- member to a new base is still an update of their row; clearing it is still
-- clear_war_target's soft delete.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A LOCK AND NOT A UNIQUE INDEX
--
-- The rule is "no two LIVE targets on one base in one war". A partial unique
-- index on (war_id, target_position) where deleted_at is null would say it
-- declaratively, but ended wars planned under 025's rule may already contain
-- two targets on a base. Creating the index would fail on them, and rewriting
-- an ended war's plan to make it pass is the one thing R12 forbids: that plan
-- is the record of what was ordered.
--
-- Instead both writers take a row lock on the war first (`for update`). Every
-- assignment and claim in a war then runs one at a time, so the "is anybody on
-- this base" check cannot be raced by a second click — the hole the check in
-- 025/046 had, where two members pressing the same base at the same instant
-- both saw it free. Wars are small and assignments are rare; serialising them
-- costs nothing anyone can measure.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function assign_war_target(
  p_war      uuid,
  p_player   uuid,
  p_position smallint,
  p_note     text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_state  text;
  v_before jsonb;
  v_holder text;
begin
  if auth.uid() is null or p_war is null or p_player is null then
    return false;
  end if;

  -- The lock. Everything below reads and writes this war's plan, and no other
  -- assignment or claim in the same war can interleave with it.
  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may assign targets in this war';
  end if;

  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  if not exists (
    select 1 from public.war_members
    where war_id = p_war and player_id = p_player and deleted_at is null
  ) then
    raise exception 'that player is not in this war';
  end if;

  -- One member per base. The holder is named, because "base 4 is taken" sends
  -- the leader looking for who; "already assigned to Kasun" does not.
  select coalesce(p.name, 'another member') into v_holder
  from public.war_targets t
  left join public.players p on p.id = t.player_id
  where t.war_id = p_war
    and t.target_position = p_position
    and t.player_id <> p_player
    and t.deleted_at is null
  limit 1;

  if v_holder is not null then
    raise exception 'base % is already assigned to %', p_position, v_holder;
  end if;

  select to_jsonb(t) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = p_player;

  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, p_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id) do update
    set target_position = excluded.target_position,
        note            = excluded.note,
        assigned_by     = excluded.assigned_by,
        assigned_at     = now(),
        deleted_at      = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'assign-target', 'war_targets', p_player, v_before,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function assign_war_target(uuid, uuid, smallint, text) from public;
grant execute on function assign_war_target(uuid, uuid, smallint, text) to authenticated;


-- claim_war_target: 046's body, unchanged except for the same war-row lock, so
-- a claim and an assignment (or two claims) on one base cannot both succeed.
create or replace function claim_war_target(
  p_war      uuid,
  p_position smallint,
  p_note     text default null,
  p_player   uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_state  text;
  v_player uuid;
  v_before jsonb;
  v_holder uuid;
  v_by     uuid;
begin
  if auth.uid() is null or p_war is null or p_position is null then
    return false;
  end if;

  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'you are not in this clan';
  end if;

  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  if not exists (
    select 1 from public.players
    where user_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'no verified player is linked to your account; verify first';
  end if;

  select p.id into v_player
  from public.players p
  join public.war_members wm
    on wm.player_id = p.id and wm.war_id = p_war and wm.deleted_at is null
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and (p_player is null or p.id = p_player)
  order by p.id
  limit 1;

  if v_player is null then
    raise exception 'you are not in this war';
  end if;

  select player_id into v_holder
  from public.war_targets
  where war_id = p_war
    and target_position = p_position
    and player_id <> v_player
    and deleted_at is null
  limit 1;

  if v_holder is not null then
    raise exception 'base % is already taken', p_position;
  end if;

  select to_jsonb(t), t.assigned_by into v_before, v_by
  from public.war_targets t
  where t.war_id = p_war and t.player_id = v_player and t.deleted_at is null;

  if v_by is not null and v_by <> auth.uid() then
    raise exception
      'leadership has already assigned you a target; ask them to change it';
  end if;

  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, v_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id) do update
    set target_position = excluded.target_position,
        note            = excluded.note,
        assigned_by     = excluded.assigned_by,
        assigned_at     = now(),
        deleted_at      = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'claim-target', 'war_targets', v_player, v_before,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function claim_war_target(uuid, smallint, text, uuid) from public;
grant execute on function claim_war_target(uuid, smallint, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   select assign_war_target('<war>', '<A>', 3::smallint);   -- true
--   select assign_war_target('<war>', '<B>', 3::smallint);   -- RAISES: already assigned to <A's name>
--   select assign_war_target('<war>', '<A>', 5::smallint);   -- true (A moves)
--   select assign_war_target('<war>', '<B>', 3::smallint);   -- true (3 is free again)
-- ---------------------------------------------------------------------------
