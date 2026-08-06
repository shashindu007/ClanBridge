-- T6.4, second half — "Members may claim an unassigned target."
--
-- 024 shipped assign_war_target() and clear_war_target(), both of which raise
-- for anyone below co-leader. That is correct for assignment. It also means the
-- sentence above, which is in the task text, has no write path at all: a member
-- can read the board and change nothing on it.
--
-- This is the fifth table in this project to reach a page before it reached a
-- grant (021 announcements, 022 cwl_bonuses, 023 push_subscriptions, 024
-- war_targets for leadership, and now war_targets for members). The pattern is
-- consistent enough to state plainly: a feature is not writable because someone
-- wrote a form for it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A CLAIM IS NOT JUST assign_war_target WITH A WEAKER ROLE CHECK
--
-- Four rules differ, and each of them is the difference between "members can
-- self-organise" and "members can quietly undo the leader's plan":
--
--   1. YOU MAY ONLY CLAIM FOR YOURSELF. The player is resolved from
--      players.user_id = auth.uid(), never passed in. A p_player argument would
--      be an authorisation decision made by the caller.
--
--   2. YOU MAY NOT TAKE A BASE SOMEONE ELSE HOLDS. Asymmetric with the leader's
--      function on purpose: 003 puts no unique constraint on
--      (war_id, target_position) because double-hitting a base is a legitimate
--      thing for a leader to order. A member helping themselves to base 3
--      because it looks easy is not the same act, and the check below is the
--      only thing that separates them.
--
--   3. YOU MAY NOT OVERWRITE AN ASSIGNMENT MADE BY SOMEBODY ELSE. Re-claiming
--      your own previous claim is fine — that is changing your mind. Replacing
--      what your co-leader told you to do is not a claim, it is a refusal, and
--      it must not look identical to one in the audit trail.
--
--   4. THE AUDIT ACTION IS DIFFERENT. 'claim-target', not 'assign-target', so
--      T9.6's viewer can answer "did the leader put me on base 7, or did I?"
--      Recording both as the same action makes that question unanswerable, and
--      it is precisely the question that gets asked after a lost war.
--
-- R12 — like 024's functions, this writes the PLAN and never touches
-- war_attacks. R4 — nothing here deletes; withdrawal is clear_war_target's soft
-- delete, which remains leadership-only by design (see the note at the end).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function claim_war_target(
  p_war      uuid,
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
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  -- R3. Membership, not leadership — that is the whole point of this function —
  -- but still a clan check: a member of clan A may not claim in clan B's war.
  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'you are not in this clan';
  end if;

  -- Same rule as 024. Editing the plan after the outcome is known is how a
  -- "plan versus reality" report quietly becomes one that agrees with itself.
  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  -- Rule 1. Resolved, never supplied. An account with no linked player has not
  -- finished verification (T3.3) and has nothing to claim with — said plainly,
  -- because "nothing happened" on a button press is the most confusing possible
  -- answer to a member who has not realised they never verified.
  select id into v_player
  from public.players
  where user_id = auth.uid() and deleted_at is null
  limit 1;

  if v_player is null then
    raise exception 'no verified player is linked to your account; verify first';
  end if;

  if not exists (
    select 1 from public.war_members
    where war_id = p_war and player_id = v_player and deleted_at is null
  ) then
    raise exception 'you are not in this war';
  end if;

  -- Rule 2. Any LIVE target on that base, held by anyone else.
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

  -- Rule 3. Your own row, whoever put it there.
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

  -- Rule 4.
  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'claim-target', 'war_targets', v_player, v_before,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function claim_war_target(uuid, smallint, text) from public;
grant execute on function claim_war_target(uuid, smallint, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The mirror, and it is narrower than clear_war_target on purpose.
--
-- A member may release a base THEY claimed. They may not release one leadership
-- assigned them — that is clear_war_target's job and it stays leadership-only,
-- because "I dropped the target you gave me" is a conversation, not a button.
--
-- Soft delete (R4): the row stays and both states are in the audit trail, so
-- "who was on base 7 an hour ago" still has an answer.
-- ---------------------------------------------------------------------------
create or replace function release_war_target(p_war uuid)
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
  v_by     uuid;
begin
  if auth.uid() is null or p_war is null then
    return false;
  end if;

  select clan_id, state into v_clan, v_state
  from public.wars
  where id = p_war and deleted_at is null;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'you are not in this clan';
  end if;

  if v_state = 'warEnded' then
    raise exception 'this war has ended; its plan can no longer be changed';
  end if;

  select id into v_player
  from public.players
  where user_id = auth.uid() and deleted_at is null
  limit 1;

  if v_player is null then
    return false;
  end if;

  select to_jsonb(t), t.assigned_by into v_before, v_by
  from public.war_targets t
  where t.war_id = p_war and t.player_id = v_player and t.deleted_at is null;

  if v_before is null then
    return false;                      -- already gone; not an error, not audited twice
  end if;

  if v_by is distinct from auth.uid() then
    raise exception
      'leadership assigned this target; ask them to clear it';
  end if;

  update public.war_targets
  set deleted_at = now()
  where war_id = p_war and player_id = v_player;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), v_clan, 'release-target', 'war_targets', v_player, v_before);

  return true;
end;
$$;

revoke execute on function release_war_target(uuid) from public;
grant execute on function release_war_target(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- NO NEW GRANT ON war_targets, AND THAT IS THE POINT.
--
-- 023's header is worth restating because it is the mistake this project keeps
-- almost making: a policy is not a grant, and Postgres checks the table
-- privilege first. The inverse also holds — these functions are SECURITY
-- DEFINER, so they run as the owner and need no privilege granted to
-- `authenticated` at all. Adding `grant insert on war_targets to authenticated`
-- to "make it work" would open a second, unaudited write path around every rule
-- above, and it would work, which is what makes it dangerous.
--
-- Verify:
--
--   -- as a member with a linked player, in the war:
--   select claim_war_target('<war>', 3::smallint);              -- true
--   select count(*) from audit_log where action = 'claim-target';  -- 1
--
--   -- a second member cannot take the same base:
--   select claim_war_target('<war>', 3::smallint);              -- RAISES
--
--   -- and cannot overwrite what a leader assigned them:
--   select assign_war_target('<war>', '<them>', 5::smallint);   -- as leader
--   select claim_war_target('<war>', 9::smallint);              -- RAISES
--
--   -- releasing your own claim is a soft delete, not a delete:
--   select release_war_target('<war>');
--   select count(*) from war_targets where deleted_at is not null;  -- 1
-- ---------------------------------------------------------------------------
