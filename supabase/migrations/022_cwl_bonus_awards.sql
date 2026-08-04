-- T4.7 / T4B.13 — recording who gets a bonus medal, in the leader's own order.
--
-- cwl_bonuses has existed since 002 and has never been writable: 006 created no
-- insert policy for it and granted only select. So the table that exists
-- specifically to record a justified human decision could not record anything.
--
-- WHY AN ORDER COLUMN
--
-- The rule for allocating bonuses is the LEADER'S FINAL DECISION ORDER, not a
-- formula. The system's job is to lay the evidence out — stars, attacks used,
-- missed days, average destruction (T4B.12) — and then record what the leader
-- decided, in the sequence they decided it.
--
-- That is why `award_order` is stored rather than derived. A ranking computed
-- from contribution can always be recomputed; a leader's judgement cannot. If
-- only the contribution numbers were kept, next season's "why did they get one
-- and I did not" would be answered by re-running a sort, which is precisely the
-- answer that starts the argument.
--
-- R11 — human decision data. No sync job may ever write here; the API does not
-- report bonus allocation at all, which is why this exists nowhere but here.


alter table cwl_bonuses
  add column award_order smallint;

comment on column cwl_bonuses.award_order is
  'The leader''s explicit allocation order (1 = first medal). Stored, not '
  'derived: a computed ranking can be recomputed, a judgement cannot (T4B.13).';

-- One position per season. Two players holding "second" is not an order.
create unique index cwl_bonuses_season_order_idx
  on cwl_bonuses (season_id, award_order)
  where deleted_at is null and award_order is not null;


-- ---------------------------------------------------------------------------
-- award_cwl_bonus(season, player, order, note)
--
-- A definer function rather than an insert policy, for the reason 015 records at
-- lines 199-207: awarding a bonus must also write audit_log (R4), and expressing
-- it as "which rows may this role write" splits one indivisible act into a
-- permission check and a separate, forgettable audit insert.
--
-- Idempotent on (season_id, player_id), which 002 already made unique — awarding
-- twice updates the order and the note rather than failing, because a leader
-- reordering their list is the normal case, not an error.
-- ---------------------------------------------------------------------------
create or replace function award_cwl_bonus(
  p_season uuid,
  p_player uuid,
  p_order  smallint default null,
  p_note   text default null
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
  if auth.uid() is null or p_season is null or p_player is null then
    return false;
  end if;

  select clan_id into v_clan
  from public.cwl_seasons
  where id = p_season and deleted_at is null;

  if not found then
    return false;
  end if;

  -- Leadership of the clan whose season this is. Checked here, in one readable
  -- place, rather than in a WITH CHECK expression spread across two policies.
  if v_clan not in (select public.auth_leadership_clan_ids()) then
    return false;
  end if;

  select to_jsonb(b) into v_before
  from public.cwl_bonuses b
  where b.season_id = p_season and b.player_id = p_player;

  insert into public.cwl_bonuses (season_id, player_id, awarded_by, award_order, note)
  values (p_season, p_player, auth.uid(), p_order, p_note)
  on conflict (season_id, player_id) do update
    set award_order = excluded.award_order,
        note        = excluded.note,
        awarded_by  = excluded.awarded_by,
        awarded_at  = now(),
        deleted_at  = null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_clan, 'award-bonus', 'cwl_bonuses', p_player, v_before,
          jsonb_build_object('award_order', p_order, 'note', p_note));

  return true;
end;
$$;

revoke execute on function award_cwl_bonus(uuid, uuid, smallint, text) from public;
grant execute on function award_cwl_bonus(uuid, uuid, smallint, text) to authenticated;


-- The mirror, so withdrawing a medal is recorded rather than vanishing. Soft
-- delete (R4): the row stays, and the audit trail keeps both states.
create or replace function withdraw_cwl_bonus(p_season uuid, p_player uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan uuid;
begin
  if auth.uid() is null or p_season is null or p_player is null then
    return false;
  end if;

  select clan_id into v_clan
  from public.cwl_seasons
  where id = p_season and deleted_at is null;

  if not found or v_clan not in (select public.auth_leadership_clan_ids()) then
    return false;
  end if;

  update public.cwl_bonuses
  set deleted_at = now(), award_order = null
  where season_id = p_season and player_id = p_player and deleted_at is null;

  if not found then
    return false;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan, 'withdraw-bonus', 'cwl_bonuses', p_player,
          jsonb_build_object('withdrawn', true));

  return true;
end;
$$;

revoke execute on function withdraw_cwl_bonus(uuid, uuid) from public;
grant execute on function withdraw_cwl_bonus(uuid, uuid) to authenticated;


-- Read stays as 006 left it: "read own clan cwl bonuses", via the season join.
-- No insert or update policy is added, deliberately — the functions above are
-- the only write path, so every award is audited by construction.
grant select on cwl_bonuses to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verify:
--
--   select has_table_privilege('authenticated', 'cwl_bonuses', 'insert');
--     -- expect FALSE. If true, an unaudited award is possible.
-- ---------------------------------------------------------------------------
