-- 050 — A member may hold as many targets as they have attacks left.
--
-- 003 gave war_targets `unique (war_id, player_id)`: one target per member per
-- war. A regular war gives two attacks, so a leader could plan only half of
-- them — "Kasun hits 7, then cleans up 12" had nowhere to go but a note. The
-- clan's rule is now:
--
--   a member may hold up to (attacks allowed − attacks used) OPEN targets,
--   where a target is open until the member has attacked that base;
--   an enemy base still holds ONE member (047).
--
-- With two attacks left a member can be given two bases; after one attack,
-- one more; after both, none. A target already hit stays on the record as the
-- plan (R12) but no longer uses a slot.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CONSTRAINT
--
-- `unique (war_id, player_id)` becomes `unique (war_id, player_id,
-- target_position)`. Existing rows already satisfy it (one per member). It is
-- a full unique, not partial, so a target cleared and given again REVIVES its
-- row (deleted_at back to null) instead of adding a second one — the same
-- one-row, one-history rule as before, now per base (R4).
--
-- THE FUNCTIONS
--
--   assign_war_target(war, player, position, note, replace)
--       adds a target; `replace` moves the member off one of their bases onto
--       another in one locked step (the old "Change")
--   clear_war_target(war, player, position)      one target, or all when null
--   claim_war_target(war, position, note, player) a member adds one for themselves
--   release_war_target(war, player, position)     gives back the member's OWN claims
--
-- The old signatures are dropped first: an overload left behind would keep the
-- one-slot behaviour reachable, and test/pglite-supabase.ts resolves .rpc()
-- argument types by name alone.
--
-- Every writer still takes 047's lock on the war row first, so the "is this
-- base free" and "does this member have a slot" checks cannot be raced.
-- ─────────────────────────────────────────────────────────────────────────────

alter table war_targets drop constraint if exists war_targets_war_id_player_id_key;
alter table war_targets
  add constraint war_targets_war_player_position_key unique (war_id, player_id, target_position);

create index if not exists war_targets_player_live_idx
  on war_targets (war_id, player_id) where deleted_at is null;


-- ---------------------------------------------------------------------------
-- How many more open targets this member may take, ignoring `p_ignore`
-- (the base being replaced, or the one being assigned again). Internal: only
-- the definer functions below call it.
-- ---------------------------------------------------------------------------
create or replace function war_target_slots_left(
  p_war    uuid,
  p_player uuid,
  p_ignore smallint[] default '{}'
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
    coalesce((select wm.attacks_allowed from public.war_members wm
              where wm.war_id = p_war and wm.player_id = p_player and wm.deleted_at is null), 0)
    - (select count(*) from public.war_attacks a
       where a.war_id = p_war and a.player_id = p_player and a.deleted_at is null)
    - (select count(*) from public.war_targets t
       where t.war_id = p_war and t.player_id = p_player and t.deleted_at is null
         and not (t.target_position = any (p_ignore))
         and not exists (
           select 1 from public.war_attacks a
           where a.war_id = t.war_id and a.player_id = t.player_id
             and a.defender_position = t.target_position and a.deleted_at is null
         ))
  )::integer;
$$;

revoke execute on function war_target_slots_left(uuid, uuid, smallint[]) from public;


drop function if exists assign_war_target(uuid, uuid, smallint, text);
drop function if exists clear_war_target(uuid, uuid);
drop function if exists claim_war_target(uuid, smallint, text, uuid);
drop function if exists release_war_target(uuid, uuid);


-- ---------------------------------------------------------------------------
-- assign_war_target
-- ---------------------------------------------------------------------------
create or replace function assign_war_target(
  p_war      uuid,
  p_player   uuid,
  p_position smallint,
  p_note     text default null,
  p_replace  smallint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan    uuid;
  v_state   text;
  v_before  jsonb;
  v_holder  text;
  v_name    text;
  v_has     boolean;
  v_left    integer;
  v_allowed integer;
begin
  if auth.uid() is null or p_war is null or p_player is null or p_position is null then
    return false;
  end if;

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

  select wm.attacks_allowed into v_allowed
  from public.war_members wm
  where wm.war_id = p_war and wm.player_id = p_player and wm.deleted_at is null;

  if not found then
    raise exception 'that player is not in this war';
  end if;

  -- One member per base (047), naming the holder.
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

  select exists (
    select 1 from public.war_targets
    where war_id = p_war and player_id = p_player and target_position = p_position
      and deleted_at is null
  ) into v_has;

  -- A slot is needed only for a base the member does not already hold. The
  -- base being replaced gives its slot back first.
  if not v_has then
    v_left := public.war_target_slots_left(
      p_war, p_player,
      case when p_replace is null then '{}'::smallint[] else array[p_replace] end
    );
    if v_left <= 0 then
      select name into v_name from public.players where id = p_player;
      raise exception '% has no attacks left to plan — every remaining attack already has a base',
        coalesce(v_name, 'that member');
    end if;
  end if;

  select jsonb_agg(to_jsonb(t)) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = p_player and t.deleted_at is null;

  if p_replace is not null and p_replace <> p_position then
    update public.war_targets
    set deleted_at = now()
    where war_id = p_war and player_id = p_player and target_position = p_replace
      and deleted_at is null;
  end if;

  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, p_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id, target_position) do update
    set note        = excluded.note,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        deleted_at  = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'assign-target', 'war_targets', p_player, v_before,
          jsonb_build_object('target_position', p_position, 'replaced', p_replace, 'note', p_note));

  return true;
end;
$$;

revoke execute on function assign_war_target(uuid, uuid, smallint, text, smallint) from public;
grant execute on function assign_war_target(uuid, uuid, smallint, text, smallint) to authenticated;


-- ---------------------------------------------------------------------------
-- clear_war_target — one base, or every base when p_position is null.
-- Soft delete (R4); leadership only, as in 024.
-- ---------------------------------------------------------------------------
create or replace function clear_war_target(
  p_war      uuid,
  p_player   uuid,
  p_position smallint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan   uuid;
  v_before jsonb;
begin
  if auth.uid() is null or p_war is null or p_player is null then
    return false;
  end if;

  select clan_id into v_clan from public.wars
  where id = p_war and deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  if v_clan not in (select public.auth_leadership_clan_ids()) then
    raise exception 'only a leader or co-leader may clear targets in this war';
  end if;

  select jsonb_agg(to_jsonb(t)) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = p_player and t.deleted_at is null
    and (p_position is null or t.target_position = p_position);

  if v_before is null then
    return false;                      -- already gone; not an error, not audited twice
  end if;

  update public.war_targets
  set deleted_at = now()
  where war_id = p_war and player_id = p_player and deleted_at is null
    and (p_position is null or target_position = p_position);

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), v_clan, 'clear-target', 'war_targets', p_player, v_before);

  return true;
end;
$$;

revoke execute on function clear_war_target(uuid, uuid, smallint) from public;
grant execute on function clear_war_target(uuid, uuid, smallint) to authenticated;


-- ---------------------------------------------------------------------------
-- claim_war_target — a member adds a base for themselves, up to their slots.
--
-- 025's "leadership has already assigned you a target" refusal is gone: it
-- existed because a claim used to REPLACE the member's one target. A claim now
-- only adds, so it cannot undo what leadership planned — and claiming a base
-- leadership already gave you changes nothing, rather than quietly turning the
-- leader's assignment into your own claim.
-- ---------------------------------------------------------------------------
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
  v_holder uuid;
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

  -- 046: the caller's village that is IN this war, never an arbitrary one.
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

  -- Already yours (claimed, or given by leadership): nothing to do.
  if exists (
    select 1 from public.war_targets
    where war_id = p_war and player_id = v_player and target_position = p_position
      and deleted_at is null
  ) then
    return true;
  end if;

  if public.war_target_slots_left(p_war, v_player) <= 0 then
    raise exception 'every attack you have left already has a base; give one back first';
  end if;

  insert into public.war_targets (war_id, player_id, target_position, note, assigned_by)
  values (p_war, v_player, p_position, p_note, auth.uid())
  on conflict (war_id, player_id, target_position) do update
    set note        = excluded.note,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        deleted_at  = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan, 'claim-target', 'war_targets', v_player,
          jsonb_build_object('target_position', p_position, 'note', p_note));

  return true;
end;
$$;

revoke execute on function claim_war_target(uuid, smallint, text, uuid) from public;
grant execute on function claim_war_target(uuid, smallint, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- release_war_target — give back the member's OWN claims: one base, or all of
-- them when p_position is null. A base leadership assigned is theirs to clear.
-- ---------------------------------------------------------------------------
create or replace function release_war_target(
  p_war      uuid,
  p_player   uuid default null,
  p_position smallint default null
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
begin
  if auth.uid() is null or p_war is null then
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

  -- The caller's village that holds a live target here (046).
  select p.id into v_player
  from public.players p
  join public.war_targets t
    on t.player_id = p.id and t.war_id = p_war and t.deleted_at is null
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and (p_player is null or p.id = p_player)
    and (p_position is null or t.target_position = p_position)
  order by p.id
  limit 1;

  if v_player is null then
    return false;                      -- nothing held; not an error, not audited
  end if;

  if p_position is not null and exists (
    select 1 from public.war_targets
    where war_id = p_war and player_id = v_player and target_position = p_position
      and deleted_at is null and assigned_by is distinct from auth.uid()
  ) then
    raise exception 'leadership assigned this target; ask them to clear it';
  end if;

  select jsonb_agg(to_jsonb(t)) into v_before
  from public.war_targets t
  where t.war_id = p_war and t.player_id = v_player and t.deleted_at is null
    and t.assigned_by = auth.uid()
    and (p_position is null or t.target_position = p_position);

  if v_before is null then
    raise exception 'leadership assigned this target; ask them to clear it';
  end if;

  update public.war_targets
  set deleted_at = now()
  where war_id = p_war and player_id = v_player and deleted_at is null
    and assigned_by = auth.uid()
    and (p_position is null or target_position = p_position);

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before)
  values (auth.uid(), v_clan, 'release-target', 'war_targets', v_player, v_before);

  return true;
end;
$$;

revoke execute on function release_war_target(uuid, uuid, smallint) from public;
grant execute on function release_war_target(uuid, uuid, smallint) to authenticated;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- a member with 2 attacks allowed and none used:
--   select assign_war_target('<war>', '<A>', 3::smallint);   -- true
--   select assign_war_target('<war>', '<A>', 7::smallint);   -- true  (second slot)
--   select assign_war_target('<war>', '<A>', 9::smallint);   -- RAISES (no slot)
--   select assign_war_target('<war>', '<A>', 9::smallint, null, 7::smallint); -- true (7 -> 9)
--   select clear_war_target('<war>', '<A>', 3::smallint);    -- true (only base 3)
-- ---------------------------------------------------------------------------
